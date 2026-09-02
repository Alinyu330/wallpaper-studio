// main.js — Electron 主进程：窗口管理、壁纸引擎调度、IPC、托盘
const { app, BrowserWindow, Tray, Menu, ipcMain, dialog, screen, nativeImage, shell, globalShortcut, powerMonitor, powerSaveBlocker } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./src/store');
const { MpvController, findMpv } = require('./src/mpv');
const { ExeWallpaper } = require('./src/exe-wallpaper');
const { StatsCollector } = require('./src/widgets-stats');
const desktop = require('./src/desktop');
const { detectType, DIALOG_FILTERS } = require('./src/file-types');
const lockscreen = require('./src/lockscreen');

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

// ---------- 全局状态 ----------
// 支持通过环境变量重定向数据目录（开发/调试用；正常使用时为系统 AppData）
if (process.env.WALLPAPER_DATA_DIR) {
  app.setPath('userData', process.env.WALLPAPER_DATA_DIR);
}

let mainWindow = null;
let wallpaperWindow = null;
let tray = null;
let store = null;
let mpv = null;
let exeWallpaper = null;
let rotationTimer = null;
let isQuitting = false;

// 桌面 DIY 组件（覆盖层窗口 + 数据采集 + 光标轮询输入开关）
let widgetsWindow = null;
let widgetsHwnd = 0;
let widgetRects = [];      // 组件可交互矩形（物理像素，相对组件窗口）
let statsCollector = null;
let widgetsInputTimer = null; // 光标轮询定时器
let widgetsInputOn = false;   // 当前是否允许组件接收鼠标（非穿透）
let widgetsInteracting = false; // 组件交互中（拖动等，保持可点击直到鼠标释放）

// 全局暂停（视频冻结 + 轮换停止）
let globalPaused = false;

// 预览弹出窗口（独立预览壁纸效果）
let previewWindow = null;
let lastPreviewData = null; // {wallpaper, params, display}

// 当前生效的壁纸与参数
let currentWallpaper = null;   // {id,name,path,type}
let currentParams = null;

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
    wallpaperWindow.showInactive();
    // attach 内部会优先挂到 WorkerW 并用物理像素精确铺满虚拟桌面
    const ok = desktop.attachToDesktop(wallpaperHwnd);
    console.log(`[engine] 壁纸窗口嵌入桌面 ${ok ? '成功' : '失败'} hwnd=${wallpaperHwnd}`);
    // WorkerW 可能延迟生成：稍后复查挂载层级
    setTimeout(() => checkWallpaperAttach(), 800);
    setTimeout(() => checkWallpaperAttach(), 2500);
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
  if (!wallpaperWindow || wallpaperWindow.isDestroyed() || !wallpaperHwnd) return;
  const r = desktop.ensureAttached(wallpaperHwnd);
  if (r === 'reattached') console.log('[engine] 已重新挂载壁纸窗口（桌面层级变化）');
  if (r === 'dead') scheduleWallpaperRecovery();
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
    // 组件覆盖层保活（保持在图标层之上、普通窗口之下）
    if (widgetsWindow && !widgetsWindow.isDestroyed() && widgetsHwnd) {
      desktop.ensureWidgetsOverlay(widgetsHwnd);
    }
    if (!wallpaperWindow || wallpaperWindow.isDestroyed()) {
      if (currentWallpaper) scheduleWallpaperRecovery();
      return;
    }
    checkWallpaperAttach();
    // Chromium 重建渲染层（GPU 重启等）可能把 mpv 窗口重新压底，周期性确保
    if (currentWallpaper?.type === 'video' && mpv?.isRunning) {
      raiseMpvWindow();
      // 暂停状态对账：防止 mpv 实际状态与应用期望状态脱节（如快速切换壁纸的时序竞态
      // 导致 mpv 被置暂停后无人恢复，视频壁纸永久卡住）。幂等设置，无副作用。
      syncMpvPause();
    }
  }, 4000);
}

// ---------- 桌面 DIY 组件（叠加在壁纸上、图标层之下） ----------
/** 是否有任一组件启用 */
function widgetsActive() {
  const w = store?.settings?.widgets;
  if (!w || !w.enabled) return false;
  return Object.values(w.items || {}).some(i => i && i.on);
}

