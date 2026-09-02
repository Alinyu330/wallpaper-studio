// launcher.js — 桌面 App 快捷方式转盘（主进程侧宿主）
//
// 实现「Wallpaper Engine 式」的桌面快捷方式收纳：
// - 独立小窗口挂在桌面图标层(SHELLDLL_DefView)之上、普通窗口之下 ——
//   桌面上可直接点击启动应用，又不遮挡任何程序窗口、不影响壁纸观感；
// - 图标条 + 拖动条：按住拖动即像转盘一样轮换快捷方式（转盘交互在
//   renderer/launcher.html 内实现）；
// - 位置自由摆放（拖动左侧手柄）、同屏数量可自定义（设置页 4~12）；
// - 空闲自动收起为小胶囊，鼠标悬停展开（输入开关由主进程光标轮询驱动，
//   与桌面组件同款方案：默认整窗鼠标穿透，光标进入可交互矩形才可点击）。
//
// 尺寸约定：窗口物理尺寸由渲染页实测上报（launcher:metrics），
// 主进程用物理像素 MoveWindow 调整 —— 避免两端各维护一套布局算法。
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('path');
const desktop = require('./desktop');

const DEFAULTS = { enabled: false, x: null, y: null, count: 8, autoCollapse: true, shortcuts: [] };
const CLAMP_KEEP_W = 56;  // 拖动出屏时至少保留的可视宽度（物理像素）
const CLAMP_KEEP_H = 28;

class LauncherHost {
  /** @param {import('./store').Store} store */
  constructor(store) {
    this.store = store;
    this.win = null;
    this.hwnd = 0;
    this.rects = [];          // 可交互矩形（物理像素，相对窗口客户区）
    this.interacting = false; // 拖动窗口/交互中（保持可点击）
    this.inputOn = false;     // 当前窗口是否接收鼠标
    this.grabOff = { dx: 0, dy: 0 };
    this.pollTimer = null;
    this._ipcRegistered = false;
    this._registerIpc();
  }

  get cfg() {
    const saved = this.store.settings.launcher || {};
    return { ...DEFAULTS, ...saved };
  }

  /** 应用配置（设置页/托盘调用） */
  applyPatch(patch) {
    const cur = this.cfg;
    const next = { ...cur, ...patch };
    if (patch.shortcuts === undefined) next.shortcuts = cur.shortcuts;
    this.store.updateSettings({ launcher: next });
    if (next.enabled && !this.win) {
      this.create();
    } else if (!next.enabled && this.win) {
      this.destroy();
    } else if (this.win) {
      // 数量/快捷方式/收起开关变化 → 重建图标并推送（渲染页会重新上报尺寸）
      this.pushConfig();
    }
  }

  setEnabled(on) { this.applyPatch({ enabled: !!on }); }

  // ---------- 窗口生命周期 ----------

  create() {
    if (this.win && !this.win.isDestroyed()) return;
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    // 先给一个足够宽的初始尺寸供渲染页测量布局，实测后再收缩
    this.win = new BrowserWindow({
      width: 980, height: 150,
      x: primary.workArea.x + 40, y: primary.workArea.y + 40,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,   // 点击不抢焦点（不干扰当前操作）
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-launcher.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.win.loadFile(path.join(__dirname, '..', 'renderer', 'launcher.html'));
    this.win.once('ready-to-show', () => {
      if (!this.win || this.win.isDestroyed()) return;
      this.win.showInactive();
      this.hwnd = Number(this.win.getNativeWindowHandle().readBigInt64LE(0));
      desktop.attachLauncherOverlay(this.hwnd);
      this.win.setIgnoreMouseEvents(true);
      this.inputOn = false;
      console.log(`[launcher] 快捷方式转盘已嵌入桌面（图标层之上）hwnd=${this.hwnd}`);
      setTimeout(() => { if (this.hwnd) desktop.ensureLauncherOverlay(this.hwnd); }, 1500);
    });
    this.win.on('closed', () => {
      this.win = null;
      this.hwnd = 0;
      this.rects = [];
      this.interacting = false;
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

  /** 看门狗（主进程 4s 调用）：保活 + 层级校正 */
  watchdog() {
    if (!this.cfg.enabled) return;
    if (!this.win || this.win.isDestroyed()) {
      this.create();
      return;
    }
    if (this.hwnd) desktop.ensureLauncherOverlay(this.hwnd);
  }

  /** 分辨率/显示器变化：重新钳制位置（默认位置则重算底部居中） */
  onDisplayChange() {
    if (!this.hwnd) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!r) return;
    if (this.cfg.x === null) {
      this._placeDefault(r.w, r.h);
    } else {
      const pos = this._clamp(r.x, r.y, r.w, r.h);
      desktop.moveWindowToScreen(this.hwnd, pos.x, pos.y);
    }
  }

  // ---------- 配置/图标推送 ----------

  async pushConfig() {
    if (!this.win || this.win.isDestroyed()) return;
    const cfg = this.cfg;
    const shortcuts = [];
    for (const s of cfg.shortcuts || []) {
      let icon = null;
      try {
        const img = await app.getFileIcon(s.path, { size: 'large' });
        icon = img.toDataURL();
      } catch (_) {}
      shortcuts.push({ name: s.name, path: s.path, icon });
    }
    try {
      this.win.webContents.send('launcher:config', {
        enabled: cfg.enabled,
        count: cfg.count,
        autoCollapse: cfg.autoCollapse,
        shortcuts,
      });
    } catch (_) {}
  }

  // ---------- 内部：尺寸/定位 ----------

  /** 渲染页上报实测布局尺寸（CSS px）→ 物理像素调整窗口 */
  _applyMetrics(m) {
    if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
    if (!m || !(m.w > 0) || !(m.h > 0)) return;
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    const w = Math.round(m.w * sf);
    const h = Math.round(m.h * sf);
    const old = desktop.getWindowRectScreen(this.hwnd);
    if (!old) return;
    if (this.cfg.x === null) {
      this._placeDefault(w, h);
    } else {
      // 已有自定义位置：保持左上角并钳制到虚拟桌面内
      const pos = this._clamp(old.x, old.y, w, h);
      desktop.resizeWindowToScreen(this.hwnd, pos.x, pos.y, w, h);
    }
  }

  /** 默认位置：主显示器工作区底部居中（任务栏上方） */
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

  /** 钳制到虚拟桌面内（至少保留一角可见） */
  _clamp(x, y, w, h) {
    const vd = desktop.getDesktopRect();
    return {
      x: Math.min(Math.max(x, vd.x - w + CLAMP_KEEP_W), vd.x + vd.width - CLAMP_KEEP_W),
      y: Math.min(Math.max(y, vd.y - h + CLAMP_KEEP_H), vd.y + vd.height - CLAMP_KEEP_H),
    };
  }

  // ---------- 内部：输入轮询（穿透 ⇄ 可点击） ----------

  _startPolling() {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
      const hit = this.interacting || desktop.cursorInRects(this.hwnd, this.rects);
      if (hit !== this.inputOn) {
        this.inputOn = hit;
        try { this.win.setIgnoreMouseEvents(!hit); } catch (_) {}
        try { this.win.webContents.send('launcher:hover', hit); } catch (_) {}
      }
    }, 30);
  }

  _stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.inputOn = false;
  }

  // ---------- 内部：拖动移动窗口 ----------

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
    if (!this.hwnd) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (r) {
      const cfg = this.cfg;
      this.store.updateSettings({ launcher: { ...cfg, x: r.x, y: r.y } });
    }
  }

