// filebox.js — 桌面「文件收纳区」宿主（主进程侧）
//
// 从快捷方式转盘（launcher.js）拆分出的独立文件收纳能力：
// - 收纳对象：普通文件（办公文档 / 程序 / 任意文件）与文件夹；
//   （快捷方式 .lnk/.url 与系统项仍归转盘负责，两者职责分离）
// - 独立小窗口挂在桌面图标层之上、普通窗口之下，不遮挡壁纸观感；
// - 网格平铺展示图标（非转盘轮换）：文件夹与文件各自分类排列，
//   用户可在设置页自定义排序（手动 / 名称 / 类型 / 时间）；
// - 真实图标：复用 icons.js（Win32 SHGetFileInfoW），文件夹/文件类型
//   图标均取系统真实图标，不落空白占位；
// - 毛玻璃空闲态：鼠标靠近正常显示图标，离开一段时间后整体转为
//   半透明毛玻璃胶囊（不打扰壁纸观看，与壁纸协调）；
// - 文件收纳 = 移动到应用数据保管目录（桌面原位置隐藏，可恢复）；
//   文件夹收纳 = 仅登记路径引用（不移动文件夹本身，点开进入文件夹）。
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
// 可收纳的文件扩展名（办公文档 + 媒体 + 归档等普通文件；
// 快捷方式 .lnk/.url 与程序 .exe/.bat/.cmd 归转盘负责，不在此收纳）
const FILE_EXTS = [
  '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.pdf', '.txt', '.md', '.csv',
  '.zip', '.rar', '.7z', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.mkv',
  '.mp3', '.flac', '.wav', '.html', '.htm', '.json', '.xml', '.sql',
];
const ALL_FILE_EXTS = FILE_EXTS.map((e) => e.toLowerCase());
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
        const b = path.basename(String(it.path || ''));
        return !b.startsWith('._') && !b.startsWith('~$');
      });
      if (list.length !== (cfg.items || []).length) {
        this.store.updateSettings({ filebox: { ...cfg, items: list } });
        console.log(`[filebox] 已清理 ${(cfg.items || []).length - list.length} 个幽灵项`);
      }
    } catch (_) {}
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

  /** 移动文件（桌面 ⇄ 保管目录），复用 launcher 的三级降级策略 */
  _moveFile(src, dst) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) return false;
      if (!fs.existsSync(src)) return false;
      try { fs.renameSync(src, dst); if (fs.existsSync(dst)) return true; } catch (_) {}
      if (desktop.shellMoveFile(src, dst)) {
        if (fs.existsSync(dst) && !fs.existsSync(src)) return true;
      }
      let copied = false;
      try { fs.copyFileSync(src, dst); copied = fs.existsSync(dst); } catch (_) { copied = false; }
      if (!copied) {
        if (!desktop.shellCopyFile(src, dst)) return false;
        copied = fs.existsSync(dst);
        if (!copied) return false;
      }
      if (desktop.shellDeleteFile(src)) return true;
      try { fs.unlinkSync(src); }
      catch (_) { try { fs.rmSync(src, { force: true, maxRetries: 10, retryDelay: 150 }); } catch (_) {} }
      if (!fs.existsSync(src)) return true;
      try { fs.rmSync(dst, { force: true }); } catch (_) {}
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
      // 关闭功能：收纳的文件移回桌面原位置（恢复显示），收纳区清空。
      // 失败项保留记录（文件仍在保管目录），下次"全部恢复"可重试；
      // 文件夹项本就未移动，直接移除记录即可。
      const { remaining } = this._restoreAll();
      const failedSet = new Set(remaining.map((b) => b.boxPath));
      next.items = next.items.filter((it) => {
        if (it.type === 'folder') return false;           // 文件夹：移除记录
        if (!it.boxPath) return false;                    // 未移动过的文件：移除记录
        return failedSet.has(it.boxPath);                 // 恢复失败：保留记录供重试
      });
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
      this.win = null;
      this.hwnd = 0;
      this.rects = [];
      this.interacting = false;
      this.adjusting = false;
      this._stopPolling();
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
    const cfg = this.cfg;
    const exist = new Set((cfg.items || []).map((i) => i.path));
    const items = [...(cfg.items || [])];
    let added = 0;
    for (const p of filePaths || []) {
      await new Promise((r) => setImmediate(r));
      if (exist.has(p)) continue;
      let st;
      try { st = fs.statSync(p); } catch (_) { continue; }
      const mtime = st.mtimeMs || 0;
      if (st.isDirectory()) {
        // 文件夹：仅登记路径引用，不移动
        items.push({ name: path.basename(p), path: p, type: 'folder', mtime });
        exist.add(p);
        added++;
      } else {
        // 普通文件：移动到保管目录（桌面原位置隐藏，可恢复）
        const ext = path.extname(p).toLowerCase();
        const boxPath = this._boxPathFor(path.basename(p));
        if (!this._moveFile(p, boxPath)) {
          // 移动失败（可能是磁盘根目录等）：退化为仅登记路径引用
          items.push({ name: path.basename(p, ext), path: p, type: 'file', mtime });
        } else {
          items.push({ name: path.basename(p, ext), path: boxPath, type: 'file', originPath: p, boxPath, mtime });
        }
        exist.add(p);
        added++;
      }
    }
    if (added) {
      this.applyPatch({ items });
      desktop.notifyShellIconRefresh();
    }
    return added;
  }

  /** 一键收纳桌面全部普通文件 + 文件夹 */
  async boxAll() {
    const cfg = this.cfg;
    const items = [...(cfg.items || [])];
    const existPaths = new Set(items.map((i) => i.path));
    let done = 0, files = 0, folders = 0;
    const desktopDir = app.getPath('desktop');
    for (const f of fs.readdirSync(desktopDir, { withFileTypes: true })) {
      await new Promise((r) => setImmediate(r));
      const p = path.join(desktopDir, f.name);
      if (existPaths.has(p)) continue;
      if (f.name.startsWith('._') || f.name.startsWith('~$')) continue;
      if (f.isDirectory()) {
        let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) {}
        items.push({ name: f.name, path: p, type: 'folder', mtime });
        existPaths.add(p);
        folders++; done++;
        continue;
      }
      const ext = path.extname(f.name).toLowerCase();
      if (!ALL_FILE_EXTS.includes(ext)) continue;
      let mtime = 0; try { mtime = fs.statSync(p).mtimeMs || 0; } catch (_) {}
      const boxPath = this._boxPathFor(f.name);
      if (this._moveFile(p, boxPath)) {
        items.push({ name: path.basename(f.name, ext), path: boxPath, type: 'file', originPath: p, boxPath, mtime });
      } else {
        items.push({ name: path.basename(f.name, ext), path: p, type: 'file', mtime });
      }
      existPaths.add(p);
      files++; done++;
    }
    if (done) {
      this.applyPatch({ items });
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
    if (removed && removed.type === 'file' && removed.boxPath && fs.existsSync(removed.boxPath)) {
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
      if (it.type !== 'file' || !it.boxPath) continue;
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
    if (restored) desktop.notifyShellIconRefresh(restoredPaths);
    return { restored, failed, remaining };
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
      const { restored, failed, remaining } = this._restoreAll();
      const failedSet = new Set(remaining.map((b) => b.boxPath));
      this.applyPatch({
        items: (this.cfg.items || []).filter((it) => {
          if (it.type === 'folder') return false;          // 文件夹：移除记录
          if (!it.boxPath) return false;                   // 未移动过的文件：移除记录
          return failedSet.has(it.boxPath);                // 恢复失败：保留记录供重试
        }),
      });
      return { ok: true, restored, failed };
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
