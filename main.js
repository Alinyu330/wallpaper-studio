// main.js — Electron 主进程：窗口管理、壁纸引擎调度、IPC、托盘
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, nativeImage, shell, globalShortcut, powerMonitor, powerSaveBlocker, session, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const util = require('util');
const { Store } = require('./src/store');
const { findMpv } = require('./src/mpv');
const { VideoEngine } = require('./src/video-engine');
const { ExeWallpaper } = require('./src/exe-wallpaper');
const { StatsCollector } = require('./src/widgets-stats');
const { LauncherHost } = require('./src/launcher');
const { FileBoxHost } = require('./src/filebox');
const { WidgetsHost } = require('./src/widgets-host');
const desktop = require('./src/desktop');
const { detectType, DIALOG_FILTERS } = require('./src/file-types');
const lockscreen = require('./src/lockscreen');
const updater = require('./src/updater');
const { dispose: jobGuardDispose } = require('./src/job-guard');

// ---------- 渲染策略 ----------
// 组件覆盖层/转盘窗口常驻桌面且从不获得焦点：Chromium 自动播放策略会把
// 这类窗口的 AudioContext 置为 suspended（resume() 也被拒绝），
// 音律动效频谱恒为 0 —— 表现为"打开动效后桌面没有任何反应"。
// 关闭自动播放手势要求，让后台覆盖层窗口的 WebAudio 正常工作。
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ---------- 覆盖层渲染保活（核心修复） ----------
// 挂到 Progman 的透明子窗口（转盘/组件/音律动效）会被 Chromium 的
// 原生窗口遮挡计算(CalculateNativeWinOcclusion)判为"被完全遮挡/不可见"，
// 从而完全停止合成新帧 —— 表现为：画面冻结在旧帧（收纳后"一片空白"）、
// 鼠标靠近才显示、偶现鼠标靠近无法唤醒、拖动时画面不动看似无响应。
// 本机是 Win11 raised desktop（Progman 带 WS_EX_NOREDIRECTIONBITMAP），
// 透明子窗口还受 EnableTransparentHwndEnlargement 影响。
// ★ v1.8.3 移除 EnableTransparentHwndEnlargement：保留它会引发 mpv 视频渲染异常
// （widgets 全屏透明子窗口挂壁纸上时，mpv 子窗口的视频帧会被 DWM 抑制合成），
// 导致壁纸"不会正常播放"。仅保留 CalculateNativeWinOcclusion —— 这是修复
// "鼠标靠近才显示"的最小必要开关（用户上轮确认该状态下壁纸播放正常）。
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------- 全局异常防护 ----------
// 背景：Electron 主进程的定时器/事件回调若抛出未捕获异常，默认行为是弹出
// 模态错误对话框并冻结事件循环（壁纸黑屏、mpv 无法启动/恢复）。
// 作为常驻桌面软件，必须吞掉异常并记录日志，保证主进程永远存活。
process.on('uncaughtException', (err) => {
  console.error('[main] 未捕获异常:', err && (err.stack || err.message));
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] 未处理的 Promise 拒绝:', reason && (reason.stack || reason));
});

// ---------- 引擎日志落盘（现场取证用） ----------
// 用户报告"壁纸停止播放"等问题时，日志文件 %APPDATA%/壁纸工坊/engine.log
// 记录了应用壁纸/健康检查/性能暂停/进程重启等全部引擎事件与时间戳。
// 超过 512KB 自动清空重写，避免无限增长。
const ORIG_CONSOLE_LOG = console.log.bind(console);
const ORIG_CONSOLE_WARN = console.warn.bind(console);
const ORIG_CONSOLE_ERROR = console.error.bind(console);
function appendEngineLog(kind, args) {
  try {
    const line = `[${new Date().toISOString()}] [${kind}] ${util.format(...args)}\n`;
    const file = path.join(app.getPath('userData'), 'engine.log');
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) fs.truncateSync(file, 0);
      fs.appendFileSync(file, line, 'utf8');
    } catch (_) {}
  } catch (_) {}
}
console.log = (...args) => { ORIG_CONSOLE_LOG(...args); appendEngineLog('info', args); };
console.warn = (...args) => { ORIG_CONSOLE_WARN(...args); appendEngineLog('warn', args); };
console.error = (...args) => { ORIG_CONSOLE_ERROR(...args); appendEngineLog('error', args); };

// ---------- 全局状态 ----------
// 支持通过环境变量重定向数据目录（开发/调试用；正常使用时为系统 AppData）
if (process.env.WALLPAPER_DATA_DIR) {
  app.setPath('userData', process.env.WALLPAPER_DATA_DIR);
}

let mainWindow = null;
let wallpaperWindow = null;
let tray = null;
let store = null;
let videoEngine = null;
let exeWallpaper = null;
let launcherHost = null;
let fileboxHost = null;
let rotationTimer = null;
let isQuitting = false;

// 桌面 DIY 组件 + 音律动效（v1.9.0：Wallpaper Engine 式每组件独立小窗口。
// v1.8.x 的全屏透明组件窗口会毒化 DWM 对 Progman 树的合成 —— mpv 视频帧被
// 抑制（壁纸冻结）、组件自身"鼠标靠近才显示"，已整体废弃）
let widgetsHost = null;
let statsCollector = null;

// 全局暂停（视频冻结 + 轮换停止）
let globalPaused = false;

// 预览弹出窗口（独立预览壁纸效果）
let previewWindow = null;
let lastPreviewData = null; // {wallpaper, params, display}

// 当前生效的壁纸与参数
let currentWallpaper = null;   // {id,name,path,type}
let currentParams = null;
let lastApplyAt = 0;           // 上次应用/切换壁纸的时间戳（启动恢复看门狗用）
let applyRetryCount = 0;       // 启动后引擎拉起失败的重试次数

const DEFAULT_PARAMS = {
  speed: 1,          // 播放速度 0.25~4
  brightness: 0,     // 亮度 -100~100
  contrast: 0,       // 对比度 -100~100
  saturation: 0,     // 饱和度 -100~100
  volume: 0,         // 音量 0~100（视频，默认静音以免打扰）
  mute: false,
  paused: false,
  loop: true,        // 循环播放
  fit: 'cover',      // 适配模式 cover/contain/stretch
  quality: 'high',   // 渲染质量 low/medium/high
  resolution: 'source', // 渲染分辨率 source/1080p/720p/480p（限制分辨率可大幅降低 GPU 占用）
};

