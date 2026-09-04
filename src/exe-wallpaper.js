// exe-wallpaper.js — EXE 壁纸控制器
// 启动外部程序，等待其主窗口出现后，将窗口去边框并嵌入桌面壁纸层。
const { spawn } = require('child_process');
const path = require('path');
const desktop = require('./desktop');
const { guardChild } = require('./job-guard');

class ExeWallpaper {
  constructor() {
    this.child = null;
    this.hwnd = 0;
    this.exePath = null;
    this._pollTimer = null;
    this.onExit = null;
    this._stopFlag = false;
  }

  get isRunning() {
    return this.child !== null && this.child.exitCode === null;
  }

  /**
   * 启动 EXE 并嵌入为壁纸
   * @param {string} exePath 程序路径
   */
  start(exePath) {
    this.stop();
    this._stopFlag = false;
    this.exePath = exePath;

    try {
      this.child = spawn(exePath, [], {
        cwd: path.dirname(exePath),
        windowsHide: false, // 需要其窗口正常显示
      });
      // 纳入孤儿守卫：主进程被强杀时系统自动结束该 EXE 壁纸进程
      try { guardChild(this.child); } catch (_) {}
    } catch (err) {
      console.error('[exe-wallpaper] 启动失败:', err.message);
      return false;
    }

    this.child.on('exit', (code) => {
      console.log(`[exe-wallpaper] 程序退出 code=${code}`);
      this.child = null;
      this.hwnd = 0;
      if (this.onExit) this.onExit(code);
    });

    // 轮询寻找程序的主窗口（程序启动可能需要数秒）
    this._pollWindow();
    return true;
  }

  _pollWindow(attempt = 0) {
    if (this._stopFlag || !this.isRunning) return;
    // 最多等待 20 秒（2s 后开始找，每 500ms 一次）
    if (attempt > 40) {
      console.warn('[exe-wallpaper] 未找到可嵌入的窗口');
      return;
    }
    const delay = attempt === 0 ? 2000 : 500;
    this._pollTimer = setTimeout(() => {
      if (this._stopFlag || !this.isRunning) return;
      const wins = desktop.findWindowsByPid(this.child.pid);
      // 过滤掉工具提示类窗口，优先选择有标题的主窗口
      const skip = ['tooltips_class32', 'MSCTFIME UI'];
      const candidates = wins.filter(w => !skip.includes(w.className));
      const target = candidates.find(w => w.title) || candidates[0];
      if (target) {
        this.hwnd = target.hwnd;
        const ok = desktop.embedExternalWindow(this.hwnd);
        console.log(`[exe-wallpaper] 已嵌入窗口 hwnd=${this.hwnd} "${target.title}" ${ok ? '成功' : '失败'}`);
        if (ok) {
          // 持续监视：程序窗口意外关闭/进程退出时通知
          this._watch();
          return;
        }
      }
      this._pollWindow(attempt + 1);
    }, delay);
  }

  _watch() {
    this._pollTimer = setTimeout(() => {
      if (!this.isRunning || !desktop.isWindowAlive(this.hwnd)) {
        if (this.onExit) this.onExit(-1);
        return;
      }
      // 保证始终铺满桌面（有些程序会自行调整窗口大小）
      desktop.fillDesktop(this.hwnd);
      this._watch();
    }, 3000);
  }

  stop() {
    this._stopFlag = true;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
    if (this.child) {
      try { this.child.kill(); } catch (_) {}
      this.child = null;
    }
    this.hwnd = 0;
  }
}

module.exports = { ExeWallpaper };
