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
const GetSystemMetrics = user32.func('int32 GetSystemMetrics(int32 nIndex)');
const GetIconInfo = user32.func('int GetIconInfo(uintptr hIcon, void *piconinfo)');
const CreateCompatibleDC = gdi32.func('uintptr CreateCompatibleDC(uintptr hdc)');
const DeleteDC = gdi32.func('int DeleteDC(uintptr hdc)');
const GetObjectW = gdi32.func('int32 GetObjectW(uintptr h, int32 c, void *pv)');
const GetDIBits = gdi32.func(
  'int32 GetDIBits(uintptr hdc, uintptr hbmp, uint32 uStartScan, uint32 cScanLines, void *lpvBits, void *lpbmi, uint32 uUsage)');
const DeleteObject = gdi32.func('int DeleteObject(uintptr ho)');
// 高分辨率抽取（v1.9.1）：PrivateExtractIconsW 可按任意尺寸直接读 exe/ico 内嵌图标组，
// 且对 .lnk 会由 shell 自行解析到目标；SHDefExtractIconW 作为指定尺寸的回落。
const PrivateExtractIconsW = user32.func(
  'int32 PrivateExtractIconsW(str16 szFileName, int32 nIconIndex, int32 cx, int32 cy, uintptr *phicon, uintptr *piconid, uint32 nIcons, uint32 flags)');
const SHDefExtractIconW = shell32.func(
  'int32 SHDefExtractIconW(str16 pszIconFile, int32 iIndex, uint32 flags, uintptr *phiconLarge, uintptr *phiconSmall, uint32 nIconSize)');
// exe 内嵌的 256px 图标是 PNG 压缩 DIB，GetDIBits 读图标自身位图会失败；
// 先把 HICON 渲染进自建 32bpp DIB section 再回读才是通用做法。
const DrawIconEx = user32.func(
  'int DrawIconEx(uintptr hdc, int32 x, int32 y, uintptr hIcon, int32 w, int32 h, uint32 istep, uintptr hbr, uint32 diFlags)');
const CreateDIBSection = gdi32.func(
  'uintptr CreateDIBSection(uintptr hdc, void *pbmi, uint32 usage, void *ppvBits, uintptr hSection, uint32 offset)');
const SelectObject = gdi32.func('uintptr SelectObject(uintptr hdc, uintptr h)');
// shell 图标抽取内部走 COM：未初始化时 SHParseDisplayName / PrivateExtractIcons
// 会概率性失败（虚拟项恒 null、首次抽取降级）。Electron 主线程通常已初始化，
// 但重复调用只返回 S_FALSE，无害 —— 这里兜底一次。
const CoInitializeEx = ole32.func('int32 CoInitializeEx(uintptr pvReserved, uint32 dwCoInit)');
let comReady = false;
function ensureCom() {
  if (comReady) return;
  comReady = true;
  try { CoInitializeEx(0, 0x2 /* COINIT_APARTMENTTHREADED */); } catch (_) {}
}

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