// ---------- 单实例锁 ----------
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// ---------- 壁纸渲染窗口 ----------
let wallpaperHwnd = 0; // 壁纸窗口 HWND（用于 mpv 嵌入与铺满）
// Win11 24H2 桌面带规则（实测）：覆盖层窗口只有在壁纸挂载建立桌面带之前
// 呈现首帧，才会被 DWM 持续合成 —— 晚于壁纸挂载的组件/转盘会永久隐身。
let overlayBootBarrier = Promise.resolve(); // 启动屏障：壁纸挂载前等全部覆盖层首帧
let bootPhase = true; // 启动阶段（桌面带尚未建立，无需重置）
let bandSuspended = false; // 桌面带重置中（暂停挂载相关看门狗）
let bandResetChain = Promise.resolve(); // 序列化重置任务
function createWallpaperWindow() {
  // 用 Electron screen 计算所有显示器的并集（DIP 坐标，Electron 自动处理 DPI 转换）
  const displays = screen.getAllDisplays();
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const d of displays) {
    x1 = Math.min(x1, d.bounds.x);
    y1 = Math.min(y1, d.bounds.y);
    x2 = Math.max(x2, d.bounds.x + d.bounds.width);
    y2 = Math.max(y2, d.bounds.y + d.bounds.height);
  }
  wallpaperWindow = new BrowserWindow({
    x: x1, y: y1, width: x2 - x1, height: y2 - y1,
    frame: false,
    show: false,
    resizable: true, // 子窗口嵌入后由 Win32 MoveWindow 控制尺寸，避免 Chromium 拦截外部调整
    movable: false,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-wallpaper.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: true, // 后台节流降耗（图片壁纸时几乎零开销）
    },
  });
  wallpaperWindow.loadFile(path.join(__dirname, 'renderer', 'wallpaper.html'));
  // 页面就绪后：先以非激活方式显示，再挂载到桌面壁图层
  wallpaperHwnd = Number(wallpaperWindow.getNativeWindowHandle().readBigInt64LE(0));
  wallpaperWindow.once('ready-to-show', () => {
    // 启动屏障：等全部组件/转盘呈现首帧后再挂壁纸（桌面带建立），
    // 让覆盖层赶上建立时机、被 DWM 持续合成
    overlayBootBarrier.then(() => {
      if (!wallpaperWindow || wallpaperWindow.isDestroyed() || !wallpaperHwnd) return;
      wallpaperWindow.showInactive();
      // attach 内部会优先挂到 WorkerW 并用物理像素精确铺满虚拟桌面
      const ok = desktop.attachToDesktop(wallpaperHwnd);
      console.log(`[engine] 壁纸窗口嵌入桌面 ${ok ? '成功' : '失败'} hwnd=${wallpaperHwnd}`);
      // v1.8.2: 组件/音律动效在独立 widgets 窗口内（不发给 wallpaper）
      // WorkerW 可能延迟生成：稍后复查挂载层级
      setTimeout(() => checkWallpaperAttach(), 800);
      setTimeout(() => checkWallpaperAttach(), 2500);
    });
  });
  // 窗口被系统销毁（如 WorkerW 重建）时自动恢复
  wallpaperWindow.on('closed', () => {
    wallpaperWindow = null;
    wallpaperHwnd = 0;
    if (!isQuitting) scheduleWallpaperRecovery();
  });
}

/** 复查壁纸窗口挂载层级（WorkerW 延迟生成/重建时自动纠正） */
function checkWallpaperAttach() {
  if (bandSuspended) return; // 桌面带重置中，避免并发挂载竞争
  if (!wallpaperWindow || wallpaperWindow.isDestroyed() || !wallpaperHwnd) return;
  const r = desktop.ensureAttached(wallpaperHwnd);
  if (r === 'reattached') console.log('[engine] 已重新挂载壁纸窗口（桌面层级变化）');
  if (r === 'dead') scheduleWallpaperRecovery();
}

/**
 * 历史遗留包装：v1.8.4 前覆盖层挂 Progman 子窗口，晚于壁纸创建的覆盖层
 * 不被 DWM 合成，需剥离壁纸宿主重建桌面带（伴随 mpv 重建卡顿）。
 * 现覆盖层为顶层窗口插入 Z 序 Progman 正上方（见 desktop.js），呈现与桌面带无关，
 * 直接执行任务即可 —— 消除组件增删时的壁纸重建。
 */
async function resetWallpaperBand(job) {
  return job();
}

/** 壁纸窗口丢失时重建并恢复当前壁纸 */
let lastRecoverAt = 0;
function scheduleWallpaperRecovery() {
  if (isQuitting || !currentWallpaper) return;
  const now = Date.now();
  if (now - lastRecoverAt < 8000) return; // 限流，防止死循环
  lastRecoverAt = now;
  console.log('[engine] 壁纸窗口丢失，正在恢复…');
  setTimeout(() => {
    if (isQuitting || !currentWallpaper) return;
    createWallpaperWindow();
    const wp = currentWallpaper;
    const apply = () => applyWallpaper(wp, currentParams);
    if (wallpaperWindow.webContents.isLoading()) {
      wallpaperWindow.webContents.once('did-finish-load', apply);
    } else {
      apply();
    }
  }, 500);
}

/** 周期性看门狗：保持挂载层级正确 + 窗口存活 + mpv 渲染层在顶部 */
function setupWallpaperWatch() {
  setInterval(() => {
    if (isQuitting) return;
    // 组件窗口保活（v1.9.0：每组件独立小窗口，launcher 同款位置/配方）
    if (widgetsHost) widgetsHost.watchdog();
    // 快捷方式转盘保活（图标层之上，位置不变）
    if (launcherHost) launcherHost.watchdog();
    // 文件收纳区保活（图标层之上，位置不变）
    if (fileboxHost) fileboxHost.watchdog();
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) {
      if (currentWallpaper) scheduleWallpaperRecovery();
      return;
    }
    checkWallpaperAttach();
    // 启动恢复兜底：开机/启动后 mpv 因窗口竞态等原因未拉起（引擎既无前台槽），
    // 15 秒宽限期后自动重新应用当前壁纸（最多 3 次），修复"重启后壁纸不显示"
    if (
      currentWallpaper && currentWallpaper.type === 'video'
      && !videoEngine.isRunning
      && Date.now() - lastApplyAt > 15000
      && applyRetryCount < 3
    ) {
      applyRetryCount++;
      console.warn(`[engine] 恢复看门狗：视频壁纸未在运行，自动重新应用（第 ${applyRetryCount}/3 次）`);
      applyWallpaper(currentWallpaper, currentParams);
      return;
    }
    // Chromium 重建渲染层（GPU 重启等）可能把 mpv 窗口重新压底，周期性确保
    if (currentWallpaper?.type === 'video' && videoEngine?.isRunning) {
      applyRetryCount = 0; // 引擎健康运行：清空重试计数（后续故障可再获重试额度）
      raiseMpvWindow();
      // 暂停状态对账：防止 mpv 实际状态与应用期望状态脱节（如快速切换壁纸的时序竞态
      // 导致 mpv 被置暂停后无人恢复，视频壁纸永久卡住）。幂等设置，无副作用。
      syncMpvPause();
    }
  }, 4000);
}

/**
 * 覆盖层高频重绘看门狗（独立 1s 循环）。
 * 透明子窗口（组件/音律动效/转盘）挂入 Progman 后，DWM 会不定期停止合成，
 * 表现为"开了没效果、鼠标划过才显示"。低频（4s）重绘不够及时 —— 用 1s 周期
 * invalidate + nudge 强制 DWM 持续合成，彻底消除"悬停才显示"。
 */
function setupOverlayRepaintWatch() {
  // v1.9.0：每个组件小窗口 + 转盘定期强制重绘，防 DWM 停止合成
  setInterval(() => {
    if (isQuitting) return;
    if (widgetsHost) widgetsHost.repaintAll();
    if (launcherHost && launcherHost.win && !launcherHost.win.isDestroyed()) {
      launcherHost.repaint();
    }
    if (fileboxHost && fileboxHost.win && !fileboxHost.win.isDestroyed()) {
      fileboxHost.repaint();
    }
  }, 1000);
}

// ---------- 桌面 DIY 组件 + 音律动效（v1.9.0：每组件独立小窗口） ----------
/** 配置变化入口（设置页开关/参数、桌面拖动落位后）：增删组件窗口 + 推送 */
async function applyWidgetsConfig() {
  if (!widgetsHost) return;
  await widgetsHost.sync(); // 串行链：await 后 parts 才反映最新开关（wantsStats 依赖）
  if (widgetsHost.wantsStats()) startStatsCollector();
  else stopStatsCollector();
}

