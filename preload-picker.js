// preload-picker.js — 桌面快捷方式点选/框选窗口桥接
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pickerHost', {
  // 主进程 → 页面：图标清单 {icons:[{name,x,y,w,h}], vd:{x,y}, dpr}
  onIcons: (cb) => ipcRenderer.on('picker:icons', (_e, data) => cb(data)),
  // 页面 → 主进程
  confirm: (names) => ipcRenderer.send('picker:confirm', names), // 选中的图标名数组
  cancel: () => ipcRenderer.send('picker:cancel'),
});
