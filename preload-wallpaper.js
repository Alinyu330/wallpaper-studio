// preload-wallpaper.js — 壁纸渲染窗口桥接（只接收渲染指令）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  onRender: (cb) => {
    ipcRenderer.on('render', (_e, payload) => cb(payload));
  },
});
