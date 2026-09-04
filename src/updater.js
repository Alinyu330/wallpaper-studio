// updater.js — 更新检查与应用内直接安装（GitHub Releases）
//
// 设计原则（对齐用户需求）：
// - 只在「客户端主窗口打开时」触发自动检查（含从托盘重新显示），后台驻留不检查；
// - 自动检查全程无弹窗：结果只通过 update:status 事件推给主界面做文字/亮点提示；
// - 手动「检查更新」发现新版本 → 弹出新版本功能介绍窗口（Release Notes）；
// - 选择更新 → 应用内分片并发下载 NSIS 安装包（带进度）→ 校验 → 静默安装 → 退出，不跳网页。
//
// ---------------------------------------------------------------------------
// 下载链路（修复「点击检查更新后进度一直为 0」）
//
// 【旧实现的两个致命缺陷】
//   1) 无超时/重试/续传：国内直连 GitHub Release CDN 时，连接常在收到首包后无限期
//      stall（实测 146 秒 0 字节），旧代码毫无感知 → 进度永久停在 0%，只能杀进程；
//      直连还可能直接 net::ERR_CONNECTION_RESET / ERR_CONNECTION_TIMED_OUT。
//   2) 单连接吞吐极低：实测仅 20~30KB/s，115MB 安装包要下载 60 分钟以上。
//
// 【传输层选型（实测决定，勿随意改回 electron net）】
//   并发 Range 分片时，两种传输表现完全相反（同一网络、同一镜像，各跑 20s）：
//                      1 并发    4 并发    8 并发
//     electron net     19KB/s    11KB/s    6KB/s   ← 并发越多越慢，直接崩塌
//     node https       28KB/s   132KB/s  314KB/s   ← 正常线性扩展
//   原因：electron 的 net 走 Chromium 网络服务进程，每个数据块都要跨进程回传主进程，
//   并发流一多就被 IPC 拖垮。因此分片并发必须用 node https。
//   但 node https 不认系统代理，故保留 electron net 作为兜底传输（自动尊重系统代理）：
//   先探测 node 是否可用，不可用再整体切换 electron net，无需解析代理配置。
//
// 【新实现要点】
//   1) 多源测速择优：GitHub 官方 + 与官网「国内高速下载」一致的加速节点并行探测，取最快；
//   2) Range 分片并发：node https 8 并发约 314KB/s（单连接 28KB/s，约 11 倍）；
//   3) 分片边收边落盘：重试从「已落盘字节」续传，而不是丢掉重来（见下方说明）；
//   4) 完整性校验：优先用 GitHub API 每个资产自带的 digest(sha256)，拿不到再退 latest.yml
//      的 sha512 —— 校验通过才执行安装包，这是安全使用第三方加速节点的前提；
//   5) 真实进度上报：百分比(1 位小数) + 已下载/总量 + 实时速度 + 预计剩余 + 当前下载源。
//
// 【为什么分片必须边收边落盘】
//   旧的分片实现把整段收到内存后才写盘，失败即把 segPart 归零 —— 加速节点在慢速下
//   频繁 stall，一个 1.8MB 分片下到 1.5MB 被中断就白下 36 秒，8 个分片反复如此，
//   表现为「百分比长时间钉在同一个值不动、速度却有数字」，最终整体无进展而失败。
//   改成每收到一块就按绝对偏移写盘后，segPart 即已落盘字节，重试直接从该处续传，
//   进度单调推进且常驻内存与并发数/分片大小无关。
// ---------------------------------------------------------------------------
const { app, net, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const crypto = require('crypto');

const RELEASES_LATEST_URL = 'https://api.github.com/repos/Alinyu330/wallpaper-studio/releases/latest';
const RELEASES_PAGE_URL = 'https://github.com/Alinyu330/wallpaper-studio/releases/latest';
const CHECK_TIMEOUT_MS = 12000;
const AUTO_CHECK_MIN_INTERVAL = 10 * 60 * 1000; // 自动检查最小间隔（防频繁打扰）

// ---- 下载源：官方直连 + 官网已在用的国内加速节点（前缀拼接原始 URL）----
// 实测（8 并发 Range，各 15s）：gh-proxy.com 247KB/s、ghproxy.net 153KB/s、ghfast.top 超时；
// 不可用的源由测速阶段自动剔除，故多列几个只会增加命中概率。
const MIRRORS = [
  { name: 'GitHub 官方', prefix: '' },
  { name: '加速节点 1', prefix: 'https://gh-proxy.com/' },
  { name: '加速节点 2', prefix: 'https://ghproxy.net/' },
  { name: '加速节点 3', prefix: 'https://ghfast.top/' },
];

// ---- 分片并发下载参数 ----
const SEG_MIN = 1024 * 1024;        // 分片下限 1MB
const SEG_MAX = 8 * 1024 * 1024;    // 分片上限 8MB（分片边收边落盘，大小不再决定内存占用）
const STALL_TIMEOUT_MS = 12000;     // 分片 12s 无任何数据 → 判定停滞，重连续传
const CONNECT_TIMEOUT_MS = 20000;   // 20s 拿不到响应头 → 判定连接失败
const SEG_MAX_RETRY = 30;           // 单分片最大重试次数（抖动网络下重试是常态，
                                    // 真正的放弃条件由下面的「整体无进展」看门狗决定）
const NO_PROGRESS_TIMEOUT_MS = 90000; // 整体 90s 没收到任何新字节 → 判定该源不可用，换源
const PROBE_BYTES = 256 * 1024;     // 测速取样大小
const PROBE_MAX_MS = 9000;          // 单源测速上限
// 并发数按传输方式区分：node https 并发能线性提速（实测加速节点 8/16/24 并发分别
// 247/601/957 KB/s），但 24 并发已开始被节点限流（HTTP 503），故取 16 这一档：
// 所有可用节点都不报错，110MB 安装包约 3 分钟下完。
// electron net 会被并发拖垮，只保留少量。
const TRANSPORTS = [
  { id: 'node', label: '直连', concurrency: 16 },
  { id: 'electron', label: '系统代理', concurrency: 2 },
];

const UA = 'wallpaper-studio-updater';

let lastCheckAt = 0;
let activeDownload = null; // { cancelled, reqs:Set } 单例：同一时间只允许一个下载任务

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 给 URL 套上加速节点前缀 */
function mirrorUrl(prefix, url) {
  return prefix ? prefix + url : url;
}

// ---------------------------------------------------------------------------
// 元数据请求（数据量小，统一走 electron net：自动尊重系统代理）
// ---------------------------------------------------------------------------

/**
 * GET（走 Electron net，尊重系统代理；带超时）
 * @param {string|string[]} urls 依次尝试的候选地址（前一个失败才试下一个）
 * @returns {Promise<{status:number, body:string}>}
 */
function fetchTextAny(urls, timeoutMs) {
  const list = Array.isArray(urls) ? urls.slice() : [urls];
  let lastErr = new Error('网络请求失败');
  const attempt = (url) => new Promise((resolve, reject) => {
    let req;
    try {
      req = net.request(url);
    } catch (e) {
      return reject(e);
    }
    req.setHeader('User-Agent', UA);
    const timer = setTimeout(() => {
      try { req.destroy(); } catch (_) {}
      reject(new Error('请求超时'));
    }, timeoutMs);
    req.on('response', (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        clearTimeout(timer);
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve({ status: res.statusCode, body: data });
      });
    });
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.end();
  });

  return (async () => {
    for (const url of list) {
      try {
        return await attempt(url);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  })();
}

/** GET JSON（多源兜底） */
async function fetchJsonAny(urls, timeoutMs) {
  const { body } = await fetchTextAny(urls, timeoutMs);
  try {
    return JSON.parse(body);
  } catch (e) {
    throw new Error('更新信息解析失败');
  }
}

/** 候选地址列表：官方 + 各加速节点 */
function candidateUrls(url) {
  return MIRRORS.map((m) => mirrorUrl(m.prefix, url));
}

/** 解析 electron-builder 生成的 latest.yml，取顶层 sha512 / size */
function parseLatestYml(text) {
  if (!text) return null;
  let sha512 = null;
  let size = 0;
  let version = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    let m;
    // 顶层字段不带缩进；files 下的同名字段带缩进，用 ^ 锚定避免取错
    if (!sha512 && (m = line.match(/^sha512:\s*(\S+)/))) sha512 = m[1];
    else if (!size && (m = line.match(/^size:\s*(\d+)/))) size = Number(m[1]);
    else if (!version && (m = line.match(/^version:\s*(\S+)/))) version = m[1];
  }
  return sha512 ? { sha512, size, version } : null;
}

