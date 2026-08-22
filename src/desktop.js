// desktop.js — 桌面嵌入模块
// 通过 koffi 调用 user32.dll，把窗口挂载到桌面壁纸层，
// 使壁纸显示在桌面图标下方。这是壁纸软件的经典实现方式。
//
// 关键点：
// 1. DPI：所有坐标相关调用必须包裹在 PER_MONITOR_AWARE_V2 线程上下文中，
//    否则在 150% 缩放的系统上会拿到虚拟化坐标（如 2560x1600 → 1707x1067），
//    导致壁纸窗口尺寸错误。
// 2. 挂载策略（Win10/Win11 通用）：
//    a. 优先把壁纸窗口 parent 到 Progman 下的 WorkerW（系统壁纸宿主，
//       位于图标层 SHELLDLL_DefView 之下）。挂在 WorkerW 内部可以
//       覆盖系统绘制的静态壁纸，同时位于图标层之下。
//    b. 若 WorkerW 尚未生成（部分 Win11 系统会延迟生成），先挂到
//       Progman 并压底；ensureAttached() 看门狗会在 WorkerW 出现后
//       自动重新挂载，避免被 WorkerW 挡住。
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

// ---------- Win32 函数声明 ----------
const FindWindowW = user32.func('FindWindowW', 'intptr_t', ['str16', 'str16']);
const FindWindowExW = user32.func('FindWindowExW', 'intptr_t', ['intptr_t', 'intptr_t', 'str16', 'str16']);
const SetParent = user32.func('SetParent', 'intptr_t', ['intptr_t', 'intptr_t']);
const MoveWindow = user32.func('MoveWindow', 'int', ['intptr_t', 'int32_t', 'int32_t', 'int32_t', 'int32_t', 'int']);
const SetWindowPos = user32.func('SetWindowPos', 'int', ['intptr_t', 'intptr_t', 'int32_t', 'int32_t', 'int32_t', 'int32_t', 'uint32_t']);
const IsWindow = user32.func('IsWindow', 'int', ['intptr_t']);
const IsWindowVisible = user32.func('IsWindowVisible', 'int', ['intptr_t']);
const GetWindowRect = user32.func('GetWindowRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const GetClientRect = user32.func('GetClientRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32_t']);
const SetWindowLongPtrW = user32.func('SetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32_t', 'intptr_t']);
const ShowWindow = user32.func('ShowWindow', 'int', ['intptr_t', 'int32_t']);
const GetAncestor = user32.func('GetAncestor', 'intptr_t', ['intptr_t', 'uint32_t']);
const GetWindowThreadProcessId = user32.func(
  'GetWindowThreadProcessId', 'uint32_t', ['intptr_t', koffi.out(koffi.pointer('uint32_t'))]
);
const GetClassNameW = user32.func('GetClassNameW', 'int32_t', ['intptr_t', koffi.out(koffi.pointer('int16_t')), 'int32_t']);
const GetWindowTextW = user32.func('GetWindowTextW', 'int32_t', ['intptr_t', koffi.out(koffi.pointer('int16_t')), 'int32_t']);
const GetSystemMetrics = user32.func('GetSystemMetrics', 'int32_t', ['int32_t']);
const GetForegroundWindow = user32.func('GetForegroundWindow', 'intptr_t', []);
const SendMessageTimeoutW = user32.func(
  'SendMessageTimeoutW', 'intptr_t',
  ['intptr_t', 'uint32_t', 'uintptr_t', 'uintptr_t', 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uintptr_t'))]
);

// DPI 感知上下文切换（Win10 1703+，失败则退化为默认上下文）
let SetThreadDpiAwarenessContext = null;
try {
  SetThreadDpiAwarenessContext = user32.func('SetThreadDpiAwarenessContext', 'intptr_t', ['intptr_t']);
} catch (_) {}

// EnumWindows 回调原型
const EnumWindowsProc = koffi.proto('int __stdcall EnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const EnumWindows = user32.func('EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'intptr_t']);