/** 系统大图标边长（随 DPI：100% = 32、150% = 48）；命名空间图标按它显式绘制 */
let _largeIconPx = 0;
function largeIconPx() {
  if (_largeIconPx) return _largeIconPx;
  let n = 0;
  try {
    const cx = GetSystemMetrics(11 /* SM_CXICON */), cy = GetSystemMetrics(12 /* SM_CYICON */);
    if (cx > 0 && cx === cy && cx <= 256) n = cx;
  } catch (_) {}
  _largeIconPx = n || 48;
  return _largeIconPx;
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
 * 从 32bpp 位图回读 RGBA（GDI 预乘 → 反预乘）。
 * ICONINFO（x64）: fIcon(0) xHotspot(4) yHotspot(8) pad(12) hbmMask(16) hbmColor(24)
 */
function dibToRgba(hdc, hbm, w, h) {
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
  const n = GetDIBits(Number(hdc), Number(hbm), 0, h, bits, bi, DIB_RGB_COLORS);
  if (!n || n === 0x7fffffff) return null;
  const rgba = Buffer.alloc(w * h * 4);
  let opaque = 0;
  for (let p = 0; p < w * h; p++) {
    const b = bits[p * 4], g = bits[p * 4 + 1], r = bits[p * 4 + 2], a = bits[p * 4 + 3];
    if (a === 0) continue;
    opaque++;
    rgba[p * 4] = Math.min(255, Math.round((r * 255) / a));
    rgba[p * 4 + 1] = Math.min(255, Math.round((g * 255) / a));
    rgba[p * 4 + 2] = Math.min(255, Math.round((b * 255) / a));
    rgba[p * 4 + 3] = a;
  }
  if (!opaque) return null;
  return { w, h, rgba };
}

/**
 * 「颜色 + AND 掩码」型图标（无 per-pixel alpha）：DrawIconEx 只写 RGB、alpha 全 0，
 * 透明信息由 AND 掩码给出（位=1 → 透明）。按掩码重建 alpha。
 */
function maskToRgba(hdc, hbmColor, hbmMask, w, h) {
  const stride = ((w * 32 + 31) >> 5) * 4;
  const bi = Buffer.alloc(40);
  bi.writeUInt32LE(40, 0);
  bi.writeInt32LE(w, 4);
  bi.writeInt32LE(-h, 8);
  bi.writeUInt16LE(1, 12);
  bi.writeUInt16LE(32, 14);
  bi.writeUInt32LE(BI_RGB, 16);
  bi.writeUInt32LE(stride * h, 20);
  const bits = Buffer.alloc(stride * h);
  const n1 = GetDIBits(Number(hdc), Number(hbmColor), 0, h, bits, bi, DIB_RGB_COLORS);
  if (!n1 || n1 === 0x7fffffff) return null;

  const mstride = ((w + 31) >> 5) * 4;
  const bm = Buffer.alloc(40);
  bm.writeUInt32LE(40, 0);
  bm.writeInt32LE(w, 4);
  bm.writeInt32LE(-h, 8);
  bm.writeUInt16LE(1, 12);
  bm.writeUInt16LE(1, 14);      // 1bpp AND 掩码
  bm.writeUInt32LE(BI_RGB, 16);
  bm.writeUInt32LE(mstride * h, 20);
  const mask = Buffer.alloc(mstride * h);
  const n2 = hbmMask
    ? GetDIBits(Number(hdc), Number(hbmMask), 0, h, mask, bm, DIB_RGB_COLORS) : 0;

  const rgba = Buffer.alloc(w * h * 4);
  let opaque = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = y * stride + x * 4, d = (y * w + x) * 4;
    const b = bits[s], g = bits[s + 1], r = bits[s + 2];
    let a = 255;
    if (n2 && n2 !== 0x7fffffff) {
      if (mask[y * mstride + (x >> 3)] & (0x80 >> (x & 7))) a = 0;
    } else if (r === 0 && g === 0 && b === 0) a = 0; // 读不到掩码：纯黑按背景处理
    if (a === 0) continue;
    opaque++;
    rgba[d] = r; rgba[d + 1] = g; rgba[d + 2] = b; rgba[d + 3] = a;
  }
  if (!opaque) return null;
  return { w, h, rgba };
}

