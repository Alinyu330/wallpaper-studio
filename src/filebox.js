// filebox.js — 桌面「文件收纳区」宿主（主进程侧）
//
// 从快捷方式转盘（launcher.js）拆分出的独立文件收纳能力：
// - 收纳对象：桌面上除「转盘管的」（.lnk/.url/.exe/.bat/.cmd）与系统元数据
//   （desktop.ini / Thumbs.db / ._* / ~$*）之外的**任意文件**（含 0 字节文件、
//   无扩展名文件、白名单外的未知类型）；
// - 独立小窗口挂在桌面图标层之上、普通窗口之下，不遮挡壁纸观感；
// - 网格平铺展示图标（非转盘轮换）：文件夹与文件各自分类排列，
//   用户可在设置页自定义排序（手动 / 名称 / 类型 / 时间）；
// - 真实图标：复用 icons.js（Win32 SHGetFileInfoW），文件夹/文件类型
//   图标均取系统真实图标，不落空白占位；
// - 毛玻璃空闲态：鼠标靠近正常显示图标，离开一段时间后整体转为
//   半透明毛玻璃胶囊（不打扰壁纸观看，与壁纸协调）；
// - 文件收纳 = 移动到保管目录（桌面原位置隐藏，可恢复）；
//   空文件夹收纳 = 整体移入保管目录（里面没有内容，移动零风险，桌面图标消失）；
//   非空文件夹 = 仅登记路径引用（不搬动用户内容，点开进入文件夹）。
//
// 挂载/输入方案与 launcher 完全一致：顶层窗口 + transparent + focusable +
// WS_EX_NOACTIVATE，主进程 30ms 光标轮询命中渲染页上报的矩形后才可点击。
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const desktop = require('./desktop');
const icons = require('./icons');
const { getAppRoot, FILEBOX_BOX_DIRNAME } = require('./app-root');
const { scheduleMirrorSync } = require('./box-mirror');
const { isJunkName, isLauncherItem, isBoxSkipName, isEmptyDir } = require('./box-rules');

const DEFAULTS = {
  enabled: false, x: null, y: null, grid: null,
  gridCols: 5,            // 网格列数（3~12）
  groupBy: 'kind',        // 分类排列：kind 类型分类 / name 名称 / mtime 时间 / manual 手动
  style: 'frosted',       // 面板背景样式：frosted 毛玻璃 / liquid 液态玻璃 / none 半透明无模糊
  bgOpacity: 0.32,        // 面板底色不透明度（鼠标悬停展开时）
  idleOpacity: 0.28,      // 空闲（鼠标离开）时的整体不透明度（毛玻璃态）
  autoIdle: true,         // 空闲自动转半透明毛玻璃
  mirror: true,           // 面板镜像倒影
  mirrorOpacity: 25,      // 倒影强度 %
  brightness: 100,        // 亮度 %（100 = 原样）
  contrast: 100,          // 对比度 %
  saturate: 100,          // 饱和度 %
  opacity: 100,           // 整体不透明度 %
  items: [],              // [{name, path, type:'file'|'folder', originPath?, boxPath?}]
};
// 收纳范围由 box-rules.js 统一裁定：转盘拿快捷方式与程序，其余文件全归这里。
// （旧版这里是一份办公文档扩展名白名单 —— 0 字节 / 无扩展名 / 白名单外的
//   真实用户文件因此"一键收纳"收不进去，现改为黑名单式排除。）
const CLAMP_KEEP_W = 56;
const CLAMP_KEEP_H = 28;

