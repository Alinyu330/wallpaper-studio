// store.js — 配置持久化（JSON 文件存储在用户数据目录）
const { app } = require('electron');
const path = require('path');
const fs = require('fs');

// 落盘防抖：滑杆拖动/窗口移动会高频触发 save()，合并到一次异步写，避免主线程被磁盘 IO 卡住
const SAVE_DEBOUNCE_MS = 250;

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
      // 位置模型（v1.7.1）：posX/posY 为桌面拖动保存的自由位置（窗口中心相对
      // 工作区的比例，null = 未拖动过）；非 null 时优先于 pos 九宫格槽位。
      items: {
        clock:  { on: false, pos: 'tl', posX: null, posY: null, size: 'l' }, // 时钟（可点击切换12/24小时制）
        cpu:    { on: false, pos: 'tr', posX: null, posY: null, size: 'm' },
        gpu:    { on: false, pos: 'tc', posX: null, posY: null, size: 'm' },
        mem:    { on: false, pos: 'mr', posX: null, posY: null, size: 'm' },
        volume: { on: false, pos: 'br', posX: null, posY: null, size: 'm' }, // 音量（可拖动调节/点击静音）
      },
    },
    lastWindowBounds: null,     // 主窗口位置记忆
    hotkeyPause: true,          // 全局快捷键 Ctrl+Alt+W 暂停/恢复壁纸
    smoothLoop: true,           // 平滑循环（双引擎淡入覆盖，消除循环交界跳变）
    launcher: {                 // 桌面快捷方式转盘
      enabled: false,
      x: null, y: null,        // 转盘窗口左上角屏幕物理坐标；null = 默认（主显示器底部居中）
      count: 8,                // 同屏显示图标数量（4~12）
      autoCollapse: true,      // 空闲时自动收起为小胶囊
      shortcuts: [],           // [{name, path}]（图标运行时解析，不入库）
      boxed: [],               // [{name, originPath, boxPath}] 从桌面收纳的快捷方式（可恢复）
    },
    filebox: {                  // 桌面文件收纳区（从转盘拆分的普通文件/文件夹收纳）
      enabled: false,
      x: null, y: null, grid: null, // 收纳区窗口位置；grid 九宫格槽位
      gridCols: 5,             // 网格列数（3~12）
      groupBy: 'kind',         // 分类排列：kind 类型分类 / name 名称 / mtime 时间 / manual 手动
      bgOpacity: 0.32,         // 面板底色不透明度（鼠标悬停展开时）
      idleOpacity: 0.28,       // 空闲（鼠标离开）时整体不透明度（毛玻璃态）
      autoIdle: true,          // 空闲自动转半透明毛玻璃
      items: [],               // [{name, path, type:'file'|'folder', originPath?, boxPath?}]
    },
    performance: {
      fullscreenPause: true,    // 性能：全屏应用时自动暂停视频壁纸
      batteryPause: true,       // 性能：电池供电时自动暂停视频壁纸
      maximizedPause: false,    // 性能：其他窗口最大化时暂停视频壁纸（Wallpaper Engine 同款）
    },
    audioViz: {                 // 音律动效（系统声音频谱可视化）
      enabled: false,
      style: 'bars',            // bars 频谱条 / wave 波浪 / circle 圆环
      color: '#7c5cff',         // 主色
      gradient: true,           // 渐变色（主色 → 辅色）
      opacity: 0.85,            // 不透明度 0.2~1
      size: 1,                  // 大小缩放 0.5~2
      pos: 'bottom',            // 垂直预设 bottom / top（圆环忽略，居中）
      posX: null,               // 手动拖动位置（0~1 屏幕比例；null = 用 pos 预设）
      posY: null,
      mirror: true,             // 频谱条垂直镜像倒影
      sensitivity: 1.2,         // 灵敏度 0.5~3
    },
  },
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.bakFile = this.file + '.bak';
    this.data = this._load();
    this._dirty = false;    // 有待落盘的改动
    this._saving = false;   // 异步写进行中
    this._saveTimer = null; // 防抖定时器
  }

  _load() {
    // 优先读主配置；解析失败（异常关机/断电写坏文件）时回退备份，
    // 避免壁纸库与"当前壁纸"记录被清空 —— 这是"重启后壁纸不恢复"的一大元凶
    const tryParse = (file) => {
      try {
        if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
      } catch (e) {
        console.warn(`[store] 配置读取失败(${path.basename(file)}):`, e.message);
      }
      return null;
    };
    let raw = tryParse(this.file);
    if (!raw) {
      raw = tryParse(this.bakFile);
      if (raw) console.warn('[store] 主配置损坏，已从备份恢复（下次保存将重建主配置）');
    }
    if (raw) {
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
          launcher: {
            ...DEFAULT_CONFIG.settings.launcher,
            ...((raw.settings || {}).launcher || {}),
            shortcuts: (((raw.settings || {}).launcher || {}).shortcuts) || [],
            boxed: (((raw.settings || {}).launcher || {}).boxed) || [],
          },
          filebox: {
            ...DEFAULT_CONFIG.settings.filebox,
            ...((raw.settings || {}).filebox || {}),
            items: (((raw.settings || {}).filebox || {}).items) || [],
          },
          performance: { ...DEFAULT_CONFIG.settings.performance, ...((raw.settings || {}).performance || {}) },
          audioViz: { ...DEFAULT_CONFIG.settings.audioViz, ...((raw.settings || {}).audioViz || {}) },
        },
      };
    }
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }

  /**
   * 保存配置（合并 + 异步落盘）
   *
   * 调用频率极高：拖动滑块每一帧、主窗口每次 resize/move、每次切换壁纸都会触发。
   * 旧实现是同步写盘（writeFileSync + copyFileSync + renameSync），且 rename 被杀软/
   * 索引服务短暂占用时会「忙等」最长 500ms —— 主进程事件循环被彻底卡住，
   * 表现为整个客户端卡顿、窗口失去合成内容而变黑一段时间。
   * 现改为：250ms 合并一次 + 全程异步 + 定时器退避重试（不再忙等）。
   * 进程退出前由 flushSync() 兜底落盘。
   */
  save() {
    this._dirty = true;
    this._scheduleSave();
  }

  _scheduleSave() {
    if (this._saving || this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushAsync();
    }, SAVE_DEBOUNCE_MS);
  }

  async _flushAsync() {
    if (this._saving) return;
    this._saving = true;
    // 取快照：写入期间数据再变化会置 _dirty，写完重新排期，不会丢改动
    const json = JSON.stringify(this.data, null, 2);
    this._dirty = false;
    try {
      await this._writeAtomic(json);
    } catch (e) {
      console.error('[store] 配置保存失败:', e.message);
    } finally {
      this._saving = false;
      if (this._dirty) this._scheduleSave();
    }
  }

  /** 原子写入：临时文件 → 转存 .bak → 改名覆盖（断电/崩溃不会留下半截 JSON） */
  async _writeAtomic(json) {
    await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    await fs.promises.writeFile(tmp, json, 'utf8');
    try { await fs.promises.copyFile(this.file, this.bakFile); } catch (_) {}
    // rename 可能因目标被短暂锁定而失败（应用被强杀后句柄未释放、杀软扫描等）：
    // 定时器退避重试，绝不忙等
    let lastErr = null;
    for (let i = 0; i < 5; i++) {
      try {
        await fs.promises.rename(tmp, this.file);
        return;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 50 * (i + 1)));
      }
    }
    throw lastErr || new Error('rename 重试后仍失败');
  }

  /** 退出前同步落盘：异步写在进程退出时可能来不及完成 */
  flushSync() {
    if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    if (!this._dirty && !this._saving) return;
    try {
      const json = JSON.stringify(this.data, null, 2);
      const tmp = this.file + '.tmp';
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, json, 'utf8');
      try { if (fs.existsSync(this.file)) fs.copyFileSync(this.file, this.bakFile); } catch (_) {}
      fs.renameSync(tmp, this.file);
      this._dirty = false;
    } catch (e) {
      console.error('[store] 退出前配置保存失败:', e.message);
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
