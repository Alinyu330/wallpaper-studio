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
const kernel32 = koffi.load('kernel32.dll');
const shell32 = koffi.load('shell32.dll');

// ---------- Win32 函数声明 ----------
const FindWindowW = user32.func('FindWindowW', 'intptr_t', ['str16', 'str16']);
const FindWindowExW = user32.func('FindWindowExW', 'intptr_t', ['intptr_t', 'intptr_t', 'str16', 'str16']);
const SetParent = user32.func('SetParent', 'intptr_t', ['intptr_t', 'intptr_t']);
const MoveWindow = user32.func('MoveWindow', 'int', ['intptr_t', 'int32_t', 'int32_t', 'int32_t', 'int32_t', 'int']);
const SetWindowPos = user32.func('SetWindowPos', 'int', ['intptr_t', 'intptr_t', 'int32_t', 'int32_t', 'int32_t', 'int32_t', 'uint32_t']);
const IsWindow = user32.func('IsWindow', 'int', ['intptr_t']);
const IsWindowVisible = user32.func('IsWindowVisible', 'int', ['intptr_t']);
const IsZoomed = user32.func('IsZoomed', 'int', ['intptr_t']);
const GetWindowRect = user32.func('GetWindowRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const GetClientRect = user32.func('GetClientRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const GetWindowLongPtrW = user32.func('GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32']);
const SetWindowLongPtrW = user32.func('SetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32', 'intptr_t']);
const SetLayeredWindowAttributes = user32.func('SetLayeredWindowAttributes', 'int', ['intptr_t', 'uint32', 'uint8', 'uint32']);
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

// ---------- 跨进程读取桌面图标（点选/框选收纳用） ----------
// 桌面图标住在 explorer.exe 的 SysListView32（虚拟列表控件）里。
// LVM_GETITEMRECT / LVM_GETITEMTEXTW 的参数指向调用方地址空间，
// 跨进程使用必须在 explorer 内分配内存（VirtualAllocEx）再回读
// （任务管理器读取进程列表的同款手法；只读不注入）。
const OpenProcess = kernel32.func('OpenProcess', 'intptr_t', ['uint32', 'int', 'uint32']);
const CloseHandle = kernel32.func('CloseHandle', 'int', ['intptr_t']);
const VirtualAllocEx = kernel32.func('VirtualAllocEx', 'intptr_t', ['intptr_t', 'intptr_t', 'size_t', 'uint32', 'uint32']);
const VirtualFreeEx = kernel32.func('VirtualFreeEx', 'int', ['intptr_t', 'intptr_t', 'size_t', 'uint32']);
const ReadProcessMemory = kernel32.func('ReadProcessMemory', 'int', ['intptr_t', 'intptr_t', 'void *', 'size_t', koffi.out(koffi.pointer('size_t'))]);
const WriteProcessMemory = kernel32.func('WriteProcessMemory', 'int', ['intptr_t', 'intptr_t', 'void *', 'size_t', koffi.out(koffi.pointer('size_t'))]);
const LVM_GETITEMCOUNT = 0x1004;
const LVM_GETITEMRECT = 0x100E;   // wParam=行号 lParam=RECT*（rect.left 预置 LVIR_BOUNDS=0）
const LVM_GETITEMTEXTW = 0x1073;  // wParam=行号 lParam=LVITEMW*

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
const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TOOLWINDOW = 0x00000080;
const LWA_ALPHA = 0x00000002;

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
 * 设置子窗口整体不透明度（0 透明 ~ 255 不透明）。
 * 通过 WS_EX_LAYERED + SetLayeredWindowAttributes 实现，
 * 实测对 mpv 的 D3D 子窗口内容有效（Win8+ 支持子窗口分层）。
 * 用途：双槽引擎的循环交叉淡入淡出与无黑屏热修复。
 */