// ---------- 常量 ----------
const GWL_STYLE = -16;
const GA_PARENT = 1;
const SW_HIDE = 0;
const SW_SHOW = 5;
const HWND_TOP = 0;
const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;
const SM_XVIRTUALSCREEN = 76;
const SM_YVIRTUALSCREEN = 77;
const SM_CXVIRTUALSCREEN = 78;
const SM_CYVIRTUALSCREEN = 79;
const DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = -4;
const WM_SPAWN_WORKERW = 0x052C;

// 窗口样式位
const WS_CHILD = 0x40000000;
const WS_CAPTION = 0x00C00000;
const WS_THICKFRAME = 0x00040000;
const WS_SYSMENU = 0x00080000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_POPUP = 0x80000000;

/**
 * 在 PER_MONITOR_AWARE_V2 线程上下文中执行 Win32 调用：
 * 保证所有坐标/尺寸都是物理像素，不受系统 DPI 缩放虚拟化影响。
 */
function pmv2(fn) {
  if (!SetThreadDpiAwarenessContext) return fn();
  const old = Number(BigIntAsInt(SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)));
  try {
    return fn();
  } finally {
    if (old !== 0) SetThreadDpiAwarenessContext(old);
  }
}

// 读取窗口类名（宽字符缓冲区，避免字符串 out 指针溢出问题）
function getClassName(hwnd) {
  const buf = new Int16Array(256);
  const n = GetClassNameW(hwnd, buf, 256);
  return utf16ToString(buf, n);
}

function getWindowTitle(hwnd) {
  const buf = new Int16Array(512);
  const n = GetWindowTextW(hwnd, buf, 512);
  return utf16ToString(buf, n);
}

function utf16ToString(arr, len) {
  let s = '';
  for (let i = 0; i < len && arr[i] !== 0; i++) s += String.fromCharCode(arr[i]);
  return s;
}

/** 查找桌面宿主窗口 Progman（图标层 SHELLDLL_DefView 是其子窗口） */
function findDesktopHost() {
  return Number(BigIntAsInt(FindWindowW('Progman', null)));
}

/**
 * 查找 Progman 下、图标层(SHELLDLL_DefView)之下的 WorkerW（系统壁纸宿主）。
 * 挂载到 WorkerW 内部 = 覆盖系统壁纸但位于桌面图标之下。
 */
function findWallpaperWorkerW() {
  const progman = findDesktopHost();
  if (!progman) return 0;
  let h = Number(BigIntAsInt(FindWindowExW(progman, 0, null, null)));
  while (h) {
    if (getClassName(h) === 'WorkerW') return h; // 第一个 WorkerW 即图标层之下的壁纸宿主
    h = Number(BigIntAsInt(FindWindowExW(progman, h, null, null)));
  }
  return 0;
}

/** 获取虚拟桌面物理尺寸（所有显示器的并集，物理像素） */
function getDesktopRect() {
  return pmv2(() => {
    const x = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const y = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    return { x, y, width: w, height: h };
  });
}

/** 让窗口以物理像素铺满宿主客户区（宿主起点即虚拟屏起点） */
function fillDesktop(hwnd) {
  return pmv2(() => {
    const w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    MoveWindow(hwnd, 0, 0, w, h, 1);
    return { x: 0, y: 0, width: w, height: h };
  });
}

/** 把 hwnd 挂载为 host 的子窗口并铺满 */
function attachToHost(hwnd, host, toBottom) {
  pmv2(() => {
    // 转为真正的 WS_CHILD 子窗口（去掉 WS_POPUP），否则 Z 序无法正确压到图标层之下
    const style = BigIntAsInt(GetWindowLongPtrW(hwnd, GWL_STYLE));
    const newStyle = (style & ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_POPUP)) | WS_CHILD;
    SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
  });

  SetParent(hwnd, host);
  pmv2(() => {
    if (toBottom) {
      // 挂在 Progman 下：压到子窗口 Z 序底部（DefView 图标层之下）
      SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    } else {
      // 挂在 WorkerW 内：置于其子窗口顶部（覆盖系统绘制的壁纸）
      SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    }
  });
  fillDesktop(hwnd);
  ShowWindow(hwnd, SW_SHOW);
}

