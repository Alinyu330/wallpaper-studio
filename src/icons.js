// icons.js — Shell 图标提取（HICON → PNG data URL）
//
// 为什么不用 Electron 的 app.getFileIcon：
// 1) 它只能处理真实文件 —— 回收站/控制面板/网络/此电脑 这类虚拟项没有文件路径，
//    取不到图标（表现为转盘里"一片空白"）；
// 2) 对部分 .lnk / 办公文件返回空图，渲染层只能显示空白方块。
//
// 本模块直接调 Win32（句柄统一用 uintptr 传值，避开 koffi 指针语义的坑）：
//   SHGetFileInfoW（普通文件，SHGFI_ICON 取 32px HICON）
//   SHParseDisplayName + SHGFI_PIDL（shell:RecycleBinFolder 等虚拟项）
//   GetIconInfo + GetDIBits（HICON → 32bpp BGRA 位图）
// 再用 zlib 自己编码 PNG（无第三方依赖），结果按目标缓存到磁盘。
const koffi = require('koffi');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const user32 = koffi.load('user32.dll');
const shell32 = koffi.load('shell32.dll');
const gdi32 = koffi.load('gdi32.dll');
const ole32 = koffi.load('ole32.dll');

// ---------- Win32 声明（句柄 = uintptr；缓冲区 = Buffer） ----------
const SHGetFileInfoPath = shell32.func(
  'uintptr SHGetFileInfoW(str16 pszPath, uint32 dwFileAttributes, void *psfi, uint32 cbSizeFileInfo, uint32 uFlags)');
const SHGetFileInfoPidl = shell32.func(
  'uintptr SHGetFileInfoW(uintptr pidl, uint32 dwFileAttributes, void *psfi, uint32 cbSizeFileInfo, uint32 uFlags)');
const SHParseDisplayName = shell32.func(
  'int32 SHParseDisplayName(str16 pszName, uintptr pbc, void *ppidl, uint32 sfgaoIn, void *psfgaoOut)');
const CoTaskMemFree = ole32.func('void CoTaskMemFree(uintptr pv)');
const DestroyIcon = user32.func('int DestroyIcon(uintptr hIcon)');
const GetIconInfo = user32.func('int GetIconInfo(uintptr hIcon, void *piconinfo)');
const CreateCompatibleDC = gdi32.func('uintptr CreateCompatibleDC(uintptr hdc)');
const DeleteDC = gdi32.func('int DeleteDC(uintptr hdc)');
const GetObjectW = gdi32.func('int32 GetObjectW(uintptr h, int32 c, void *pv)');
const GetDIBits = gdi32.func(
  'int32 GetDIBits(uintptr hdc, uintptr hbmp, uint32 uStartScan, uint32 cScanLines, void *lpvBits, void *lpbmi, uint32 uUsage)');
const DeleteObject = gdi32.func('int DeleteObject(uintptr ho)');

// ---------- 常量 ----------
const SHGFI_ICON = 0x000000100;
const SHGFI_LARGEICON = 0x000000000;
const SHGFI_SMALLICON = 0x000000001;
const SHGFI_PIDL = 0x000000008;
const SHGFI_USEFILEATTRIBUTES = 0x000000010;
const SHGFI_SYSICONINDEX = 0x000004000;
const SHGFI_TYPENAME = 0x000000400;
const FILE_ATTRIBUTE_NORMAL = 0x00000080;
const DBG = !!process.env.WP_ICON_DEBUG;
const BI_RGB = 0;
const DIB_RGB_COLORS = 0;

// SHFILEINFOW（x64）：hIcon(8) iIcon(4) dwAttributes(4) szDisplayName(520) szTypeName(160)
const SFI_SIZE = 704;

// ---------- 缓存 ----------
let cacheDir = null;
function init(userDataDir) {
  try {
    cacheDir = path.join(userDataDir, 'icon-cache');
    fs.mkdirSync(cacheDir, { recursive: true });
  } catch (_) { cacheDir = null; }
}

function cacheKey(target) {
  return crypto.createHash('sha1').update(String(target)).digest('hex').slice(0, 24);
}

