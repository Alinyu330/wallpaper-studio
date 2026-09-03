// updater.js — 静默更新检查（GitHub Releases）
//
// 设计原则（对齐用户需求）：
// - 只在「客户端主窗口打开时」触发自动检查（含从托盘重新显示），后台驻留不检查；
// - 检查全程无弹窗：结果只通过 update:status 事件推给主界面做文字/亮点提示；
// - 没有新版本 → 设置页文字提示"已是最新版本"；
// - 有新版本 → 标题栏版本号旁的呼吸小圆点 + 设置页"前往下载"按钮，
//   是否更新完全由用户决定（打开发布页手动下载安装）。
const { app, net, shell } = require('electron');

const RELEASES_LATEST_URL = 'https://api.github.com/repos/Alinyu330/wallpaper-studio/releases/latest';
const RELEASES_PAGE_URL = 'https://github.com/Alinyu330/wallpaper-studio/releases/latest';
const CHECK_TIMEOUT_MS = 10000;
const AUTO_CHECK_MIN_INTERVAL = 10 * 60 * 1000; // 自动检查最小间隔（防频繁打扰）

let lastCheckAt = 0;

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

/**
 * 检查一次更新
 * @returns {Promise<{hasUpdate:boolean, current:string, latest:string,
 *                    releaseUrl:string, notes?:string, error?:string}>}
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
    result.notes = typeof rel.body === 'string' ? rel.body.slice(0, 600) : undefined;
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

/** 打开下载页（发布页含 NSIS 安装包） */
function openDownloadPage(url) {
  shell.openExternal(url || RELEASES_PAGE_URL);
}

module.exports = { checkForUpdate, autoCheck, openDownloadPage };
