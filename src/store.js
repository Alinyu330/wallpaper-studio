// store.js — 配置持久化（JSON 文件存储在用户数据目录）
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_CONFIG = {
  wallpapers: [],      // 壁纸库 [{id,name,path,type,addedAt,favorite,params}]
  current: null,       // 当前壁纸 {id, params}
  settings: {
    mpvPath: 'auto',            // auto=自动查找内置/PATH
    autoStart: false,           // 开机自启
    wallpaperPaused: false,     // 全局暂停（视频冻结 + 轮换停止）
    rotation: { enabled: false, intervalMin: 30, scope: 'all', order: 'random', list: [] }, // 定时轮换
    widgets: {                  // 桌面 DIY 组件
      enabled: false,
      theme: 'auto',            // auto/light/dark
      opacity: 0.72,            // 组件面板底透明度
      items: {
        clock:  { on: false, pos: 'tl', size: 'l' }, // 时钟（可点击切换12/24小时制）
        cpu:    { on: false, pos: 'tr', size: 'm' },
        gpu:    { on: false, pos: 'tr', size: 'm' },
        mem:    { on: false, pos: 'tr', size: 'm' },
        volume: { on: false, pos: 'br', size: 'm' }, // 音量（可拖动调节/点击静音）
      },
    },
    lastWindowBounds: null,     // 主窗口位置记忆
    hotkeyPause: true,          // 全局快捷键 Ctrl+Alt+W 暂停/恢复壁纸
    performance: {
      fullscreenPause: true,    // 性能：全屏应用时自动暂停视频壁纸
      batteryPause: true,       // 性能：电池供电时自动暂停视频壁纸
      maximizedPause: false,    // 性能：其他窗口最大化时暂停视频壁纸（Wallpaper Engine 同款）
    },
  },
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'));
        // 合并默认值，防止旧配置缺字段
        return {
          ...DEFAULT_CONFIG,
          ...raw,
          settings: {
            ...DEFAULT_CONFIG.settings,
            ...(raw.settings || {}),
            rotation: { ...DEFAULT_CONFIG.settings.rotation, ...((raw.settings || {}).rotation || {}) },
            widgets: {
              ...DEFAULT_CONFIG.settings.widgets,
              ...((raw.settings || {}).widgets || {}),
              items: { ...DEFAULT_CONFIG.settings.widgets.items, ...(((raw.settings || {}).widgets || {}).items || {}) },
            },
            performance: { ...DEFAULT_CONFIG.settings.performance, ...((raw.settings || {}).performance || {}) },
          },
        };
      }
    } catch (e) {
      console.warn('[store] 配置读取失败，使用默认配置:', e.message);
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[store] 配置保存失败:', e.message);
    }
  }

  get wallpapers() { return this.data.wallpapers; }
  get current() { return this.data.current; }
  get settings() { return this.data.settings; }

  addWallpaper(wp) {
    // 去重：同路径不重复添加
    const exists = this.data.wallpapers.find(w => w.path === wp.path);
    if (exists) return exists;
    this.data.wallpapers.unshift(wp);
    this.save();
    return wp;
  }

  removeWallpaper(id) {
    const idx = this.data.wallpapers.findIndex(w => w.id === id);
    if (idx >= 0) {
      this.data.wallpapers.splice(idx, 1);
      this.save();
    }
  }

  updateWallpaper(id, patch) {
    const wp = this.data.wallpapers.find(w => w.id === id);
    if (wp) {
      Object.assign(wp, patch);
      this.save();
    }
    return wp;
  }

  setCurrent(id, params) {
    const wp = this.data.wallpapers.find(w => w.id === id);
    this.data.current = wp ? { id, params: params || wp.params || {} } : null;
    this.save();
  }

  updateSettings(patch) {
    Object.assign(this.data.settings, patch);
    this.save();
  }
}

module.exports = { Store };