/** 文件内容变化时图标也可能变化 → 参与缓存键 */
function stampOf(target) {
  if (isVirtual(target)) return '';
  try {
    const st = fs.statSync(target);
    return `${st.size}-${Math.floor(st.mtimeMs / 1000)}`;
  } catch (_) { return 'x'; }
}

/** 虚拟项（无文件路径）：shell: 前缀 或 ::{GUID} */
function isVirtual(target) {
  const t = String(target || '');
  return t.startsWith('shell:') || t.startsWith('::');
}

// ---------- PNG 编码（zlib + CRC32，零依赖） ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** RGBA 像素（宽×高×4）→ PNG Buffer */
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: None
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- HICON → RGBA ----------
/**
 * GetIconInfo + GetDIBits 取图标 32bpp 位图。
 * ICONINFO（x64）: fIcon(0) xHotspot(4) yHotspot(8) pad(12) hbmMask(16) hbmColor(24)
 */
function iconToRgba(hIcon) {
  const ii = Buffer.alloc(32);
  if (!GetIconInfo(Number(hIcon), ii)) return null;
  const hbmMask = ii.readBigUInt64LE(16);
  const hbmColor = ii.readBigUInt64LE(24);
  if (DBG) console.log(`[icons] ICONINFO mask=${hbmMask} color=${hbmColor}`);
  if (!hbmColor) {
    if (hbmMask) DeleteObject(Number(hbmMask));
    return null;
  }
  const hdc = CreateCompatibleDC(0);
  if (!hdc) {
    DeleteObject(Number(hbmColor));
    if (hbmMask) DeleteObject(Number(hbmMask));
    return null;
  }
  try {
    const bm = Buffer.alloc(48);
    const got = GetObjectW(Number(hbmColor), 48, bm);
    if (DBG) console.log(`[icons] GetObjectW=${got}（期望 32） w=${bm.readInt32LE(4)} h=${bm.readInt32LE(8)} bpp=${bm.readUInt16LE(18)}`);
    if (got < 24) return null;
    const w = bm.readInt32LE(4);
    const h = bm.readInt32LE(8);
    if (!(w > 0 && h > 0 && w <= 512 && h <= 512)) return null;

    const bi = Buffer.alloc(40);
    bi.writeUInt32LE(40, 0);
    bi.writeInt32LE(w, 4);
    bi.writeInt32LE(-h, 8);     // 负高度 = 自上而下，无需翻转
    bi.writeUInt16LE(1, 12);    // planes
    bi.writeUInt16LE(32, 14);   // bit count
    bi.writeUInt32LE(BI_RGB, 16);
    const stride = ((w * 32 + 31) >> 5) * 4;
    bi.writeUInt32LE(stride * h, 20);
    const bits = Buffer.alloc(stride * h);
    const n = GetDIBits(Number(hdc), Number(hbmColor), 0, h, bits, bi, DIB_RGB_COLORS);
    if (DBG) console.log();
    if (!n || n === 0x7fffffff) return null;

    // BGRA（GDI 预乘）→ RGBA（反预乘）
    const rgba = Buffer.alloc(w * h * 4);
    for (let p = 0; p < w * h; p++) {
      const b = bits[p * 4], g = bits[p * 4 + 1], r = bits[p * 4 + 2], a = bits[p * 4 + 3];
      if (a === 0) continue;
      rgba[p * 4] = Math.min(255, Math.round((r * 255) / a));
      rgba[p * 4 + 1] = Math.min(255, Math.round((g * 255) / a));
      rgba[p * 4 + 2] = Math.min(255, Math.round((b * 255) / a));
      rgba[p * 4 + 3] = a;
    }
    return { w, h, rgba };
  } finally {
    DeleteDC(Number(hdc));
    DeleteObject(Number(hbmColor));
    if (hbmMask) DeleteObject(Number(hbmMask));
  }
}

// ---------- 对外 API ----------

