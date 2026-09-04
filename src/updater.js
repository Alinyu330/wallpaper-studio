// updater.js — 更新检查与应用内直接安装（GitHub Releases）
//
// 设计原则（对齐用户需求）：
// - 只在「客户端主窗口打开时」触发自动检查（含从托盘重新显示），后台驻留不检查；
// - 自动检查全程无弹窗：结果只通过 update:status 事件推给主界面做文字/亮点提示；
// - 手动「检查更新」发现新版本 → 弹出新版本功能介绍窗口（Release Notes）；
// - 选择更新 → 应用内直接下载 NSIS 安装包（带进度）→ 静默安装 → 退出，不跳网页。
const { app, net, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASES_LATEST_URL = 'https://api.github.com/repos/Alinyu330/wallpaper-studio/releases/latest';
const RELEASES_PAGE_URL = 'https://github.com/Alinyu330/wallpaper-studio/releases/latest';
const CHECK_TIMEOUT_MS = 10000;
const AUTO_CHECK_MIN_INTERVAL = 10 * 60 * 1000; // 自动检查最小间隔（防频繁打扰）

let lastCheckAt = 0;
let activeDownload = null; // { req, cancelled } 单例：同一时间只允许一个下载任务

/** 解析 semver（容错 v 前缀与后缀），失败返回 null */
function parseVersion(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^v?(\d+)\.(\d+)\.(\d+)/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** a > b ？（版本号逐段比较） */
function versionGt(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** GET JSON（走 Electron net，尊重系统代理；带超时） */
function fetchJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request(url);
    } catch (e) {
      return reject(e);
    }
    req.setHeader('User-Agent', 'wallpaper-studio-updater');
    const timer = setTimeout(() => {
      try { req.destroy(); } catch (_) {}
      reject(new Error('请求超时'));
    }, timeoutMs);
    req.on('response', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });
}

/** 从 Release 资产中找出 NSIS 安装包（WallpaperStudio-Setup-x.y.z.exe） */
function findInstallerAsset(rel) {
  const assets = Array.isArray(rel?.assets) ? rel.assets : [];
  if (!assets.length) return null;
  return assets.find(a => /^WallpaperStudio-Setup-.+\.exe$/i.test(a.name || ''))
      || assets.find(a => /setup.+\.exe$/i.test(a.name || ''))
      || null;
}

/**
 * 检查一次更新
 * @returns {Promise<{hasUpdate:boolean, current:string, latest:string,
 *                    releaseUrl:string, notes?:string, publishedAt?:string,
 *                    installerUrl?:string, installerName?:string, installerSize?:number,
 *                    error?:string}>}
 */
async function checkForUpdate() {
  const current = app.getVersion();
  const result = { hasUpdate: false, current, latest: current, releaseUrl: RELEASES_PAGE_URL };
  try {
    const rel = await fetchJson(RELEASES_LATEST_URL, CHECK_TIMEOUT_MS);
    const latest = parseVersion(rel.tag_name || rel.name);
    const cur = parseVersion(current);
    if (!latest) throw new Error('无法解析版本号');
    result.latest = latest.join('.');
    result.releaseUrl = rel.html_url || RELEASES_PAGE_URL;
    result.publishedAt = typeof rel.published_at === 'string' ? rel.published_at : undefined;
    result.notes = typeof rel.body === 'string' ? rel.body.slice(0, 4000) : undefined;
    const asset = findInstallerAsset(rel);
    if (asset && asset.browser_download_url) {
      result.installerUrl = asset.browser_download_url;
      result.installerName = asset.name;
      result.installerSize = Number(asset.size) || 0;
    }
    if (!cur || versionGt(latest, cur)) result.hasUpdate = true;
  } catch (e) {
    result.error = e.message || '网络请求失败';
  }
  return result;
}

/**
 * 自动检查（主窗口打开/显示时调用）：
 * 限频 + 静默，结果通过回调交给调用方推送主界面
 */
