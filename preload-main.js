// preload-main.js — 主界面与主进程之间的安全桥接
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 拖拽文件对象 → 绝对路径（Electron 33+ File.path 已移除）
  getFilePath: (file) => webUtils.getPathForFile(file),
  // 数据
  getStore: () => ipcRenderer.invoke('store:get'),
  // 壁纸管理
  addFiles: () => ipcRenderer.invoke('wallpaper:add-files'),
  addPaths: (paths) => ipcRenderer.invoke('wallpaper:add-paths', paths),
  addWeb: (url) => ipcRenderer.invoke('wallpaper:add-web', url),
  apply: (id, params) => ipcRenderer.invoke('wallpaper:apply', id, params),
  stopWallpaper: () => ipcRenderer.invoke('wallpaper:stop'),
  updateParams: (patch) => ipcRenderer.invoke('wallpaper:update-params', patch),
  remove: (id) => ipcRenderer.invoke('wallpaper:remove', id),
  favorite: (id, val) => ipcRenderer.invoke('wallpaper:favorite', id, val),
  // 设置
  updateSettings: (patch) => ipcRenderer.invoke('settings:update', patch),
  checkMpv: () => ipcRenderer.invoke('mpv:check'),
  openMpvDownload: () => ipcRenderer.invoke('mpv:open-download'),
  showInFolder: (p) => ipcRenderer.invoke('shell:show-in-folder', p),
  // 壁纸站点跳转（默认浏览器打开）
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  // 全局暂停 / 轮换
  pauseAll: (paused) => ipcRenderer.invoke('wallpaper:pause-all', paused),
  rotationNext: () => ipcRenderer.invoke('rotation:next'),
  // 显示器信息（预览比例）
  getDisplays: () => ipcRenderer.invoke('system:get-displays'),
  // 预览弹出窗口
  openPreview: () => ipcRenderer.invoke('preview:open'),
  syncPreview: (data) => ipcRenderer.invoke('preview:sync', data),
  // 锁屏壁纸
  setLockScreen: (imagePath) => ipcRenderer.invoke('lockscreen:set', imagePath),
  resetLockScreen: () => ipcRenderer.invoke('lockscreen:reset'),
  getLockScreen: () => ipcRenderer.invoke('lockscreen:get'),
  // 桌面快捷方式转盘
  getLauncherConfig: () => ipcRenderer.invoke('launcher:get'),
  addLauncherShortcuts: () => ipcRenderer.invoke('launcher:add'),
  updateLauncherConfig: (patch) => ipcRenderer.invoke('settings:update', { launcher: patch }),
  pickDesktopShortcuts: () => ipcRenderer.invoke('launcher:pick'),
  boxAllDesktopShortcuts: () => ipcRenderer.invoke('launcher:box-all'),
  boxPublicDesktopShortcuts: () => ipcRenderer.invoke('launcher:box-public'),
  removeLauncherAt: (idx) => ipcRenderer.invoke('launcher:remove-at', idx),
  setLauncherPinned: (idx, on) => ipcRenderer.invoke('launcher:set-pinned', { idx, on }),
  restoreAllLauncher: () => ipcRenderer.invoke('launcher:restore-all'),
  // 桌面文件收纳区（从转盘拆分的普通文件/文件夹收纳）
  getFileboxConfig: () => ipcRenderer.invoke('filebox:get'),
  addFileboxItems: () => ipcRenderer.invoke('filebox:add'),
  updateFileboxConfig: (patch) => ipcRenderer.invoke('settings:update', { filebox: patch }),
  boxAllDesktopFiles: () => ipcRenderer.invoke('filebox:box-all'),
  removeFileboxAt: (idx) => ipcRenderer.invoke('filebox:remove-at', idx),
  restoreAllFilebox: () => ipcRenderer.invoke('filebox:restore-all'),
  // 位置调整模式（客户端按钮进入 → 桌面按住拖动 → 松手自动保存）
  setWidgetsAdjust: (key, on) => ipcRenderer.invoke('widgets:set-adjust', key, on),
  setAvizAdjust: (on) => ipcRenderer.invoke('audioviz:set-adjust', on),
  // 看板城市搜索（Open-Meteo geocoding，主进程代拉）
  geocodeCity: (name) => ipcRenderer.invoke('board:geocode', name),
  setLauncherAdjust: (on) => ipcRenderer.invoke('launcher:set-adjust', on),
  setFileboxAdjust: (on) => ipcRenderer.invoke('filebox:set-adjust', on),
  // 检查更新（结果通过 update:status 事件与返回值提供；手动检查发现新版弹功能介绍窗口）
  checkUpdateNow: () => ipcRenderer.invoke('update:check-now'),
  openDownloadPage: (url) => ipcRenderer.invoke('update:open-download', url),
  // 一键更新：应用内下载安装包并静默安装（进度与状态通过事件推送）
  installUpdate: () => ipcRenderer.invoke('update:install'),
  cancelUpdateInstall: () => ipcRenderer.invoke('update:install-cancel'),
  // 客户端版本号（关于页动态显示）
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  // 收纳存储路径（主存储 / 备用镜像；设置页文字提示 + 点击打开）
  getStoragePaths: () => ipcRenderer.invoke('app:storage-paths'),
  // 硬件加速等「app ready 前才生效」的设置改完后立即重启（主进程会先 flushSync 落盘）
  relaunchApp: () => ipcRenderer.invoke('app:relaunch'),
  // 窗口控制
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  close: () => ipcRenderer.send('win:close'),
  // 事件订阅（返回取消函数）
  on: (channel, cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
