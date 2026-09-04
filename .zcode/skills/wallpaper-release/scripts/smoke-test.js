#!/usr/bin/env node
/**
 * smoke-test.js — 壁纸工坊发布前 CDP 冒烟测试（无外部依赖，Node ≥ 21 需内置 WebSocket）
 *
 * 用法（仓库根执行）:
 *   node .zcode/skills/wallpaper-release/scripts/smoke-test.js
 *   node ... --extra tmp-feature-checks.js   # 附加本次新功能的专项断言（写法见 references/testing.md）
 *   node ... --keep                          # 测完不杀应用（供 computer-use GUI 视觉验证续用）
 *   node ... --port 9223 --settle 4000       # 调试端口 / 页面稳定等待毫秒
 *
 * 行为:
 *   1. 以隔离数据目录 tmp-smoke-data 启动应用（WALLPAPER_DATA_DIR，不碰用户真实壁纸配置）
 *   2. 连接 CDP，对每个页面目标收集 未捕获异常 / console error / Log error
 *   3. 主窗口内置断言：8 个导航项、8 个页面区块、应用按钮、版本号与 package.json 一致、逐页点击切换
 *   4. 逐页面截图 + 可选 --extra 专项断言
 *   5. 扫描主进程 engine.log 中的错误
 *   6. 生成 tmp-smoke-report/report.md 与 report.json，退出码 = 失败数（0 为全过）
 *
 * 数据目录/报告目录均以 tmp- 开头，天然被 .gitignore 忽略，不会误入库。
 */

'use strict';

const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');

// ---------- 参数 ----------
const args = process.argv.slice(2);
function argOf(flag, dflt) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
const PORT = Number(argOf('--port', '9223'));
const SETTLE_MS = Number(argOf('--settle', '4000'));
const BOOT_TIMEOUT_MS = Number(argOf('--boot-timeout', '45000'));
const EXTRA_FILE = argOf('--extra', null);
const KEEP = args.includes('--keep');
if (typeof WebSocket !== 'function') {
  console.error('需要 Node ≥ 21（内置 WebSocket）。当前版本: ' + process.version);
  process.exit(2);
}

// ---------- 仓库根 / 目录 ----------
function findRepoRoot(start) {
  let cur = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return path.resolve(start);
    cur = parent;
  }
}
const REPO = findRepoRoot(__dirname);
const DATA_DIR = path.join(REPO, 'tmp-smoke-data');
const REPORT_DIR = path.join(REPO, 'tmp-smoke-report');
for (const d of [DATA_DIR, REPORT_DIR]) fs.mkdirSync(d, { recursive: true });

const PKG = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));

// ---------- 结果收集 ----------
const results = [];           // { name, ok, detail }
const screenshots = [];       // 报告目录内的截图文件名
const mainErrors = [];        // 渲染进程异常/错误（含来源）
const envWarnings = [];       // 环境冲突警告（不计入失败）
let portCollisionExpected = false; // 预检发现 7851 被占时置位，EADDRINUSE 降级为警告
const DEBUG_PORT = 7851;      // main.js 固定的调试 HTTP 端口，与正在运行的正式实例必然冲突
const ignoredErrorPatterns = [
  'favicon',                  // 常见无害 404
];
let extraErrorsWhitelisted = 0;
function ignoreError(pattern) { ignoredErrorPatterns.push(pattern); }

function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
}

function recordError(source, text) {
  if (ignoredErrorPatterns.some((p) => text.includes(p))) { extraErrorsWhitelisted++; return; }
  // 预检已确认调试端口被正式实例占用时，EADDRINUSE 属预期环境冲突，降级为警告
  if (portCollisionExpected && text.includes('EADDRINUSE')) {
    envWarnings.push(`[${source}] ${text}`);
    return;
  }
  mainErrors.push(`[${source}] ${text}`);
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    const done = (v) => { try { s.destroy(); } catch (_) {} resolve(v); };
    s.on('connect', () => done(true));
    s.on('error', () => done(false));
    setTimeout(() => done(false), 1500);
  });
}