  // ---------- 内部：快捷方式增删/启动 ----------

  async _addShortcuts() {
    const res = await dialog.showOpenDialog(this.win && !this.win.isDestroyed() ? this.win : undefined, {
      title: '选择快捷方式（支持 .lnk / .exe / .url）',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '快捷方式与程序', extensions: ['lnk', 'exe', 'url', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return 0;
    const cfg = this.cfg;
    const exist = new Set((cfg.shortcuts || []).map(s => s.path));
    const added = res.filePaths
      .filter(p => !exist.has(p))
      .map(p => ({ name: path.basename(p).replace(/\.(lnk|exe|url|bat|cmd)$/i, ''), path: p }));
    if (added.length) this.applyPatch({ shortcuts: [...(cfg.shortcuts || []), ...added] });
    return added.length;
  }

  _removeAt(idx) {
    const cfg = this.cfg;
    const list = [...(cfg.shortcuts || [])];
    if (idx < 0 || idx >= list.length) return;
    list.splice(idx, 1);
    this.applyPatch({ shortcuts: list });
  }

  _launch(idx) {
    const s = (this.cfg.shortcuts || [])[idx];
    if (!s) return;
    shell.openPath(s.path).then((err) => {
      if (err) console.warn(`[launcher] 启动失败: ${s.path} — ${err}`);
    });
  }

  // ---------- IPC ----------

  _registerIpc() {
    if (this._ipcRegistered) return;
    this._ipcRegistered = true;

    ipcMain.on('launcher:ready', () => this.pushConfig());
    ipcMain.on('launcher:metrics', (_e, m) => this._applyMetrics(m));
    ipcMain.on('launcher:report-rects', (_e, rects) => {
      this.rects = Array.isArray(rects) ? rects : [];
    });
    ipcMain.on('launcher:set-interacting', (_e, v) => { this.interacting = !!v; });

    ipcMain.on('launcher:drag-start', () => this._dragStart());
    ipcMain.on('launcher:drag-move', () => this._dragMove());
    ipcMain.on('launcher:drag-end', () => this._dragEnd());

    ipcMain.on('launcher:launch', (_e, idx) => this._launch(idx));
    ipcMain.on('launcher:remove', (_e, idx) => this._removeAt(idx));
    ipcMain.handle('launcher:add', async () => {
      const n = await this._addShortcuts();
      return { ok: true, added: n };
    });
    ipcMain.handle('launcher:get', async () => {
      const cfg = this.cfg;
      const shortcuts = [];
      for (const s of cfg.shortcuts || []) {
        let icon = null;
        try { icon = (await app.getFileIcon(s.path, { size: 'normal' })).toDataURL(); } catch (_) {}
        shortcuts.push({ ...s, icon });
      }
      return { ...cfg, shortcuts };
    });
  }
}

module.exports = { LauncherHost };