/** 设置更新统一入口（IPC settings:update 与调试端点共用） */
function applySettingsUpdate(patch) {
  // widgets 深合并（items 单项更新；item 内字段也合并，防止局部补丁
  // 丢失 on/pos 等字段 —— 曾表现为「调节参数后组件被异常关闭」）
  if (patch && patch.widgets) {
    const old = store.settings.widgets || {};
    const w = patch.widgets;
    const mergedItems = { ...(old.items || {}) };
    for (const [k, v] of Object.entries(w.items || {})) {
      mergedItems[k] = { ...(mergedItems[k] || {}), ...(v && typeof v === 'object' ? v : {}) };
    }
    patch = {
      ...patch,
      widgets: { ...old, ...w, items: mergedItems },
    };
  }
  // launcher 深合并（关键：只调 orientation/bgOpacity/edgeFade 等参数时，
  // 若整体替换会丢失 enabled/shortcuts/boxed/count —— 表现为「调节参数后
  // 转盘开关被异常关闭、已收纳项消失」）。
  // ★ 保留合并前的原始补丁：合并后 patch.launcher 会被旧配置填满（含 grid/x/y），
  //   直接交给 applyPatch 会让「改数量」也被当成「点了九宫格」，把拖动保存的
  //   自由位置清空并弹回默认位置（v1.7.1）。
  let launcherPatch = null;
  if (patch && patch.launcher) {
    const old = store.settings.launcher || {};
    launcherPatch = patch.launcher;
    patch = {
      ...patch,
      launcher: { ...old, ...patch.launcher },
    };
  }
  // filebox 深合并（同 launcher：只调 gridCols/groupBy/idleOpacity 等参数时，
  // 不能整体替换，否则丢失 enabled/items）。
  let fileboxPatch = null;
  if (patch && patch.filebox) {
    const old = store.settings.filebox || {};
    fileboxPatch = patch.filebox;
    patch = {
      ...patch,
      filebox: { ...old, ...patch.filebox },
    };
  }
  store.updateSettings(patch);
  if (patch.autoStart !== undefined) {
    applyAutoStartSetting(!!patch.autoStart);
  }
  if (patch.rotation !== undefined) setupRotation();
  if (patch.widgets !== undefined) applyWidgetsConfig();
  if (patch.audioViz !== undefined) applyWidgetsConfig(); // 音律动效与组件共用覆盖层
  if (launcherPatch && launcherHost) launcherHost.applyPatch(launcherPatch);
  if (fileboxPatch && fileboxHost) fileboxHost.applyPatch(fileboxPatch);
  if (patch.wallpaperPaused !== undefined) setWallpaperPaused(patch.wallpaperPaused);
  if (patch.hotkeyPause !== undefined) applyHotkeySetting();
  if (patch.smoothLoop !== undefined && videoEngine) videoEngine.setSmoothLoop(patch.smoothLoop);
  if (patch.performance !== undefined) updatePerfFlags();
  // 推送最新配置给主界面，本地 state 与主进程保持一致
  // （否则桌面拖动等经主进程直接写入后，界面下一次保存会用旧 state 覆盖新值）
  notifyMain('settings:sync', store.settings);
  return { ok: true };
}

function startStatsCollector() {
  if (!statsCollector) {
    statsCollector = new StatsCollector();
    statsCollector.on((data) => {
      // 广播给所有组件小窗口（CPU/GPU/内存/音量各自消费）
      if (widgetsHost) {
        widgetsHost.broadcast({
          ...data,
          volume: currentParams?.volume ?? 0,
          mute: !!currentParams?.mute,
        });
      }
    });
  }
  statsCollector.start(1000);
}

function stopStatsCollector() {
  statsCollector?.stop();
}

// ---------- 壁纸引擎 ----------
/** 周期性确保前台 mpv 渲染子窗口位于宿主内 Z 序顶部（防 Chromium 层遮挡黑屏） */
function raiseMpvWindow() {
  if (!wallpaperHwnd || !videoEngine) return;
  try {
    videoEngine.raiseFront();
  } catch (e) {
    console.warn('[engine] 提升 mpv 窗口失败:', e.message);
  }
}

function initEngine() {
  videoEngine = new VideoEngine();
  videoEngine.setSmoothLoop(store.settings.smoothLoop !== false);
  exeWallpaper = new ExeWallpaper();
  exeWallpaper.onExit = () => {
    // EXE 壁纸程序退出：若仍在使用该壁纸则回退显示壁纸窗口
    if (currentWallpaper && currentWallpaper.type === 'exe' && !isQuitting) {
      notifyMain('wallpaper:exe-exited', { name: currentWallpaper.name });
    }
  };
}

/** 向壁纸渲染窗口发送渲染指令 */
function sendToWallpaper(payload) {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.webContents.send('render', payload);
  }
}

// ---------- 渲染就绪回执（视频→静态平滑过渡用） ----------
// 壁纸窗口每完成一次 image/web 渲染（图片解码完成/页面加载）发送 render:ready，
// 主进程等到回执再把 mpv 淡出 —— 保证淡出露出的是已就绪的新静态画面而非黑底。
let renderReadyCb = null;
// 仅主实例注册（第二实例 gotLock=false 立即退出，不注册任何 IPC 监听）
if (gotLock) {
  ipcMain.on('render:ready', () => {
    const cb = renderReadyCb;
    renderReadyCb = null;
    if (cb) cb();
  });
}
function waitForRenderReady(ms = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      renderReadyCb = null;
      clearTimeout(timer);
      resolve();
    };
    renderReadyCb = finish; // 新的等待覆盖旧等待（以最新渲染指令为准）
    const timer = setTimeout(finish, ms);
  });
}

/**
 * 应用壁纸（核心调度）
 * @param {object} wp 壁纸对象 {id,name,path,type}
 * @param {object} params 播放参数
 * @param {object} [opts] { transition: 切换到不同壁纸时用平滑过渡（无黑屏/无重影） }
 */
function applyWallpaper(wp, params, opts = {}) {
  if (!wp) return;
  const prev = currentWallpaper;
  // 平滑过渡条件：运行期切换到「另一张」壁纸，且新旧都不是 EXE（EXE 需独占桌面层）
  const useTransition = !!opts.transition
    && prev && prev.id !== wp.id
    && prev.type !== 'exe' && wp.type !== 'exe'
    && !isQuitting;
  if (useTransition) return transitionWallpaper(wp, params, prev);
  lastApplyAt = Date.now();
  applyWallpaperDirect(wp, params);
}

/** 直接应用壁纸（启动恢复 / 窗口重建恢复 / 同壁纸重应用） */
function applyWallpaperDirect(wp, params) {
  currentWallpaper = wp;
  currentParams = { ...DEFAULT_PARAMS, ...(wp.params || {}), ...(params || {}) };
  store.setCurrent(wp.id, currentParams);
  console.log(`[engine] 应用壁纸: ${wp.name} (type=${wp.type})`);
  updatePowerSaveBlocker();

  // 先停掉旧资源
  videoEngine.stopAll();
  exeWallpaper.stop();

  const rect = desktop.getDesktopRect();

  switch (wp.type) {
    case 'image':
    case 'web': {
      if (wallpaperWindow && !wallpaperWindow.isVisible()) wallpaperWindow.show();
      sendToWallpaper({ type: wp.type, src: wp.path, url: wp.url, params: currentParams, rect });
      break;
    }
    case 'video': {
      // 壁纸窗口作为黑色底 + 双槽 mpv 引擎渲染（前台播放/待命热备）
      if (wallpaperWindow && !wallpaperWindow.isVisible()) wallpaperWindow.show();
      sendToWallpaper({ type: 'video', params: currentParams, rect });
      // 稍等壁纸窗口切到黑屏再启动引擎；若窗口尚未就绪（ready-to-show 未触发，
      // 启动恢复与窗口初始化存在竞态）则等待其可见后再启动，避免 mpv 渲染失败退出
      const tryStart = (retries) => {
        if (isQuitting || !(currentWallpaper && currentWallpaper.id === wp.id)) return;
        if (wallpaperWindow && !wallpaperWindow.isDestroyed() && !wallpaperWindow.isVisible() && retries > 0) {
          setTimeout(() => tryStart(retries - 1), 300);
          return;
        }
        videoEngine.start(wp.path, wallpaperHwnd, currentParams);
      };
      setTimeout(() => tryStart(6), 250);
      break;
    }
    case 'exe': {
      // 隐藏壁纸窗口，让位给 EXE 窗口
      if (wallpaperWindow && wallpaperWindow.isVisible()) wallpaperWindow.hide();
      sendToWallpaper({ type: 'blank' });
      exeWallpaper.start(wp.path);
      break;
    }
  }
  notifyMain('wallpaper:current-changed', { wallpaper: wp, params: currentParams });
}