/** 应用组件配置：创建/销毁组件窗口，启停采集与输入轮询 */
function applyWidgetsConfig() {
  const active = widgetsActive();
  if (active) {
    createWidgetsWindow();
    startStatsCollector();
  } else {
    destroyWidgetsWindow();
    stopStatsCollector();
  }
  sendWidgetsConfig();
}

function sendWidgetsConfig() {
  if (!widgetsWindow || widgetsWindow.isDestroyed()) return;
  const sf = screen.getPrimaryDisplay().scaleFactor || 1;
  widgetsWindow.webContents.send('widgets:config', {
    ...store.settings.widgets,
    scaleFactor: sf,
  });
}

function createWidgetsWindow() {
  if (widgetsWindow && !widgetsWindow.isDestroyed()) return;
  const displays = screen.getAllDisplays();
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const d of displays) {
    x1 = Math.min(x1, d.bounds.x); y1 = Math.min(y1, d.bounds.y);
    x2 = Math.max(x2, d.bounds.x + d.bounds.width); y2 = Math.max(y2, d.bounds.y + d.bounds.height);
  }
  widgetsWindow = new BrowserWindow({
    x: x1, y: y1, width: x2 - x1, height: y2 - y1,
    frame: false,
    show: false,
    resizable: true,
    movable: false,
    skipTaskbar: true,
    focusable: false,
    transparent: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-widgets.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 组件需要实时更新（时钟/占用率）
    },
  });
  widgetsWindow.loadFile(path.join(__dirname, 'renderer', 'widgets.html'));
  widgetsWindow.once('ready-to-show', () => {
    widgetsWindow.showInactive();
    widgetsHwnd = Number(widgetsWindow.getNativeWindowHandle().readBigInt64LE(0));
    // 挂为 Progman 子窗口、置于图标层之上（普通窗口之下），默认鼠标穿透
    desktop.attachWidgetsOverlay(widgetsHwnd);
    widgetsWindow.setIgnoreMouseEvents(true);
    widgetsInputOn = false;
    sendWidgetsConfig();
    startWidgetsInput();
    console.log(`[widgets] 组件覆盖层已嵌入桌面（图标层之上）hwnd=${widgetsHwnd}`);
    setTimeout(() => {
      if (widgetsHwnd) desktop.ensureWidgetsOverlay(widgetsHwnd);
    }, 1500);
  });
  widgetsWindow.on('closed', () => {
    widgetsWindow = null;
    widgetsHwnd = 0;
    widgetRects = [];
    widgetsInteracting = false;
  });
}

function destroyWidgetsWindow() {
  if (widgetsWindow && !widgetsWindow.isDestroyed()) widgetsWindow.close();
  widgetsWindow = null;
  widgetsHwnd = 0;
  widgetRects = [];
  widgetsInteracting = false;
}

