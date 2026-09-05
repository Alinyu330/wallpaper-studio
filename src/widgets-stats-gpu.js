// widgets-stats-gpu.js — GPU 占用率采集工作线程
// 独立于主线程运行 PDH 查询：PdhCollectQueryData 在 GPU 客户端（如硬件解码的
// mpv）退出时可能阻塞数十秒等待驱动清理，绝不能在主线程调用（会冻结整个应用）。
//
// 占用率口径 = 「各引擎跨进程求和后的最大值」，与任务管理器「性能 → GPU」的
// 总占用一致：实例名形如 pid_1184_luid_0x..._phys_0_eng_3_engtype_VideoDecode，
// 去掉 pid 前缀即引擎身份（3D / VideoDecode / Copy …，含 luid 故多显卡自然分开），
// 同引擎跨进程累加，再取所有引擎里的最大值。
//
// 旧实现把所有实例直接求和再 clamp 到 100 —— 一台机器上引擎实例可达 800+，
// 任何负载下都会顶到 100%；而且步长/偏移都读错了（见 pdh-worker.js 头注释），
// 实际恒为 0%。
const { PdhQuery, startWorkerLoop } = require('./pdh-worker');

const COUNTER = '\\GPU Engine(*)\\Utilization Percentage';

let q = null;
try {
  q = new PdhQuery([COUNTER]);
} catch (e) {
  if (require('worker_threads').parentPort) {
    require('worker_threads').parentPort.postMessage({ gpu: null, unavailable: e.message });
  }
}

function collect() {
  if (!q) return null;
  const res = q.sample();
  if (!res || !res[0] || !res[0].length) return null; // 首次采样或无有效实例
  const perEngine = new Map();
  for (const { name, value } of res[0]) {
    const eng = name.replace(/^pid_\d+_/, '');
    perEngine.set(eng, (perEngine.get(eng) || 0) + value);
  }
  let max = 0;
  for (const v of perEngine.values()) if (v > max) max = v;
  return Math.min(100, Math.max(0, max));
}

if (q) {
  const { parentPort } = require('worker_threads');
  startWorkerLoop({
    collect,
    emit: (gpu) => parentPort.postMessage({ gpu }),
    intervalMs: 1000,
  });
}
