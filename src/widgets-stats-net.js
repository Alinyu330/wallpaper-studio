// widgets-stats-net.js — 网速采集工作线程（系统状态监控组件用）
// 与 GPU 采集同样必须放在 worker 里：PDH 查询可能长时间阻塞。
//
// 用两条独立计数器而不是 Bytes Total/sec，直接拿到上/下行，无需自己拆分。
// Windows 的 Network Interface 计数器集不含真正的 loopback 回环，
// 所以 ping 127.0.0.1 不会走数（与「资源监视器 → 网络」口径一致）。
//
// 虚拟网卡与隧道适配器要排除：Hyper-V 的 vEthernet 会和物理网卡重复计数同一份
// 流量，WAN Miniport / ISATAP / Teredo 则几乎恒为 0 但白占实例。
const { parentPort } = require('worker_threads');
const { PdhQuery, startWorkerLoop } = require('./pdh-worker');

const RECV = '\\Network Interface(*)\\Bytes Received/sec';
const SENT = '\\Network Interface(*)\\Bytes Sent/sec';

// PDH 会把实例名里的 [ ] ( ) # / \ 全替换成 _，故一律用小写子串匹配
const SKIP = [
  'loopback', 'isatap', 'teredo', 'tunneling', 'wan miniport',
  'vethernet', 'hyper-v', 'vmware', 'virtualbox', 'bluetooth',
  'wi-fi direct', 'wifi direct', 'wireguard', 'openvpn', 'tap-windows', 'tap0901',
];

const skipped = (name) => {
  const n = String(name || '').toLowerCase();
  return SKIP.some((s) => n.includes(s));
};

let q = null;
try {
  q = new PdhQuery([RECV, SENT]);
} catch (e) {
  if (parentPort) parentPort.postMessage({ net: null, unavailable: e.message });
}

function sum(list, filter) {
  let total = 0, matched = 0;
  for (const { name, value } of list) {
    if (filter && skipped(name)) continue;
    matched++;
    total += value;
  }
  return { total: Math.max(0, total), matched };
}

function collect() {
  if (!q) return null;
  const res = q.sample();
  if (!res || !res[0] || !res[1]) return null; // 速率型计数器首次无数据
  let down = sum(res[0], true);
  let up = sum(res[1], true);
  // 兜底：过滤后一个实例都不剩 = 本机网卡命名不在黑名单预期内，
  // 退回不过滤，宁可数字略高也不要恒显示 0
  if (!down.matched) down = sum(res[0], false);
  if (!up.matched) up = sum(res[1], false);
  return { down: down.total, up: up.total };
}

if (q) {
  startWorkerLoop({
    collect,
    emit: (net) => parentPort.postMessage({ net }),
    intervalMs: 1000,
  });
}