function iconToRgba(hIcon, wantW = 0, wantH = 0) {
  const ii = Buffer.alloc(32);
  if (!GetIconInfo(Number(hIcon), ii)) { if (DBG) console.log('[icons]   GetIconInfo 失败'); return null; }
  const hbmMask = ii.readBigUInt64LE(16);
  const hbmColor = ii.readBigUInt64LE(24);
  if (!hbmColor) {
    if (DBG) console.log('[icons]   hbmColor=0（单色/掩码型图标）');
    if (hbmMask) DeleteObject(Number(hbmMask));
    return null;
  }
  const hdc = CreateCompatibleDC(0);
  if (!hdc) {
    DeleteObject(Number(hbmColor));
    if (hbmMask) DeleteObject(Number(hbmMask));
    return null;
  }
  let hbmDib = 0;
  try {
    let w = wantW | 0, h = wantH | 0;
    if (!(w > 0 && h > 0)) {
      // 未指定尺寸（shell 32px 回落路径）：从图标自身位图推导。
      // 注意 PNG 压缩的 256px 图标这里 GetObjectW 会返回 0，所以高分辨率路径必须显式传尺寸。
      const bm = Buffer.alloc(48);
      const got = GetObjectW(Number(hbmColor), 48, bm);
      if (DBG) console.log(`[icons] GetObjectW=${got}（期望 32） w=${bm.readInt32LE(4)} h=${bm.readInt32LE(8)} bpp=${bm.readUInt16LE(18)}`);
      if (got < 24) return null;
      w = bm.readInt32LE(4);
      h = bm.readInt32LE(8);
    }
    if (!(w > 0 && h > 0 && w <= 512 && h <= 512)) return null;

    // ① 通用路径：渲染进自建 DIB section。exe 内 256px 图标是 PNG 压缩 DIB，
    //    直接 GetDIBits 读图标自身位图读不出来，DrawIconEx 会正确展开。
    const bmi = Buffer.alloc(40);
    bmi.writeUInt32LE(40, 0);
    bmi.writeInt32LE(w, 4);
    bmi.writeInt32LE(-h, 8);
    bmi.writeUInt16LE(1, 12);
    bmi.writeUInt16LE(32, 14);
    bmi.writeUInt32LE(BI_RGB, 16);
    hbmDib = CreateDIBSection(Number(hdc), bmi, DIB_RGB_COLORS, 0, 0, 0);
    if (hbmDib) {
      const old = SelectObject(Number(hdc), Number(hbmDib));
      const drew = DrawIconEx(Number(hdc), 0, 0, Number(hIcon), w, h, 0, 0, 0x0003 /* DI_NORMAL */);
      if (old) SelectObject(Number(hdc), Number(old));
      if (drew) {
        const img = dibToRgba(hdc, hbmDib, w, h);
        if (img) return img;
        // alpha 全 0 = 「颜色 + AND 掩码」型图标 → 按掩码重建透明度
        const m = maskToRgba(hdc, hbmDib, hbmMask, w, h);
        if (m) { if (DBG) console.log(`[icons]   AND 掩码兜底 ${w}x${h}`); return m; }
      }
    }
    // ② 回落：直接读图标自身位图（未压缩的 32/48px 图标走这里也正确）
    return dibToRgba(hdc, hbmColor, w, h);
  } finally {
    DeleteDC(Number(hdc));
    if (hbmDib) DeleteObject(Number(hbmDib));
    DeleteObject(Number(hbmColor));
    if (hbmMask) DeleteObject(Number(hbmMask));
  }
}

// ---------- .lnk 解析（MS-SHLLINK 二进制，无 COM） ----------
// 为什么不用 IShellLink COM：koffi 2.16 无法按原型调用裸 vtable 地址
// （koffi.indirect 不存在、koffi.call 拒绝数字指针），而直接读文件格式是确定性的。
// 标志位按 MS-SHLLINK 2.1.1 LinkFlags 定义（Windows 唯一实际写盘布局）。
// ★ 曾额外保留过一组「整体左移一位」的伪布局：它的 HasLinkTargetIDList=0x00 使
//   `flags & 0x00` 恒假 → 带 IDList 的 .lnk 不跳 IDList → 字符串槽位整体错位，
//   把 IconLocation 读成 target，而打分又因该串里的 exe 真实存在而给高分，
//   结果错误布局反而胜出（实测 66 个开始菜单快捷方式中 26 个中招）。
const LNK_FLAGS = { id: 0x01, li: 0x02, name: 0x04, rel: 0x08, work: 0x10, icon: 0x40, uni: 0x80 };

function lnkWideAt(b, off) {
  let e = off;
  while (e + 1 < b.length && !(b[e] === 0 && b[e + 1] === 0)) e += 2;
  return b.subarray(off, e).toString('utf16le');
}
function lnkAnsiAt(b, off) {
  let e = off;
  while (e < b.length && b[e] !== 0) e++;
  return b.subarray(off, e).toString('latin1');
}
function expandEnvVars(p) {
  return String(p || '').replace(/%([^%]+)%/g, (m, k) => process.env[k.toUpperCase()] ?? m);
}
/** IconLocation 形如 `@C:\x\y.dll,-102` 或 `C:\x\y.exe,0` → {path, index} */
function splitIconLoc(s) {
  let str = String(s || '').trim();
  if (str.startsWith('@')) str = str.slice(1);
  const m = /[,;](-?\d+)\s*$/.exec(str);
  const index = m ? parseInt(m[1], 10) : null;
  if (m) str = str.slice(0, m.index);
  return { path: expandEnvVars(str), index };
}

