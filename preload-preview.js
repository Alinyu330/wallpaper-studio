// preload-preview.js — 预览弹出窗口与主进程之间的桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('previewHost', {
  // 接收预览数据 {wallpaper, params, display}
  onData: (cb) => {
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on('preview:data', listener);
    return () => ipcRenderer.removeListener('preview:data', listener);
  },
  // 请求当前预览数据（窗口加载完成时）
  request: () => ipcRenderer.invoke('preview:request'),
  close: () => ipcRenderer.send('preview:close'),
});