/**
 * 平滑切换壁纸（v1.7.0）：动↔动 / 静↔静 / 动↔静 全组合无黑屏过渡。
 * 原理与视频循环溶解一致 —— 垫底层全程不透明，新层淡入覆盖：
 * - 视频→视频：旧 mpv 前台垫底，新 mpv 槽淡入盖过后杀旧；
 * - 视频→静态：先让静态层在 mpv 之下渲染就绪（回执确认），再淡出 mpv 露出静态层；
 * - 静态→视频：静态层垫底，新 mpv 槽淡入盖过，完全遮盖后清空静态层（黑底不可见）；
 * - 静态→静态：wallpaper.html 内 CSS 交叉淡入（新图叠旧图淡入）。
 */
async function transitionWallpaper(wp, params, prev) {
  lastApplyAt = Date.now();
  currentWallpaper = wp;
  currentParams = { ...DEFAULT_PARAMS, ...(wp.params || {}), ...(params || {}) };
  store.setCurrent(wp.id, currentParams);
  console.log(`[engine] 平滑切换壁纸: ${prev.name}(${prev.type}) → ${wp.name}(${wp.type})`);
  updatePowerSaveBlocker();
  // 先行通知（不等过渡完成）：主界面立即反映当前壁纸
  notifyMain('wallpaper:current-changed', { wallpaper: wp, params: currentParams });
  if (trayRebuild) trayRebuild();

  const rect = desktop.getDesktopRect();
  const toVideo = wp.type === 'video';
  const fromVideo = prev.type === 'video' && videoEngine.isRunning;

  if (toVideo) {
    exeWallpaper.stop();
    if (wallpaperWindow && !wallpaperWindow.isVisible()) wallpaperWindow.show();
    if (fromVideo) {
      // 视频→视频：旧前台保持不透明垫底，新视频淡入覆盖
      videoEngine.transitionStart(wp.path, wallpaperHwnd, currentParams);
    } else {
      // 静态→视频：静态层垫底，新视频淡入盖过；完全遮盖后再清空静态层
      videoEngine.transitionStart(wp.path, wallpaperHwnd, currentParams, () => {
        sendToWallpaper({ type: 'video', params: currentParams, rect: desktop.getDesktopRect() });
      });
    }
  } else {
    // 切到静态（图片/网页）
    exeWallpaper.stop();
    if (wallpaperWindow && !wallpaperWindow.isVisible()) wallpaperWindow.show();
    if (fromVideo) {
      // 视频→静态：先渲染静态层（mpv 之下），就绪回执后再淡出 mpv
      sendToWallpaper({ type: wp.type, src: wp.path, url: wp.url, params: currentParams, rect });
      await waitForRenderReady(2500);
      if (isQuitting || !(currentWallpaper && currentWallpaper.id === wp.id)) return; // 已被新切换接管
      await videoEngine.fadeOutAndStop();
    } else {
      // 静态→静态：CSS 交叉淡入（新图加载完成后叠在旧图上淡入）
      videoEngine.stopAll();
      sendToWallpaper({
        type: wp.type, src: wp.path, url: wp.url, params: currentParams, rect,
        crossfade: prev.type === 'image' && wp.type === 'image',
      });
    }
  }
}

/** 实时更新当前壁纸参数（无需重启；分辨率/质量变化自动重启 mpv） */
function updateParams(patch) {
  if (!currentWallpaper || !patch) return;
  const old = currentParams;
  currentParams = { ...currentParams, ...patch };
  store.setCurrent(currentWallpaper.id, currentParams);

  // 渲染分辨率 / 渲染质量是启动期参数，变化时重启 mpv 生效
  const needRestart =
    (patch.resolution !== undefined && patch.resolution !== old.resolution) ||
    (patch.quality !== undefined && patch.quality !== old.quality);

  if (currentWallpaper.type === 'video') {
    if (needRestart && videoEngine.isRunning) {
      videoEngine.restart();
    } else {
      videoEngine.applyParams(patch);
    }
    syncMpvPause();
    sendToWallpaper({ type: 'video', params: currentParams, rect: desktop.getDesktopRect() });
  } else {
    sendToWallpaper({ type: currentWallpaper.type, src: currentWallpaper.path, url: currentWallpaper.url, params: currentParams, rect: desktop.getDesktopRect() });
  }
  notifyMain('wallpaper:params-updated', currentParams);
  if (trayRebuild) trayRebuild();
}

// ---------- 停止使用壁纸 ----------
/**
 * 停止使用当前壁纸：清掉桌面上的壁纸内容并隐藏壁纸窗口，
 * 桌面恢复显示系统默认壁纸。壁纸库记录保留，可随时重新应用。
 */
function stopWallpaper() {
  if (!currentWallpaper) return { ok: true };
  videoEngine.stopAll();
  exeWallpaper.stop();
  sendToWallpaper({ type: 'blank' });
  if (wallpaperWindow && !wallpaperWindow.isDestroyed() && wallpaperWindow.isVisible()) {
    wallpaperWindow.hide();
  }
  currentWallpaper = null;
  currentParams = null;
  store.setCurrent(null);
  updatePowerSaveBlocker();
  console.log('[engine] 已停止使用壁纸，桌面恢复系统默认');
  notifyMain('wallpaper:current-changed', null);
  if (trayRebuild) trayRebuild();
  return { ok: true };
}

// ---------- 性能：自动暂停（全屏应用 / 电池供电 / 窗口最大化） ----------
let fsPaused = false;        // 全屏应用导致的暂停（区别于用户手动暂停）
let batteryPaused = false;   // 电池供电导致的暂停
let maximizedPaused = false; // 其他窗口最大化导致的暂停

/** 统一同步 mpv 暂停状态 = 用户暂停 || 全局暂停 || 任一性能暂停 */
function syncMpvPause() {
  if (!currentWallpaper || currentWallpaper.type !== 'video') return;
  const shouldPause =
    !!currentParams?.paused || globalPaused || fsPaused || batteryPaused || maximizedPaused;
  videoEngine.setExpectedPause(shouldPause);
}

/** 重算三项性能暂停标志（有变化才同步 mpv 并打日志） */
function updatePerfFlags() {
  if (!store) return;
  const perf = store.settings.performance || {};
  const active = currentWallpaper?.type === 'video' && videoEngine?.isRunning;

  let fs = false, bat = false, max = false;
  if (active) {
    if (perf.fullscreenPause !== false) fs = desktop.isFullscreenApp();
    if (perf.maximizedPause === true) max = desktop.isAnyWindowMaximized();
    if (perf.batteryPause !== false) {
      try { bat = powerMonitor.isOnBatteryPower(); } catch (_) {}
    }
  }
  const changed = fs !== fsPaused || bat !== batteryPaused || max !== maximizedPaused;
  fsPaused = fs;
  batteryPaused = bat;
  maximizedPaused = max;
  if (changed) {
    syncMpvPause();
    const reasons = [];
    if (fs) reasons.push('全屏应用');
    if (max) reasons.push('窗口最大化');
    if (bat) reasons.push('电池供电');
    console.log(reasons.length
      ? `[perf] 检测到${reasons.join('/')}，已暂停视频壁纸`
      : '[perf] 性能暂停已解除，恢复视频壁纸');
  }
}