/**
 * LinkInfo 内「本地基准路径」的声明偏移在各版本 Windows 上并不统一（28/32/36/44/48
 * 字节的变体头都实际存在，MS-SHLLINK 也没把扩展字段偏移定死），按固定偏移读会捞到
 * Arguments 之类的相邻字符串。改为直接扫「盘符: \ 」签名的 ANSI / UTF-16LE 路径。
 */
function lnkLocalPaths(li) {
  const out = [];
  for (let o = 0; o + 3 < li.length; o++) {
    const c = li[o];
    if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a))) continue;
    let s = '';
    if (li[o + 1] === 0 && li[o + 2] === 0x3a && li[o + 3] === 0) s = lnkWideAt(li, o);
    else if (li[o + 1] === 0x3a && (li[o + 2] === 0x5c || li[o + 2] === 0x2f)) s = lnkAnsiAt(li, o);
    if (/^[A-Za-z]:[\\/].+/.test(s) && !out.includes(s)) out.push(s);
  }
  return out;
}

function parseLnkBody(b, F) {
  const flags = b.readUInt32LE(20);
  const uni = !!(flags & F.uni);
  const out = {
    target: '', paths: [], iconFile: '', iconIndex: b.readInt32LE(56) || 0, relPath: '', workDir: '',
  };
  let off = 76;
  if (flags & F.id) {
    if (off + 2 > b.length) return out;
    off += 2 + b.readUInt16LE(off); // LinkTargetIDList
  }
  if (flags & F.li) {
    const liSize = b.readUInt32LE(off);
    if (liSize > 0 && off + liSize <= b.length) out.liPaths = lnkLocalPaths(b.subarray(off, off + liSize));
    off += liSize;
  }
  const readStr = () => {
    if (off + 2 > b.length) return '';
    const n = b.readUInt16LE(off); off += 2;
    const s = uni ? b.subarray(off, off + n * 2).toString('utf16le') : b.subarray(off, off + n).toString('latin1');
    off += uni ? n * 2 : n;
    return s;
  };
  if (flags & F.name) readStr();
  if (flags & F.rel) out.relPath = readStr();
  if (flags & F.work) out.workDir = readStr();
  if (flags & F.icon) {
    const loc = splitIconLoc(readStr());
    out.iconFile = loc.path;
    if (loc.index !== null) out.iconIndex = loc.index;
  }
  // 目标候选：LinkInfo 基准路径 → 全文件扫描（含 LINK_TARGET_INFO 扩展块的
  // LocalBasePath / DrivePath / VolumePath，跨卷快捷方式只有这里才有完整路径）
  const seen = new Set();
  const add = (p) => {
    const s = String(p || '').trim();
    // @C:\x.dll,-4001 之类是 mUI 资源串（只作图标源，不是目标）；纯相对串也不当绝对目标
    if (!s || s.startsWith('@') || !/^[A-Za-z]:[\\/]/.test(expandEnvVars(s))) return;
    const e = expandEnvVars(s);
    if (seen.has(e.toLowerCase())) return;
    seen.add(e.toLowerCase());
    out.paths.push(e);
  };
  for (const p of out.liPaths || []) add(p);
  for (const p of lnkLocalPaths(b)) add(p);
  add(out.relPath);
  out.target = out.paths[0] || '';
  return out;
}

/**
 * 解析 .lnk → {target, paths, iconFile, iconIndex, relPath}；非 .lnk 或解析失败返回 null。
 * target 只保证「像路径」，是否真实存在由调用方判定；paths 已按可信度排序。
 */