/** 取安装包的 sha512（用于校验加速节点下载结果的完整性） */
async function fetchInstallerChecksum(tag) {
  if (!tag) return null;
  const ymlUrl = `https://github.com/Alinyu330/wallpaper-studio/releases/download/${tag}/latest.yml`;
  try {
    const { body } = await fetchTextAny(candidateUrls(ymlUrl), CHECK_TIMEOUT_MS);
    return parseLatestYml(body);
  } catch (e) {
    console.warn(`[updater] 获取校验值失败（将仅使用官方源）: ${e.message}`);
    return null;
  }
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
    const rel = await fetchJsonAny(candidateUrls(RELEASES_LATEST_URL), CHECK_TIMEOUT_MS);
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

/** 校验磁盘剩余空间是否足够（避免下到一半才失败） */
function ensureFreeSpace(dir, needed) {
  let e0 = null;
  try {
    const stat = fs.statfsSync(dir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    if (free && free < needed) {
      throw new Error(`磁盘空间不足（需要 ${Math.ceil(needed / 1048576)}MB，可用 ${Math.floor(free / 1048576)}MB）`);
    }
    return;
  } catch (e) {
    e0 = e;
  }
  // 仅当确实检测到空间不足时抛出；statfs 不可用则忽略，交给写入阶段自然报错
  if (e0 && String(e0.message || '').includes('磁盘空间不足')) throw e0;
}

// ---------------------------------------------------------------------------
// 传输层：node https（高吞吐）/ electron net（尊重系统代理，兜底）
// ---------------------------------------------------------------------------

function makeNodeAgent() {
  try {
    // 不设置 agent 级 timeout：连接/停滞判定统一由 fetchRange 内的看门狗负责，
    // 避免两套超时互相干扰（分片等待期间 socket 是空闲的）。
    return new https.Agent({ keepAlive: true, maxSockets: 32 });
  } catch (_) {
    return undefined;
  }
}

/**
 * node https 发起 GET（自动跟随重定向）
 * @param {object} ctrl 控制器，持有当前 req 以便中断：{ req }
 */
function nodeRequest(url, headers, agent, onResponse, ctrl, redirectsLeft = 5) {
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    onResponse(null, e);
    return;
  }
  const lib = u.protocol === 'http:' ? http : https;
  let req;
  try {
    req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: `${u.pathname}${u.search}`,
      method: 'GET',
      headers,
      agent: u.protocol === 'https:' ? agent : undefined,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          onResponse(null, new Error('重定向次数过多'));
          return;
        }
        let next;
        try {
          next = new URL(res.headers.location, url).toString();
        } catch (e) {
          onResponse(null, e);
          return;
        }
        nodeRequest(next, headers, agent, onResponse, ctrl, redirectsLeft - 1);
        return;
      }
      onResponse(res, null);
    });
  } catch (e) {
    onResponse(null, e);
    return;
  }
  ctrl.req = req;
  req.on('error', (e) => onResponse(null, e));
  req.end();
}

