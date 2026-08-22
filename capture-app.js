// capture-app.js — 通过 CDP 抓取主窗口高分辨率截图（用于官网落地页）
const http = require('http');
const fs = require('fs');

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: 9222, path }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const targets = await getJson('/json');
  const main = targets.find(t => t.url.includes('index.html') && t.type === 'page');
  if (!main) { console.log('未找到主窗口'); process.exit(1); }
  const ws = new WebSocket(main.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen ? r() : ws.addEventListener('open', r));

  const send = (id, method, params) => ws.send(JSON.stringify({ id, method, params }));
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
  };
  const call = (method, params = {}) => new Promise(r => {
    const id = pending.size + 1 + Math.floor(Math.random() * 1000);
    pending.set(id, r);
    send(id, method, params);
  });

  // 先选中一个壁纸让预览区有内容，再截图
  await call('Runtime.evaluate', { expression: `(() => {
    const cards = document.querySelectorAll('.wallpaper-card');
    if (cards[1]) cards[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
  })()` });
  await new Promise(r => setTimeout(r, 1500));

  const shot = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('D:/WallPaper/docs/app-screenshot.png', Buffer.from(shot.data, 'base64'));
  const size = fs.statSync('D:/WallPaper/docs/app-screenshot.png').size;
  console.log(`已保存 docs/app-screenshot.png (${(size / 1024).toFixed(0)} KB)`);
  ws.close();
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
