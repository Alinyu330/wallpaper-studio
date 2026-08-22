// verify-wallpaper.js — 验证壁纸窗口结构与可见性（WorkerW 挂载方案）
// 预期结构：
//   Progman
//   ├── SHELLDLL_DefView（图标层）
//   └── WorkerW（系统壁纸宿主）
//       └── Electron 壁纸窗口（Chrome_WidgetWin_1，铺满虚拟桌面）
const koffi = require('koffi');
const u = koffi.load('user32.dll');
const FX = u.func('FindWindowExW', 'intptr_t', ['intptr_t', 'intptr_t', 'str16', 'str16']);
const GR = u.func('GetWindowRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const GCN = u.func('GetClassNameW', 'int32_t', ['intptr_t', koffi.out(koffi.pointer('int16_t')), 'int32_t']);
const GSM = u.func('GetSystemMetrics', 'int32_t', ['int32_t']);
const IWV = u.func('IsWindowVisible', 'int', ['intptr_t']);
const STDAC = u.func('SetThreadDpiAwarenessContext', 'intptr_t', ['intptr_t']);

function cn(h) { const b = new Int16Array(256); const n = GCN(h, b, 256); let s = ''; for (let i = 0; i < n && b[i]; i++) s += String.fromCharCode(b[i]); return s; }
function pmv2(fn) { const old = STDAC(-4); try { return fn(); } finally { if (old) STDAC(old); } }

const result = { ok: false, errors: [] };
pmv2(() => {
  const progman = Number(FX(0, 0, 'Progman', null));
  if (!progman) { result.errors.push('找不到 Progman'); return; }
  console.log('Progman:', progman);

  // 枚举 Progman 直接子窗口
  console.log('--- Progman 直接子窗口（Z 序从顶到底）---');
  const children = [];
  let h = Number(FX(progman, 0, null, null));
  while (h && children.length < 30) {
    const r = [0, 0, 0, 0];
    GR(h, r);
    children.push({ hwnd: h, cls: cn(h), vis: !!IWV(h), rect: r });
    h = Number(FX(progman, h, null, null));
  }
  children.forEach((c, i) => console.log(`  #${i} class="${c.cls}" vis=${c.vis ? 1 : 0} rect=[${c.rect.join(',')}]`));

  const defview = children.find(c => c.cls === 'SHELLDLL_DefView');
  const workerW = children.find(c => c.cls === 'WorkerW');
  if (!defview) result.errors.push('缺少 SHELLDLL_DefView（图标层）');
  if (!workerW) { result.errors.push('缺少 WorkerW（壁纸宿主）'); return; }

  // WorkerW 内部应有 Electron 壁纸窗口
  console.log('--- WorkerW 内部子窗口 ---');
  let electron = null;
  let c = Number(FX(workerW.hwnd, 0, null, null));
  while (c) {
    const r = [0, 0, 0, 0];
    GR(c, r);
    const cls = cn(c);
    console.log(`  class="${cls}" hwnd=${c} vis=${IWV(c) ? 1 : 0} rect=[${r.join(',')}]`);
    if (cls === 'Chrome_WidgetWin_1') electron = { hwnd: c, vis: !!IWV(c), rect: r };
    c = Number(FX(workerW.hwnd, c, null, null));
  }

  const vw = GSM(78), vh = GSM(79);
  console.log(`虚拟桌面: ${GSM(76)},${GSM(77)} ${vw}x${vh}`);

  if (!electron) { result.errors.push('WorkerW 内未找到 Electron 壁纸窗口'); return; }
  if (!electron.vis) result.errors.push('壁纸窗口不可见');
  if (electron.rect[2] - electron.rect[0] !== vw || electron.rect[3] - electron.rect[1] !== vh) {
    result.errors.push(`壁纸窗口尺寸 ${electron.rect[2] - electron.rect[0]}x${electron.rect[3] - electron.rect[1]} != 虚拟桌面 ${vw}x${vh}`);
  }
  result.ok = result.errors.length === 0;
});

console.log(result.ok ? '\n=== 壁纸窗口结构验证通过 ===' : `\n=== 验证失败: ${result.errors.join('; ')} ===`);
process.exit(result.ok ? 0 : 1);