/**
 * node https：流式拉取一个字节区间（连接超时 + 停滞超时）
 * 每收到一块立即回调 onChunk(chunk, 该块在文件中的绝对偏移)，由调用方落盘 ——
 * 不在内存里攒整段，重试才能从「已落盘处」续传。
 * @returns {Promise<number>} 实际收到的字节数
 */
function nodeFetchRange(url, from, to, onChunk, ctx, agent) {
  const expect = to - from + 1;
  return new Promise((resolve, reject) => {
    const ctrl = { req: null };
    // 取消时需要能中断：登记一个持有当前 req 的句柄（重定向后 req 会变）
    const handle = {
      destroy: () => { try { if (ctrl.req) ctrl.req.destroy(); } catch (_) {} },
    };
    let settled = false;
    let got = 0;
    let lastAt = Date.now();
    const settle = (err, n) => {
      if (settled) return;
      settled = true;
      clearTimeout(connTimer);
      clearInterval(wd);
      if (ctx && ctx.reqs) ctx.reqs.delete(handle);
      try { if (ctrl.req) ctrl.req.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(n);
    };
    if (ctx && ctx.reqs) ctx.reqs.add(handle);
    const wd = setInterval(() => {
      if (!settled && Date.now() - lastAt > STALL_TIMEOUT_MS) settle(new Error('下载停滞'));
    }, 2000);
    const connTimer = setTimeout(() => settle(new Error('连接超时')), CONNECT_TIMEOUT_MS);
    nodeRequest(url, { 'User-Agent': UA, Range: `bytes=${from}-${to}` }, agent, (res, err) => {
      if (err) return settle(err);
      if (res.statusCode === 200) {
        res.resume();
        return settle(new Error('该下载源不支持断点续传'));
      }
      if (res.statusCode !== 206) {
        res.resume();
        return settle(new Error(`HTTP ${res.statusCode}`));
      }
      res.on('data', (c) => {
        if (settled) return;
        lastAt = Date.now();
        const pos = from + got;
        got += c.length;
        try { onChunk && onChunk(c, pos); } catch (_) {}
        if (got >= expect) settle(null, got);
      });
      res.on('end', () => {
        if (got >= expect) settle(null, got);
        else settle(new Error(`数据不完整（${got}/${expect} 字节）`));
      });
      res.on('error', (e) => settle(e));
    }, ctrl);
  });
}

/** electron net：流式拉取一个字节区间（用于系统代理环境兜底，契约同 nodeFetchRange） */
function electronFetchRange(url, from, to, onChunk, ctx) {
  const expect = to - from + 1;
  return new Promise((resolve, reject) => {
    let req;
    let settled = false;
    let got = 0;
    let lastAt = Date.now();
    const settle = (err, n) => {
      if (settled) return;
      settled = true;
      clearTimeout(connTimer);
      clearInterval(wd);
      if (ctx && ctx.reqs) ctx.reqs.delete(req);
      try { req.destroy(); } catch (_) {}
      if (err) reject(err);
      else resolve(n);
    };
    try {
      req = net.request(url);
    } catch (e) {
      return reject(e);
    }
    if (ctx && ctx.reqs) ctx.reqs.add(req);
    req.setHeader('User-Agent', UA);
    req.setHeader('Range', `bytes=${from}-${to}`);
    const connTimer = setTimeout(() => settle(new Error('连接超时')), CONNECT_TIMEOUT_MS);
    const wd = setInterval(() => {
      if (!settled && Date.now() - lastAt > STALL_TIMEOUT_MS) settle(new Error('下载停滞'));
    }, 2000);
    req.on('response', (res) => {
      clearTimeout(connTimer);
      if (res.statusCode === 200) return settle(new Error('该下载源不支持断点续传'));
      if (res.statusCode !== 206) return settle(new Error(`HTTP ${res.statusCode}`));
      res.on('data', (c) => {
        if (settled) return;
        lastAt = Date.now();
        const pos = from + got;
        got += c.length;
        try { onChunk && onChunk(c, pos); } catch (_) {}
        if (got >= expect) settle(null, got);
      });
      res.on('end', () => {
        if (got >= expect) settle(null, got);
        else settle(new Error(`数据不完整（${got}/${expect} 字节）`));
      });
      res.on('error', (e) => settle(e));
    });
    req.on('error', (e) => settle(e));
    req.end();
  });
}

function fetchRangeByTransport(transport, url, from, to, onChunk, ctx, agent) {
  return transport === 'node'
    ? nodeFetchRange(url, from, to, onChunk, ctx, agent)
    : electronFetchRange(url, from, to, onChunk, ctx);
}

// ---------------------------------------------------------------------------
// 测速选源
// ---------------------------------------------------------------------------

/** node https 版测速 */
function nodeProbe(src, totalBytes, agent) {
  return new Promise((resolve) => {
    const want = Math.min(PROBE_BYTES, totalBytes);
    const ctrl = { req: null };
    let settled = false;
    let got = 0;
    const t0 = Date.now();
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (ctrl.req) ctrl.req.destroy(); } catch (_) {}
      const ms = Date.now() - t0;
      resolve({ ok, name: src.name, url: src.url, official: src.official, score: ok ? got / Math.max(1, ms) : 0, ms, bytes: got });
    };
    const timer = setTimeout(() => finish(got > 0), PROBE_MAX_MS);
    nodeRequest(src.url, { 'User-Agent': UA, Range: `bytes=0-${want - 1}` }, agent, (res, err) => {
      if (err) return finish(false);
      if (res.statusCode !== 206) {
        res.resume();
        return finish(false);
      }
      res.on('data', (c) => {
        got += c.length;
        if (got >= want) finish(true);
      });
      res.on('end', () => finish(got >= want));
      res.on('error', () => finish(false));
    }, ctrl);
  });
}