/**
 * 将指定窗口挂载为桌面壁纸。
 * 优先挂到 WorkerW（壁纸宿主）；若不存在则挂到 Progman 并压底，
 * 稍后 WorkerW 出现时由 ensureAttached() 纠正。
 */
function attachToDesktop(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  const progman = findDesktopHost();
  if (!progman) return false;

  // 请求系统生成 WorkerW（已存在则无副作用）
  try {
    const out = [0];
    SendMessageTimeoutW(progman, WM_SPAWN_WORKERW, 0, 0, 0, 500, out);
  } catch (_) {}

  const workerW = findWallpaperWorkerW();
  if (workerW) {
    attachToHost(hwnd, workerW, false);
    return true;
  }
  attachToHost(hwnd, progman, true);
  return true;
}

/**
 * 看门狗：确保壁纸窗口始终位于正确层级。
 * 场景：挂到 Progman 后系统才生成 WorkerW（会把我们的窗口挡住），
 * 或 WorkerW 被系统重建导致父窗口变化。返回 'ok' | 'reattached' | 'dead'。
 */
function ensureAttached(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return 'dead';
  const progman = findDesktopHost();
  if (!progman) return 'ok';

  const workerW = findWallpaperWorkerW();
  const parent = Number(BigIntAsInt(GetAncestor(hwnd, GA_PARENT)));

  if (workerW) {
    if (parent === workerW) {
      fillDesktop(hwnd); // 保持铺满（分辨率可能变化）
      return 'ok';
    }
    // 挂错了宿主（或 WorkerW 刚生成）：重新挂到 WorkerW
    attachToHost(hwnd, workerW, false);
    return 'reattached';
  }

  // 没有 WorkerW：确保挂在 Progman 且位于底部
  if (parent !== progman) {
    attachToHost(hwnd, progman, true);
    return 'reattached';
  }
  fillDesktop(hwnd);
  return 'ok';
}

/**
 * 查找父窗口下指定类名的子窗口
 * @param {number} parentHwnd 父窗口
 * @param {string} className 窗口类名（如 'mpv'）
 */
function findChildByClass(parentHwnd, className) {
  if (!parentHwnd) return 0;
  let h = Number(BigIntAsInt(FindWindowExW(parentHwnd, 0, null, null)));
  while (h) {
    if (getClassName(h) === className) return h;
    h = Number(BigIntAsInt(FindWindowExW(parentHwnd, h, null, null)));
  }
  return 0;
}

/**
 * 将子窗口在其父窗口内提到 Z 序顶部。
 * 用途：mpv 渲染窗口（--wid 挂入壁纸窗口）默认位于 Chromium 渲染层
 * (Chrome_RenderWidgetHostHWND) 之下导致视频黑屏，需提升到顶部。
 */
function raiseToTopInParent(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  pmv2(() => {
    SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  });
  return true;
}

/**
 * 检查子窗口是否位于父窗口子窗口 Z 序顶部，不是则提升。
 * @returns {boolean} 是否发生了提升
 */
function ensureChildOnTop(parentHwnd, className) {
  const child = findChildByClass(parentHwnd, className);
  if (!child) return false;
  const first = Number(BigIntAsInt(FindWindowExW(parentHwnd, 0, null, null)));
  if (first === child) return false; // 已在顶部
  raiseToTopInParent(child);
  return true;
}

/**
 * 将外部进程窗口嵌入为壁纸（用于 EXE 壁纸）：
 * 去边框 → 挂到 WorkerW/Progman → 物理像素铺满
 */