function setupPerformanceWatch() {
  setInterval(updatePerfFlags, 3000);
  // 电源切换即时响应（插电/拔出不用等轮询）
  try {
    powerMonitor.on('power-source-changed', updatePerfFlags);
  } catch (_) {}
  // 睡眠唤醒：显示器功耗切换/睡眠常导致 GPU 硬解设备失效、窗口层级被重置，
  // 唤醒后主动校正挂载层级、提升 mpv 渲染层并对齐暂停状态；
  // 若 mpv 已被唤醒事件卡死，由 mpv 播放健康检查自动重启恢复。
  try {
    powerMonitor.on('resume', () => {
      console.log('[power] 系统从睡眠唤醒，校正壁纸渲染状态');
      setTimeout(() => {
        if (wallpaperHwnd) {
          desktop.ensureAttached(wallpaperHwnd);
          desktop.fillDesktop(wallpaperHwnd);
        }
        raiseMpvWindow();
        syncMpvPause();
        updatePerfFlags();
      }, 1500);
    });
  } catch (_) {}
}

// ---------- 防挂起：视频壁纸播放期间阻止系统挂起应用 ----------
// 长时间无前台交互时 Windows 可能挂起后台应用/合并其定时器，
// 导致壁纸引擎看门狗停摆、mpv 参数与暂停同步失效。
let powerSaveId = null;
function updatePowerSaveBlocker() {
  const need = currentWallpaper?.type === 'video';
  if (need && powerSaveId === null) {
    try { powerSaveId = powerSaveBlocker.start('prevent-app-suspension'); } catch (_) {}
  } else if (!need && powerSaveId !== null) {
    try { powerSaveBlocker.stop(powerSaveId); } catch (_) {}
    powerSaveId = null;
  }
}

// ---------- 全局快捷键：暂停/恢复壁纸 ----------
const HOTKEY_TOGGLE = 'Control+Alt+W';

/**
 * 注册/注销开机自启（登录项）。
 * 关键修复：开发模式下 process.execPath 是 electron.exe，不带应用目录参数的
 * 登录项重启后只会启动一个空白 Electron —— 必须把项目路径作为参数写入；
 * 打包后 execPath 即应用 exe，无需参数。启动时也会对已开启的自启做一次
 * 重注册自愈（修复历史版本写坏的登录项）。
 */
function applyAutoStartSetting(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(app.getAppPath())],
    });
    console.log(`[autostart] 开机自启${on ? '已注册' : '已注销'} (${app.isPackaged ? 'packaged' : 'dev: ' + path.resolve(app.getAppPath())})`);
  } catch (e) {
    console.warn('[autostart] 注册失败:', e.message);
  }
}

function applyHotkeySetting() {
  try {
    globalShortcut.unregister(HOTKEY_TOGGLE);
    if (store.settings.hotkeyPause !== false) {
      globalShortcut.register(HOTKEY_TOGGLE, () => setWallpaperPaused(!globalPaused));
      console.log('[hotkey] 全局快捷键已注册:', HOTKEY_TOGGLE);
    }
  } catch (e) {
    console.warn('[hotkey] 注册失败:', e.message);
  }
}

/** 暂停/恢复视频播放（用户手动，仅当前壁纸参数） */
function setVideoPaused(paused) {
  updateParams({ paused });
}

// ---------- 全局暂停（视频冻结 + 轮换停止） ----------
function setWallpaperPaused(paused) {
  globalPaused = !!paused;
  // 暂停是运行态，不写入配置（见 app.whenReady 中的启动重置）
  if (globalPaused) {
    if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
    console.log('[engine] 壁纸已全局暂停');
  } else {
    setupRotation();
    console.log('[engine] 壁纸已恢复');
  }
  syncMpvPause();
  notifyMain('wallpaper:paused-changed', globalPaused);
  if (trayRebuild) trayRebuild();
}

// ---------- 定时轮换 ----------
/** 当前轮换候选列表（按 scope 过滤） */
function getRotationList() {
  const rot = store.settings.rotation || {};
  if (rot.scope === 'favorite') return store.wallpapers.filter(w => w.favorite);
  if (rot.scope === 'custom') {
    return (rot.list || []).map(id => store.wallpapers.find(w => w.id === id)).filter(Boolean);
  }
  return store.wallpapers;
}

/** 挑选下一张轮换壁纸（随机或顺序） */
function pickNextWallpaper() {
  const rot = store.settings.rotation || {};
  const list = getRotationList();
  if (list.length < 2) return null;
  const curId = currentWallpaper?.id;
  if (rot.order === 'sequential') {
    let idx = list.findIndex(w => w.id === curId);
    idx = (idx + 1) % list.length;
    if (list[idx].id === curId) return null; // 列表只有一张
    return list[idx];
  }
  const pool = list.filter(w => w.id !== curId);
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function setupRotation() {
  if (rotationTimer) { clearInterval(rotationTimer); rotationTimer = null; }
  const rot = store.settings.rotation;
  if (!rot || !rot.enabled || globalPaused) return;
  const ms = Math.max(1, rot.intervalMin) * 60 * 1000;
  rotationTimer = setInterval(() => {
    const next = pickNextWallpaper();
    if (next) applyWallpaper(next, next.params, { transition: true }); // 平滑过渡切换
  }, ms);
  console.log(`[rotation] 定时轮换已开启，间隔 ${rot.intervalMin} 分钟，范围 ${rot.scope}，${rot.order === 'sequential' ? '顺序' : '随机'}`);
}

/** 手动切换到下一张（托盘/主界面按钮） */
function rotationNext() {
  const next = pickNextWallpaper();
  if (next) {
    applyWallpaper(next, next.params, { transition: true });
    return { ok: true, name: next.name };
  }
  return { ok: false, error: '轮换列表不足两张壁纸' };
}

// ---------- 主窗口 ----------
function createMainWindow() {
  const bounds = store.settings.lastWindowBounds;
  mainWindow = new BrowserWindow({
    width: bounds?.width || 1180,
    height: bounds?.height || 760,
    x: bounds?.x, y: bounds?.y,
    minWidth: 940, minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#0d0f14',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  // 打开客户端（含从托盘重新显示）→ 静默检查更新；后台驻留（隐藏）不检查
  mainWindow.on('show', () => scheduleAutoUpdateCheck());
  mainWindow.on('close', (e) => {
    // 点关闭 = 隐藏到托盘，真正退出走托盘菜单
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  const saveBounds = () => {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      store.updateSettings({ lastWindowBounds: mainWindow.getBounds() });
    }
  };
  mainWindow.on('resize', saveBounds);
  mainWindow.on('move', saveBounds);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

function notifyMain(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// ---------- 检查更新（静默，无弹窗） ----------
/** 推送更新状态给主界面（文字提示 / 亮点提示由渲染层呈现） */
function pushUpdateStatus(result) {
  if (!result) return;
  notifyMain('update:status', result);
}

/** 主窗口打开时触发：静默检查，失败静默（仅日志），结果只做界面提示 */
async function scheduleAutoUpdateCheck() {
  try {
    const result = await updater.autoCheck(); // 内部限频 10 分钟
    pushUpdateStatus(result);
  } catch (_) { /* 静默：更新检查绝不打扰 */ }
}

// ---------- 托盘 ----------
// 1x1 备用图标（防止 assets/icon.png 不存在时托盘崩溃）
const BLANK_ICON = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
let trayRebuild = null;
function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
  tray = new Tray(icon.isEmpty() ? nativeImage.createFromDataURL(BLANK_ICON) : icon);
  tray.setToolTip('壁纸工坊');
  tray.on('double-click', () => { mainWindow.show(); mainWindow.focus(); });

  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: () => { mainWindow.show(); mainWindow.focus(); } },
      { type: 'separator' },
      {
        label: globalPaused ? '恢复壁纸' : '暂停壁纸',
        enabled: !!currentWallpaper,
        click: () => setWallpaperPaused(!globalPaused),
      },
      {
        label: '下一张壁纸',
        enabled: getRotationList().length >= 2,
        click: () => rotationNext(),
      },
      {
        label: '停止使用壁纸',
        enabled: !!currentWallpaper,
        click: () => stopWallpaper(),
      },
      {
        label: '桌面快捷方式',
        type: 'checkbox',
        checked: !!store.settings.launcher?.enabled,
        click: (mi) => launcherHost?.setEnabled(mi.checked),
      },
      { label: '静音', type: 'checkbox', checked: !!currentParams?.mute, enabled: currentWallpaper?.type === 'video', click: (mi) => updateParams({ mute: mi.checked }) },
      { type: 'separator' },
      { label: '退出', click: () => { isQuitting = true; app.quit(); } },
    ]));
  };
  rebuild();
  trayRebuild = rebuild;
  return { rebuild };
}