/** electron net 版测速 */
function electronProbe(src, totalBytes) {
  return new Promise((resolve) => {
    const want = Math.min(PROBE_BYTES, totalBytes);
    let req = null;
    let settled = false;
    let got = 0;
    const t0 = Date.now();
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (req) req.destroy(); } catch (_) {}
      const ms = Date.now() - t0;
      resolve({ ok, name: src.name, url: src.url, official: src.official, score: ok ? got / Math.max(1, ms) : 0, ms, bytes: got });
    };
    const timer = setTimeout(() => finish(got > 0), PROBE_MAX_MS);
    try {
      req = net.request(src.url);
    } catch (e) {
      clearTimeout(timer);
      return finish(false);
    }
    req.setHeader('User-Agent', UA);
    req.setHeader('Range', `bytes=0-${want - 1}`);
    req.on('response', (res) => {
      // 206 = 支持断点续传（分片下载的前提）；200 = 该源不支持 Range，放弃
      if (res.statusCode !== 206) return finish(false);
      res.on('data', (c) => {
        got += c.length;
        if (got >= want) finish(true);
      });
      res.on('end', () => finish(got >= want));
      res.on('error', () => finish(false));
    });
    req.on('error', () => finish(false));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// 完整性校验 + 进度上报
// ---------------------------------------------------------------------------

/** 计算文件哈希，统一返回小写 hex（算法取 'sha256' / 'sha512'） */
function hashOfFile(algo, filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const s = fs.createReadStream(filePath);
    s.on('data', (d) => hash.update(d));
    s.on('end', () => resolve(hash.digest('hex')));
    s.on('error', reject);
  });
}

