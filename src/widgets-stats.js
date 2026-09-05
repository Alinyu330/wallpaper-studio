// widgets-stats.js — 桌面组件数据采集：CPU / GPU / 内存 / 网速
// CPU: os.cpus() 差分采样；内存: os.totalmem/freemem（都在主线程，开销可忽略）；
// GPU 与网速: 由 worker 线程跑 PDH 查询（可能长时间阻塞，不能进主线程），
//             本类仅缓存其结果。对应组件没开时线程根本不启动。
// 采不到时为 null（UI 显示 --）。
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

const MIN_INTERVAL = 250;
const MAX_INTERVAL = 10000;

class StatsCollector {
  constructor() {
    this._timer = null;
    this._interval = 1000;
    this._cpuLast = null;
    this._needs = { gpu: false, net: false };
    this._gpuWorker = null;
    this._gpuValue = null;  // 0~100
    this._netWorker = null;
    this._netValue = null;  // {down, up} bytes/sec
    this._listeners = new Set();
  }

  on(fn) { this._listeners.add(fn); }
  off(fn) { this._listeners.delete(fn); }

  start(intervalMs = 1000) {
    const ms = this._clamp(intervalMs);
    if (this._timer) {
      if (ms !== this._interval) this.setIntervalMs(ms);
      return;
    }
    this._interval = ms;
    this._applyNeeds();
    this._timer = setInterval(() => this._tick(), ms);
    this._tick(); // 立即采一次（CPU 第一次无差分，跳过显示）
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._cpuLast = null;
    this._stopWorker('gpu');
    this._stopWorker('net');
  }

  /**
   * 改刷新间隔：只换定时器并向存活 worker 转发新周期。
   * ★ 绝不能走 stop()+start() —— stop() 会清 _cpuLast（下一次 CPU 显示 "--"）
   *   并 terminate worker（koffi + PDH 重新初始化，速率型计数器还要再等一个
   *   采样周期），拖动滑杆时会看到组件连续闪好几秒的空值。
   */
  setIntervalMs(ms) {
    const next = this._clamp(ms);
    if (next === this._interval) return;
    this._interval = next;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = setInterval(() => this._tick(), next);
    }
    for (const w of [this._gpuWorker, this._netWorker]) {
      try { if (w) w.postMessage({ cmd: 'interval', ms: next }); } catch (_) {}
    }
  }

  /**
   * 按需启停采集线程：GPU 组件没开就不该有 GPU 的 PDH 查询在跑
   * （GPU Engine 计数器一台机器可达 800+ 实例，白采是实打实的 CPU 与内存）。
   * @param {{gpu?:boolean, net?:boolean}} n
   */
  setNeeds(n) {
    this._needs = { gpu: !!(n && n.gpu), net: !!(n && n.net) };
    if (this._timer) this._applyNeeds(); // 未 start 时交给 start() 统一拉起
  }

  _applyNeeds() {
    if (this._needs.gpu) this._startWorker('gpu'); else this._stopWorker('gpu');
    if (this._needs.net) this._startWorker('net'); else this._stopWorker('net');
  }

  _clamp(ms) {
    return Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(Number(ms) || 1000)));
  }

  _emit(data) {
    for (const fn of this._listeners) {
      try { fn(data); } catch (_) {}
    }
  }

  _tick() {
    this._emit({
      cpu: this._cpuPercent(),
      gpu: this._gpuValue,
      mem: this._memPercent(),
      netDown: this._netValue ? this._netValue.down : null,
      netUp: this._netValue ? this._netValue.up : null,
      at: Date.now(),
    });
  }

  _cpuPercent() {
    let idle = 0, total = 0;
    for (const cpu of os.cpus()) {
      const t = cpu.times;
      idle += t.idle;
      total += t.idle + t.user + t.nice + t.sys + t.irq;
    }
    const last = this._cpuLast;
    this._cpuLast = { idle, total };
    if (!last) return null;
    const dIdle = idle - last.idle;
    const dTotal = total - last.total;
    if (dTotal <= 0) return 0;
    return Math.min(100, Math.max(0, (1 - dIdle / dTotal) * 100));
  }

  _memPercent() {
    const total = os.totalmem();
    const free = os.freemem();
    if (!total) return null;
    return (1 - free / total) * 100;
  }

  // ---------- worker（GPU / 网速） ----------

  _workerFile(kind) {
    return path.join(__dirname, kind === 'net' ? 'widgets-stats-net.js' : 'widgets-stats-gpu.js');
  }

  _startWorker(kind) {
    const slot = kind === 'net' ? '_netWorker' : '_gpuWorker';
    if (this[slot]) return;
    try {
      const w = new Worker(this._workerFile(kind));
      w.on('message', (m) => {
        if (!m) return;
        if (m.unavailable) console.warn(`[widgets] ${kind.toUpperCase()} 采集不可用:`, m.unavailable);
        if (kind === 'net') {
          if ('net' in m) this._netValue = m.net;
        } else if ('gpu' in m) {
          this._gpuValue = m.gpu;
        }
      });
      w.on('error', () => {
        if (kind === 'net') this._netValue = null; else this._gpuValue = null;
      });
      w.on('exit', (code) => {
        this[slot] = null;
        if (kind === 'net') this._netValue = null; else this._gpuValue = null;
        if (code !== 0) console.warn(`[widgets] ${kind.toUpperCase()} 采集线程异常退出，组件显示 --`);
      });
      this[slot] = w;
      // 新线程要跟上当前刷新间隔（速率型计数器需两次采样，间隔越短首值越快）
      try { w.postMessage({ cmd: 'interval', ms: this._interval }); } catch (_) {}
      console.log(`[widgets] ${kind.toUpperCase()} 采集已移入工作线程（防主线程阻塞）`);
    } catch (e) {
      console.warn(`[widgets] ${kind.toUpperCase()} 采集线程不可用:`, e.message);
      this[slot] = null;
    }
  }

  _stopWorker(kind) {
    const slot = kind === 'net' ? '_netWorker' : '_gpuWorker';
    const w = this[slot];
    this[slot] = null;
    if (kind === 'net') this._netValue = null; else this._gpuValue = null;
    if (!w) return;
    try { w.postMessage({ cmd: 'stop' }); } catch (_) {}
    try { w.terminate(); } catch (_) {}
  }
}

module.exports = { StatsCollector };
