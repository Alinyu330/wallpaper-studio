// preload-widgets.js — 桌面组件/音律动效窗口桥接（v1.9.0：每组件独立小窗口）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  // 主进程 → 页面
  onConfig: (cb) => ipcRenderer.on('wallpaper-config', (_e, cfg) => cb(cfg)),
  onStats: (cb) => ipcRenderer.on('wallpaper-stats', (_e, s) => cb(s)),   // {cpu,gpu,mem,volume,mute}
  onAdjust: (cb) => ipcRenderer.on('widgets:adjust-mode', (_e, v) => cb(v)), // {on} 调整模式开关
  // 页面 → 主进程
  // ★ ready：渲染页加载完、IPC 监听器已注册后主动通知主进程（launcher 同款双保险时序，
  //   防止主进程早发的配置丢失 → cfg=null → 组件不渲染）
  ready: () => ipcRenderer.send('wallpaper-widgets-ready'),
  reportRects: (rects) => ipcRenderer.send('wallpaper-report-rects', rects),
  setInteracting: (v) => ipcRenderer.send('wallpaper-set-interacting', v),
  setVolume: (v) => ipcRenderer.send('wallpaper-set-volume', v),
  toggleMute: () => ipcRenderer.send('wallpaper-toggle-mute'),
  reportAvStatus: (s) => ipcRenderer.send('wallpaper-av-status', s),
  // 拖动 = 移动整个窗口（主进程实现，launcher 同款 grabOff 方案）
  dragStart: () => ipcRenderer.send('wallpaper-drag-start'),
  dragMove: () => ipcRenderer.send('wallpaper-drag-move'),
  dragEnd: () => ipcRenderer.send('wallpaper-drag-end'),
});