/**
 * 解析 GitHub API 资产自带的 digest（形如 "sha256:abc..."）
 * 这是首选校验源：检查更新时已随 Release 元数据一并拿到，无需额外请求
 */
function parseAssetDigest(digest) {
  if (typeof digest !== 'string') return null;
  const m = digest.trim().match(/^(sha256|sha512):([0-9a-f]+)$/i);
  if (!m) return null;
  return { algo: m[1].toLowerCase(), hex: m[2].toLowerCase(), origin: 'GitHub API' };
}

/** 把 latest.yml 的 base64 sha512 归一成同样的 { algo, hex } 形状 */
function fromBase64Sha512(b64) {
  if (!b64) return null;
  try {
    return { algo: 'sha512', hex: Buffer.from(String(b64).trim(), 'base64').toString('hex'), origin: 'latest.yml' };
  } catch (_) {
    return null;
  }
}

/** 进度上报器：节流 + 速度/剩余时间估算 */
function createProgressReporter(totalBytes, onProgress) {
  const samples = []; // { t, received }
  let lastEmit = 0;
  let lastReported = 0;
  return function report(received, extra) {
    const now = Date.now();
    samples.push({ t: now, received });
    while (samples.length > 2 && now - samples[0].t > 6000) samples.shift();
    let speed = 0;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dt = (b.t - a.t) / 1000;
      if (dt > 0.5) speed = Math.max(0, (b.received - a.received) / dt);
    }
    // 分片重传会让实际字节数回退，展示上保持单调，避免进度条倒退
    lastReported = Math.max(lastReported, received);
    const shown = Math.min(totalBytes, lastReported);
    // 常规进度 250ms 节流；带 note 的事件（换源/重试/校验）1000ms 节流，
    // 避免 8 个分片同时重试时把提示刷屏。
    const minGap = extra ? 1000 : 250;
    if (now - lastEmit < minGap) return;
    lastEmit = now;
    const eta = speed > 1024 ? (totalBytes - shown) / speed : 0;
    try {
      onProgress && onProgress({
        percent: totalBytes ? Math.min(100, (shown / totalBytes) * 100) : 0,
        receivedBytes: shown,
        totalBytes,
        speed,
        eta,
        ...(extra || {}),
      });
    } catch (_) {}
  };
}

// ---------------------------------------------------------------------------
// 分片并发下载
// ---------------------------------------------------------------------------

/**
 * 用指定传输方式 + 指定源做分片并发下载（边收边落盘）
 *
 * 关键点：
 * - segState（segments/segDone/segPart）在整个下载过程中共享，换源/换传输方式时
 *   已完成与已落盘的分片进度都不丢，直接从断点继续（网络不稳时频繁换源，
 *   若每次重头再来会永远下不完）；
 * - segPart 只统计「已写进文件」的字节：写盘链按绝对偏移顺序执行，写完才计数，
 *   因此重试的起点就是磁盘上的真实断点，不会把已下载的数据白扔掉；
 * - 失败判定不看「重试了几次」，而看「整体是否还在推进」：
 *   连续 NO_PROGRESS_TIMEOUT_MS 没有任何新字节才判定该源不可用。
 *   抖动网络下重试是常态，按次数判失败会把可用的源误杀。
 *
 * @param {string} transport 'node' | 'electron'
 */