function parseLnk(file) {
  let b;
  try { b = fs.readFileSync(file); } catch (_) { return null; }
  if (b.length < 76 || b.readUInt32LE(0) !== 0x4c) return null;
  let r;
  try { r = parseLnkBody(b, LNK_FLAGS); } catch (_) { return null; }
  // 相对路径按快捷方式所在目录解析（实测有 .lnk 只写 ..\..\x.exe）
  const dir = path.dirname(file);
  const exists = (p) => { try { return fs.existsSync(p); } catch (_) { return false; } };
  if (r.relPath && !/^[A-Za-z]:[\\/]/.test(r.relPath)) {
    const abs = path.resolve(dir, expandEnvVars(r.relPath));
    if (exists(abs) && !r.paths.includes(abs)) r.paths.unshift(abs);
  }
  // 真实存在的路径优先（转盘取图靠它找 exe 内嵌图标组）
  r.paths.sort((a, x) => (exists(x) ? 1 : 0) - (exists(a) ? 1 : 0));
  r.target = r.paths[0] || r.target;
  if (r.iconFile) {
    const ic = splitIconLoc(r.iconFile);
    if (ic.path && !r.paths.includes(ic.path)) r.extraIcon = ic.path;
  }
  return r;
}

// ---------- 高分辨率抽取链 ----------
const normPath = (p) => String(p).replace(/\//g, '\\');

function peiIcon(file, index, size) {
  const ph = Buffer.alloc(8), pid = Buffer.alloc(4);
  const n = PrivateExtractIconsW(normPath(file), index | 0, size, size, ph, pid, 1, 0);
  if (n <= 0) return 0;
  return Number(ph.readBigUInt64LE(0));
}
function sdeiIcon(file, index, size) {
  const pl = Buffer.alloc(8), ps = Buffer.alloc(8);
  const rc = SHDefExtractIconW(normPath(file), index | 0, 0, pl, ps, (size & 0xffff) | ((size & 0xffff) << 16));
  if (rc !== 0) return 0;
  return Number(pl.readBigUInt64LE(0));
}

/**
 * 图标源候选：先让 shell 自己解析 .lnk（PrivateExtractIconsW 吃 .lnk 会落到目标），
 * 再用解析出的显式 IconLocation 与目标路径。Wallpaper Engine 同款思路：
 * 快捷方式大多指向 exe，真图标在 exe 的内嵌图标组里。
 */
function iconSourceCandidates(target) {
  const list = [];
  const push = (p, i) => {
    const pp = String(p || '').trim();
    if (!pp) return;
    if (!list.some((x) => x.p === pp && x.i === (i | 0))) list.push({ p: pp, i: i | 0 });
  };
  push(target, 0);
  if (/\.lnk$/i.test(String(target))) {
    const r = parseLnk(target);
    if (r) {
      // ★ IconLocation 的编号往往是资源 ID（mycomput.dll,-112），而 PEI/SDEI 把它当
      //   图标组数组下标 → 负数必然取不到句柄。带非 0 索引时同文件再补一个 0 号候选。
      const push2 = (p, i) => { push(p, i); if ((i | 0) !== 0) push(p, 0); };
      // 显式 IconLocation 优先（shell 画图标就按它取）
      if (r.iconFile) push2(r.iconFile, r.iconIndex);
      // paths 已按「是否真实存在」排序；串尾可能自带 ,-索引（扫描时 @ 前缀已丢失）
      for (const t of r.paths || []) {
        const loc = splitIconLoc(t);
        push2(loc.path, loc.index !== null ? loc.index : (r.iconFile ? r.iconIndex : 0));
      }
      if (r.extraIcon) push2(r.extraIcon, r.iconIndex);
    }
  }
  return list;
}

/** 按 256→48→32 依次尝试两种 API，首个 ≥128px 立即返回，否则取最大者 */
function extractBigRgba(cands) {
  let best = null;
  for (const { p, i } of cands) {
    for (const [apiName, api] of [['pei', peiIcon], ['sdei', sdeiIcon]]) {
      for (const sz of [256, 48, 32]) {
        const h = api(p, i, sz);
        if (!h) { if (DBG) console.log(`[icons] try ${apiName} ${p} #${i} ${sz} → 无句柄`); continue; }
        const img = iconToRgba(h, sz, sz);
        try { DestroyIcon(h); } catch (_) {}
        if (DBG) console.log(`[icons] try ${apiName} ${p} #${i} ${sz} → ${img ? img.w + 'px' : '转换失败'}`);
        if (!img) continue;
        if (!best || img.w > best.w) best = img;
        if (best.w >= 128) return best;
      }
    }
    if (best && best.w >= 128) return best;
  }
  // 冷启动/瞬时失败兜底：同一 256px 抽取首轮可能「转换失败」、稍后再调就成功
  // （实测 electron 进程里 git-bash.exe 需要第二轮才拿到 256px），故最多补试三轮。
  if (best && best.w < 128) {
    for (let pass = 0; pass < 3; pass++) {
      for (const { p, i } of cands) {
        for (const api of [peiIcon, sdeiIcon]) {
          const h = api(p, i, 256);
          if (!h) continue;
          const img = iconToRgba(h, 256, 256);
          try { DestroyIcon(h); } catch (_) {}
          if (img && img.w >= 128) {
            if (DBG) console.log(`[icons] 补试第 ${pass + 1} 轮命中 256px: ${p}`);
            return img;
          }
        }
      }
    }
  }
  return best;
}

// ---------- 对外 API ----------

/** 缓存时效跟随「真正提供图标的文件」：.lnk 指向的 exe 更新后图标要刷新 */
function stampTarget(target) {
  if (isVirtual(target)) return target;
  if (/\.lnk$/i.test(String(target))) {
    const r = parseLnk(target);
    if (r) {
      for (const p of [r.iconFile, r.target]) {
        const cp = splitIconLoc(p).path;
        if (cp) { try { if (fs.existsSync(cp)) return cp; } catch (_) {} }
      }
    }
  }
  return target;
}

/** 取图标 PNG Buffer（磁盘缓存）；失败返回 null */
function getIconPng(target) {
  if (!target) return null;
  // -v5：.lnk 目标解析修复（错位槽位导致取不到真实 exe → 只剩 32px/空白）→ 使 v4 那批脏缓存失效
  const file = cacheDir ? path.join(cacheDir, `${cacheKey(target)}-${stampOf(stampTarget(target))}-v5.png`) : null;
  if (file) {
    try {
      const b = fs.readFileSync(file);
      if (b.length > 64) return b;
    } catch (_) {}
  }
  const png = extractIconPng(target);
  if (png && file) {
    // ★ 只缓存高分辨率命中：48px 降级图一旦入盘，冷启动补试轮次就永远命中脏缓存、
    //   再没机会升级到 256px（实测 Git Bash 冷启动被固化成 48px）。
    //   虚拟项本来就只有系统大图标尺寸，照常缓存。
    let w = 0;
    try { w = png.readUInt32BE(16); } catch (_) {}
    if (isVirtual(target) || w >= 128) {
      try { fs.writeFileSync(file, png); cleanupCache(); } catch (_) {}
    }
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

/** 虚拟项（shell: / ::{GUID}）：PIDL → SHGetFileInfo → HICON → PNG */
function extractVirtualPng(target) {
  let hIcon = 0;
  let pidl = 0;
  try {
    const sfi = Buffer.alloc(SFI_SIZE);
    const flagsBase = SHGFI_ICON | SHGFI_SYSICONINDEX;
    const ppidl = Buffer.alloc(8);
    const attrOut = Buffer.alloc(8);
    if (SHParseDisplayName(String(target), 0, ppidl, 0, attrOut) !== 0) return null;
    pidl = Number(ppidl.readBigUInt64LE(0));
    if (!pidl) return null;
    // 命名空间图标的颜色位图常读不出尺寸（GetObjectW 失败）→ 必须显式给绘制尺寸，
    // 走 DrawIconEx 进自建 DIB 的路径；尺寸取系统大图标（与资源管理器一致）。
    // ★ 首轮 DrawIconEx 可能失败（冷启动），每轮重新申请句柄，最多三轮。
    const px = largeIconPx();
    for (let pass = 0; pass < 3; pass++) {
      // ★ 返回值只是成功标志/索引；真正的 HICON 在 SHFILEINFOW.hIcon（偏移 0）。
      //   旧代码把返回值当句柄用 —— 带 SHGFI_SYSICONINDEX 时返回的是索引，
      //   GetIconInfo(索引) 恒失败，这就是转盘"空白方块"的根因。
      if (SHGetFileInfoPidl(pidl, 0, sfi, SFI_SIZE, flagsBase | SHGFI_PIDL | SHGFI_LARGEICON)) {
        hIcon = Number(sfi.readBigUInt64LE(0));
      }
      if (!hIcon && SHGetFileInfoPidl(pidl, 0, sfi, SFI_SIZE, flagsBase | SHGFI_PIDL | SHGFI_SMALLICON)) {
        hIcon = Number(sfi.readBigUInt64LE(0));
      }
      if (!hIcon) continue;
      const img = iconToRgba(hIcon, px, px);
      try { DestroyIcon(hIcon); } catch (_) {}
      hIcon = 0; // 本轮已释放
      if (img) {
        if (DBG && pass) console.log(`[icons]   系统项补试第 ${pass + 1} 轮命中 ${px}px: ${target}`);
        return encodePng(img.w, img.h, img.rgba);
      }
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    if (hIcon) { try { DestroyIcon(hIcon); } catch (_) {} }
    if (pidl) { try { CoTaskMemFree(pidl); } catch (_) {} }
  }
}

/** 普通文件 / 快捷方式：高分辨率链优先，回落 shell 类型图标（32px） */
function extractFilePng(target) {
  const cands = iconSourceCandidates(target);
  const big = extractBigRgba(cands);
  if (big) {
    if (DBG) console.log(`[icons] HIRES ${target} ${big.w}x${big.h}`);
    return encodePng(big.w, big.h, big.rgba);
  }
  // ★ 回落也不能吃 .lnk 本身：SHGetFileInfo 对快捷方式会自动叠「快捷方式角标」
  //   （左下角蓝箭头 + 白色圆角底）。优先用候选链里真实存在的目标 exe/dll。
  let src = normPath(target);
  for (const { p } of cands) {
    const pp = normPath(p);
    if (pp === src) continue;
    try { if (fs.existsSync(pp)) { src = pp; break; } } catch (_) {}
  }
  let hIcon = 0;
  try {
    const sfi = Buffer.alloc(SFI_SIZE);
    const flagsBase = SHGFI_ICON | SHGFI_SYSICONINDEX;
    // ★ Shell API 只认反斜杠路径：正斜杠会静默返回 0
    const p = src;
    // ★ 返回值只是成功标志/索引；HICON 在 SHFILEINFOW.hIcon（偏移 0）
    if (SHGetFileInfoPath(p, 0, sfi, SFI_SIZE, flagsBase | SHGFI_LARGEICON)) {
      hIcon = Number(sfi.readBigUInt64LE(0));
    }
    if (!hIcon && SHGetFileInfoPath(p, 0, sfi, SFI_SIZE, flagsBase | SHGFI_SMALLICON)) {
      hIcon = Number(sfi.readBigUInt64LE(0));
    }
    if (!hIcon && SHGetFileInfoPath(p, FILE_ATTRIBUTE_NORMAL, sfi, SFI_SIZE,
      SHGFI_ICON | SHGFI_USEFILEATTRIBUTES | SHGFI_SYSICONINDEX | SHGFI_LARGEICON)) {
      // 关联图标缺失（无关联程序的办公文件等）：按扩展名取类型图标
      hIcon = Number(sfi.readBigUInt64LE(0));
    }
    if (!hIcon) { if (DBG) console.log('[icons] 未取到 HICON:', target); return null; }
    const img = iconToRgba(hIcon);
    if (!img) { if (DBG) console.log('[icons] HICON 转位图失败:', target); return null; }
    return encodePng(img.w, img.h, img.rgba);
  } catch (_) {
    return null;
  } finally {
    if (hIcon) { try { DestroyIcon(hIcon); } catch (_) {} }
  }
}

/** 实际提取入口 */
function extractIconPng(target) {
  ensureCom();
  try {
    return isVirtual(target) ? extractVirtualPng(target) : extractFilePng(target);
  } catch (_) {
    return null;
  }
}

/** 取图标 data URL（渲染层 <img src> 直接用）；失败返回 null */
function getIconDataUrl(target) {
  const png = getIconPng(target);
  return png ? `data:image/png;base64,${png.toString('base64')}` : null;
}

module.exports = { init, getIconPng, getIconDataUrl, isVirtual, encodePng };