function startStatsCollector() {
  if (!statsCollector) {
    statsCollector = new StatsCollector();
    statsCollector.on((data) => {
      if (widgetsWindow && !widgetsWindow.isDestroyed()) {
        widgetsWindow.webContents.send('widgets:stats', {
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

/**
 * 组件输入轮询：默认整窗鼠标穿透（不影响桌面操作）；
 * 光标进入任一组件矩形（或组件交互中）时切换为可点击，
 * 组件收到原生 DOM 鼠标事件（点击/拖动/滚轮），桌面不再响应。
 * 替代低级鼠标钩子方案（WH_MOUSE_LL 钩子回调会与主线程消息泵
 * 互相等待导致事件循环死锁、mpv 崩溃后无法自动恢复）。
 */
function startWidgetsInput() {
  if (widgetsInputTimer) return;
  widgetsInputTimer = setInterval(() => {
    if (!widgetsWindow || widgetsWindow.isDestroyed() || !widgetsHwnd) return;
    const hit = widgetsInteracting || desktop.cursorInRects(widgetsHwnd, widgetRects);
    if (hit !== widgetsInputOn) {
      widgetsInputOn = hit;
      try { widgetsWindow.setIgnoreMouseEvents(!hit); } catch (_) {}
    }
  }, 30);
}

function stopWidgetsInput() {
  if (widgetsInputTimer) { clearInterval(widgetsInputTimer); widgetsInputTimer = null; }
  widgetsInputOn = false;
  widgetsInteracting = false;
}

// ---------- 壁纸引擎 ----------
/**
 * 把 mpv 渲染子窗口提到壁纸窗口内部 Z 序顶部。
 * 背景：mpv --wid 挂入壁纸窗口后默认位于 Chromium 渲染层
 * (Chrome_RenderWidgetHostHWND) 之下，视频会被黑色背景遮挡（黑屏），
 * 必须提升到其上才能真正显示画面。
 */
function raiseMpvWindow() {
  if (!wallpaperHwnd || !mpv || !mpv.isRunning) return;
  try {
    const raised = desktop.ensureChildOnTop(wallpaperHwnd, 'mpv');
    if (raised) console.log('[engine] 已提升 mpv 渲染窗口层级（覆盖 Chromium 渲染层）');
  } catch (e) {
    console.warn('[engine] 提升 mpv 窗口失败:', e.message);
  }
}

function initEngine() {
  mpv = new MpvController();
  mpv.onReady = () => {
    // IPC 就绪时 mpv 渲染窗口已创建；稍等其完成初始化再提升 Z 序
    setTimeout(() => {
      raiseMpvWindow();
      syncMpvPause(); // 启动后对齐暂停状态（params.paused || fsPaused）
    }, 150);
  };
  // mpv 异常退出自动恢复（限流防崩溃循环；正常切换壁纸由 stop() 触发，不在此路径）
  let lastMpvRecoverAt = 0;
  mpv.onExit = () => {
    if (isQuitting || !currentWallpaper || currentWallpaper.type !== 'video') return;
    const now = Date.now();
    if (now - lastMpvRecoverAt < 5000) return;
    lastMpvRecoverAt = now;
    console.log('[engine] mpv 异常退出，2 秒后自动重启…');
    setTimeout(() => {
      if (isQuitting || !currentWallpaper || currentWallpaper.type !== 'video' || mpv.isRunning) return;
      mpv.start(currentWallpaper.path, wallpaperHwnd, currentParams);
    }, 2000);
  };
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

/**
 * 应用壁纸（核心调度）
 * @param {object} wp 壁纸对象 {id,name,path,type}
 * @param {object} params 播放参数
 */
function applyWallpaper(wp, params) {
  if (!wp) return;
  currentWallpaper = wp;
  currentParams = { ...DEFAULT_PARAMS, ...(wp.params || {}), ...(params || {}) };
  store.setCurrent(wp.id, currentParams);
  console.log(`[engine] 应用壁纸: ${wp.name} (type=${wp.type})`);
  updatePowerSaveBlocker();

  // 先停掉旧资源
  mpv.stop();
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
      // 壁纸窗口作为黑色底 + mpv 嵌入渲染
      if (wallpaperWindow && !wallpaperWindow.isVisible()) wallpaperWindow.show();
      sendToWallpaper({ type: 'video', params: currentParams, rect });
      // 稍等壁纸窗口切到黑屏再启动 mpv；若窗口尚未就绪（ready-to-show 未触发，
      // 启动恢复与窗口初始化存在竞态）则等待其可见后再启动，避免 mpv 渲染失败退出
      const tryStart = (retries) => {
        if (isQuitting || !(currentWallpaper && currentWallpaper.id === wp.id)) return;
        if (wallpaperWindow && !wallpaperWindow.isDestroyed() && !wallpaperWindow.isVisible() && retries > 0) {
          setTimeout(() => tryStart(retries - 1), 300);
          return;
        }
        mpv.start(wp.path, wallpaperHwnd, currentParams);
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
    if (needRestart && mpv.isRunning) {
      mpv.start(currentWallpaper.path, wallpaperHwnd, currentParams);
    } else {
      mpv.applyParams(patch);
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
  mpv.stop();
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
  if (!currentWallpaper || currentWallpaper.type !== 'video' || !mpv.isRunning) return;
  const shouldPause =
    !!currentParams?.paused || globalPaused || fsPaused || batteryPaused || maximizedPaused;
  mpv.setProperty('pause', shouldPause);
}

/** 重算三项性能暂停标志（有变化才同步 mpv 并打日志） */
function updatePerfFlags() {
  if (!store) return;
  const perf = store.settings.performance || {};
  const active = currentWallpaper?.type === 'video' && mpv?.isRunning;

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
  store.updateSettings({ wallpaperPaused: globalPaused });
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
    if (next) applyWallpaper(next, next.params);
  }, ms);
  console.log(`[rotation] 定时轮换已开启，间隔 ${rot.intervalMin} 分钟，范围 ${rot.scope}，${rot.order === 'sequential' ? '顺序' : '随机'}`);
}

/** 手动切换到下一张（托盘/主界面按钮） */
function rotationNext() {
  const next = pickNextWallpaper();
  if (next) {
    applyWallpaper(next, next.params);
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
    applyWallpaper(wp, wp.params);
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
  ipcMain.handle('settings:update', (_e, patch) => {
    // widgets 深合并（items 单项更新）
    if (patch && patch.widgets) {
      const old = store.settings.widgets || {};
      const w = patch.widgets;
      patch = {
        ...patch,
        widgets: {
          ...old,
          ...w,
          items: { ...(old.items || {}), ...(w.items || {}) },
        },
      };
    }
    store.updateSettings(patch);
    if (patch.autoStart !== undefined) {
      app.setLoginItemSettings({ openAtLogin: !!patch.autoStart, path: process.execPath });
    }
    if (patch.rotation !== undefined) setupRotation();
    if (patch.widgets !== undefined) applyWidgetsConfig();
    if (patch.wallpaperPaused !== undefined) setWallpaperPaused(patch.wallpaperPaused);
    if (patch.hotkeyPause !== undefined) applyHotkeySetting();
    if (patch.performance !== undefined) updatePerfFlags();
    return { ok: true };
  });

  // ---------- 桌面组件 ----------
  // 组件窗口上报可交互矩形（输入轮询命中检测用）
  ipcMain.on('widgets:report-rects', (_e, rects) => {
    widgetRects = Array.isArray(rects) ? rects : [];
  });
  // 组件交互状态（按下时保持可点击直到释放，保证拖动不中断）
  ipcMain.on('widgets:set-interacting', (_e, v) => {
    widgetsInteracting = !!v;
  });
  // 音量组件调节（更新当前壁纸参数 → mpv）
  ipcMain.on('widgets:set-volume', (_e, v) => {
    if (currentWallpaper) updateParams({ volume: Math.min(100, Math.max(0, Math.round(v))) });
  });
  ipcMain.on('widgets:toggle-mute', () => {
    if (currentWallpaper) updateParams({ mute: !currentParams?.mute });
  });

  // ---------- 全局暂停 / 轮换 ----------
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
app.whenReady().then(() => {
  store = new Store();
  initEngine();
  createWallpaperWindow();
  createMainWindow();
  setupIpc();
  createTray();

  // 恢复全局暂停状态（暂停时轮换不启动）
  globalPaused = !!store.settings.wallpaperPaused;

  setupRotation();
  setupPerformanceWatch();
  setupWallpaperWatch();
  applyHotkeySetting();

  // 电池状态初始同步（笔记本拔电使用时立即生效）
  updatePerfFlags();

  // 恢复桌面 DIY 组件（配置了则创建组件窗口）
  applyWidgetsConfig();

  // 监听屏幕分辨率变化，重新铺满（只注册一次）
  screen.on('display-metrics-changed', () => {
    if (wallpaperHwnd) desktop.ensureAttached(wallpaperHwnd);
    if (widgetsHwnd) { desktop.ensureAttached(widgetsHwnd); desktop.raiseToTopInParent(widgetsHwnd); }
    if (exeWallpaper && exeWallpaper.isRunning && exeWallpaper.hwnd) desktop.fillDesktop(exeWallpaper.hwnd);
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
  mpv?.stop();
  exeWallpaper?.stop();
  if (powerSaveId !== null) {
    try { powerSaveBlocker.stop(powerSaveId); } catch (_) {}
    powerSaveId = null;
  }
  try { globalShortcut.unregisterAll(); } catch (_) {}
  stopWidgetsInput();
  stopStatsCollector();
});

app.on('window-all-closed', () => {
  // 常驻托盘，不退出
});
