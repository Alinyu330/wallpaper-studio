// preload-widgets.js — 桌面组件窗口桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widgetHost', {
  // 主进程 → 页面
  onConfig: (cb) => ipcRenderer.on('widgets:config', (_e, cfg) => cb(cfg)),
  onStats: (cb) => ipcRenderer.on('widgets:stats', (_e, s) => cb(s)),   // {cpu,gpu,mem,volume,mute}
  onMouse: (cb) => ipcRenderer.on('widgets:mouse', (_e, ev) => cb(ev)), // 合成的鼠标事件
  // 页面 → 主进程
  reportRects: (rects) => ipcRenderer.send('widgets:report-rects', rects), // 可交互矩形（CSS px）
  setVolume: (v) => ipcRenderer.send('widgets:set-volume', v),
  toggleMute: () => ipcRenderer.send('widgets:toggle-mute'),
});