class FileBoxHost {
  /** @param {import('./store').Store} store */
  constructor(store) {
    this.store = store;
    this.win = null;
    this.hwnd = 0;
    this.rects = [];
    this.interacting = false;
    this.adjusting = false;
    this.inputOn = false;
    this.grabOff = { dx: 0, dy: 0 };
    this.pollTimer = null;
    this.onChanged = null;
    this.onAdjustState = null;
    this.onCreateJob = null;
    this._ipcRegistered = false;
    // 文件保管目录（普通文件收纳后移入此处，文件夹仅登记路径不移动）。
    // v1.12.0 起位于应用根目录的可见文件夹（开发态=项目根，安装态=安装目录），
    // 默认为空、收纳时文件才移入；升级/卸载保护见 build/installer.nsh。
    this.boxDir = path.join(getAppRoot(app), FILEBOX_BOX_DIRNAME);
    try { fs.mkdirSync(this.boxDir, { recursive: true }); } catch (_) {}
    console.log(`[filebox] 文件收纳目录: ${this.boxDir} · 桌面目录: ${app.getPath('desktop')}`);
    try { icons.init(app.getPath('userData')); } catch (_) {}
    this._purgeGhostItems();
    this._registerIpc();
  }

  get cfg() {
    const saved = this.store.settings.filebox || {};
    return { ...DEFAULTS, ...saved, items: saved.items || [] };
  }

  /** 启动净化：清理指向不存在文件的幽灵项（文件已被移回桌面但记录残留） */
  _purgeGhostItems() {
    try {
      const cfg = this.cfg;
      const list = (cfg.items || []).filter((it) => {
        if (!it) return false;
        if (it.type === 'folder') return it.path && fs.existsSync(it.path);
        if (!it.path || !fs.existsSync(it.path)) return false;
        return !isJunkName(it.path);
      });
      if (list.length !== (cfg.items || []).length) {
        this.store.updateSettings({ filebox: { ...cfg, items: list } });
        console.log(`[filebox] 已清理 ${(cfg.items || []).length - list.length} 个幽灵项`);
      }
    } catch (_) {}
  }

  /**
   * 新增收纳条目落库：以「当前最新配置」为基准合并，绝不整体覆盖写回。
   * 收纳是逐个让出事件循环的批处理，期间用户再点一次即另起一批；旧实现把批次
   * 开始时的快照在结束时整体写回，后完成的一批会盖掉先完成那批的记录 ——
   * 文件已躺在保管目录、清单却是空的（列表什么都没有、"全部恢复"无事可做）。
   */
  _commitItems(added) {
    if (!added || !added.length) return;
    const cur = this.cfg;
    const items = [...(cur.items || [])];
    const seen = new Set();
    for (const it of items) { if (it.path) seen.add(it.path); if (it.originPath) seen.add(it.originPath); }
    let merged = 0;
    for (const it of added) {
      if (seen.has(it.path) || (it.originPath && seen.has(it.originPath))) continue;
      items.push(it);
      seen.add(it.path);
      if (it.originPath) seen.add(it.originPath);
      merged++;
    }
    if (merged) this.applyPatch({ items });
  }

  /**
   * 保管目录中「清单未引用」的失联内容 → 恢复到桌面根目录。
   * 清单与保管目录正常永远同步，出现失联即记录曾丢失（历史并发覆盖写回）。
   * 启动自愈（repair.js）做同一件事，这里让「全部恢复到桌面」当场就能找回。
   */
  _restoreOrphans() {
    const referenced = new Set();
    for (const it of this.cfg.items || []) {
      if (it.boxPath) referenced.add(path.resolve(it.boxPath).toLowerCase());
      if (it.path) referenced.add(path.resolve(it.path).toLowerCase());
    }
    const desktopDir = app.getPath('desktop');
    let moved = 0;
    let entries = [];
    try { entries = fs.readdirSync(this.boxDir, { withFileTypes: true }); } catch (_) { return 0; }
    for (const e of entries) {
      if (isJunkName(e.name) || isBoxSkipName(e.name)) continue;
      const src = path.join(this.boxDir, e.name);
      if (referenced.has(path.resolve(src).toLowerCase())) continue;
      if (this._moveFile(src, this._restorePathFor(path.join(desktopDir, e.name)))) moved++;
    }
    if (moved) console.log(`[filebox] 保管目录 ${moved} 个失联文件已恢复到桌面`);
    return moved;
  }

