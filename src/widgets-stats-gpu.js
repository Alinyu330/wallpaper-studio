// widgets-stats-gpu.js — GPU 占用率采集工作线程
// 独立于主线程运行 PDH 性能计数器查询：
// PdhCollectQueryData 在 GPU 客户端（如硬件解码的 mpv）退出时可能阻塞
// 数十秒等待驱动清理，绝不能在主线程调用（会冻结整个应用事件循环）。
const { parentPort } = require('worker_threads');
const koffi = require('koffi');

const PDH_FMT_DOUBLE = 0x00000200;

let pdh = null, query = 0, counter = 0, cap = 0, buf = null;
let PdhCollectQueryData = null, PdhGetFormattedCounterArrayW = null;
let timer = null;

function init() {
  try {
    pdh = koffi.load('pdh.dll');
    const PdhOpenQueryW = pdh.func('PdhOpenQueryW', 'int32_t', ['str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]);
    const PdhAddEnglishCounterW = pdh.func('PdhAddEnglishCounterW', 'int32_t', ['intptr_t', 'str16', 'uintptr_t', koffi.out(koffi.pointer('intptr_t'))]);
    const q = [0], c = [0];
    if (PdhOpenQueryW(null, 0, q) !== 0) throw new Error('PdhOpenQueryW failed');
    if (PdhAddEnglishCounterW(q[0], '\\GPU Engine(*)\\Utilization Percentage', 0, c) !== 0) {
      throw new Error('PdhAddEnglishCounterW failed');
    }
    query = q[0]; counter = c[0];
    cap = 512 * 1024;
    buf = koffi.alloc('uint8_t', cap);
    PdhCollectQueryData = pdh.func('PdhCollectQueryData', 'int32_t', ['intptr_t']);
    PdhGetFormattedCounterArrayW = pdh.func(
      'PdhGetFormattedCounterArrayW', 'int32_t',
      ['intptr_t', 'uint32_t', koffi.inout(koffi.pointer('uint32_t')), koffi.inout(koffi.pointer('uint32_t')), koffi.pointer('uint8_t')]
    );
    return true;
  } catch (e) {
    parentPort.postMessage({ gpu: null, unavailable: e.message });
    return false;
  }
}

// 速率型计数器需两次采样后才有有效数据，首次返回 null
function collect() {
  try {
    if (PdhCollectQueryData(query) !== 0) return null;
    const size = [cap], count = [0];
    const rc = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, size, count, buf);
    if (rc !== 0) return null;
    // PDH_FMT_COUNTERVALUE_ITEM_W (x64): { LPWSTR szName(8); union(8); DWORD CStatus(4)+pad } = 24 字节
    const data = Buffer.from(koffi.decode(buf, 'uint8_t', size[0]));
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

if (init()) {
  parentPort.postMessage({ gpu: null });
  timer = setInterval(() => {
    parentPort.postMessage({ gpu: collect() });
  }, 1000);
}
parentPort.on('message', (m) => {
  if (m === 'stop' && timer) { clearInterval(timer); timer = null; }
});