/** 取图标 PNG Buffer（磁盘缓存）；失败返回 null */
function getIconPng(target) {
  if (!target) return null;
  const file = cacheDir ? path.join(cacheDir, `${cacheKey(target)}-${stampOf(target)}.png`) : null;
  if (file) {
    try {
      const b = fs.readFileSync(file);
      if (b.length > 64) return b;
    } catch (_) {}
  }
  const png = extractIconPng(target);
  if (png && file) {
    try { fs.writeFileSync(file, png); cleanupCache(); } catch (_) {}
  }
  return png;
}

/** 缓存上限保护：超过 400 个文件时清掉最旧的一半 */
function cleanupCache() {
  if (!cacheDir) return;
  try {
    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.png'));
    if (files.length <= 400) return;
    const infos = files.map((f) => ({ f, m: fs.statSync(path.join(cacheDir, f)).mtimeMs }));
    infos.sort((a, b) => a.m - b.m);
    for (const it of infos.slice(0, Math.floor(infos.length / 2))) {
      try { fs.unlinkSync(path.join(cacheDir, it.f)); } catch (_) {}
    }
  } catch (_) {}
}

/** 实际提取：SHGetFileInfo（文件）/ SHParseDisplayName（虚拟项）→ HICON → PNG */
function extractIconPng(target) {
  let hIcon = 0n;
  let pidl = 0n;
  try {
    const sfi = Buffer.alloc(SFI_SIZE);
    // ★ 标志组合实测：必须带 SHGFI_SYSICONINDEX 才会返回有效 HICON；
    //   带 SHGFI_TYPENAME 时返回值变成"成功标志(1)"而非图标句柄 —— 不要加。
    const flagsBase = SHGFI_ICON | SHGFI_SYSICONINDEX;
    if (isVirtual(target)) {
      const ppidl = Buffer.alloc(8);
      const attrOut = Buffer.alloc(8);
      if (SHParseDisplayName(String(target), 0, ppidl, 0, attrOut) !== 0) return null;
      pidl = ppidl.readBigUInt64LE(0);
      if (!pidl) return null;
      hIcon = SHGetFileInfoPidl(Number(pidl), 0, sfi, SFI_SIZE, flagsBase | SHGFI_PIDL | SHGFI_LARGEICON);
      if (!hIcon) hIcon = SHGetFileInfoPidl(Number(pidl), 0, sfi, SFI_SIZE, flagsBase | SHGFI_PIDL | SHGFI_SMALLICON);
    } else {
      // ★ Shell API 只认反斜杠路径：正斜杠会静默返回 0
      const p = String(target).replace(/\//g, '\\');
      hIcon = SHGetFileInfoPath(p, 0, sfi, SFI_SIZE, flagsBase | SHGFI_LARGEICON);
      if (!hIcon) hIcon = SHGetFileInfoPath(p, 0, sfi, SFI_SIZE, flagsBase | SHGFI_SMALLICON);
      if (!hIcon) {
        // 关联图标缺失（无关联程序的办公文件等）：按扩展名取类型图标
        hIcon = SHGetFileInfoPath(p, FILE_ATTRIBUTE_NORMAL, sfi, SFI_SIZE,
          SHGFI_ICON | SHGFI_USEFILEATTRIBUTES | SHGFI_SYSICONINDEX | SHGFI_LARGEICON);
      }
    }
    if (!hIcon) { if (DBG) console.log('[icons] 未取到 HICON:', target); return null; }
    const img = iconToRgba(hIcon);
    if (!img) { if (DBG) console.log('[icons] HICON 转位图失败:', target); return null; }
    const png = encodePng(img.w, img.h, img.rgba);
    if (DBG) console.log(`[icons] OK ${target} ${img.w}x${img.h} ${png.length}B`);
    return png;
  } catch (_) {
    return null;
  } finally {
    if (hIcon) { try { DestroyIcon(Number(hIcon)); } catch (_) {} }
    if (pidl) { try { CoTaskMemFree(Number(pidl)); } catch (_) {} }
  }
}

/** 取图标 data URL（渲染层 <img src> 直接用）；失败返回 null */
function getIconDataUrl(target) {
  const png = getIconPng(target);
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}

module.exports = { init, getIconPng, getIconDataUrl, isVirtual, encodePng };