async function autoCheck(force = false) {
  const now = Date.now();
  if (!force && now - lastCheckAt < AUTO_CHECK_MIN_INTERVAL) return null;
  lastCheckAt = now;
  const result = await checkForUpdate();
  if (result.error) {
    console.warn(`[updater] 自动检查更新失败: ${result.error}`);
  } else {
    console.log(`[updater] 检查更新: 当前 v${result.current} / 最新 v${result.latest}${result.hasUpdate ? ' → 有新版本' : ' → 已是最新'}`);
  }
  return result;
}

/** 打开发布页（兜底入口：发布页含 NSIS 安装包） */
function openDownloadPage(url) {
  shell.openExternal(url || RELEASES_PAGE_URL);
}

/**
 * 下载最新版 NSIS 安装包到临时目录（流式写入，带进度回调）
 * 每次调用都会重新请求 latest Release，确保拿到的是当前最新安装包
 * @param {(p:{percent:number, receivedBytes:number, totalBytes:number})=>void} onProgress
 * @returns {Promise<{installerPath:string, totalBytes:number}>}
 */
async function downloadLatestInstaller(onProgress) {
  const rel = await fetchJson(RELEASES_LATEST_URL, CHECK_TIMEOUT_MS);
  const asset = findInstallerAsset(rel);
  if (!asset || !asset.browser_download_url) throw new Error('发布页未找到可用的安装包');
  const url = asset.browser_download_url;
  const knownSize = Number(asset.size) || 0;

  const dir = path.join(app.getPath('temp'), 'wallpaper-studio-update');
  await fs.promises.mkdir(dir, { recursive: true });
  const installerPath = path.join(dir, asset.name || 'WallpaperStudio-Setup.exe');
  // 清理同名残留（上次未完成/未清理的）
  try { await fs.promises.rm(installerPath, { force: true }); } catch (_) {}

  return await new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request(url);
    } catch (e) {
      return reject(e);
    }
    req.setHeader('User-Agent', 'wallpaper-studio-updater');
    const stream = fs.createWriteStream(installerPath);
    let received = 0;
    let lastEmit = 0;
    let settled = false;

    const cleanup = () => {
      try { stream.destroy(); } catch (_) {}
      fs.promises.rm(installerPath, { force: true }).catch(() => {});
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      activeDownload = null;
      cleanup();
      reject(err);
    };

    activeDownload = { req, cancelled: false };

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        return fail(new Error(`下载失败（HTTP ${res.statusCode}）`));
      }
      const totalBytes = Number(res.headers['content-length']) || knownSize;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (!stream.write(chunk)) {
          stream.once('drain', () => { try { res.resume(); } catch (_) {} });
          res.pause();
        }
        const now = Date.now();
        if (now - lastEmit > 150 || (totalBytes && received >= totalBytes)) {
          lastEmit = now;
          try {
            onProgress && onProgress({
              percent: totalBytes ? Math.min(100, (received / totalBytes) * 100) : 0,
              receivedBytes: received,
              totalBytes,
            });
          } catch (_) {}
        }
      });
      res.on('end', () => {
        stream.end(() => {
          if (settled) return;
          settled = true;
          activeDownload = null;
          try {
            onProgress && onProgress({ percent: 100, receivedBytes: received, totalBytes: totalBytes || received });
          } catch (_) {}
          resolve({ installerPath, totalBytes: totalBytes || received });
        });
      });
      res.on('error', fail);
    });
    req.on('error', fail);
    req.end();
  });
}

/** 取消当前下载（删除半成品文件） */
function cancelDownload() {
  const dl = activeDownload;
  if (!dl) return false;
  dl.cancelled = true;
  activeDownload = null;
  try { dl.req.destroy(new Error('已取消')); } catch (_) {
    try { dl.req.abort(); } catch (_) {}
  }
  return true;
}

/** 运行 NSIS 安装包（/S 静默模式），拉起后立即返回 */
function runInstaller(installerPath) {
  const child = spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return true;
}

module.exports = { checkForUpdate, autoCheck, openDownloadPage, downloadLatestInstaller, cancelDownload, runInstaller };
