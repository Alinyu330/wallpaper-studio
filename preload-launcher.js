// preload-launcher.js — 快捷方式转盘窗口桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('launcherHost', {
  // 主进程 → 页面
  onConfig: (cb) => ipcRenderer.on('launcher:config', (_e, cfg) => cb(cfg)),
  onHover: (cb) => ipcRenderer.on('launcher:hover', (_e, v) => cb(v)),
  // 页面 → 主进程
  ready: () => ipcRenderer.send('launcher:ready'),
  reportMetrics: (m) => ipcRenderer.send('launcher:metrics', m),     // {w,h} CSS px
  reportRects: (rects) => ipcRenderer.send('launcher:report-rects', rects), // [{x,y,w,h}] CSS px
  setInteracting: (v) => ipcRenderer.send('launcher:set-interacting', v),
  dragStart: () => ipcRenderer.send('launcher:drag-start'),
  dragMove: () => ipcRenderer.send('launcher:drag-move'),
  dragEnd: () => ipcRenderer.send('launcher:drag-end'),
  launch: (idx) => ipcRenderer.send('launcher:launch', idx),
  remove: (idx) => ipcRenderer.send('launcher:remove', idx),
  addShortcuts: () => ipcRenderer.invoke('launcher:add'),
});
