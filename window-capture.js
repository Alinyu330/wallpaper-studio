// window-capture.js — 用 PrintWindow 抓取壁纸窗口内容，验证 mpv 渲染到壁纸窗口
const { app, nativeImage } = require('electron');
const path = require('path');
const koffi = require('koffi');
const fs = require('fs');

const u = koffi.load('user32.dll');
const g = koffi.load('gdi32.dll');
const FX = u.func('FindWindowExW', 'intptr_t', ['intptr_t', 'intptr_t', 'str16', 'str16']);
const GCN = u.func('GetClassNameW', 'int32_t', ['intptr_t', koffi.out(koffi.pointer('int16_t')), 'int32_t']);
const GCR = u.func('GetClientRect', 'int', ['intptr_t', koffi.out(koffi.pointer('int32_t'))]);
const PW = u.func('PrintWindow', 'int', ['intptr_t', 'intptr_t', 'uint32_t']);
const GetDC = u.func('GetDC', 'intptr_t', ['intptr_t']);
const ReleaseDC = u.func('ReleaseDC', 'int', ['intptr_t', 'intptr_t']);
const CreateCompatibleDC = g.func('CreateCompatibleDC', 'intptr_t', ['intptr_t']);
const CreateCompatibleBitmap = g.func('CreateCompatibleBitmap', 'intptr_t', ['intptr_t', 'int32_t', 'int32_t']);
const SelectObject = g.func('SelectObject', 'intptr_t', ['intptr_t', 'intptr_t']);
const DeleteObject = g.func('DeleteObject', 'int', ['intptr_t']);
const DeleteDC = g.func('DeleteDC', 'int', ['intptr_t']);
const BitBlt = g.func('BitBlt', 'int', ['intptr_t', 'int32_t', 'int32_t', 'int32_t', 'int32_t', 'intptr_t', 'int32_t', 'int32_t', 'uint32_t']);
const STDAC = u.func('SetThreadDpiAwarenessContext', 'intptr_t', ['intptr_t']);

function cn(h) { const b = new Int16Array(256); const n = GCN(h, b, 256); let s = ''; for (let i = 0; i < n && b[i]; i++) s += String.fromCharCode(b[i]); return s; }

app.whenReady().then(() => {
  const old = STDAC(-4);
  try {
    // 找壁纸窗口：Progman → WorkerW → Chrome_WidgetWin_1
    const progman = Number(FX(0, 0, 'Progman', null));
    let h = Number(FX(progman, 0, null, null)), workerW = 0;
    while (h) { if (cn(h) === 'WorkerW') workerW = h; h = Number(FX(progman, h, null, null)); }
    let wpHwnd = 0;
    let c = Number(FX(workerW, 0, null, null));
    while (c) { if (cn(c) === 'Chrome_WidgetWin_1') { wpHwnd = c; break; } c = Number(FX(workerW, c, null, null)); }
    if (!wpHwnd) { console.log('未找到壁纸窗口'); app.exit(1); return; }

    const rect = [0, 0, 0, 0];
    GCR(wpHwnd, rect);
    const w = rect[2], hgt = rect[3];
    console.log(`壁纸窗口 ${wpHwnd} 客户区 ${w}x${hgt}`);

    // PrintWindow 抓取（PW_RENDERFULLCONTENT=2 支持 D3D 内容）
    const hdc = GetDC(wpHwnd);
    const memDC = CreateCompatibleDC(hdc);
    const bmp = CreateCompatibleBitmap(hdc, w, hgt);
    SelectObject(memDC, bmp);
    // PrintWindow 到 memDC
    const ok = PW(wpHwnd, memDC, 2);
    console.log('PrintWindow:', ok);
    // 若 PrintWindow 失败，尝试 BitBlt
    if (!ok) BitBlt(memDC, 0, 0, w, hgt, hdc, 0, 0, 0x00CC0020);

    // 读取位图数据（Buffer 构造 BITMAPINFOHEADER）
    const GetDIBits = g.func('GetDIBits', 'int', ['intptr_t', 'intptr_t', 'uint32_t', 'uint32_t', koffi.out(koffi.pointer('uint8_t')), koffi.out(koffi.pointer('void')), 'uint32_t']);
    const bmi = Buffer.alloc(40);
    bmi.writeUInt32LE(40, 0);       // biSize
    bmi.writeInt32LE(w, 4);         // biWidth
    bmi.writeInt32LE(-hgt, 8);      // biHeight（负值=自顶向下）
    bmi.writeUInt16LE(1, 12);       // biPlanes
    bmi.writeUInt16LE(32, 14);      // biBitCount
    const bufSize = w * hgt * 4;
    const out = Buffer.alloc(bufSize);
    const got = GetDIBits(memDC, bmp, 0, hgt, out, bmi, 0);
    if (got !== hgt) { console.log('GetDIBits 失败:', got); app.exit(1); return; }

    // 转 Electron nativeImage 并保存
    const img = nativeImage.createFromBitmap(out, { width: w, height: hgt });
    fs.writeFileSync('D:/WallPaper/wallpaper-window.png', img.toPNG());
    console.log('已保存 wallpaper-window.png');

    // 采样统计亮度（验证不是纯黑）
    const b = img.getBitmap();
    let black = 0, total = 0, sumR = 0, sumG = 0, sumB = 0;
    for (let y = 0; y < hgt; y += 40) {
      for (let x = 0; x < w; x += 40) {
        const i = (y * w + x) * 4;
        total++;
        sumR += b[i+2]; sumG += b[i+1]; sumB += b[i];
        if (b[i] + b[i+1] + b[i+2] < 15) black++;
      }
    }
    console.log(`采样 ${total} 点: 纯黑 ${black} (${(black/total*100).toFixed(0)}%), 平均色 RGB(${Math.round(sumR/total)},${Math.round(sumG/total)},${Math.round(sumB/total)})`);
    console.log(black / total < 0.5
      ? '=== 壁纸窗口有实际内容（非黑屏），mpv 渲染正常 ==='
      : '=== 壁纸窗口大面积黑屏，渲染可能失败 ===');
    app.exit(0);
  } finally {
    if (old) STDAC(old);
  }
});