function embedExternalWindow(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  const progman = findDesktopHost();
  if (!progman) return false;

  const workerW = findWallpaperWorkerW();
  attachToHost(hwnd, workerW || progman, !workerW);
  return true;
}

/**
 * 检测前台是否有全屏应用（用于全屏时自动暂停视频壁纸，节省 CPU/GPU）
 * 判定标准（避免最大化窗口/系统覆盖层误判）：
 * 1. 排除桌面与系统覆盖层窗口（输入体验、NVIDIA 浮层等）
 * 2. 排除带标题栏的窗口（最大化窗口保留 WS_CAPTION，真全屏游戏是无边框）
 * 3. 前台窗口覆盖整个虚拟桌面
 */
const FULLSCREEN_SKIP_CLASSES = [
  'Progman', 'WorkerW', 'SHELLDLL_DefView', 'SysListView32',
  'Windows.UI.Core.CoreWindow', // Windows 输入体验宿主，非应用窗口
  'CEF-OSC-WIDGET',             // NVIDIA GeForce Overlay
  'Xaml_WindowedPopupClass',
];
function isFullscreenApp() {
  return pmv2(() => {
    const fg = Number(BigIntAsInt(GetForegroundWindow()));
    if (!fg) return false;
    const cls = getClassName(fg);
    if (FULLSCREEN_SKIP_CLASSES.includes(cls)) return false;
    // 带标题栏 = 普通最大化窗口，不是全屏
    const style = BigIntAsInt(GetWindowLongPtrW(fg, GWL_STYLE));
    if (style & WS_CAPTION) return false;
    const r = [0, 0, 0, 0];
    if (!GetWindowRect(fg, r)) return false;
    const vx = GetSystemMetrics(SM_XVIRTUALSCREEN);
    const vy = GetSystemMetrics(SM_YVIRTUALSCREEN);
    const vw = GetSystemMetrics(SM_CXVIRTUALSCREEN);
    const vh = GetSystemMetrics(SM_CYVIRTUALSCREEN);
    return r[0] <= vx && r[1] <= vy && (r[2] - r[0]) >= vw && (r[3] - r[1]) >= vh;
  });
}

/**
 * 枚举属于指定进程 PID 的可见顶层窗口
 * @returns {Array<{hwnd, title, className}>}
 */
function findWindowsByPid(pid) {
  const found = [];
  const callback = koffi.register((hwnd, _lParam) => {
    const pidBuf = [0];
    GetWindowThreadProcessId(hwnd, pidBuf);
    if (pidBuf[0] === pid && IsWindowVisible(hwnd)) {
      const title = getWindowTitle(hwnd);
      const className = getClassName(hwnd);
      if (title || className) {
        found.push({ hwnd, title, className });
      }
    }
    return 1;
  }, koffi.pointer(EnumWindowsProc));
  EnumWindows(callback, 0);
  koffi.unregister(callback);
  return found;
}

function isWindowAlive(hwnd) {
  return hwnd ? !!IsWindow(hwnd) : false;
}

function showHwnd(hwnd, show) {
  if (hwnd && IsWindow(hwnd)) ShowWindow(hwnd, show ? SW_SHOW : SW_HIDE);
}

// koffi 返回的 intptr_t 可能是 BigInt，安全转 Number
function BigIntAsInt(v) {
  return typeof v === 'bigint' ? Number(v) : v;
}

module.exports = {
  findDesktopHost,
  findWallpaperWorkerW,
  getDesktopRect,
  attachToDesktop,
  ensureAttached,
  fillDesktop,
  embedExternalWindow,
  findWindowsByPid,
  isFullscreenApp,
  isWindowAlive,
  showHwnd,
  getClassName,
  getWindowTitle,
  findChildByClass,
  raiseToTopInParent,
  ensureChildOnTop,
  isWindowVisible: (hwnd) => !!IsWindowVisible(hwnd),
};
