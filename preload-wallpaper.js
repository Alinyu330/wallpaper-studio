// preload-wallpaper.js — 壁纸渲染窗口桥接（v1.8.2：组件+音律动效改在独立 widgets 窗口，本窗口只渲染壁纸）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  // 壁纸渲染（图片/网页/视频）
  onRender: (cb) => ipcRenderer.on('render', (_e, payload) => cb(payload)),
  ready: () => ipcRenderer.send('render:ready'),
});