async function downloadFromSource(segState, src, transport, agent, totalBytes, installerPath, report, ctx) {
  const concurrency = (TRANSPORTS.find((t) => t.id === transport) || TRANSPORTS[0]).concurrency;
  const { segments, segDone, segPart } = segState;

  const received = () => {
    let sum = 0;
    for (let i = 0; i < segments.length; i++) sum += segDone[i] + segPart[i];
    return sum;
  };

  // 'r+'：不截断 —— 已落盘的分片数据必须保留下来供续传
  const fh = await fs.promises.open(installerPath, 'r+');
  try {
    let cursor = 0;
    let retries = 0;
    let fatal = null;
    let lastProgressAt = Date.now();
    let lastReceived = received();

    // 整体推进看门狗：长时间零进展才放弃（旧实现无此机制，stall 后永久卡死）
    const progressWd = setInterval(() => {
      if (fatal || ctx.cancelled) return;
      const now = received();
      if (now > lastReceived) {
        lastReceived = now;
        lastProgressAt = Date.now();
        return;
      }
      if (Date.now() - lastProgressAt > NO_PROGRESS_TIMEOUT_MS) {
        fatal = new Error(`下载长时间无进展（${Math.round(NO_PROGRESS_TIMEOUT_MS / 1000)} 秒无新数据）`);
        for (const r of ctx.reqs) { try { r.destroy(); } catch (_) {} }
      }
    }, 2000);

    const downloadSegment = async (idx) => {
      const seg = segments[idx];
      const segLen = seg.end - seg.start + 1;
      if (segDone[idx] >= segLen) return; // 已完成，跳过（续传场景）

      // 本分片的写盘链：串行执行，保证按绝对偏移落盘；writeErr 单独留存，
      // 磁盘类错误（空间不足/权限）重试没有意义，必须直接上抛。
      let chain = Promise.resolve();
      let writeErr = null;
      const drain = async () => {
        try { await chain; } catch (e) { writeErr = writeErr || e; }
        chain = Promise.resolve();
      };

      for (let attempt = 0; ; attempt++) {
        if (ctx.cancelled) throw new Error('已取消');
        if (fatal) throw fatal;
        await drain();
        if (writeErr) throw writeErr;
        if (segPart[idx] >= segLen) {
          segDone[idx] = segLen;
          segPart[idx] = 0;
          return;
        }
        const from = seg.start + segPart[idx]; // 断点 = 已落盘位置
        try {
          await fetchRangeByTransport(transport, src.url, from, seg.end, (chunk, pos) => {
            // 必须拷贝：socket 读缓冲来自 Node 的内存池，异步写盘时原缓冲可能已被复用
            const buf = Buffer.from(chunk);
            chain = chain
              .then(() => fh.write(buf, 0, buf.length, pos))
              .then((r) => {
                // 只计已写成功的字节，短写会在下次续传时自动补齐
                segPart[idx] += (r && r.bytesWritten) || 0;
                report(received());
              });
          }, ctx, agent);
          await drain();
          if (writeErr) throw writeErr;
          if (ctx.cancelled) throw new Error('已取消');
          if (segPart[idx] < segLen) throw new Error(`数据不完整（${segPart[idx]}/${segLen} 字节）`);
          segDone[idx] = segLen;
          segPart[idx] = 0;
          report(received());
          return;
        } catch (e) {
          await drain();
          if (writeErr) throw writeErr;
          if (ctx.cancelled || (e && e.message === '已取消')) throw new Error('已取消');
          if (fatal) throw fatal;
          retries++;
          if (attempt >= SEG_MAX_RETRY) throw e;
          // 退避 + 抖动：避免 8 个分片同时 stall 后又同时发起重连
          await sleep(Math.min(4000, 400 * (attempt + 1)) + Math.random() * 800);
          report(received(), { note: `网络波动，断点续传中（第 ${attempt + 1} 次）`, source: src.name, retries });
        }
      }
    };

    const worker = async () => {
      while (!ctx.cancelled && !fatal) {
        const idx = cursor++;
        if (idx >= segments.length) return;
        await downloadSegment(idx);
      }
      if (fatal) throw fatal;
    };

    const n = Math.max(1, Math.min(concurrency, segments.length));
    const workers = [];
    for (let i = 0; i < n; i++) workers.push(worker());
    try {
      await Promise.all(workers);
    } catch (e) {
      fatal = fatal || e;
      throw e;
    } finally {
      clearInterval(progressWd);
    }
    if (ctx.cancelled) throw new Error('已取消');
    report(totalBytes, { done: true, source: src.name, transport });
  } finally {
    try { await fh.close(); } catch (_) {}
  }
}