// ---------- IPC ----------
function setupIpc() {
  // 获取壁纸库与配置
  ipcMain.handle('store:get', () => ({
    wallpapers: store.wallpapers,
    current: currentWallpaper ? { wallpaper: currentWallpaper, params: currentParams } : null,
    settings: store.settings,
  }));

  // 导入文件（对话框选择）
  ipcMain.handle('wallpaper:add-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择壁纸文件',
      properties: ['openFile', 'multiSelections'],
      filters: DIALOG_FILTERS,
    });
    if (res.canceled || !res.filePaths.length) return [];
    return addFiles(res.filePaths);
  });

  // 导入文件（拖拽路径）
  ipcMain.handle('wallpaper:add-paths', (_e, paths) => addFiles(paths));

  // 添加网页壁纸
  ipcMain.handle('wallpaper:add-web', (_e, url) => {
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const wp = store.addWallpaper({
      id: genId(), name: url.replace(/^https?:\/\//, '').slice(0, 60), type: 'web', url,
      path: url, addedAt: Date.now(), favorite: false, params: {},
    });
    notifyMain('wallpaper:list-changed', store.wallpapers);
    return wp;
  });

  // 应用壁纸
  ipcMain.handle('wallpaper:apply', (_e, id) => {
    const wp = store.wallpapers.find(w => w.id === id);
    if (!wp) return { ok: false, error: '壁纸不存在' };
    if (wp.type === 'video') {
      const m = findMpv();
      if (m === 'mpv' && !checkMpvInPath()) {
        return { ok: false, error: '未找到 mpv 播放器，请在设置中配置 mpv 路径或将其加入 PATH' };
      }
    }
    applyWallpaper(wp, wp.params, { transition: true });
    return { ok: true };
  });

  // 实时调参
  ipcMain.handle('wallpaper:update-params', (_e, patch) => {
    updateParams(patch);
    return { ok: true };
  });

  // 停止使用当前壁纸（恢复系统默认桌面）
  ipcMain.handle('wallpaper:stop', () => stopWallpaper());

  // 移除壁纸
  ipcMain.handle('wallpaper:remove', (_e, id) => {
    if (currentWallpaper && currentWallpaper.id === id) {
      stopWallpaper();
    }
    store.removeWallpaper(id);
    notifyMain('wallpaper:list-changed', store.wallpapers);
    return { ok: true };
  });

  // 收藏
  ipcMain.handle('wallpaper:favorite', (_e, id, val) => {
    store.updateWallpaper(id, { favorite: val });
    notifyMain('wallpaper:list-changed', store.wallpapers);
    return { ok: true };
  });

  // 设置更新
  ipcMain.handle('settings:update', (_e, patch) => applySettingsUpdate(patch));

  // ---------- 桌面组件 / 音律动效 ----------
  // v1.9.0：wallpaper-* IPC（矩形上报/穿透切换/拖动/音量/静音/动效状态）已随
  // 全屏组件窗口一起移入 src/widgets-host.js（多窗口按 sender 归属）。
  // 位置调整模式：主界面按钮 → 覆盖层整窗可拖动 → 松手自动保存并退出。
  ipcMain.handle('widgets:set-adjust', (_e, key, on) => {
    const k = String(key || '');
    if (!k || !/^[a-z]+$/.test(k)) return false;
    return widgetsHost ? widgetsHost.setAdjust(k, !!on) : false;
  });
  ipcMain.handle('audioviz:set-adjust', (_e, on) => (widgetsHost ? widgetsHost.setAdjust('aviz', !!on) : false));
  ipcMain.handle('launcher:set-adjust', (_e, on) => (launcherHost ? launcherHost.setAdjust(!!on) : false));
  ipcMain.handle('filebox:set-adjust', (_e, on) => (fileboxHost ? fileboxHost.setAdjust(!!on) : false));

  // v1.8.2 调试端点：对桌面窗口调用 capturePage 并保存到 userData/.workbuddy/，
  // 用于精确诊断组件是否真的渲染到合成层（不依赖 desktopCapturer 外部截图）。
  ipcMain.handle('debug:capture-windows', async () => {
    return await captureDebugScreens();
  });

  // 同时提供 HTTP 控制端点（避免需要启动第二个 Electron 进程触发）
  try {
    const http = require('http');
    http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/capture') {
        const r = await captureDebugScreens();
        res.end(JSON.stringify(r, null, 2));
      } else if (process.env.WP_DEBUG === '1' && req.url.startsWith('/settings')) {
        // WP_DEBUG=1 调试端点：模拟客户端 settings:update 全链路（仅本机回环）
        try {
          const u = new URL(req.url, 'http://127.0.0.1');
          const patch = JSON.parse(u.searchParams.get('patch') || '{}');
          res.end(JSON.stringify(applySettingsUpdate(patch)));
        } catch (e) {
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      } else if (process.env.WP_DEBUG === '1' && req.url.startsWith('/bandreset')) {
        // WP_DEBUG=1 诊断：桌面带全量重置（销毁全部覆盖层 → 无壁纸状态下重建 → 重挂壁纸）
        const job = async () => {
          widgetsHost.destroyAll();
          if (launcherHost && launcherHost.win) launcherHost.destroy();
          if (fileboxHost && fileboxHost.win) fileboxHost.destroy();
          await new Promise((r) => setTimeout(r, 250));
          for (const key of widgetsHost._wantParts()) widgetsHost._createPart(key);
          if (launcherHost && launcherHost.cfg.enabled && !launcherHost.win) launcherHost.create();
          if (fileboxHost && fileboxHost.cfg.enabled && !fileboxHost.win) fileboxHost.create();
          await Promise.all([...widgetsHost._wantParts()].map((k) => widgetsHost._whenPartShown(k, 6000)));
          await launcherHost.whenSettled(6000);
          await fileboxHost.whenSettled(6000);
        };
        resetWallpaperBand(job)
          .then(() => res.end('{"ok":true}'))
          .catch((e) => res.end(JSON.stringify({ ok: false, error: e.message })));
      } else if (process.env.WP_DEBUG === '1' && req.url.startsWith('/adjust')) {
        // WP_DEBUG=1 时提供运行时触发调整模式的测试端点（仅本机回环）
        const u = new URL(req.url, 'http://127.0.0.1');
        const key = u.searchParams.get('key') || '';
        const on = u.searchParams.get('on') === '1';
        let ok = false;
        if (key === 'launcher') ok = launcherHost ? launcherHost.setAdjust(on) : false;
        else if (key === 'filebox') ok = fileboxHost ? fileboxHost.setAdjust(on) : false;
        else if (/^[a-z]+$/.test(key)) ok = widgetsHost ? widgetsHost.setAdjust(key, on) : false;
        res.end(JSON.stringify({ ok }));
      } else {
        res.end('{"ok":true}');
      }
    }).listen(7851, '127.0.0.1', () => console.log('[debug] HTTP 控制端点已启用 http://127.0.0.1:7851/capture'));
  } catch (e) { console.warn('[debug] HTTP 端点启动失败:', e.message); }

  async function captureDebugScreens() {
    const fs = require('fs');
    const dir = path.join(app.getPath('userData'), '.workbuddy');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const result = {};
    const parts = widgetsHost ? widgetsHost.captureList() : [];
    for (const [name, win] of [['wallpaper', wallpaperWindow], ...parts, ['launcher', launcherHost?.win], ['filebox', fileboxHost?.win]]) {
      if (!win || win.isDestroyed()) { result[name] = 'no-window'; continue; }
      try {
        const img = await win.webContents.capturePage();
        const p = path.join(dir, `dbg-${name}.png`);
        fs.writeFileSync(p, img.toPNG());
        result[name] = { file: p, size: img.getSize() };
      } catch (e) {
        result[name] = 'capture-err: ' + e.message;
      }
    }
    return result;
  }

  ipcMain.handle('wallpaper:pause-all', (_e, paused) => {
    setWallpaperPaused(!!paused);
    return { ok: true, paused: globalPaused };
  });
  ipcMain.handle('rotation:next', () => rotationNext());

  // ---------- 壁纸站点跳转 ----------
  ipcMain.handle('shell:open-external', (_e, url) => {
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: '仅支持 http/https 链接' };
    shell.openExternal(url);
    return { ok: true };
  });

  // mpv 路径检测
  ipcMain.handle('mpv:check', () => {
    const bundled = path.join(__dirname, 'assets', 'mpv', 'mpv.exe');
    const hasBundled = fs.existsSync(bundled);
    const inPath = checkMpvInPath();
    return { bundled: hasBundled, inPath, bundledPath: hasBundled ? bundled : null };
  });

  // ---------- 检查更新 ----------
  // 手动检查（设置页按钮）：强制发起并返回结果（渲染层弹功能介绍窗口）
  ipcMain.handle('update:check-now', async () => {
    const result = await updater.autoCheck(true);
    pushUpdateStatus(result);
    return result;
  });
  // 前往发布页（兜底入口：应用内无法下载时使用）
  ipcMain.handle('update:open-download', (_e, url) => {
    updater.openDownloadPage(url);
    return { ok: true };
  });
  // 一键更新：应用内下载最新安装包（带进度）→ 静默安装 → 自动退出
  let updateInstalling = false;
  ipcMain.handle('update:install', async () => {
    if (updateInstalling) return { ok: false, error: '正在下载更新，请稍候' };
    updateInstalling = true;
    notifyMain('update:install-state', { stage: 'downloading' });
    try {
      const res = await updater.downloadLatestInstaller((p) => notifyMain('update:download-progress', p));
      notifyMain('update:install-state', { stage: 'launching' });
      updater.runInstaller(res.installerPath);
      // 防覆盖安装并发（v1.8.3）：旧实例若仍占用 exe/resources，NSIS /S 覆盖写盘会
      // 半装/混版（安装后首启 JS/DOM 不一致 → “窗口在但点击无响应”）。这里 spawn
      // 后立即同步清理引擎/窗口释放文件锁，300ms 留渲染层画“即将安装”，随后退出；
      // 3s 兜底强制退出，避免 quit 被窗口 close 拦截而残留旧实例。
      // ★ 退出定时器必须在清理之前调度（清理包独立 try/catch）：即便某个
      // stop/destroy 意外抛错，本实例也必然退出，绝不带着已 spawn 的 NSIS 残留。
      isQuitting = true;
      setTimeout(() => {
        try { app.quit(); } catch (_) {}
        setTimeout(() => process.exit(0), 3000).unref();
      }, 300);
      try {
        videoEngine?.stopAll();
        exeWallpaper?.stop();
        launcherHost?.destroy();
        fileboxHost?.destroy();
        widgetsHost?.destroyAll();
      } catch (cleanupErr) {
        console.warn('[update] 退出前清理资源异常（不阻塞退出）:', cleanupErr && cleanupErr.message);
      }
      return { ok: true };
    } catch (e) {
      updateInstalling = false;
      const cancelled = e && (e.message === '已取消' || (e.message || '').includes('cancel'));
      const msg = cancelled ? '已取消下载' : (e.message || '下载失败');
      notifyMain('update:install-state', { stage: 'error', error: msg });
      return { ok: false, error: msg };
    }
  });
  // 取消下载
  ipcMain.handle('update:install-cancel', () => {
    updater.cancelDownload();
    updateInstalling = false;
    return { ok: true };
  });
  // 客户端版本号（关于页动态显示，避免硬编码过期）
  ipcMain.handle('app:get-version', () => app.getVersion());

  // 显示器信息（预览比例用）
  ipcMain.handle('system:get-displays', () => {
    const primary = screen.getPrimaryDisplay();
    const all = screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label,
      isPrimary: d.id === primary.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      physical: {
        width: Math.round(d.bounds.width * d.scaleFactor),
        height: Math.round(d.bounds.height * d.scaleFactor),
      },
    }));
    return { primary: all.find(d => d.isPrimary) || all[0], all };
  });

  // 锁屏壁纸
  ipcMain.handle('lockscreen:set', async (_e, imagePath) => lockscreen.setLockScreen(imagePath));
  ipcMain.handle('lockscreen:reset', async () => lockscreen.resetLockScreen());
  ipcMain.handle('lockscreen:get', async () => lockscreen.getLockScreen());

  // ---------- 预览弹出窗口 ----------
  ipcMain.handle('preview:open', () => {
    if (previewWindow && !previewWindow.isDestroyed()) {
      previewWindow.show();
      previewWindow.focus();
      return { ok: true };
    }
    // 按主显示器物理比例确定初始窗口尺寸
    const primary = screen.getPrimaryDisplay();
    const pw = Math.round(primary.bounds.width * primary.scaleFactor);
    const ph = Math.round(primary.bounds.height * primary.scaleFactor);
    const ratio = pw / ph;
    const w = 720;
    const h = Math.round(w / ratio);
    previewWindow = new BrowserWindow({
      width: w,
      height: h,
      minWidth: 320,
      minHeight: 200,
      useContentSize: true,
      title: '壁纸预览',
      backgroundColor: '#05060a',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload-preview.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    previewWindow.loadFile(path.join(__dirname, 'renderer', 'preview.html'));
    previewWindow.on('closed', () => { previewWindow = null; });
    return { ok: true };
  });

  // 主界面推送预览数据（选中/参数变化时调用）
  ipcMain.handle('preview:sync', (_e, data) => {
    // patch 模式：仅更新参数；完整模式：更换壁纸
    if (data.patch && lastPreviewData) {
      lastPreviewData.params = { ...(lastPreviewData.params || {}), ...data.patch };
    } else if (!data.patch) {
      lastPreviewData = data;
    }
    if (previewWindow && !previewWindow.isDestroyed()) {
      try {
        previewWindow.webContents.send('preview:data', data.patch ? { patch: data.patch } : lastPreviewData);
      } catch (_) {}
    }
    return { ok: true };
  });

  // 预览窗口加载完成后请求数据
  ipcMain.handle('preview:request', () => lastPreviewData);

  ipcMain.on('preview:close', () => {
    if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();
  });


  // 打开 mpv 下载页（帮助用户）
  ipcMain.handle('mpv:open-download', () => {
    shell.openExternal('https://github.com/shinchiro/mpv-winbuild-cmake/releases');
  });

  // 窗口控制
  ipcMain.on('win:minimize', () => mainWindow?.minimize());
  ipcMain.on('win:maximize', () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.on('win:close', () => mainWindow.hide());

  // 打开文件所在位置
  ipcMain.handle('shell:show-in-folder', (_e, p) => shell.showItemInFolder(p));
}

function addFiles(paths) {
  const added = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    const type = detectType(p);
    if (!type) continue;
    const wp = store.addWallpaper({
      id: genId(),
      name: path.basename(p),
      path: p, type,
      addedAt: Date.now(),
      favorite: false,
      params: {},
    });
    added.push(wp);
  }
  notifyMain('wallpaper:list-changed', store.wallpapers);
  return added;
}

function checkMpvInPath() {
  try {
    require('child_process').execSync('mpv --version', { windowsHide: true, timeout: 3000, stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ---------- 应用生命周期 ----------
// 单实例锁防护（v1.8.3）：仅主实例注册 whenReady 初始化与生命周期事件。
// 未获锁（第二实例）已在上面 app.quit() —— 若这里仍注册 whenReady，
// 第二实例会重复建窗/建引擎/抢 7851 调试端口（EADDRINUSE uncaught），
// 与更新安装器自动拉起的新实例并发时即“安装后卡死/点击无响应”。
if (gotLock) {
  app.whenReady().then(() => {
    console.log(`[main] 壁纸工坊引擎启动 v${app.getVersion()} (electron ${process.versions.electron})`);
    store = new Store();
    initEngine();
    launcherHost = new LauncherHost(store);
    // 收纳/恢复/移除后通知主界面刷新快捷方式设置页（payload 为收纳结果时附带提示）
    launcherHost.onChanged = (result) => notifyMain('launcher:changed', result || null);
    // 文件收纳区（从转盘拆分的普通文件/文件夹收纳）
    fileboxHost = new FileBoxHost(store);
    fileboxHost.onChanged = (result) => notifyMain('filebox:changed', result || null);
    // 桌面组件 + 音律动效宿主（每组件独立小窗口）
    widgetsHost = new WidgetsHost(store, {
      onAvStatus: (s) => notifyMain('audioViz:status', s),
      onVolume: (v) => { if (currentWallpaper) updateParams({ volume: Math.min(100, Math.max(0, Math.round(v))) }); },
      onToggleMute: () => { if (currentWallpaper) updateParams({ mute: !currentParams?.mute }); },
      onConfigChanged: () => notifyMain('settings:sync', store.settings),
      // 调整模式状态变化 → 主界面按钮复位（拖动落位自动退出时）
      onAdjustState: (key, on) => notifyMain('widgets:adjust-state', { key, on }),
    });
    // 转盘调整模式状态变化 → 主界面按钮复位
    launcherHost.onAdjustState = (on) => notifyMain('launcher:adjust-state', { on });
    // 文件收纳区调整模式状态变化 → 主界面按钮复位
    fileboxHost.onAdjustState = (on) => notifyMain('filebox:adjust-state', { on });
    // 覆盖层创建任务路由到桌面带重置：晚于壁纸挂载创建的覆盖层需随带重建合成
    widgetsHost.hooks.createJob = (job) => resetWallpaperBand(job);
    launcherHost.onCreateJob = (job) => resetWallpaperBand(job);
    fileboxHost.onCreateJob = (job) => resetWallpaperBand(job);
    createWallpaperWindow();
    createMainWindow();
    setupIpc();
    createTray();

    // 开机自启自愈：设置已开启但登录项缺失/损坏（旧版本注册的坏项）时重写一次
    if (store.settings.autoStart) applyAutoStartSetting(true);

    // ---------- 音律动效：系统声音环回捕获授权 ----------
    // 组件覆盖层通过 getDisplayMedia({audio:true}) 捕获 Windows 系统混音（WASAPI
    // loopback）：这里程序化授权（仅允许 widgets.html 发起），视频轨由页面停用，
    // 音频轨送 WebAudio Analyser 做频谱分析 —— 播放任何音乐/视频都会驱动动效。
    try {
      session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
        const url = request.frame?.url || '';
        if (!url.includes('widgets.html')) return callback({}); // v1.8.2: 音律动效在 widgets.html 内发起
        desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
          callback({ video: sources[0], audio: 'loopback' });
        }).catch(() => callback({}));
      }, { enableLocalEcho: false });
      console.log('[audioViz] 系统音频环回捕获已就绪（loopback）');
    } catch (e) {
      console.warn('[audioViz] 环回捕获初始化失败:', e.message);
    }

    // 暂停是运行态，不跨启动保留：旧版本曾把它持久化进配置，导致
    // “暂停过一次 → 之后每次启动壁纸都是冻结画面”，这里强制恢复播放，
    // 并把历史配置残留的 true 清理回 false（客户端初始 UI 以配置为准）
    globalPaused = false;
    if (store.settings.wallpaperPaused) store.updateSettings({ wallpaperPaused: false });

    setupRotation();
    setupPerformanceWatch();
    setupWallpaperWatch();
    setupOverlayRepaintWatch();
    applyHotkeySetting();

    // 电池状态初始同步（笔记本拔电使用时立即生效）
    updatePerfFlags();

    // 恢复桌面 DIY 组件（配置了则创建组件窗口）
    applyWidgetsConfig();

    // 恢复桌面快捷方式转盘（配置了则创建转盘窗口）
    if (store.settings.launcher?.enabled) launcherHost.create();

    // 恢复桌面文件收纳区（配置了则创建收纳区窗口）
    if (store.settings.filebox?.enabled) fileboxHost.create();

    // 启动屏障：壁纸挂载（桌面带建立）前，等全部组件/转盘/收纳区呈现真实内容帧
    // （含 painted 等待，见 widgets-host/launcher/filebox whenSettled）
    overlayBootBarrier = Promise.all([
      widgetsHost.whenSettled(5000),
      launcherHost.whenSettled(5000),
      fileboxHost.whenSettled(5000),
    ]).then(() => { bootPhase = false; });

    // 监听屏幕分辨率变化，重新铺满（只注册一次）
    screen.on('display-metrics-changed', () => {
      if (wallpaperHwnd && !bandSuspended) desktop.ensureAttached(wallpaperHwnd);
      if (widgetsHost) widgetsHost.onDisplayChange();
      if (exeWallpaper && exeWallpaper.isRunning && exeWallpaper.hwnd) desktop.fillDesktop(exeWallpaper.hwnd);
      launcherHost?.onDisplayChange();
      fileboxHost?.onDisplayChange();
    });

    // 首次启动：自动导入示例壁纸，开箱即用
    if (store.wallpapers.length === 0) {
      const examplesDir = path.join(__dirname, 'examples');
      if (fs.existsSync(examplesDir)) {
        const files = fs.readdirSync(examplesDir).map(f => path.join(examplesDir, f));
        const added = addFiles(files);
        if (added.length) {
          const first = added.find(w => w.type === 'image') || added[0];
          if (first) store.setCurrent(first.id, first.params);
          console.log(`[engine] 首次启动已导入 ${added.length} 个示例壁纸`);
        }
      }
    }

    // 恢复上次的壁纸：等壁纸窗口页面加载完成，避免渲染指令丢失
    const restore = () => {
      const cur = store.current;
      if (cur) {
        const wp = store.wallpapers.find(w => w.id === cur.id);
        if (wp) applyWallpaper(wp, cur.params);
      }
    };
    if (wallpaperWindow.webContents.isLoading()) {
      wallpaperWindow.webContents.once('did-finish-load', restore);
    } else {
      restore();
    }
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    // 清理所有子进程、热键、防挂起与定时器
    videoEngine?.stopAll();
    exeWallpaper?.stop();
    launcherHost?.destroy();
    fileboxHost?.destroy();
    widgetsHost?.destroyAll();
    jobGuardDispose(); // 关闭孤儿守卫 Job（子进程已在上方清理，此步是兜底）
    if (powerSaveId !== null) {
      try { powerSaveBlocker.stop(powerSaveId); } catch (_) {}
      powerSaveId = null;
    }
    try { globalShortcut.unregisterAll(); } catch (_) {}
    stopStatsCollector();
  });

  app.on('window-all-closed', () => {
    // 常驻托盘，不退出
  });
} // if (gotLock) —— 单实例锁失败的第二实例不注册任何初始化/生命周期事件