  /** 保管目录中不冲突的文件名（同名加序号） */
  _boxPathFor(fileName) {
    let p = path.join(this.boxDir, fileName);
    if (!fs.existsSync(p)) return p;
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    for (let i = 2; i < 100; i++) {
      p = path.join(this.boxDir, `${base} (${i})${ext}`);
      if (!fs.existsSync(p)) return p;
    }
    return path.join(this.boxDir, `${base}-${Date.now()}${ext}`);
  }

  /** 移动文件/空目录（桌面 ⇄ 保管目录），复用 launcher 的三级降级策略 */
  _moveFile(src, dst) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) return false;
      if (!fs.existsSync(src)) return false;
      const isDir = fs.statSync(src).isDirectory();
      const copy = () => {
        if (isDir) fs.cpSync(src, dst, { recursive: true });
        else fs.copyFileSync(src, dst);
        return fs.existsSync(dst);
      };
      const removeSrc = () => {
        if (isDir) { fs.rmSync(src, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 }); return; }
        try { fs.unlinkSync(src); }
        catch (_) { try { fs.rmSync(src, { force: true, maxRetries: 10, retryDelay: 150 }); } catch (_2) {} }
      };
      try { fs.renameSync(src, dst); if (fs.existsSync(dst)) return true; } catch (_) {}
      if (desktop.shellMoveFile(src, dst)) {
        if (fs.existsSync(dst) && !fs.existsSync(src)) return true;
      }
      let copied = false;
      try { copied = copy(); } catch (_) { copied = false; }
      if (!copied) {
        if (!desktop.shellCopyFile(src, dst)) return false;
        copied = fs.existsSync(dst);
        if (!copied) return false;
      }
      if (desktop.shellDeleteFile(src)) return true;
      removeSrc();
      if (!fs.existsSync(src)) return true;
      try { fs.rmSync(dst, { force: true, recursive: true }); } catch (_) {}
      return false;
    } catch (_) {
      return false;
    }
  }

  _restorePathFor(originPath) {
    if (!fs.existsSync(originPath)) return originPath;
    const ext = path.extname(originPath);
    const base = path.basename(originPath, ext);
    const dir = path.dirname(originPath);
    for (let i = 2; i < 100; i++) {
      const p = path.join(dir, `${base} (${i})${ext}`);
      if (!fs.existsSync(p)) return p;
    }
    return path.join(dir, `${base}-${Date.now()}${ext}`);
  }

  /** 应用配置。关闭功能 = 恢复全部收纳文件并清空收纳区 */
  applyPatch(patch) {
    const cur = this.cfg;
    const wasEnabled = !!cur.enabled;
    const next = { ...cur, ...patch };
    if (patch.items === undefined) next.items = cur.items;
    if (Object.prototype.hasOwnProperty.call(patch, 'grid')) {
      next.grid = patch.grid || null;
      next.x = null;
      next.y = null;
    }
    if (wasEnabled && next.enabled === false) {
      // 关闭功能：收纳的文件/空文件夹移回桌面原位置（恢复显示），收纳区清空。
      // 失败项保留记录（实体仍在保管目录），下次"全部恢复"可重试；
      // 仅登记引用的非空文件夹本就未动过，直接移除记录即可。
      const { remaining } = this._restoreAll();
      const failedSet = new Set(remaining.map((b) => b.boxPath));
      next.items = next.items.filter((it) => !!it.boxPath && failedSet.has(it.boxPath));
    }
    this.store.updateSettings({ filebox: next });
    if (next.enabled && !this.win) {
      this._createAsync();
    } else if (!next.enabled && this.win) {
      this.destroy();
    } else if (this.win) {
      this.pushConfig();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'grid') && this.win && !this.win.isDestroyed() && this.hwnd) {
      this._applyGrid(next.grid);
    }
    if (this.onChanged) this.onChanged();
    // 收纳内容镜像备份（双保险）：任何收纳/恢复/移除落定后防抖同步
    scheduleMirrorSync(app);
  }

  setEnabled(on) { this.applyPatch({ enabled: !!on }); }

  // ---------- 窗口生命周期 ----------

  create() {
    if (this.win && !this.win.isDestroyed()) return;
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    this.win = new BrowserWindow({
      width: 560, height: 220,
      x: primary.workArea.x + 40, y: primary.workArea.y + 40,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-filebox.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'filebox.html'));
    this.win.once('ready-to-show', () => {
      if (!this.win || this.win.isDestroyed()) return;
      this.hwnd = Number(this.win.getNativeWindowHandle().readBigInt64LE(0));
      desktop.attachLauncherOverlay(this.hwnd);
      this._placeDefault(560, 220);
      this.win.showInactive();
      this.shownOnce = true;
      this.win.setIgnoreMouseEvents(true);
      this.inputOn = false;
      const repaint = () => { try { if (this.win && !this.win.isDestroyed()) this.win.webContents.invalidate(); } catch (_) {} };
      repaint();
      for (const ms of [200, 600, 1500, 3000]) setTimeout(repaint, ms);
      console.log(`[filebox] 文件收纳区已嵌入桌面 hwnd=${this.hwnd}`);
      setTimeout(() => { if (this.hwnd) desktop.ensureLauncherOverlay(this.hwnd); }, 1500);
    });
    this.win.on('closed', () => {
      const wasAdjusting = this.adjusting;
      this.win = null;
      this.hwnd = 0;
      this.rects = [];
      this.interacting = false;
      this.adjusting = false;
      this._stopPolling();
      // 覆盖层销毁（关掉收纳区 / 重建合成带）也要回传退出，否则客户端透视持有者永不释放
      if (wasAdjusting && this.onAdjustState) this.onAdjustState(false);
    });
    this._startPolling();
  }

  destroy() {
    if (this.win && !this.win.isDestroyed()) this.win.close();
    this.win = null;
    this.hwnd = 0;
    this._stopPolling();
  }

  _captureHasContent(img) {
    try {
      const { width, height } = img.getSize();
      const buf = img.getBitmap();
      const n = width * height;
      for (let i = 0; i < n; i += 5) {
        if (buf[i * 4 + 3] !== 0) return true;
      }
    } catch (_) {}
    return false;
  }

  whenSettled(timeoutMs = 3000) {
    if (!this.cfg.enabled) return Promise.resolve();
    const deadline = Date.now() + timeoutMs;
    const waitShown = new Promise((resolve) => {
      const tick = () => {
        if (this.shownOnce || !this.win || this.win.isDestroyed() || Date.now() > deadline) return resolve();
        setTimeout(tick, 60);
      };
      tick();
    });
    return waitShown.then(() => {
      if (!this.win || this.win.isDestroyed()) return;
      const attempt = () => {
        if (!this.win || this.win.isDestroyed() || Date.now() > deadline) return;
        return this.win.webContents.capturePage().then((img) => {
          if (this._captureHasContent(img)) return;
          return new Promise((r) => setTimeout(r, 80)).then(attempt);
        }).catch(() => {});
      };
      return attempt();
    });
  }

  async _createAsync() {
    const job = async () => {
      this.create();
      await this.whenSettled(5000);
    };
    if (this.onCreateJob) await this.onCreateJob(job);
    else await job();
  }

  watchdog() {
    if (!this.cfg.enabled) return;
    if (!this.win || this.win.isDestroyed()) {
      this._createAsync();
      return;
    }
    if (this.hwnd) desktop.ensureLauncherOverlay(this.hwnd);
  }

  repaint() {
    try {
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.invalidate();
        if (this.hwnd) desktop.nudgeWindow(this.hwnd);
      }
    } catch (_) {}
  }

  onDisplayChange() {
    if (!this.hwnd) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!r) return;
    if (this.cfg.grid) {
      this._applyGrid(this.cfg.grid);
    } else if (this.cfg.x === null) {
      this._placeDefault(r.w, r.h);
    } else {
      const pos = this._clamp(r.x, r.y, r.w, r.h);
      desktop.moveWindowToScreen(this.hwnd, pos.x, pos.y);
    }
  }

  // ---------- 图标提取 ----------

  async _iconFor(it) {
    await new Promise((r) => setImmediate(r));
    try {
      if (it && it.path) {
        const url = icons.getIconDataUrl(it.path);
        if (url) return url;
      }
    } catch (_) {}
    try {
      const img = await app.getFileIcon(it.path, { size: 'large' });
      return img && !img.isEmpty() ? img.toDataURL() : null;
    } catch (_) {
      return null;
    }
  }

  async pushConfig() {
    if (!this.win || this.win.isDestroyed()) return;
    const cfg = this.cfg;
    const items = [];
    for (const it of cfg.items || []) {
      const icon = await this._iconFor(it);
      items.push({ name: it.name, path: it.path, type: it.type, icon, mtime: it.mtime || 0 });
    }
    try {
      this.win.webContents.send('filebox:config', {
        enabled: cfg.enabled,
        gridCols: cfg.gridCols,
        groupBy: cfg.groupBy,
        style: ['frosted', 'liquid', 'none'].includes(cfg.style) ? cfg.style : 'frosted',
        bgOpacity: cfg.bgOpacity ?? 0.32,
        idleOpacity: cfg.idleOpacity ?? 0.28,
        autoIdle: !!cfg.autoIdle,
        mirror: cfg.mirror !== false,
        mirrorOpacity: Number.isFinite(cfg.mirrorOpacity) ? cfg.mirrorOpacity : 25,
        brightness: Number.isFinite(cfg.brightness) ? cfg.brightness : 100,
        contrast: Number.isFinite(cfg.contrast) ? cfg.contrast : 100,
        saturate: Number.isFinite(cfg.saturate) ? cfg.saturate : 100,
        opacity: Number.isFinite(cfg.opacity) ? cfg.opacity : 100,
        items,
      });
    } catch (_) {}
  }

  // ---------- 尺寸/定位 ----------

  _applyMetrics(m) {
    if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
    if (!m || !(m.w > 0) || !(m.h > 0)) return;
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    const w = Math.round(m.w * sf);
    const h = Math.round(m.h * sf);
    const old = desktop.getWindowRectScreen(this.hwnd);
    if (!old) return;
    if (this.cfg.x === null) {
      if (this.cfg.grid) {
        desktop.resizeWindowToScreen(this.hwnd, old.x, old.y, w, h);
        this._applyGrid(this.cfg.grid);
      } else {
        this._placeDefault(w, h);
      }
    } else {
      const pos = this._clamp(old.x, old.y, w, h);
      desktop.resizeWindowToScreen(this.hwnd, pos.x, pos.y, w, h);
    }
  }

  _placeDefault(w, h) {
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    const wa = {
      x: Math.round(primary.workArea.x * sf),
      y: Math.round(primary.workArea.y * sf),
      w: Math.round(primary.workArea.width * sf),
      h: Math.round(primary.workArea.height * sf),
    };
    const x = wa.x + Math.round((wa.w - w) / 2);
    const y = wa.y + wa.h - h - Math.round(14 * sf);
    desktop.resizeWindowToScreen(this.hwnd, x, y, w, h);
  }

  _applyGrid(cell) {
    if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!r) return;
    if (!cell) { this._placeDefault(r.w, r.h); return; }
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    const m = Math.round(14 * sf);
    const wx = Math.round(primary.workArea.x * sf);
    const wy = Math.round(primary.workArea.y * sf);
    const ww = Math.round(primary.workArea.width * sf);
    const wh = Math.round(primary.workArea.height * sf);
    const row = cell[0], col = cell[1];
    const x = col === 'l' ? wx + m : col === 'r' ? wx + ww - r.w - m : wx + Math.round((ww - r.w) / 2);
    const y = row === 't' ? wy + m : row === 'b' ? wy + wh - r.h - m : wy + Math.round((wh - r.h) / 2);
    desktop.moveWindowToScreen(this.hwnd, x, y);
  }

  _clamp(x, y, w, h) {
    const vd = desktop.getDesktopRect();
    return {
      x: Math.min(Math.max(x, vd.x - w + CLAMP_KEEP_W), vd.x + vd.width - CLAMP_KEEP_W),
      y: Math.min(Math.max(y, vd.y - h + CLAMP_KEEP_H), vd.y + vd.height - CLAMP_KEEP_H),
    };
  }

  // ---------- 输入轮询 ----------

  _startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
      const hit = this.adjusting || this.interacting || desktop.cursorInRects(this.hwnd, this.rects);
      if (hit !== this.inputOn) {
        this.inputOn = hit;
        try { this.win.setIgnoreMouseEvents(!hit); } catch (_) {}
        try { this.win.webContents.send('filebox:hover', hit); } catch (_) {}
      }
    }, 30);
  }

  _stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.inputOn = false;
  }

  // ---------- 调整模式 ----------

  setAdjust(on) {
    if (!this.win || this.win.isDestroyed()) return false;
    this.adjusting = !!on;
    this.win.setIgnoreMouseEvents(!this.adjusting);
    this.win.webContents.send('filebox:adjust-mode', { on: this.adjusting });
    console.log(`[filebox] 调整模式${this.adjusting ? '开启' : '关闭'}`);
    if (this.onAdjustState) this.onAdjustState(this.adjusting);
    return this.adjusting;
  }

  // ---------- 拖动 ----------

  _dragStart() {
    if (!this.hwnd) return;
    const cur = desktop.getCursorPos();
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!cur || !r) return;
    this.grabOff = { dx: cur.x - r.x, dy: cur.y - r.y };
    this.interacting = true;
  }

  _dragMove() {
    if (!this.hwnd || !this.interacting) return;
    const cur = desktop.getCursorPos();
    if (!cur) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!r) return;
    const pos = this._clamp(cur.x - this.grabOff.dx, cur.y - this.grabOff.dy, r.w, r.h);
    desktop.moveWindowToScreen(this.hwnd, pos.x, pos.y);
  }

  _dragEnd() {
    this.interacting = false;
    if (this.hwnd) {
      const r = desktop.getWindowRectScreen(this.hwnd);
      if (r) {
        const cfg = this.cfg;
        if (cfg.x !== r.x || cfg.y !== r.y || cfg.grid != null) {
          this.store.updateSettings({ filebox: { ...cfg, x: r.x, y: r.y, grid: null } });
          if (this.onChanged) this.onChanged();
        }
      }
    }
    if (this.adjusting) this.setAdjust(false);
  }

  // ---------- 收纳/启动 ----------

  /** 添加文件/文件夹收纳（文件选择对话框，含文件夹选择） */
  async _addItems() {
    const res = await dialog.showOpenDialog(this.win && !this.win.isDestroyed() ? this.win : undefined, {
      title: '选择要收纳的文件或文件夹',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: '所有文件与文件夹', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return 0;
    return this._ingestPaths(res.filePaths);
  }

  /** 把一批路径收纳进保管区（文件对话框与桌面拖拽共用） */
  async _ingestPaths(filePaths) {
    const added = [];
    for (const p of filePaths || []) {
      await new Promise((r) => setImmediate(r));
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      const mtime = st.mtimeMs || 0;
      const name = path.basename(p);
      if (st.isDirectory()) {
        // 空文件夹：整体移入保管目录（里面没有内容，移动零风险，桌面图标随之消失）
        if (isEmptyDir(p)) {
          const boxPath = this._boxPathFor(name);
          if (this._moveFile(p, boxPath)) {
            added.push({ name, path: boxPath, type: 'folder', originPath: p, boxPath, mtime });
            continue;
          }
        }
        // 非空文件夹 / 搬不动：仅登记路径引用，不碰用户内容
        added.push({ name, path: p, type: 'folder', mtime });
      } else {
        // 普通文件：移动到保管目录（任意类型，含 0 字节与无扩展名）
        const ext = path.extname(p);
        const boxPath = this._boxPathFor(name);
        if (!this._moveFile(p, boxPath)) {
          // 移动失败（可能是磁盘根目录等）：退化为仅登记路径引用
          added.push({ name: path.basename(p, ext), path: p, type: 'file', mtime });
        } else {
          added.push({ name: path.basename(p, ext), path: boxPath, type: 'file', originPath: p, boxPath, mtime });
        }
      }
    }
    if (added.length) {
      this._commitItems(added);
      desktop.notifyShellIconRefresh();
    }
    return added.length;
  }

  /** 一键收纳桌面全部文件与文件夹（连点复用同一次执行，见 _boxAll 注释） */
  boxAll() {
    if (this._boxAllJob) return this._boxAllJob;
    this._boxAllJob = this._boxAll().finally(() => { this._boxAllJob = null; });
    return this._boxAllJob;
  }

  async _boxAll() {
    const cfg = this.cfg;
    // 已在清单里的桌面路径不重复处理（登记型文件夹仍留在桌面，会被反复扫到）
    const handled = new Set();
    for (const it of cfg.items || []) {
      if (it.originPath) handled.add(it.originPath);
      if (it.path) handled.add(it.path);
    }
    const added = [];
    let files = 0, folders = 0;
    const desktopDir = app.getPath('desktop');
    for (const f of fs.readdirSync(desktopDir, { withFileTypes: true })) {
      await new Promise((r) => setImmediate(r));
      const p = path.join(desktopDir, f.name);
      if (handled.has(p)) continue;
      if (isJunkName(f.name) || isBoxSkipName(f.name)) continue;
      if (f.isDirectory()) {
        let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) {}
        // 空文件夹整体移入保管目录；非空文件夹只登记引用（不搬用户内容）
        const boxPath = isEmptyDir(p) ? this._boxPathFor(f.name) : null;
        if (boxPath && this._moveFile(p, boxPath)) {
          added.push({ name: f.name, path: boxPath, type: 'folder', originPath: p, boxPath, mtime });
        } else {
          added.push({ name: f.name, path: p, type: 'folder', mtime });
        }
        folders++;
        continue;
      }
      if (isLauncherItem(p)) continue; // 快捷方式与程序文件归转盘收纳
      let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) {}
      const ext = path.extname(f.name);
      const boxPath = this._boxPathFor(f.name);
      if (this._moveFile(p, boxPath)) {
        added.push({ name: path.basename(f.name, ext), path: boxPath, type: 'file', originPath: p, boxPath, mtime });
      } else {
        added.push({ name: path.basename(f.name, ext), path: p, type: 'file', mtime });
      }
      files++;
    }
    const done = added.length;
    if (done) {
      this._commitItems(added);
      desktop.notifyShellIconRefresh();
    }
    console.log(`[filebox] 一键收纳全部: ${done} 个（文件 ${files} / 文件夹 ${folders}）`);
    if (this.onChanged) this.onChanged({ picked: done });
    return { ok: true, boxed: done, files, folders };
  }

  _removeAt(idx) {
    const cfg = this.cfg;
    const list = [...(cfg.items || [])];
    if (idx < 0 || idx >= list.length) return;
    const [removed] = list.splice(idx, 1);
    // 有 boxPath = 实体被移进过保管目录（普通文件与空文件夹同理），必须搬回去
    if (removed && removed.boxPath && fs.existsSync(removed.boxPath)) {
      const dst = this._restorePathFor(removed.originPath);
      if (this._moveFile(removed.boxPath, dst)) {
        console.log(`[filebox] 已恢复到桌面: ${removed.name}`);
        desktop.notifyShellIconRefresh([dst]);
      } else {
        console.warn(`[filebox] 恢复失败（文件保留在保管目录）: ${removed.name}`);
      }
    }
    this.applyPatch({ items: list });
  }

  _restoreAll() {
    const cfg = this.cfg;
    let restored = 0, failed = 0;
    const remaining = [];
    const restoredPaths = [];
    for (const it of cfg.items || []) {
      if (!it.boxPath) continue;              // 仅登记的文件夹 / 未移动过的文件：无实体要搬
      if (!fs.existsSync(it.boxPath)) continue;
      const dst = this._restorePathFor(it.originPath);
      if (this._moveFile(it.boxPath, dst)) {
        restored++;
        restoredPaths.push(dst);
      } else {
        failed++;
        remaining.push(it);
      }
    }
    // 清单没记、但确实躺在保管目录里的历史失联项一并带回桌面（不必等下次启动自愈）
    const orphans = failed ? 0 : this._restoreOrphans();
    if ((cfg.items || []).length || orphans) {
      console.log(`[filebox] 恢复全部收纳项: 成功 ${restored} 失败 ${failed} 失联 ${orphans}`);
    }
    if (restored) desktop.notifyShellIconRefresh(restoredPaths);
    return { restored, failed, orphans, remaining };
  }

  _launch(idx) {
    const it = (this.cfg.items || [])[idx];
    if (!it || !it.path) return;
    console.log(`[filebox] 打开: ${it.name} ← ${it.path} (type=${it.type})`);
    shell.openPath(it.path).then((err) => {
      if (!err) return;
      console.warn(`[filebox] openPath 失败(${err})，改用 explorer 兜底: ${it.path}`);
      try {
        require('child_process').exec(
          `explorer.exe "${it.path}"`,
          { windowsHide: true, timeout: 8000 },
          (e) => { if (e) console.warn(`[filebox] 兜底打开也失败: ${it.path}`, e.message); }
        );
      } catch (_) {}
    });
  }

  // ---------- IPC ----------

  _registerIpc() {
    if (this._ipcRegistered) return;
    this._ipcRegistered = true;

    ipcMain.on('filebox:ready', () => this.pushConfig());
    ipcMain.on('filebox:metrics', (_e, m) => this._applyMetrics(m));
    ipcMain.on('filebox:report-rects', (_e, rects) => {
      this.rects = Array.isArray(rects) ? rects : [];
    });
    ipcMain.on('filebox:set-interacting', (_e, v) => { this.interacting = !!v; });
    ipcMain.on('filebox:drag-start', () => this._dragStart());
    ipcMain.on('filebox:drag-move', () => this._dragMove());
    ipcMain.on('filebox:drag-end', () => this._dragEnd());
    ipcMain.on('filebox:launch', (_e, idx) => this._launch(idx));
    ipcMain.on('filebox:remove', (_e, idx) => this._removeAt(idx));
    ipcMain.handle('filebox:add', async () => {
      const n = await this._addItems();
      return { ok: true, added: n };
    });
    ipcMain.handle('filebox:drop-paths', async (_e, paths) => {
      const arr = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
      const n = arr.length ? await this._ingestPaths(arr) : 0;
      return { ok: true, added: n };
    });
    ipcMain.handle('filebox:box-all', () => this.boxAll());
    ipcMain.handle('filebox:remove-at', (_e, idx) => {
      this._removeAt(idx);
      return { ok: true };
    });
    ipcMain.handle('filebox:restore-all', () => {
      const { restored, failed, orphans, remaining } = this._restoreAll();
      const failedSet = new Set(remaining.map((b) => b.boxPath));
      this.applyPatch({
        items: (this.cfg.items || []).filter((it) => !!it.boxPath && failedSet.has(it.boxPath)),
      });
      return { ok: true, restored, failed, orphans };
    });
    ipcMain.handle('filebox:get', async () => {
      const cfg = this.cfg;
      const items = [];
      for (const it of cfg.items || []) {
        const icon = await this._iconFor(it);
        items.push({ ...it, icon });
      }
      return { ...cfg, items };
    });
  }
}

module.exports = { FileBoxHost };