/**
 * 下载最新版 NSIS 安装包到临时目录（分片并发 + 多源兜底 + 完整性校验）
 * 每次调用都会重新请求 latest Release，确保拿到的是当前最新安装包
 * @param {(p:{percent:number, receivedBytes:number, totalBytes:number,
 *             speed:number, eta:number, source?:string, note?:string})=>void} onProgress
 * @returns {Promise<{installerPath:string, totalBytes:number}>}
 */
async function downloadLatestInstaller(onProgress) {
  const rel = await fetchJsonAny(candidateUrls(RELEASES_LATEST_URL), CHECK_TIMEOUT_MS);
  const asset = findInstallerAsset(rel);
  if (!asset || !asset.browser_download_url) throw new Error('发布页未找到可用的安装包');
  const totalBytes = Number(asset.size) || 0;
  if (!totalBytes) throw new Error('无法获取安装包大小');

  const baseReport = createProgressReporter(totalBytes, onProgress);
  // 校验失败会丢弃已下载数据，届时进度必须能从头显示 → 用可替换的转发函数包一层
  let activeReport = baseReport;
  const report = (n, extra) => activeReport(n, extra);

  // 校验值缺失时只允许官方源 —— 不校验就执行第三方镜像下载的安装包是不安全的。
  // 首选 GitHub API 每个资产自带的 digest（检查更新时已一并拿到，零额外请求）；
  // 仅当 API 没给 digest 时才去取 latest.yml。旧实现反过来先请求 latest.yml，
  // 一旦这次请求失败就退化成「只剩官方源」，而官方源在 hosts 被改写/被墙的环境下
  // 必然秒失败 → 一个可用源都不剩 → 进度永远停在 0%。
  let checksum = parseAssetDigest(asset.digest);
  if (!checksum) {
    report(0, { note: '正在获取安装包校验信息…' });
    const yml = await fetchInstallerChecksum(rel.tag_name);
    checksum = fromBase64Sha512(yml && yml.sha512);
  }
  if (!checksum) {
    console.warn('[updater] 未取到任何校验值，本次仅使用官方源下载');
  }
  const sources = MIRRORS
    .filter((m) => !m.prefix || checksum)
    .map((m) => ({
      name: m.name,
      url: mirrorUrl(m.prefix, asset.browser_download_url),
      official: !m.prefix,
    }));

  const dir = path.join(app.getPath('temp'), 'wallpaper-studio-update');
  await fs.promises.mkdir(dir, { recursive: true });
  ensureFreeSpace(dir, totalBytes + 64 * 1024 * 1024);
  const installerPath = path.join(dir, asset.name || 'WallpaperStudio-Setup.exe');
  // 清理同名残留（上次未完成/未清理的）
  try { await fs.promises.rm(installerPath, { force: true }); } catch (_) {}

  // 分片固定（与并发数解耦）：这样换源/换传输方式时分片边界不变，
  // 已落盘的进度可以直接接着下，实现跨源续传。
  const segSize = Math.max(SEG_MIN, Math.min(SEG_MAX, Math.ceil(totalBytes / 64)));
  const segments = [];
  for (let s = 0; s < totalBytes; s += segSize) {
    segments.push({ start: s, end: Math.min(s + segSize - 1, totalBytes - 1) });
  }
  // segDone: 已完成分片的字节数；segPart: 当前分片已落盘（可续传）的字节数
  const segState = {
    segments,
    segDone: new Array(segments.length).fill(0),
    segPart: new Array(segments.length).fill(0),
  };
  // 预分配：让磁盘空间不足等问题在下载前就暴露，也为乱序写入分片留出空间
  const preallocate = async () => {
    const fh0 = await fs.promises.open(installerPath, 'w');
    try { await fh0.truncate(totalBytes); } catch (_) {}
    await fh0.close();
  };
  await preallocate();

  const ctx = { cancelled: false, reqs: new Set() };
  activeDownload = ctx;

  const cleanup = (removeFile) => {
    for (const r of ctx.reqs) { try { r.destroy(); } catch (_) {} }
    ctx.reqs.clear();
    if (activeDownload === ctx) activeDownload = null;
    if (removeFile) fs.promises.rm(installerPath, { force: true }).catch(() => {});
  };

  // 校验失败意味着磁盘上的数据不可信：必须清零进度并重建文件，
  // 否则下一个源会看到「所有分片已完成」而跳过下载，再次校验同一个坏文件。
  const discardProgress = async () => {
    segState.segDone.fill(0);
    segState.segPart.fill(0);
    // 进度上报器内部保持单调峰值，不重建就会一直显示被废弃那次的百分比
    activeReport = createProgressReporter(totalBytes, onProgress);
    try { await fs.promises.rm(installerPath, { force: true }); } catch (_) {}
    await preallocate();
  };

  let lastErr = new Error('所有下载源均不可用，请点击「前往发布页」手动下载');
  for (const transport of TRANSPORTS) {
    if (ctx.cancelled) { cleanup(true); throw new Error('已取消'); }
    const agent = transport.id === 'node' ? makeNodeAgent() : undefined;
    try {
      report(0, { note: '正在测速选择最快的下载源…' });
      const probed = await Promise.all(
        sources.map((s) => (transport.id === 'node' ? nodeProbe(s, totalBytes, agent) : electronProbe(s, totalBytes)))
      );
      const okSources = probed.filter((p) => p.ok).sort((a, b) => b.score - a.score);
      console.log(`[updater][${transport.id}] 下载源测速: ${probed.map((p) => `${p.name}=${p.ok ? Math.round(p.score) + 'B/ms' : '不可用'}`).join(', ')}`);
      if (!okSources.length) {
        lastErr = new Error('无法连接下载源，正在尝试其他连接方式…');
        continue; // 该传输方式整体不可用 → 换下一种
      }
      for (const src of okSources) {
        if (ctx.cancelled) { cleanup(true); throw new Error('已取消'); }
        try {
          const doneBytes = segState.segDone.reduce((a, b) => a + b, 0) + segState.segPart.reduce((a, b) => a + b, 0);
          report(doneBytes, { note: `正在从「${src.name}」下载…`, source: src.name, transport: transport.id });
          await downloadFromSource(segState, src, transport.id, agent, totalBytes, installerPath, report, ctx);
          // 完整性校验：大小 + 哈希
          const stat = await fs.promises.stat(installerPath);
          if (stat.size !== totalBytes) throw new Error(`文件大小不符（${stat.size}/${totalBytes}）`);
          if (checksum) {
            report(totalBytes, { note: '正在校验安装包完整性…', source: src.name });
            const actual = await hashOfFile(checksum.algo, installerPath);
            if (actual !== checksum.hex) {
              console.warn(`[updater] 校验失败（源=${src.name}，${checksum.algo} 期望 ${checksum.hex.slice(0, 16)}… 实际 ${actual.slice(0, 16)}…），丢弃已下载数据换源重试`);
              await discardProgress();
              throw new Error(`「${src.name}」返回的安装包校验失败（文件与官方发布的不一致）`);
            }
            console.log(`[updater] 安装包校验通过（${checksum.algo}，来源 ${checksum.origin}）`);
          }
          cleanup(false);
          return { installerPath, totalBytes };
        } catch (e) {
          if (ctx.cancelled) { cleanup(true); throw new Error('已取消'); }
          lastErr = e;
          console.warn(`[updater] 下载源「${src.name}」/「${transport.id}」失败: ${e && e.message}（已保留已落盘分片，换源续传）`);
        }
      }
    } finally {
      try { if (agent) agent.destroy(); } catch (_) {}
    }
  }
  cleanup(true);
  throw lastErr;
}

/** 取消当前下载（删除半成品文件） */
function cancelDownload() {
  const dl = activeDownload;
  if (!dl) return false;
  dl.cancelled = true;
  activeDownload = null;
  for (const r of dl.reqs) {
    try { r.destroy(); } catch (_) {
      try { r.abort(); } catch (__) {}
    }
  }
  dl.reqs.clear();
  return true;
}

/** 运行 NSIS 安装包（/S 静默模式），拉起后立即返回 */
function runInstaller(installerPath) {
  const child = spawn(installerPath, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  return true;
}

module.exports = { checkForUpdate, autoCheck, openDownloadPage, downloadLatestInstaller, cancelDownload, runInstaller };
