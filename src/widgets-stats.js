// widgets-stats.js — 桌面组件数据采集：CPU / GPU / 内存
// CPU: os.cpus() 差分采样；GPU: pdh.dll 性能计数器 \GPU Engine(*)\Utilization Percentage；
// 内存: os.totalmem/freemem。GPU 计数器不可用时返回 null（UI 显示 --）。
const koffi = require('koffi');
const os = require('os');

const PDH_FMT_DOUBLE = 0x00000200;

class StatsCollector {
  constructor() {
    this._timer = null;
    this._cpuLast = null;
    this._gpu = null; // { pdh, query, counter, buf }
    this._listeners = new Set();
  }

  on(fn) { this._listeners.add(fn); }
  off(fn) { this._listeners.delete(fn); }

  start(intervalMs = 1000) {
    if (this._timer) return;
    this._initGpu();
    this._timer = setInterval(() => this._tick(), intervalMs);
    // 立即采一次（CPU 第一次采样无差分，跳过显示）
    this._tick();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._cpuLast = null;
    this._freeGpu();
  }

  _emit(data) {
    for (const fn of this._listeners) {
      try { fn(data); } catch (_) {}
    }
  }

  _tick() {
    this._emit({
      cpu: this._cpuPercent(),
      gpu: this._gpuPercent(),
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

  // ---------- GPU（性能计数器） ----------
  // 注意：速率型计数器需要两次 PdhCollectQueryData 采样后 GetFormatted 才有效，
  // 因此第一次 tick 返回 null，第二次起有数据。
  _initGpu() {
    try {
      const pdh = koffi.load('pdh.dll');
      const PdhOpenQueryW = pdh.func('PdhOpenQueryW', 'int32_t', ['str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]);
      const PdhAddEnglishCounterW = pdh.func('PdhAddEnglishCounterW', 'int32_t', ['intptr_t', 'str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]);
      const query = [0], counter = [0];
      if (PdhOpenQueryW(null, 0, query) !== 0) throw new Error('PdhOpenQueryW failed');
      if (PdhAddEnglishCounterW(query[0], '\\GPU Engine(*)\\Utilization Percentage', 0, counter) !== 0) {
        throw new Error('PdhAddEnglishCounterW failed');
      }
      // 固定大缓冲复用（避免每秒分配）；不足时按需重分配
      const cap = 512 * 1024;
      this._gpu = {
        pdh,
        query: query[0],
        counter: counter[0],
        cap,
        buf: koffi.alloc('uint8_t', cap),
        PdhCollectQueryData: pdh.func('PdhCollectQueryData', 'int32_t', ['intptr_t']),
        PdhGetFormattedCounterArrayW: pdh.func(
          'PdhGetFormattedCounterArrayW', 'int32_t',
          ['intptr_t', 'uint32_t', koffi.inout(koffi.pointer('uint32_t')), koffi.inout(koffi.pointer('uint32_t')), koffi.pointer('uint8_t')]
        ),
      };
      console.log('[widgets] GPU 性能计数器已就绪');
    } catch (e) {
      console.warn('[widgets] GPU 计数器不可用:', e.message);
      this._gpu = null;
    }
  }

  _freeGpu() {
    this._gpu = null;
  }

  _gpuPercent() {
    const g = this._gpu;
    if (!g) return null;
    try {
      if (g.PdhCollectQueryData(g.query) !== 0) return null;
      const size = [g.cap], count = [0];
      const rc = g.PdhGetFormattedCounterArrayW(g.counter, PDH_FMT_DOUBLE, size, count, g.buf);
      if (rc !== 0) return null; // 含首次采样不足的情况
      // PDH_FMT_COUNTERVALUE_ITEM_W (x64): { LPWSTR szName(8); union(8); DWORD CStatus(4)+pad } = 24 字节
      const data = Buffer.from(koffi.decode(g.buf, 'uint8_t', size[0]));
      const stride = Math.max(8, Math.floor(size[0] / count[0]));
      let sum = 0;
      for (let i = 0; i < count[0]; i++) {
        const base = i * stride;
        if (data.readUInt32LE(base + 16) === 0) sum += data.readDoubleLE(base + 8);
      }
      return Math.min(100, Math.max(0, sum));
    } catch (_) {
      return null;
    }
  }
}

module.exports = { StatsCollector };
