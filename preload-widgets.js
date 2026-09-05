// preload-widgets.js — 桌面组件/音律动效窗口桥接（v1.9.0：每组件独立小窗口）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallpaperHost', {
  // 主进程 → 页面
  onConfig: (cb) => ipcRenderer.on('wallpaper-config', (_e, cfg) => cb(cfg)),
  onStats: (cb) => ipcRenderer.on('wallpaper-stats', (_e, s) => cb(s)),   // {cpu,gpu,mem,volume,mute}
  onAdjust: (cb) => ipcRenderer.on('widgets:adjust-mode', (_e, v) => cb(v)), // {on} 调整模式开关
  onWeather: (cb) => ipcRenderer.on('wallpaper-weather', (_e, w) => cb(w)), // 看板天气（主进程 30min 刷新）
  onPerfPause: (cb) => ipcRenderer.on('aviz:perf-pause', (_e, v) => cb(v)), // {on} 上层有最大化/全屏窗口
  // 页面 → 主进程
  // ★ ready：渲染页加载完、IPC 监听器已注册后主动通知主进程（launcher 同款双保险时序，
  //   防止主进程早发的配置丢失 → cfg=null → 组件不渲染）
  ready: () => ipcRenderer.send('wallpaper-widgets-ready'),
  reportRects: (rects) => ipcRenderer.send('wallpaper-report-rects', rects),
  setInteracting: (v) => ipcRenderer.send('wallpaper-set-interacting', v),
  // 音量组件 = 系统主音量（默认播放设备），与壁纸自身音量是两条独立通道
  setSysVolume: (v) => ipcRenderer.send('wallpaper-set-sys-volume', v),
  toggleSysMute: () => ipcRenderer.send('wallpaper-toggle-sys-mute'),
  toggleTodo: (id) => ipcRenderer.send('wallpaper-board-todo', id),
  // 桌面看板编辑：新增/删除待办与日程、切换天气城市（invoke 返回最新 board）
  boardEdit: (payload) => ipcRenderer.invoke('wallpaper-board-edit', payload),
  boardGeocode: (q) => ipcRenderer.invoke('wallpaper-board-geocode', q),
  boardFocus: () => ipcRenderer.send('wallpaper-board-focus'),
  boardHeight: (h) => ipcRenderer.send('wallpaper-board-height', h),
  reportAvStatus: (s) => ipcRenderer.send('wallpaper-av-status', s),
  // 拖动 = 移动整个窗口（主进程实现，launcher 同款 grabOff 方案）
  dragStart: () => ipcRenderer.send('wallpaper-drag-start'),
  dragMove: () => ipcRenderer.send('wallpaper-drag-move'),
  dragEnd: () => ipcRenderer.send('wallpaper-drag-end'),
});