// ---------- CDP 客户端（沿用 cdp-test.js 的全局 WebSocket 模式） ----------
function getJson(pathname) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: pathname }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(ws, label) {
    this.ws = ws; this.label = label; this.id = 0;
    this.pending = new Map(); this.queue = [];
    this.ready = false; this.closed = false;
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const r = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? r.reject(new Error(m.error.message)) : r.resolve(m.result);
      } else if (m.method) {
        this.onEvent(m);
      }
    };
    ws.onopen = () => { this.ready = true; this.queue.splice(0).forEach((f) => f()); };
    ws.onclose = () => { this.closed = true; };
    ws.onerror = () => { this.closed = true; };
  }
  onEvent(m) {
    const text = (o) => JSON.stringify(o?.params || o).slice(0, 400);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      const msg = d?.exception?.description || d?.text || 'unknown exception';
      recordError(this.label, '未捕获异常: ' + msg);
    } else if (m.method === 'Log.entryAdded' && m.params.entry?.level === 'error') {
      recordError(this.label, m.params.entry.text);
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      recordError(this.label, (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' '));
    }
  }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const run = () => {
        const id = ++this.id;
        this.pending.set(id, { resolve, reject });
        try { this.ws.send(JSON.stringify({ id, method, params })); }
        catch (e) { this.pending.delete(id); reject(e); }
      };
      if (this.ready) run(); else this.queue.push(run);
    });
  }
  async eval(expr) {
    const r = await this.call('Runtime.evaluate', {
      expression: expr, returnByValue: true, awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'evaluate failed');
    return r.result ? r.result.value : undefined;
  }
}

async function attach(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const cdp = new Cdp(ws, shortLabel(target.url));
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('CDP 连接超时: ' + target.url)), 10000);
    ws.addEventListener('open', () => { clearTimeout(t); res(); });
    ws.addEventListener('error', () => { clearTimeout(t); rej(new Error('CDP 连接失败: ' + target.url)); });
  });
  await cdp.call('Runtime.enable');
  await cdp.call('Log.enable');
  await cdp.call('Page.enable');
  return cdp;
}

function shortLabel(targetOrUrl) {
  // 兼容传入 target 对象或 url 字符串（pages.map(shortLabel) 传的是对象）
  const url = typeof targetOrUrl === 'string' ? targetOrUrl : (targetOrUrl && targetOrUrl.url) || '';
  const m = url.match(/renderer[\/\\]([a-z-]+\.html)/i);
  return m ? m[1] : url.slice(0, 60);
}

// ---------- 应用启动 ----------
function resolveElectron() {
  // 普通 Node 下 require('electron') 返回 electron.exe 路径字符串
  const p = require(path.join(REPO, 'node_modules', 'electron'));
  if (typeof p === 'string' && fs.existsSync(p)) return p;
  throw new Error('未找到 electron 可执行文件，请先 npm install');
}

