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
  apply: (id) => ipcRenderer.invoke('wallpaper:apply', id),
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
