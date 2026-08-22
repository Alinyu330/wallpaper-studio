// widgets-stats.js — 桌面组件数据采集：CPU / GPU / 内存
// CPU: os.cpus() 差分采样；内存: os.totalmem/freemem；
// GPU: 由 widgets-stats-gpu.js 工作线程采集（PDH 查询可能长时间阻塞，
//      不能在主线程调用），本类仅缓存其结果。
// GPU 不可用时为 null（UI 显示 --）。
const { Worker } = require('worker_threads');
const path = require('path');
const os = require('os');

class StatsCollector {
  constructor() {
    this._timer = null;
    this._cpuLast = null;
    this._gpuWorker = null;
    this._gpuValue = null; // 工作线程最近上报的 GPU 占用率
    this._listeners = new Set();
  }

  on(fn) { this._listeners.add(fn); }
  off(fn) { this._listeners.delete(fn); }

  start(intervalMs = 1000) {
    if (this._timer) return;
    this._startGpuWorker();
    this._timer = setInterval(() => this._tick(), intervalMs);
    // 立即采一次（CPU 第一次采样无差分，跳过显示）
    this._tick();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._cpuLast = null;
    if (this._gpuWorker) {
      try { this._gpuWorker.terminate(); } catch (_) {}
      this._gpuWorker = null;
    }
    this._gpuValue = null;
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

  // ---------- GPU（工作线程） ----------
  _startGpuWorker() {
    if (this._gpuWorker) return;
    try {
      this._gpuWorker = new Worker(path.join(__dirname, 'widgets-stats-gpu.js'));
      this._gpuWorker.on('message', (m) => {
        if (m && typeof m.gpu !== 'undefined') this._gpuValue = m.gpu;
      });
      this._gpuWorker.on('error', () => { this._gpuValue = null; });
      this._gpuWorker.on('exit', (code) => {
        this._gpuWorker = null;
        this._gpuValue = null;
        if (code !== 0) console.warn('[widgets] GPU 采集线程异常退出，GPU 显示 --');
      });
      console.log('[widgets] GPU 采集已移入工作线程（防主线程阻塞）');
    } catch (e) {
      console.warn('[widgets] GPU 采集线程不可用:', e.message);
      this._gpuWorker = null;
    }
  }
}

module.exports = { StatsCollector };
