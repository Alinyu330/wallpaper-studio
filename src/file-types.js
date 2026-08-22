// file-types.js — 支持的壁纸文件格式与类型识别

// 静态图片（Electron Chromium 直接渲染）
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.gif', '.avif', '.ico', '.tiff', '.tif', '.jxl'];
// 动态视频（mpv 播放，支持格式极其丰富）
const VIDEO_EXTS = ['.mp4', '.avi', '.mkv', '.webm', '.flv', '.mov', '.wmv', '.ts', '.m2ts', '.mts', '.m4v',
  '.3gp', '.3g2', '.mpg', '.mpeg', '.vob', '.ogv', '.rm', '.rmvb', '.asf', '.divx', '.f4v', '.mxf', '.dat'];
// 可执行程序（嵌入窗口）
const EXE_EXTS = ['.exe'];
// 网页
const WEB_EXTS = ['.html', '.htm'];

function getExt(filePath) {
  const idx = filePath.lastIndexOf('.');
  return idx >= 0 ? filePath.slice(idx).toLowerCase() : '';
}

/**
 * 识别壁纸类型
 * @returns {'image'|'video'|'exe'|'web'|null}
 */
function detectType(filePath) {
  const ext = getExt(filePath);
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  if (EXE_EXTS.includes(ext)) return 'exe';
  if (WEB_EXTS.includes(ext)) return 'web';
  return null;
}

/** 文件选择对话框的过滤器 */
const DIALOG_FILTERS = [
  { name: '所有支持的壁纸', extensions: [...IMAGE_EXTS, ...VIDEO_EXTS, ...EXE_EXTS, ...WEB_EXTS].map(e => e.slice(1)) },
  { name: '图片', extensions: IMAGE_EXTS.map(e => e.slice(1)) },
  { name: '视频', extensions: VIDEO_EXTS.map(e => e.slice(1)) },
  { name: '程序 (EXE)', extensions: ['exe'] },
  { name: '网页', extensions: ['html', 'htm'] },
];

module.exports = { IMAGE_EXTS, VIDEO_EXTS, EXE_EXTS, WEB_EXTS, detectType, DIALOG_FILTERS };
