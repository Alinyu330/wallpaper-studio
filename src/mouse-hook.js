// mouse-hook.js — WH_MOUSE_LL 低级鼠标钩子
// 用途：壁纸组件窗口挂在桌面图标层之下，系统鼠标事件无法到达；
// 通过全局低级钩子捕获鼠标，命中组件区域时把事件转发给组件页面并
// 吞掉系统事件（阻止桌面框选/右键），未命中则放行（不影响正常桌面操作）。
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');

// ---------- Win32 ----------
const POINT = koffi.struct('MH_POINT', { x: 'int32_t', y: 'int32_t' });
const MSLLHOOKSTRUCT = koffi.struct('MH_MSLLHOOKSTRUCT', {
  x: 'int32_t', y: 'int32_t',
  mouseData: 'uint32_t', flags: 'uint32_t', time: 'uint32_t',
  dwExtraInfo: 'uintptr_t',
});
const LowLevelMouseProc = koffi.proto(
  'intptr_t __stdcall MH_LowLevelMouseProc(int32_t nCode, uintptr_t wParam, void *lParam)'
);

const SetWindowsHookExW = user32.func('SetWindowsHookExW', 'intptr_t', ['int32_t', koffi.pointer(LowLevelMouseProc), 'intptr_t', 'uint32_t']);
const UnhookWindowsHookEx = user32.func('UnhookWindowsHookEx', 'int', ['intptr_t']);
const CallNextHookEx = user32.func('CallNextHookEx', 'intptr_t', ['intptr_t', 'int32_t', 'uintptr_t', 'intptr_t']);
const ScreenToClient = user32.func('ScreenToClient', 'int', ['intptr_t', koffi.inout(koffi.pointer(POINT))]);
const GetModuleHandleW = user32.func('GetModuleHandleW', 'intptr_t', ['str16']);

const WH_MOUSE_LL = 14;

// 鼠标消息 → 事件类型
const MSG_MAP = {
  0x0200: 'move',   // WM_MOUSEMOVE
  0x0201: 'down',   // WM_LBUTTONDOWN
  0x0202: 'up',     // WM_LBUTTONUP
  0x0204: 'rdown',  // WM_RBUTTONDOWN
  0x0205: 'rup',    // WM_RBUTTONUP
  0x020A: 'wheel',  // WM_MOUSEWHEEL
};

/**
 * 鼠标钩子管理器
 * handler(ev) 返回 true 表示事件已消费（吞掉，不再传递给系统）。
 * ev = { type: 'move'|'down'|'up'|'rdown'|'rup'|'wheel', x, y, delta }
 * x/y 为目标窗口客户区坐标（物理像素）。
 */
class MouseHook {
  constructor() {
    this._hook = 0;
    this._cb = null;
    this._hwnd = 0;
  }

  get active() { return !!this._hook; }

  /** 安装钩子（重复调用安全，仅更新目标窗口） */
  start(hwnd, handler) {
    this._hwnd = hwnd;
    if (this._hook) return;
    const self = this;
    this._cb = koffi.register((nCode, wParam, lParam) => {
      if (nCode >= 0) {
        try {
          const type = MSG_MAP[Number(wParam)];
          if (type && self._hwnd) {
            const st = koffi.decode(lParam, MSLLHOOKSTRUCT);
            const pt = [st.x, st.y];
            if (ScreenToClient(self._hwnd, pt)) {
              const ev = { type, x: pt[0], y: pt[1] };
              if (type === 'wheel') ev.delta = (st.mouseData >> 16) / 120; // 滚轮格数
              if (self._handler && self._handler(ev)) return 1;
            }
          }
        } catch (_) { /* 钩子回调绝不能抛异常 */ }
      }
      return CallNextHookEx(0, nCode, wParam, lParam);
    }, koffi.pointer(LowLevelMouseProc));
    this._handler = handler;
    const hmod = Number(GetModuleHandleW(null)) || 0;
    this._hook = Number(SetWindowsHookExW(WH_MOUSE_LL, this._cb, hmod, 0));
    if (!this._hook) {
      koffi.unregister(this._cb);
      this._cb = null;
      console.warn('[mouse-hook] 安装失败');
    } else {
      console.log('[mouse-hook] 已安装（组件交互）');
    }
  }

  stop() {
    if (this._hook) {
      try { UnhookWindowsHookEx(this._hook); } catch (_) {}
      this._hook = 0;
      console.log('[mouse-hook] 已卸载');
    }
    if (this._cb) {
      try { koffi.unregister(this._cb); } catch (_) {}
      this._cb = null;
    }
    this._handler = null;
    this._hwnd = 0;
  }
}

module.exports = { MouseHook };
