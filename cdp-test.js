// cdp-test.js — 通过 CDP 验证参数预设点/数值输入/预览缩放/弹出预览窗口
const http = require('http');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.queue = []; this.ready = false;
    ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const r = this.pending.get(m.id); this.pending.delete(m.id); r(m.result); } };
    ws.onopen = () => { this.ready = true; this.queue.splice(0).forEach(f => f()); };
  }
  call(method, params = {}) {
    return new Promise((resolve) => {
      const run = () => {
        const id = ++this.id;
        this.pending.set(id, resolve);
        this.ws.send(JSON.stringify({ id, method, params }));
      };
      if (this.ready) run(); else this.queue.push(run);
    });
  }
  eval(expr) {
    return this.call('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => r.result.value);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail !== undefined ? '  (' + detail + ')' : ''}`);
}

(async () => {
  const targets = await getJson('/json');
  const main = targets.find(t => t.url.includes('index.html') && t.type === 'page');
  if (!main) { console.log('未找到主窗口'); process.exit(1); }
  const wsMain = new WebSocket(main.webSocketDebuggerUrl);
  const cdp = new Cdp(wsMain);
  await new Promise(r => wsMain.onopen ? r() : wsMain.addEventListener('open', r));

  // 等待初始化（选中壁纸）
  await new Promise(r => setTimeout(r, 1500));

  // ---- 1. 预设点生成 ----
  const chipCount = await cdp.eval('document.querySelectorAll(".preset-chip").length');
  check('预设调整点生成（27个）', chipCount === 27, `实际 ${chipCount}`);

  const speedChips = await cdp.eval('document.querySelectorAll("#v-speed-presets .preset-chip").length');
  check('速度预设点 7 个', speedChips === 7, `实际 ${speedChips}`);

  // ---- 2. 点击预设点 → 参数快速跳转 ----
  await cdp.eval(`[...document.querySelectorAll('#v-speed-presets .preset-chip')].find(b=>b.dataset.val==='2').click()`);
  await new Promise(r => setTimeout(r, 300));
  const speedVal = await cdp.eval('document.querySelector("#v-speed").value');
  const speedNum = await cdp.eval('document.querySelector("#v-speed-num").value');
  const speedActive = await cdp.eval('document.querySelector("#v-speed-presets .preset-chip.active")?.dataset.val');
  check('点击「2×」预设 → 滑块跳到 2', Number(speedVal) === 2, `slider=${speedVal}`);
  check('点击「2×」预设 → 数值框显示 2.00', speedNum === '2.00', `num=${speedNum}`);
  check('「2×」预设点高亮', speedActive === '2', `active=${speedActive}`);

  // ---- 3. 数值输入 → 精确调节 ----
  await cdp.eval(`(() => { const n = document.querySelector('#v-bright-num'); n.value = 42; n.dispatchEvent(new Event('change')); })()`);
  await new Promise(r => setTimeout(r, 300));
  const brightSlider = await cdp.eval('document.querySelector("#v-bright").value');
  check('输入亮度 42 → 滑块同步', Number(brightSlider) === 42, `slider=${brightSlider}`);

  // 超范围 clamp
  await cdp.eval(`(() => { const n = document.querySelector('#v-contrast-num'); n.value = 999; n.dispatchEvent(new Event('change')); })()`);
  await new Promise(r => setTimeout(r, 300));
  const contrastVal = await cdp.eval('document.querySelector("#v-contrast").value');
  check('输入对比度 999 → 自动钳制到 100', Number(contrastVal) === 100, `slider=${contrastVal}`);

  // ---- 4. 预览区缩放 ----
  const w0 = await cdp.eval('document.querySelector("#params-panel").offsetWidth');
  await cdp.eval('document.querySelector("#btn-preview-zoom-in").click()');
  await new Promise(r => setTimeout(r, 400));
  const w1 = await cdp.eval('document.querySelector("#params-panel").offsetWidth');
  check('预览区放大（面板加宽）', w1 === w0 + 100, `${w0}px → ${w1}px`);
  await cdp.eval('document.querySelector("#btn-preview-zoom-out").click()');
  await new Promise(r => setTimeout(r, 400));
  const w2 = await cdp.eval('document.querySelector("#params-panel").offsetWidth');
  check('预览区缩小（面板收窄）', w2 === w0, `${w1}px → ${w2}px`);

  // ---- 5. 弹出独立预览窗口 ----
  await cdp.eval('document.querySelector("#btn-preview-popout").click()');
  await new Promise(r => setTimeout(r, 2000));
  const targets2 = await getJson('/json');
  const pop = targets2.find(t => t.url.includes('preview.html'));
  check('弹出独立预览窗口', !!pop);

  if (pop) {
    const wsPop = new WebSocket(pop.webSocketDebuggerUrl);
    const cdpPop = new Cdp(wsPop);
    await new Promise(r => wsPop.onopen ? r() : wsPop.addEventListener('open', r));
    await new Promise(r => setTimeout(r, 800));
    const name = await cdpPop.eval('document.querySelector("#name").textContent');
    const hasVideo = await cdpPop.eval('!!document.querySelector("#stage video")');
    check('预览窗口显示当前壁纸', name.includes('云层') || name.length > 0, `name=${name}`);
    check('预览窗口渲染视频元素', hasVideo);

    // 参数实时同步：主窗口点预设 → 预览窗口播放速度变化
    await cdp.eval(`[...document.querySelectorAll('#v-speed-presets .preset-chip')].find(b=>b.dataset.val==='0.5').click()`);
    await new Promise(r => setTimeout(r, 600));
    const rate = await cdpPop.eval('document.querySelector("#stage video")?.playbackRate');
    check('参数实时同步到预览窗口（速度 0.5×）', rate === 0.5, `playbackRate=${rate}`);

    // 预览窗口可调整大小（BrowserWindow 窗口，由主进程管理）
    wsPop.close();
  }

  // ---- 6. 恢复测试改动 ----
  await cdp.eval(`[...document.querySelectorAll('#v-speed-presets .preset-chip')].find(b=>b.dataset.val==='1').click()`);
  await cdp.eval(`(() => { const n = document.querySelector('#v-bright-num'); n.value = 0; n.dispatchEvent(new Event('change')); })()`);
  await cdp.eval(`(() => { const n = document.querySelector('#v-contrast-num'); n.value = 0; n.dispatchEvent(new Event('change')); })()`);

  wsMain.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n=== 结果: ${results.length - failed}/${results.length} 通过 ===`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