function killTree(pid) {
  if (process.platform === 'win32') {
    try { execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' }); }
    catch (_) { try { process.kill(pid); } catch (__) {} }
  } else {
    try { process.kill(-pid, 'SIGTERM'); } catch (_) { try { process.kill(pid); } catch (__) {} }
  }
}

let child = null;
function cleanup() {
  if (child && child.pid && !KEEP) killTree(child.pid);
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function bootApp() {
  const electronPath = resolveElectron();
  child = spawn(electronPath, ['.', '--remote-debugging-port=' + PORT], {
    cwd: REPO,
    env: { ...process.env, WALLPAPER_DATA_DIR: DATA_DIR, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: 'ignore',
  });
  child.on('exit', (code) => {
    if (!bootDone) failBoot = `应用进程提前退出 (code=${code})。` +
      `若报单实例锁冲突，请先关闭正在运行的壁纸工坊再测试。`;
  });

  const t0 = Date.now();
  while (Date.now() - t0 < BOOT_TIMEOUT_MS) {
    if (failBoot) throw new Error(failBoot);
    try {
      const list = await getJson('/json/list');
      if (Array.isArray(list) && list.some((t) => t.type === 'page')) return list;
    } catch (_) { /* 未就绪，继续轮询 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${BOOT_TIMEOUT_MS}ms 内 CDP(${PORT}) 不可达。` +
    `检查端口占用，或应用是否被安全软件拦截。`);
}
let bootDone = false, failBoot = null;

// ---------- 内置冒烟断言 ----------
const NAV_PAGES = ['library', 'rotation', 'widgets', 'audio', 'launcher', 'filebox', 'sites', 'settings'];

async function builtinChecks(cdpMain) {
  // 窗口骨架
  const navCount = await cdpMain.eval("document.querySelectorAll('.nav-item').length");
  check('主界面导航项 8 个', navCount === 8, `实际 ${navCount}`);
  const sectionCount = await cdpMain.eval(
    "['library','rotation','widgets','audio','launcher','filebox','sites','settings']" +
    ".filter((p) => document.getElementById('page-' + p)).length"
  );
  check('页面区块 8 个齐全', sectionCount === 8, `实际 ${sectionCount}`);
  check('「应用壁纸」按钮存在', !!(await cdpMain.eval("!!document.getElementById('btn-apply')")));

  // 版本号与 package.json 一致
  const uiVer = await cdpMain.eval("(document.getElementById('about-version')||{}).textContent || ''");
  check('关于页版本号 = package.json', String(uiVer).includes(PKG.version), `UI="${String(uiVer).trim()}" pkg=${PKG.version}`);

  // 逐页点击切换（回归 v1.8.4「主界面全区域点击无响应」一类故障）
  for (const page of NAV_PAGES) {
    await cdpMain.eval(`document.querySelector('.nav-item[data-page="${page}"]').click()`);
    await new Promise((r) => setTimeout(r, 250));
    const active = await cdpMain.eval(
      `document.getElementById('page-${page}').classList.contains('active') && ` +
      `document.querySelector('.nav-item[data-page="${page}"]').classList.contains('active')`
    );
    check(`导航切换 → ${page}`, !!active);
  }
}

// ---------- 截图 ----------
async function screenshot(target, cdp, idx) {
  try {
    const r = await cdp.call('Page.captureScreenshot', { format: 'png' });
    if (r && r.data) {
      const file = path.join(REPORT_DIR, `${String(idx + 1).padStart(2, '0')}-${shortLabel(target.url).replace('.html', '')}.png`);
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
      return path.basename(file);
    }
  } catch (_) { /* 截图失败不阻断 */ }
  return null;
}

// ---------- engine.log 扫描（主进程错误） ----------
function scanEngineLog() {
  const log = path.join(DATA_DIR, 'engine.log');
  if (!fs.existsSync(log)) return [];
  const lines = fs.readFileSync(log, 'utf8').split(/\r?\n/);
  return lines.filter((l) => l.includes('[error]') || l.includes('未捕获异常') || l.includes('未处理的 Promise 拒绝'));
}

// ---------- 报告 ----------
function writeReport() {
  const fails = results.filter((r) => !r.ok);
  const engineAll = scanEngineLog();
  const engineErrors = [], engineWarnings = [];
  for (const l of engineAll) {
    if (portCollisionExpected && l.includes('EADDRINUSE')) engineWarnings.push(l.trim());
    else engineErrors.push(l);
  }
  const warnings = envWarnings.concat(engineWarnings);
  const allErrorCount = mainErrors.length + engineErrors.length;

  const json = {
    version: PKG.version, date: new Date().toISOString(),
    pass: results.length - fails.length, fail: fails.length,
    rendererErrors: mainErrors, engineLogErrors: engineErrors.slice(-30),
    envWarnings: warnings, extraErrorsWhitelisted, results,
  };
  fs.writeFileSync(path.join(REPORT_DIR, 'report.json'), JSON.stringify(json, null, 2));

  const md = [];
  md.push(`# 冒烟测试报告 — v${PKG.version}`);
  md.push(`- 时间: ${json.date}`);
  md.push(`- 结果: **${fails.length === 0 && allErrorCount === 0 ? '✅ 全部通过' : '❌ 存在失败'}**（断言 ${results.length - fails.length}/${results.length} 通过，渲染/主进程错误 ${allErrorCount} 条${warnings.length ? `，环境警告 ${warnings.length} 条` : ''}）`);
  if (fails.length) { md.push('\n## 失败项'); fails.forEach((f) => md.push(`- ❌ ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)); }
  if (mainErrors.length) { md.push('\n## 渲染进程错误'); mainErrors.forEach((e) => md.push(`- ${e}`)); }
  if (engineErrors.length) {
    md.push('\n## 主进程 engine.log 错误（末 30 条）');
    engineErrors.slice(-30).forEach((e) => md.push(`- ${e.trim()}`));
  }
  if (warnings.length) {
    md.push('\n## 环境冲突警告（不计入失败）');
    md.push(`- 调试端口 ${DEBUG_PORT} 预检已被占用（正式实例在运行），相关 EADDRINUSE 已降级；如需完全干净的测试环境，先关闭正在运行的壁纸工坊。`);
    warnings.slice(-20).forEach((e) => md.push(`- ${e}`));
  }
  md.push('\n## 截图');
  md.push(...screenshots.map((s) => `- ${s ? s : '(截图失败)'}`));
  md.push(`\n数据目录: tmp-smoke-data/ ｜ 报告目录: tmp-smoke-report/（均已被 gitignore）`);
  fs.writeFileSync(path.join(REPORT_DIR, 'report.md'), md.join('\n') + '\n');

  return { fails: fails.length, allErrorCount, warnings: warnings.length };
}

// ---------- 主流程 ----------
(async () => {
  console.log(`冒烟测试 v${PKG.version} ｜ 端口 ${PORT} ｜ 数据目录隔离: tmp-smoke-data`);
  if (await isPortInUse(DEBUG_PORT)) {
    portCollisionExpected = true;
    console.log(`⚠ 调试端口 ${DEBUG_PORT} 已被占用（正式实例在运行）——EADDRINUSE 将记为环境警告而非失败`);
  }
  const targets = await bootApp();
  bootDone = true;

  const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'));
  console.log(`发现 ${pages.length} 个页面目标: ${pages.map(shortLabel).join(', ')}`);

  const mainTarget = pages.find((t) => String(t.url).includes('index.html'));
  if (!mainTarget) { check('主窗口 (index.html) 存在', false, pages.map(shortLabel).join(', ')); }
  else check('主窗口 (index.html) 存在', true);

  const wallpaperTarget = pages.find((t) => String(t.url).includes('wallpaper.html'));
  check('壁纸渲染层 (wallpaper.html) 已创建', !!wallpaperTarget);

  const attached = [];
  for (let i = 0; i < pages.length; i++) {
    try {
      const cdp = await attach(pages[i]);
      attached.push(cdp);
      screenshots.push(await screenshot(pages[i], cdp, i));
      if (pages[i] === mainTarget) {
        await new Promise((r) => setTimeout(r, SETTLE_MS));
        await builtinChecks(cdp);
      }
    } catch (e) {
      check(`连接页面 ${shortLabel(pages[i].url)}`, false, e.message);
    }
  }

  // 专项断言（本次新功能）
  if (EXTRA_FILE) {
    const file = path.resolve(EXTRA_FILE);
    if (!fs.existsSync(file)) {
      check(`加载专项断言 ${EXTRA_FILE}`, false, '文件不存在');
    } else {
      try {
        const cdpMain = mainTarget ? attached[pages.indexOf(mainTarget)] : null;
        const mod = require(file);
        await mod({
          check, ignoreError, version: PKG.version, reportDir: REPORT_DIR,
          targets: pages, attach,
          main: cdpMain,
        });
        check(`专项断言执行完成 (${path.basename(file)})`, true);
      } catch (e) {
        check(`专项断言执行 (${path.basename(file)})`, false, e.message);
      }
    }
  }

  check('渲染进程无未捕获异常 / 错误日志', mainErrors.length === 0,
    mainErrors.length ? `${mainErrors.length} 条（详见报告）` : '0 条');

  cleanup();
  const { fails, allErrorCount, warnings } = writeReport();
  console.log(`\n报告: tmp-smoke-report/report.md ｜ 断言失败 ${fails}，进程错误 ${allErrorCount}${warnings ? `，环境警告 ${warnings}` : ''}`);
  if (KEEP) console.log('（--keep：应用保持运行，数据目录 tmp-smoke-data，可直接进行 GUI 视觉验证）');
  process.exit(fails > 0 || allErrorCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试框架异常:', e.message);
  cleanup();
  process.exit(2);
});