function setChildAlpha(hwnd, alpha) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  const ex = BigIntAsInt(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
  if (!(ex & WS_EX_LAYERED)) {
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
  }
  const a = Math.max(0, Math.min(255, Math.round(alpha)));
  return !!SetLayeredWindowAttributes(hwnd, 0, a, LWA_ALPHA);
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

/** 枚举父窗口下指定类名的全部子窗口（按 Z 序） */
function findAllChildrenByClass(parentHwnd, className) {
  const out = [];
  if (!parentHwnd) return out;
  let h = Number(BigIntAsInt(FindWindowExW(parentHwnd, 0, null, null)));
  while (h) {
    if (getClassName(h) === className) out.push(h);
    h = Number(BigIntAsInt(FindWindowExW(parentHwnd, h, null, null)));
  }
  return out;
}

// ---------- 桌面组件覆盖层（位于图标层之上、普通窗口之下） ----------
// 组件窗口挂为 Progman 子窗口并置于图标层(SHELLDLL_DefView)之上：
// 既能渲染在壁纸/图标上方，又始终位于所有普通窗口之下。
// 配合 setIgnoreMouseEvents 轮询切换，实现"组件区域可点击、其余穿透"。
const D_POINT = koffi.struct('D_POINT', { x: 'int32_t', y: 'int32_t' });
const GetCursorPos = user32.func('GetCursorPos', 'int', [koffi.inout(koffi.pointer(D_POINT))]);
const DScreenToClient = user32.func('ScreenToClient', 'int', ['intptr_t', koffi.inout(koffi.pointer(D_POINT))]);

/** 查找图标层窗口 SHELLDLL_DefView */
function findDefView() {
  const progman = findDesktopHost();
  if (!progman) return 0;
  return findChildByClass(progman, 'SHELLDLL_DefView');
}

/** 把组件覆盖层挂到 Progman、置于图标层之上并铺满虚拟桌面 */
function attachWidgetsOverlay(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  const progman = findDesktopHost();
  if (!progman) return false;
  // 与 attachToHost 相同：转为 WS_CHILD 子窗口
  pmv2(() => {
    const style = BigIntAsInt(GetWindowLongPtrW(hwnd, GWL_STYLE));
    const newStyle = (style & ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_POPUP)) | WS_CHILD;
    SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
  });
  SetParent(hwnd, progman);
  const defView = findDefView();
  pmv2(() => {
    // 紧贴图标层之上（普通窗口永远在我们之上，因为整个 Progman 位于 Z 序底部）
    SetWindowPos(hwnd, defView || 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  });
  fillDesktop(hwnd);
  ShowWindow(hwnd, SW_SHOW);
  return true;
}

/** 看门狗：确保组件覆盖层仍挂在 Progman 且位于图标层之上 */
function ensureWidgetsOverlay(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return 'dead';
  const progman = findDesktopHost();
  if (!progman) return 'ok';
  const parent = Number(BigIntAsInt(GetAncestor(hwnd, GA_PARENT)));
  if (parent !== progman) {
    attachWidgetsOverlay(hwnd);
    return 'reattached';
  }
  // Explorer 重启等会重建 DefView；确认仍在图标层之上
  const defView = findDefView();
  if (defView) {
    const first = Number(BigIntAsInt(FindWindowExW(progman, 0, null, null)));
    let prev = 0;
    let h = first;
    while (h) {
      if (h === hwnd) break;
      if (h === defView) { prev = h; }
      h = Number(BigIntAsInt(FindWindowExW(progman, h, null, null)));
    }
    // 若 DefView 位于我们之上 → 重新抬高
    if (prev) {
      pmv2(() => {
        SetWindowPos(hwnd, defView, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      });
    }
  }
  fillDesktop(hwnd);
  return 'ok';
}

/**
 * 光标是否命中任一矩形（物理像素，相对 hwnd 客户区）。
 * 用于组件覆盖层的输入开关轮询（替代低级鼠标钩子，避免主线程死锁）。
 */
function cursorInRects(hwnd, rects) {
  if (!hwnd || !rects || !rects.length) return false;
  // 注意：koffi 的 struct pointer 参数必须传对象字面量（{x,y}），
  // 传数组 [0,0] 会抛 TypeError —— 在 Electron 主进程的定时器回调里
  // 未捕获异常会弹出模态错误对话框，冻结整个事件循环（表现为
  // 视频壁纸黑屏、mpv 无法启动/恢复）。
  const pt = { x: 0, y: 0 };
  if (!GetCursorPos(pt)) return false;
  if (!DScreenToClient(hwnd, pt)) return false;
  const x = pt.x, y = pt.y;
  for (const r of rects) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return true;
  }
  return false;
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

// ---------- 桌面快捷方式转盘覆盖层 ----------
// 与组件覆盖层同层：挂为 Progman 子窗口、置于图标层(SHELLDLL_DefView)之上、
// 普通窗口之下 —— 桌面直接点击可用，又不遮挡任何应用窗口。
// 窗口尺寸为转盘实际大小（非全屏），位置由主进程用物理像素控制。

/** 把转盘窗口挂到 Progman、置于图标层之上（保持现有尺寸与位置） */
function attachLauncherOverlay(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  const progman = findDesktopHost();
  if (!progman) return false;
  pmv2(() => {
    const style = BigIntAsInt(GetWindowLongPtrW(hwnd, GWL_STYLE));
    const newStyle = (style & ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX | WS_POPUP)) | WS_CHILD;
    SetWindowLongPtrW(hwnd, GWL_STYLE, newStyle);
  });
  SetParent(hwnd, progman);
  const defView = findDefView();
  pmv2(() => {
    SetWindowPos(hwnd, defView || 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
  });
  ShowWindow(hwnd, SW_SHOW);
  return true;
}

/** 看门狗：转盘窗口仍挂在 Progman 且位于图标层之上（不改动位置/尺寸） */
function ensureLauncherOverlay(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return 'dead';
  const progman = findDesktopHost();
  if (!progman) return 'ok';
  const parent = Number(BigIntAsInt(GetAncestor(hwnd, GA_PARENT)));
  if (parent !== progman) {
    attachLauncherOverlay(hwnd);
    return 'reattached';
  }
  const defView = findDefView();
  if (defView) {
    // 确认仍在图标层之上（Explorer 重启会重建 DefView）
    let prev = 0;
    let h = Number(BigIntAsInt(FindWindowExW(progman, 0, null, null)));
    while (h) {
      if (h === hwnd) break;
      if (h === defView) prev = h;
      h = Number(BigIntAsInt(FindWindowExW(progman, h, null, null)));
    }
    if (prev) {
      pmv2(() => {
        SetWindowPos(hwnd, defView, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
      });
    }
  }
  return 'ok';
}

/**
 * 把子窗口移动到屏幕物理坐标 (x,y)（保持尺寸）。
 * MoveWindow 对子窗口要求父窗口客户区坐标，这里用 ScreenToClient 换算。
 */
function moveWindowToScreen(hwnd, x, y) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  return pmv2(() => {
    const r = [0, 0, 0, 0];
    if (!GetWindowRect(hwnd, r)) return false;
    const w = r[2] - r[0];
    const h = r[3] - r[1];
    const host = Number(BigIntAsInt(GetAncestor(hwnd, GA_PARENT)));
    const pt = { x: Math.round(x), y: Math.round(y) };
    if (host) DScreenToClient(host, pt);
    return !!MoveWindow(hwnd, pt.x, pt.y, w, h, 1);
  });
}

/** 按物理像素调整子窗口尺寸并移动到屏幕坐标 (x,y) */
function resizeWindowToScreen(hwnd, x, y, w, h) {
  if (!hwnd || !IsWindow(hwnd)) return false;
  return pmv2(() => {
    const host = Number(BigIntAsInt(GetAncestor(hwnd, GA_PARENT)));
    const pt = { x: Math.round(x), y: Math.round(y) };
    if (host) DScreenToClient(host, pt);
    return !!MoveWindow(hwnd, pt.x, pt.y, Math.round(w), Math.round(h), 1);
  });
}

/** 获取窗口屏幕物理矩形 {x,y,w,h}（失效返回 null） */
function getWindowRectScreen(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return null;
  return pmv2(() => {
    const r = [0, 0, 0, 0];
    if (!GetWindowRect(hwnd, r)) return null;
    return { x: r[0], y: r[1], w: r[2] - r[0], h: r[3] - r[1] };
  });
}

// ---------- Shell 文件删除（快捷方式收纳用） ----------
// 桌面 .lnk 常被 explorer 持有句柄（图标缓存等）：fs.unlink 会被拒绝（EPERM）。
// SHFileOperationW(FO_DELETE, FOF_ALLOWUNDO) 是资源管理器语义的删除 ——
// shell 层协调文件句柄，可删除被 explorer 使用的文件，且进回收站可撤销。
const SHFileOperationW = shell32.func('SHFileOperationW', 'int', ['void *']);
const FO_DELETE = 3;
const FOF_NOCONFIRMATION = 0x10, FOF_ALLOWUNDO = 0x40, FOF_SILENT = 0x4, FOF_NOERRORUI = 0x400;

/** 双 null 结尾的 UTF-16 字符串 Buffer（SHFILEOPSTRUCT pFrom 要求） */
function zzWide(str) {
  const buf = Buffer.alloc((str.length + 2) * 2);
  buf.write(str, 0, 'utf16le');
  return buf;
}

/**
 * 以资源管理器语义删除文件到回收站（可删除被 explorer 持有的桌面快捷方式）。
 * SHFILEOPSTRUCTW 中的 pFrom 是指针：koffi 无法取 Buffer 地址，通过
 * OpenProcess(自身) + VirtualAllocEx 取得可寻址内存后写入字符串，
 * 再以纯字节结构调用。
 * @returns {boolean} 是否成功（返回码 0）
 */
function shellDeleteFile(file) {
  let hProc = 0, fromAddr = 0;
  try {
    const fromBuf = zzWide(file);
    const shfo = Buffer.alloc(56);   // SHFILEOPSTRUCTW（x64）
    shfo.writeUInt32LE(FO_DELETE, 8);                                            // wFunc
    shfo.writeUInt16LE(FOF_SILENT | FOF_NOCONFIRMATION | FOF_ALLOWUNDO | FOF_NOERRORUI, 32); // fFlags
    hProc = Number(BigIntAsInt(OpenProcess(0x38, 0, process.pid)));
    if (!hProc) return false;
    const MEM_COMMIT = 0x1000, PAGE_READWRITE = 4;
    fromAddr = Number(BigIntAsInt(VirtualAllocEx(hProc, 0, fromBuf.length, MEM_COMMIT, PAGE_READWRITE)));
    if (!fromAddr) return false;
    const nWrote = [0];
    if (!WriteProcessMemory(hProc, fromAddr, fromBuf, fromBuf.length, nWrote)) return false;
    shfo.writeBigUInt64LE(BigInt(fromAddr), 16);  // pFrom
    const r = SHFileOperationW(shfo);
    return r === 0;
  } catch (_) {
    return false;
  } finally {
    try {
      if (hProc) {
        if (fromAddr) VirtualFreeEx(hProc, fromAddr, 0, 0x8000);
        CloseHandle(hProc);
      }
    } catch (_) {}
  }
}

// ---------- 桌面图标枚举（点选/框选收纳） ----------
const DClientToScreen = user32.func('ClientToScreen', 'int', ['intptr_t', koffi.inout(koffi.pointer(D_POINT))]);

/**
 * 枚举桌面全部图标（名称 + 屏幕物理坐标矩形）。
 * 桌面图标列表是 explorer.exe 的 SysListView32：位置/文本查询的参数
 * 指针属于 explorer 地址空间 —— 在其中 VirtualAllocEx 一块内存，
 * SendMessage 让它写入，再 ReadProcessMemory 读回（只读，不注入）。
 * @returns {Array<{name,x,y,w,h}>|null} 失败返回 null（explorer 重启中等）
 */
function getDesktopIcons() {
  return pmv2(() => {
    let hProc = 0, rectAddr = 0, textAddr = 0, lviAddr = 0;
    try {
      const progman = findDesktopHost();
      if (!progman) return null;
      const defView = findChildByClass(progman, 'SHELLDLL_DefView');
      if (!defView) return null;
      const lv = findChildByClass(defView, 'SysListView32');
      if (!lv) return null;

      const out = [0];
      // 注意：SendMessageTimeoutW 的函数返回值只表示「消息是否被处理」，
      // 消息本身的返回值写入第 7 参数 out（LVM_GETITEMCOUNT → 图标数）
      SendMessageTimeoutW(lv, LVM_GETITEMCOUNT, 0, 0, 0, 500, out);
      const count = Number(out[0]);
      if (count <= 0 || count > 2000) return null;

      const pidBuf = [0];
      GetWindowThreadProcessId(lv, pidBuf);
      // PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE
      hProc = Number(BigIntAsInt(OpenProcess(0x38, 0, pidBuf[0])));
      if (!hProc) return null;

      const MEM_COMMIT = 0x1000, MEM_RELEASE = 0x8000, PAGE_READWRITE = 4;
      rectAddr = Number(BigIntAsInt(VirtualAllocEx(hProc, 0, 16, MEM_COMMIT, PAGE_READWRITE)));
      textAddr = Number(BigIntAsInt(VirtualAllocEx(hProc, 0, 1024, MEM_COMMIT, PAGE_READWRITE)));
      lviAddr = Number(BigIntAsInt(VirtualAllocEx(hProc, 0, 96, MEM_COMMIT, PAGE_READWRITE)));
      if (!rectAddr || !textAddr || !lviAddr) return null;

      // ListView 客户区坐标 → 屏幕物理坐标
      const origin = { x: 0, y: 0 };
      if (!DClientToScreen(lv, origin)) return null;

      const icons = [];
      const rectBuf = Buffer.alloc(16);
      const lviBuf = Buffer.alloc(96);
      const textBuf = Buffer.alloc(1024);
      const nRead = [0], nWrote = [0];
      for (let i = 0; i < count; i++) {
        // 边界矩形（LVIR_BOUNDS）：消息返回值（BOOL）在 out[0]
        rectBuf.writeInt32LE(0, 0);
        if (!WriteProcessMemory(hProc, rectAddr, rectBuf, 16, nWrote)) continue;
        const callOk = SendMessageTimeoutW(lv, LVM_GETITEMRECT, i, rectAddr, 0, 300, out);
        if (!callOk || !Number(out[0])) continue;
        if (!ReadProcessMemory(hProc, rectAddr, rectBuf, 16, nRead)) continue;
        const rx = rectBuf.readInt32LE(0), ry = rectBuf.readInt32LE(4);
        const rw = rectBuf.readInt32LE(8) - rx, rh = rectBuf.readInt32LE(12) - ry;
        if (rw <= 0 || rh <= 0) continue;
        // 显示名（LVITEMW：mask=LVIF_TEXT, iItem, pszText=远端文本缓冲, cchTextMax）
        lviBuf.fill(0);
        lviBuf.writeUInt32LE(0x1, 0);                     // mask = LVIF_TEXT
        lviBuf.writeInt32LE(i, 4);                        // iItem
        lviBuf.writeBigUInt64LE(BigInt(textAddr), 24);    // pszText（explorer 内地址）
        lviBuf.writeInt32LE(512, 32);                     // cchTextMax
        if (!WriteProcessMemory(hProc, lviAddr, lviBuf, 96, nWrote)) continue;
        SendMessageTimeoutW(lv, LVM_GETITEMTEXTW, i, lviAddr, 0, 300, out);
        if (!ReadProcessMemory(hProc, textAddr, textBuf, 1024, nRead)) continue;
        let name = '';
        for (let j = 0; j + 1 < textBuf.length; j += 2) {
          const c = textBuf.readUInt16LE(j);
          if (!c) break;
          name += String.fromCharCode(c);
        }
        if (!name) continue;
        icons.push({ name, x: origin.x + rx, y: origin.y + ry, w: rw, h: rh });
      }
      return icons;
    } catch (_) {
      return null;
    } finally {
      // 释放 explorer 内的临时内存（0 长度 + MEM_RELEASE）
      try {
        if (hProc) {
          if (rectAddr) VirtualFreeEx(hProc, rectAddr, 0, 0x8000);
          if (textAddr) VirtualFreeEx(hProc, textAddr, 0, 0x8000);
          if (lviAddr) VirtualFreeEx(hProc, lviAddr, 0, 0x8000);
          CloseHandle(hProc);
        }
      } catch (_) {}
    }
  });
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
 * 是否存在最大化的普通应用窗口（Wallpaper Engine 同款「窗口最大化时暂停」）。
 * 排除自身进程（主窗口最大化不算）、工具窗口与系统宿主窗口，避免误判。
 */
function isAnyWindowMaximized() {
  let found = false;
  const myPid = process.pid;
  const callback = koffi.register((hwnd, _lParam) => {
    if (found) return 0;
    if (IsWindowVisible(hwnd) && IsZoomed(hwnd)) {
      const pidBuf = [0];
      GetWindowThreadProcessId(hwnd, pidBuf);
      if (pidBuf[0] !== myPid) {
        const exStyle = BigIntAsInt(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
        if (!(exStyle & WS_EX_TOOLWINDOW)) {
          const cls = getClassName(hwnd);
          if (!FULLSCREEN_SKIP_CLASSES.includes(cls)) found = true;
        }
      }
    }
    return found ? 0 : 1;
  }, koffi.pointer(EnumWindowsProc));
  EnumWindows(callback, 0);
  koffi.unregister(callback);
  return found;
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

/** 获取窗口所属进程 PID（0 = 失败）。用于把 mpv 渲染子窗口与其进程一一对应 */
function getWindowPid(hwnd) {
  if (!hwnd || !IsWindow(hwnd)) return 0;
  const pidBuf = [0];
  GetWindowThreadProcessId(hwnd, pidBuf);
  return pidBuf[0] | 0;
}

/** 获取光标屏幕物理坐标 {x,y}（DPI 感知） */
function getCursorPos() {
  return pmv2(() => {
    const pt = { x: 0, y: 0 };
    if (!GetCursorPos(pt)) return null;
    return { x: pt.x, y: pt.y };
  });
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
  isAnyWindowMaximized,
  isWindowAlive,
  getWindowPid,
  getCursorPos,
  showHwnd,
  getClassName,
  getWindowTitle,
  findChildByClass,
  findAllChildrenByClass,
  raiseToTopInParent,
  ensureChildOnTop,
  setChildAlpha,
  attachWidgetsOverlay,
  ensureWidgetsOverlay,
  attachLauncherOverlay,
  ensureLauncherOverlay,
  moveWindowToScreen,
  resizeWindowToScreen,
  getWindowRectScreen,
  getDesktopIcons,
  shellDeleteFile,
  cursorInRects,
  isWindowVisible: (hwnd) => !!IsWindowVisible(hwnd),
};
