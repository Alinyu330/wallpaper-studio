// pdh-worker.js — worker 线程复用的 PDH 性能计数器读取（koffi）
//
// ★ 两个实测事实（2026-09-05 用 844 实例的 GPU Engine 计数器验证），改回旧写法
//   就会读到错位垃圾：
//   1. PdhGetFormattedCounterArrayW 把缓冲区打包成
//      [count × 24B 的 PDH_FMT_COUNTERVALUE_ITEM_W][紧随其后的实例名宽字符串]。
//      所以 item 步长恒等于 sizeof(item) = 24，绝不是 lpBufferSize / count。
//      旧 GPU 实现拿 size/count 当步长（844 实例、126132B 时算出 152），
//      每一项都读到别的实例的中间字节。
//   2. item 内布局：szName@+0(8B) · CStatus@+8(4B) · pad@+12 · value@+16(8B)。
//      旧实现把 status 当 @+16、value 当 @+8，恰好读反 —— 结果 GPU 组件恒显示 0%。
//
// 实例名不通过 koffi 解引用指针读取（实测会让整个进程原生崩溃、无 JS 异常），
// 而是用 koffi.address(szName) - koffi.address(buf) 换算成缓冲区内偏移，
// 再从原始字节里按 UTF-16LE 读到 null 为止。
//
// 只允许在 worker_threads 里 require：koffi + PDH 查询可能长时间阻塞
// （GPU 客户端退出时驱动清理可达数十秒），绝不能进主线程。
const { parentPort } = require('worker_threads');
const koffi = require('koffi');

const PDH_FMT_DOUBLE = 0x00000200;
const PDH_CSTATUS_VALID_DATA = 0;
const PDH_MORE_DATA = -2147481646; // 0x800007D2 按 int32 解释
const ITEM_BYTES = 24;             // sizeof(PDH_FMT_COUNTERVALUE_ITEM_W) on x64
const MAX_CAP = 16 * 1024 * 1024;

// 字段名避开 value：koffi 解出的对象上 it.value 读不到（实测 undefined）
const ITEM = koffi.struct({ szName: 'str16 *', CStatus: 'uint32', pad: 'uint32', dbl: 'double' });

let A = null;
function api() {
  if (A) return A;
  const lib = koffi.load('pdh.dll');
  A = {
    OpenQuery: lib.func('PdhOpenQueryW', 'int32_t', ['str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]),
    AddCounter: lib.func('PdhAddEnglishCounterW', 'int32_t', ['intptr_t', 'str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]),
    Collect: lib.func('PdhCollectQueryData', 'int32_t', ['intptr_t']),
    GetArray: lib.func('PdhGetFormattedCounterArrayW', 'int32_t', [
      'intptr_t', 'uint32_t',
      koffi.inout(koffi.pointer('uint32_t')),
      koffi.inout(koffi.pointer('uint32_t')),
      koffi.pointer(ITEM),
    ]),
    CloseQuery: lib.func('PdhCloseQuery', 'int32_t', ['intptr_t']),
  };
  return A;
}

class PdhQuery {
  /**
   * @param {string[]} paths 英文计数器路径（用 PdhAddEnglishCounterW，与系统显示语言无关）
   * @param {object} [opt] { capBytes }
   */
  constructor(paths, opt = {}) {
    const a = api();
    this.a = a;
    this.query = 0;
    this.counters = [];
    const q = [0];
    if (a.OpenQuery(null, 0, q) !== 0) throw new Error('PdhOpenQueryW 失败');
    this.query = q[0];
    try {
      for (const p of paths) {
        const c = [0];
        const rc = a.AddCounter(this.query, p, 0, c);
        if (rc !== 0) throw new Error(`PdhAddEnglishCounterW 失败(${p}) rc=${rc}`);
        this.counters.push(c[0]);
      }
    } catch (e) {
      this.close();
      throw e;
    }
    this._alloc(opt.capBytes || 2 * 1024 * 1024);
  }

  _alloc(capBytes) {
    this.cap = Math.min(MAX_CAP, capBytes);
    this.buf = koffi.alloc(ITEM, Math.floor(this.cap / ITEM_BYTES));
    this.base = koffi.address(this.buf);
  }

  /**
   * 采集一次并读出全部计数器。
   * 速率型计数器（名字以 /sec 结尾的那类）需要两次 Collect 才有有效数据，首次返回 null。
   * @returns {Array<Array<{name:string,value:number}>>|null}
   */
  sample() {
    if (!this.query || this.a.Collect(this.query) !== 0) return null;
    const out = [];
    for (const c of this.counters) {
      const list = this._readArray(c);
      if (list === null) return null; // 尚未就绪或缓冲区不足
      out.push(list);
    }
    return out;
  }

  _readArray(counter) {
    const size = [this.cap], count = [0];
    let rc = this.a.GetArray(counter, PDH_FMT_DOUBLE, size, count, this.buf);
    if (rc === PDH_MORE_DATA && this.cap < MAX_CAP) {
      this._alloc(Math.max(size[0] || 0, this.cap * 2));
      size[0] = this.cap; count[0] = 0;
      rc = this.a.GetArray(counter, PDH_FMT_DOUBLE, size, count, this.buf);
    }
    if (rc !== 0 || !(count[0] > 0)) return null;
    const items = koffi.decode(this.buf, koffi.array(ITEM, count[0]));
    // 名称区在 item 数组之后，只在这一次 sample 内解一份原始字节
    const raw = Buffer.from(koffi.decode(this.buf, 'uint8_t', size[0]));
    const out = [];
    for (const it of items) {
      if (it.CStatus !== PDH_CSTATUS_VALID_DATA) continue;
      out.push({ name: this._nameAt(raw, it.szName), value: it.dbl });
    }
    return out;
  }

  _nameAt(raw, ptr) {
    try {
      const off = Number(koffi.address(ptr) - this.base);
      if (!(off >= 0) || off >= raw.length) return '';
      let e = off;
      while (e + 1 < raw.length && !(raw[e] === 0 && raw[e + 1] === 0)) e += 2;
      return raw.subarray(off, e).toString('utf16le');
    } catch (_) {
      return '';
    }
  }

  close() {
    try { if (this.query) this.a.CloseQuery(this.query); } catch (_) {}
    this.query = 0;
    this.counters = [];
  }
}

/**
 * worker 主循环：定时采集 + 响应主线程的 interval / stop 指令。
 * 改间隔只重置定时器，不重建 PdhQuery —— 重建会让速率型计数器回到
 * "首次无数据"状态，组件上会闪 1~2 秒的 "--"。
 * @param {object} opt { collect: () => any, emit: (value) => void, intervalMs }
 */
function startWorkerLoop({ collect, emit, intervalMs = 1000 }) {
  let ms = Math.max(100, Number(intervalMs) || 1000);
  let timer = null;
  const tick = () => {
    let v = null;
    try { v = collect(); } catch (_) { v = null; }
    try { emit(v); } catch (_) {}
  };
  const arm = () => {
    if (timer) clearInterval(timer);
    timer = setInterval(tick, ms);
  };
  if (parentPort) {
    parentPort.on('message', (m) => {
      if (m === 'stop' || (m && m.cmd === 'stop')) {
        if (timer) { clearInterval(timer); timer = null; }
        return;
      }
      if (m && m.cmd === 'interval') {
        const next = Math.max(100, Number(m.ms) || ms);
        if (next === ms) return;
        ms = next;
        if (timer) arm();
      }
    });
  }
  tick(); // 速率型计数器首次必然无数据 → emit(null)，组件显示 "--"
  arm();
}

module.exports = { PdhQuery, startWorkerLoop };
