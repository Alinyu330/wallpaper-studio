// box-rules.js — 两个收纳宿主（转盘 launcher.js / 文件收纳区 filebox.js）共用的判定规则
//
// 职责边界：快捷方式与程序文件归转盘，其余普通文件与文件夹归文件收纳区。
// 两边的过滤规则必须互补且不重叠，否则桌面同一个条目被两个宿主反复搬运。
const fs = require('fs');
const path = require('path');

// 转盘收纳范围：快捷方式 + 可直接运行的程序
const SC_EXTS = ['.lnk', '.url'];
const APP_EXTS = ['.exe', '.bat', '.cmd'];
const LAUNCHER_EXTS = [...SC_EXTS, ...APP_EXTS].map((e) => e.toLowerCase());

// 系统/元数据文件：出现在桌面上但不是用户内容，永不收纳
const BOX_SKIP_NAMES = new Set(['desktop.ini', 'thumbs.db']);

const extOf = (p) => path.extname(String(p || '')).toLowerCase();

/** macOS 资源 fork（._*）与 Office 锁文件（~$*）：历史版本误收进来过，一律不收纳 */
const isJunkName = (p) => {
  const b = path.basename(String(p || ''));
  return b.startsWith('._') || b.startsWith('~$');
};

/** 归转盘收纳的条目（文件收纳区必须让开） */
const isLauncherItem = (p) => LAUNCHER_EXTS.includes(extOf(p));

/** 文件收纳区跳过的桌面条目名 */
const isBoxSkipName = (name) => BOX_SKIP_NAMES.has(String(name).toLowerCase());

/** 目录是否为空。读不动时按「非空」处理 —— 宁可少动，不可动错 */
function isEmptyDir(dir) {
  try { return fs.readdirSync(dir).length === 0; } catch (_) { return false; }
}

module.exports = {
  SC_EXTS, APP_EXTS, LAUNCHER_EXTS,
  extOf, isJunkName, isLauncherItem, isBoxSkipName, isEmptyDir,
};
