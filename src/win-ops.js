// win-ops.js — mpv 子窗口变更类窗口操作的隔离执行器（worker 线程池 + 超时保护）
//
// 背景：SetWindowPos / SetLayeredWindowAttributes 会向目标窗口所属线程同步投递
// 消息。当 mpv 因 D3D11 设备失效而冻结时，其消息循环停摆——主进程若直接调用
// 这类 API 会永远阻塞（Electron 主线程死锁 → 看门狗/健康检查全部停摆 → 壁纸
// 永久冻结且无法自愈，即"播放一段时间后无法正常播放"的最终元凶）。
//
// 方案：变更类操作全部派发到 worker 线程执行，主线程带超时等待；
// worker 卡死则终止并重建。目标窗口冻结时最多损失一个 worker，主线程永不阻塞。
const { Worker } = require('worker_threads');
const path = require('path');

const WORKER_SRC = `
const { parentPort, workerData } = require('worker_threads');
const koffi = require(workerData.koffiPath);
const u = koffi.load('user32.dll');
const SetWindowPos = u.func('SetWindowPos', 'int', ['intptr_t', 'intptr_t', 'int32', 'int32', 'int32', 'int32', 'uint32']);
const GetWindowLongPtrW = u.func('GetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32']);
const SetWindowLongPtrW = u.func('SetWindowLongPtrW', 'intptr_t', ['intptr_t', 'int32', 'intptr_t']);
const SetLayeredWindowAttributes = u.func('SetLayeredWindowAttributes', 'int', ['intptr_t', 'uint32', 'uint8', 'uint32']);
const GWL_EXSTYLE = -20, WS_EX_LAYERED = 0x80000, LWA_ALPHA = 2;
const SWP_NOSIZE = 0x1, SWP_NOMOVE = 0x2, SWP_NOACTIVATE = 0x10;
function I(v) { return typeof v === 'bigint' ? Number(v) : v; }
parentPort.on('message', (m) => {
  let ok = false;
  try {
    const hwnd = I(m.hwnd);
    if (m.op === 'raise') {
      ok = !!SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE);
    } else if (m.op === 'alpha') {
      const ex = I(GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (!(ex & WS_EX_LAYERED)) SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex | WS_EX_LAYERED);
      ok = !!SetLayeredWindowAttributes(hwnd, 0, Math.max(0, Math.min(255, Math.round(m.alpha))), LWA_ALPHA);
    }
  } catch (_) {}
  try { parentPort.postMessage({ id: m.id, ok }); } catch (_) {}
});
`;

class WinOps {
  constructor(size = 2) {
    this.koffiPath = require.resolve('koffi');
    this.size = size;
    this.workers = [];
    this.seq = 0;
    this.pending = new Map(); // id -> { resolve, timer }
    for (let i = 0; i < size; i++) this.workers.push(this._spawn());
  }

  _spawn() {
    const w = {
      worker: new Worker(WORKER_SRC, { eval: true, workerData: { koffiPath: this.koffiPath } }),
      busy: false,
    };
    w.worker.unref();
    w.worker.on('message', (msg) => {
      const p = this.pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(msg.id);
      w.busy = false;
      p.resolve(!!msg.ok);
    });
    w.worker.on('error', () => this._replace(w));
    w.worker.on('exit', () => {
      if (this.workers.includes(w)) this._replace(w);
    });
    return w;
  }

  /** worker 卡死（目标窗口冻结）时终止并重建，挂起中的调用按失败返回 */
  _replace(w) {
    const idx = this.workers.indexOf(w);
    if (idx < 0) return;
    this.workers[idx] = this._spawn();
    for (const [id, p] of [...this.pending]) {
      if (p.worker === w) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        p.resolve(false);
      }
    }
  }

  /**
   * 执行窗口操作（带超时）。
   * @param {'raise'|'alpha'} op
   * @returns {Promise<boolean>} false = 超时/失败（目标窗口可能已冻结）
   */
  run(op, hwnd, alpha, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let w = this.workers.find((x) => !x.busy) || this.workers[0];
      w.busy = true;
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this._replace(w);
        resolve(false);
      }, timeoutMs);
      this.pending.set(id, { resolve, timer, worker: w });
      try {
        w.worker.postMessage({ id, op, hwnd: String(hwnd), alpha });
      } catch (_) {
        clearTimeout(timer);
        this.pending.delete(id);
        this._replace(w);
        resolve(false);
      }
    });
  }

  /** 发后即忘（淡入淡出逐帧调 alpha 用，不等待结果） */
  fire(op, hwnd, alpha) {
    this.run(op, hwnd, alpha, 1200).catch(() => {});
  }

  destroy() {
    for (const w of this.workers) {
      try { w.worker.terminate(); } catch (_) {}
    }
    this.workers = [];
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve(false);
    }
    this.pending.clear();
  }
}

module.exports = { WinOps };
