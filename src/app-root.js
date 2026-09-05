// app-root.js — 应用根目录（收纳文件夹的宿主位置）
//
// 收纳的文件/快捷方式存放在应用根目录下的两个可见文件夹（默认为空）：
//   收纳快捷方式(卸载恢复)/  ← 转盘收纳的快捷方式（launcher.js）
//   收纳文件(卸载恢复)/      ← 文件收纳区收纳的普通文件（filebox.js）
// 位置规则：
//   开发态（electron .）→ 项目根目录（与 main.js 同级）；
//   安装态（asar:false）→ 安装目录（与 壁纸工坊.exe 同级）。
// 收纳内容因此对用户始终可见、可查。升级/卸载时的保护见 build/installer.nsh：
// 升级由 customInit 预备份 + customInstall 还原，真卸载由 customRemoveFiles
// 抢救回桌面，任何场景都不会静默丢失。
const path = require('path');

function getAppRoot(app) {
  return app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
}

const LAUNCHER_BOX_DIRNAME = '收纳快捷方式(卸载恢复)';
const FILEBOX_BOX_DIRNAME = '收纳文件(卸载恢复)';

module.exports = { getAppRoot, LAUNCHER_BOX_DIRNAME, FILEBOX_BOX_DIRNAME };
