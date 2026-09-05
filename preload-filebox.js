// preload-filebox.js — 文件收纳区窗口桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fileboxHost', {
  // 主进程 → 页面
  onConfig: (cb) => ipcRenderer.on('filebox:config', (_e, cfg) => cb(cfg)),
  onHover: (cb) => ipcRenderer.on('filebox:hover', (_e, v) => cb(v)),
  onAdjust: (cb) => ipcRenderer.on('filebox:adjust-mode', (_e, v) => cb(v)),
  // 页面 → 主进程
  ready: () => ipcRenderer.send('filebox:ready'),
  reportMetrics: (m) => ipcRenderer.send('filebox:metrics', m),
  reportRects: (rects) => ipcRenderer.send('filebox:report-rects', rects),
  setInteracting: (v) => ipcRenderer.send('filebox:set-interacting', v),
  dragStart: () => ipcRenderer.send('filebox:drag-start'),
  dragMove: () => ipcRenderer.send('filebox:drag-move'),
  dragEnd: () => ipcRenderer.send('filebox:drag-end'),
  launch: (idx) => ipcRenderer.send('filebox:launch', idx),
  remove: (idx) => ipcRenderer.send('filebox:remove', idx),
  addItems: () => ipcRenderer.invoke('filebox:add'),
  dropPaths: (paths) => ipcRenderer.invoke('filebox:drop-paths', paths),
});
