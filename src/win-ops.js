// win-ops.js — mpv 子窗口变更类窗口操作的隔离执行器（worker 线程池 + 超时保护）
//
// 背景：SetWindowPos / SetLayeredWindowAttributes 会向目标窗口所属线程同步投递
// 消息。当 mpv 因 D3D11 设备失效而冻结时，其消息循环停摆——主进程若直接调用
// 这类 API 会永远阻塞（Electron 主线程死锁 → 看门狗/健康检查全部停摆 → 壁纸
// 永久冻结且无法自愈，即"播放一段时间后无法正常播放"的最终元凶）。
//
// 方案：变更类操作全部派发到 worker 线程执行，主线程带超时等待；
// worker 卡死则终止并重建。目标窗口冻结时最多损失一个 worker，主线程永不阻塞。
//
// v1.5.0 重写派发模型（修复"无黑屏热修复被误杀"）：
// - 队列化派发：操作只在 worker 空闲时下发，绝不分发给忙线程。旧版把操作
//   叠加到忙 worker 上，该 worker 因超时被重建时，叠加在其上的合法操作
//   （如热修复的窗口抬升）会被连带判失败 → 连锁回退到完整重启（黑屏）。
// - 同目标去重：同一 (op, hwnd) 已在执行中时，新请求直接判失败跳过——
//   冻结窗口上的重复看门狗抬升不再反复占用 worker。
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
// hwnd 必须是 Number/BigInt：koffi 的 intptr_t 收到字符串会直接抛 TypeError
// （被 try/catch 吞掉表现为操作永远失败——v1.4.0 全部窗口操作失效的元凶）
function I(v) { return typeof v === 'bigint' ? Number(v) : Number(v); }
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
    this.pending = new Map(); // id -> task（每个 worker 至多一个在执行）
    this.queue = [];          // 待派发任务（无空闲 worker 时排队，绝不叠加给忙线程）
    for (let i = 0; i < size; i++) this.workers.push(this._spawn());
  }

  _spawn() {
    const w = {
      worker: new Worker(WORKER_SRC, { eval: true, workerData: { koffiPath: this.koffiPath } }),
      busy: false,
    };
    w.worker.unref();
    w.worker.on('message', (msg) => {
      const task = this.pending.get(msg.id);
      if (!task) {
        if (process.env.WINOPS_DEBUG) console.log(`[winops] STALE-REPLY id=${msg.id}`);
        return;
      }
      if (process.env.WINOPS_DEBUG && !msg.ok) console.log(`[winops] REPLY-FAIL op=${task.op} hwnd=${task.hwnd}`);
      clearTimeout(task.timer);
      this.pending.delete(msg.id);
      w.busy = false;
      task.resolve(!!msg.ok);
      this._pump();
    });
    w.worker.on('error', () => { if (process.env.WINOPS_DEBUG) console.log('[winops] WORKER-ERROR'); this._replace(w); });
    w.worker.on('exit', () => {
      if (this.workers.includes(w)) { if (process.env.WINOPS_DEBUG) console.log('[winops] WORKER-EXIT'); this._replace(w); }
    });
    return w;
  }

  /** worker 卡死/意外退出时：终止并重建之；其上未完成的操作按失败返回（目标窗口大概率冻结） */
  _replace(w) {
    const idx = this.workers.indexOf(w);
    if (idx < 0) return;
    try { w.worker.terminate(); } catch (_) {} // 若线程卡在 FFI 调用中，解除阻塞后生效
    this.workers[idx] = this._spawn();
    for (const [id, t] of [...this.pending]) {
      if (t.worker === w) {
        clearTimeout(t.timer);
        this.pending.delete(id);
        t.resolve(false);
      }
    }
    this._pump();
  }

  /**
   * 执行窗口操作（带超时，忙时排队）。
   * @param {'raise'|'alpha'} op
   * @returns {Promise<boolean>} false = 超时/失败/同目标重复被跳过（目标窗口可能已冻结）
   */
  run(op, hwnd, alpha, timeoutMs = 1500) {
    return new Promise((resolve) => {
      if (!this.workers.length) return resolve(false); // 已销毁
      this.queue.push({
        id: ++this.seq, op, hwnd: Number(hwnd), alpha, timeoutMs,
        resolve, worker: null, timer: null,
      });
      this._pump();
    });
  }

  /** 把队列中的操作依次派发给空闲 worker */
  _pump() {
    while (this.queue.length) {
      const w = this.workers.find((x) => !x.busy);
      if (!w) return; // 全忙：留在队列里，worker 空闲时再派（绝不叠加给忙线程）
      const task = this.queue.shift();
      // 同目标去重：同一 (op, hwnd) 已在执行（大概率卡在冻结窗口上）→ 跳过本次。
      // 健康窗口上的操作几十毫秒即完成，正常流程不会命中去重。
      const dup = [...this.pending.values()].some((t) => t.op === task.op && t.hwnd === task.hwnd);
      if (dup) {
        if (process.env.WINOPS_DEBUG) console.log(`[winops] DEDUP-SKIP op=${task.op} hwnd=${task.hwnd} q=${this.queue.length}`);
        task.resolve(false);
        continue;
      }
      if (process.env.WINOPS_DEBUG) console.log(`[winops] DISPATCH op=${task.op} hwnd=${task.hwnd} pending=${this.pending.size} q=${this.queue.length}`);
      task.worker = w;
      w.busy = true;
      task.timer = setTimeout(() => {
        // 目标窗口冻结：本操作判失败，执行它的 worker 可能卡死 → 终止重建
        if (process.env.WINOPS_DEBUG) console.log(`[winops] TIMEOUT op=${task.op} hwnd=${task.hwnd}`);
        this.pending.delete(task.id);
        this._replace(w);
        task.resolve(false);
      }, task.timeoutMs);
      this.pending.set(task.id, task);
      try {
        w.worker.postMessage({ id: task.id, op: task.op, hwnd: task.hwnd, alpha: task.alpha });
      } catch (_) {
        if (process.env.WINOPS_DEBUG) console.log(`[winops] POST-THROW op=${task.op}`);
        clearTimeout(task.timer);
        this.pending.delete(task.id);
        w.busy = false;
        task.resolve(false);
        this._pump();
      }
    }
  }

  /** 发后即忘（淡入逐帧调 alpha 用，不等待结果） */
  fire(op, hwnd, alpha) {
    this.run(op, hwnd, alpha, 1200).catch(() => {});
  }

  destroy() {
    for (const w of this.workers) {
      try { w.worker.terminate(); } catch (_) {}
    }
    this.workers = [];
    for (const t of this.queue) {
      clearTimeout(t.timer);
      t.resolve(false);
    }
    this.queue = [];
    for (const [id, t] of [...this.pending]) {
      clearTimeout(t.timer);
      t.resolve(false);
      this.pending.delete(id);
    }
  }
}

module.exports = { WinOps };
