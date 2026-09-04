// mpv IPC 状态探测：确认前台/待命槽是否真的在播放（诊断脚本，交付前删除）
const net = require('net');

function q(fullPipe, cmds) {
  return new Promise((resolve) => {
    const s = net.connect(fullPipe);
    let buf = '';
    const out = [];
    const timer = setTimeout(() => { s.destroy(); resolve(out); }, 2500);
    s.on('connect', () => {
      cmds.forEach((c, i) => {
        s.write(JSON.stringify({ command: c, request_id: i + 1 }) + '\n');
      });
    });
    s.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        try {
          const j = JSON.parse(line);
          if (j.request_id) out[j.request_id - 1] = j.data !== undefined ? j.data : 'ERR:' + j.error;
        } catch (_) {}
      }
      if (out.filter(x => x !== undefined).length >= cmds.length) {
        clearTimeout(timer); s.destroy(); resolve(out);
      }
    });
    s.on('error', (e) => { clearTimeout(timer); resolve(['CONN:' + e.message]); });
  });
}

(async () => {
  const pipes = process.argv.slice(2).map(p => '\\\\.\\pipe\\' + p.replace(/^\\\\\.\\pipe\\/, ''));
  if (!pipes.length) { console.log('usage: node mpv-probe.js <pipe-name>'); process.exit(1); }
  console.log('pipes:', pipes);

  for (const p of pipes) {
    const r = await q(p, [
      ['get_property', 'pause'],
      ['get_property', 'time-pos'],
      ['get_property', 'percent-pos'],
      ['get_property', 'eof-reached'],
      ['get_property', 'duration'],
      ['get_property', 'filename'],
    ]);
    console.log(p.includes('front') ? 'FRONT ' : 'STANDBY', JSON.stringify(r));
  }

  const front = pipes.find(p => p.includes('front'));
  if (front) {
    const t1 = await q(front, [['get_property', 'time-pos']]);
    await new Promise(res => setTimeout(res, 2000));
    const t2 = await q(front, [['get_property', 'time-pos']]);
    console.log('front time-pos t0:', JSON.stringify(t1), ' t+2s:', JSON.stringify(t2),
      ' advancing:', Math.abs((t2[0] || 0) - (t1[0] || 0)) > 0.5 ? 'YES' : 'NO');
  }
})();
