// launcher.js — 桌面 App 快捷方式转盘（主进程侧宿主）
//
// 实现「Wallpaper Engine 式」的桌面快捷方式收纳：
// - 独立小窗口挂在桌面图标层(SHELLDLL_DefView)之上、普通窗口之下 ——
//   桌面上可直接点击启动应用，又不遮挡任何程序窗口、不影响壁纸观感；
// - 图标条 + 拖动条：按住拖动即像转盘一样轮换快捷方式（转盘交互在
//   renderer/launcher.html 内实现）；
// - 位置自由摆放（拖动左侧手柄）、同屏数量可自定义（设置页 4~12）；
// - 空闲自动收起为小胶囊，鼠标悬停展开（输入开关由主进程光标轮询驱动，
//   与桌面组件同款方案：默认整窗鼠标穿透，光标进入可交互矩形才可点击）；
// - 点选/框选收纳（v1.6.0）：全屏选择器（picker.html）枚举桌面图标
//   （跨进程读取 explorer 的 SysListView32），选中后把对应 .lnk/.url
//   文件移动到应用数据目录保管 —— 桌面原位置隐藏；从转盘移除或关闭
//   功能时自动移回原位置（恢复显示）。
//
// 尺寸约定：窗口物理尺寸由渲染页实测上报（launcher:metrics），
// 主进程用物理像素 MoveWindow 调整 —— 避免两端各维护一套布局算法。
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const desktop = require('./desktop');

const DEFAULTS = { enabled: false, x: null, y: null, count: 8, autoCollapse: true, shortcuts: [], boxed: [] };
const CLAMP_KEEP_W = 56;  // 拖动出屏时至少保留的可视宽度（物理像素）
const CLAMP_KEEP_H = 28;
const SC_EXTS = ['.lnk', '.url']; // 可收纳的快捷方式扩展名

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
    this.pickerWin = null;    // 桌面图标点选/框选窗口
    this.onChanged = null;    // 配置变化通知（主界面刷新设置页）
    this._ipcRegistered = false;
    // 收纳保管目录（快捷方式文件在「桌面 ⇄ 保管目录」之间移动）
    this.boxDir = path.join(app.getPath('userData'), 'launcher-box');
    try { fs.mkdirSync(this.boxDir, { recursive: true }); } catch (_) {}
    console.log(`[launcher] 收纳目录: ${this.boxDir} · 桌面目录: ${app.getPath('desktop')}`);
    this._registerIpc();
  }

  get cfg() {
    const saved = this.store.settings.launcher || {};
    return { ...DEFAULTS, ...saved, boxed: saved.boxed || [] };
  }

  /** 收纳保管目录中不冲突的文件名（同名时加序号） */
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

  /** 在桌面目录中按显示名查找快捷方式文件（.lnk/.url，去扩展名精确匹配） */
  _findShortcutFile(name) {
    const targets = [
      app.getPath('desktop'),
      path.join(process.env.SystemRoot || 'C:\\Windows', '..', 'Users', 'Public', 'Desktop'), // 兜底
      'C:\\Users\\Public\\Desktop',
    ];
    const seen = new Set();
    for (const dir of targets) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      let files;
      try { files = fs.readdirSync(dir); } catch (_) { continue; }
      const hit = files.find((f) => {
        const ext = path.extname(f).toLowerCase();
        if (!SC_EXTS.includes(ext)) return false;
        return path.basename(f, ext).toLowerCase() === name.toLowerCase();
      });
      if (hit) return { file: path.join(dir, hit), publicDir: dir !== app.getPath('desktop') };
    }
    return null;
  }

  /**
   * 移动文件（桌面 ⇄ 保管目录）：
   * copy 到目标 + shell 删除源（SHFileOperationW FO_DELETE → 回收站）。
   * 桌面 .lnk 常被 explorer 持有句柄：fs.rename 跨卷必失败（EXDEV）、
   * fs.unlink 会被句柄拒绝（EPERM）；shell 语义删除可协调 explorer，
   * 且源文件进回收站（误操作可在回收站找回）。
   */
  _moveFile(src, dst) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) return false;
      if (!fs.existsSync(src)) return false;
      fs.copyFileSync(src, dst);
      if (!fs.existsSync(dst)) return false;
      // 优先 shell 删除（回收站，可撤销，能删被 explorer 持有的文件）
      if (desktop.shellDeleteFile(src)) return true;
      // 回退 fs 删除（带重试）
      try { fs.unlinkSync(src); }
      catch (_) { try { fs.rmSync(src, { force: true, maxRetries: 10, retryDelay: 150 }); } catch (_) {} }
      return !fs.existsSync(src);
    } catch (_) {
      return false;
    }
  }

  /** 目标被占用时退让命名：name.lnk → name (2).lnk */
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

  /** 应用配置（设置页/托盘调用）。关闭功能 = 恢复全部收纳项并清空转盘 */
  applyPatch(patch) {
    const cur = this.cfg;
    const wasEnabled = !!cur.enabled;
    const next = { ...cur, ...patch };
    if (patch.shortcuts === undefined) next.shortcuts = cur.shortcuts;
    if (patch.boxed === undefined) next.boxed = cur.boxed;
    if (wasEnabled && next.enabled === false) {
      // 关闭功能：已收纳的快捷方式移回桌面原位置（恢复显示），转盘清空
      this._restoreAllBoxed();
      next.shortcuts = [];
      next.boxed = [];
    }
    this.store.updateSettings({ launcher: next });
    if (next.enabled && !this.win) {
      this.create();
    } else if (!next.enabled && this.win) {
      this.destroy();
    } else if (this.win) {
      // 数量/快捷方式/收起开关变化 → 重建图标并推送（渲染页会重新上报尺寸）
      this.pushConfig();
    }
    if (this.onChanged) this.onChanged();
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
    this._closePicker();
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
    const boxed = [...(cfg.boxed || [])];
    if (idx < 0 || idx >= list.length) return;
    const [removed] = list.splice(idx, 1);
    // 收纳项移除 = 恢复到桌面原位置
    if (removed) {
      const bIdx = boxed.findIndex(b => b.boxPath === removed.path);
      if (bIdx >= 0) {
        const b = boxed[bIdx];
        boxed.splice(bIdx, 1);
        if (fs.existsSync(b.boxPath)) {
          const dst = this._restorePathFor(b.originPath);
          if (this._moveFile(b.boxPath, dst)) {
            console.log(`[launcher] 已恢复到桌面: ${b.name}`);
          } else {
            console.warn(`[launcher] 恢复失败（文件保留在保管目录）: ${b.name}`);
          }
        }
      }
    }
    this.applyPatch({ shortcuts: list, boxed });
  }

  /** 把保管目录中的全部收纳项移回桌面原位置 */
  _restoreAllBoxed() {
    const cfg = this.cfg;
    let restored = 0, failed = 0;
    for (const b of cfg.boxed || []) {
      if (!fs.existsSync(b.boxPath)) continue;
      const dst = this._restorePathFor(b.originPath);
      if (this._moveFile(b.boxPath, dst)) restored++;
      else failed++;
    }
    if ((cfg.boxed || []).length) {
      console.log(`[launcher] 恢复全部收纳项: 成功 ${restored} 失败 ${failed}`);
    }
    return { restored, failed };
  }

  _launch(idx) {
    const s = (this.cfg.shortcuts || [])[idx];
    if (!s) return;
    shell.openPath(s.path).then((err) => {
      if (err) console.warn(`[launcher] 启动失败: ${s.path} — ${err}`);
    });
  }

  // ---------- 点选/框选收纳（picker） ----------

  /** 打开桌面图标选择器（点选/框选），返回 {ok, error?} */
  openPicker() {
    const icons = desktop.getDesktopIcons();
    if (!icons || !icons.length) {
      return { ok: false, error: '未能读取桌面图标（资源管理器可能正在重启，请稍后再试）' };
    }
    if (this.pickerWin && !this.pickerWin.isDestroyed()) {
      this.pickerWin.close();
    }
    const vd = desktop.getDesktopRect();
    const displays = screen.getAllDisplays();
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const d of displays) {
      x1 = Math.min(x1, d.bounds.x); y1 = Math.min(y1, d.bounds.y);
      x2 = Math.max(x2, d.bounds.x + d.bounds.width); y2 = Math.max(y2, d.bounds.y + d.bounds.height);
    }
    this.pickerWin = new BrowserWindow({
      x: x1, y: y1, width: x2 - x1, height: y2 - y1,
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: true,        // 需要 Enter/Esc 键盘操作
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-picker.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    this.pickerWin.loadFile(path.join(__dirname, '..', 'renderer', 'picker.html'));
    this.pickerWin.once('ready-to-show', () => {
      if (!this.pickerWin || this.pickerWin.isDestroyed()) return;
      this.pickerWin.show();
      this.pickerWin.focus();
      const phwnd = Number(this.pickerWin.getNativeWindowHandle().readBigInt64LE(0));
      // 挂为 Progman 子窗口、图标层之上、全屏铺满（复用组件覆盖层挂载）
      desktop.attachWidgetsOverlay(phwnd);
      const dpr = screen.getPrimaryDisplay().scaleFactor || 1;
      // 物理坐标 → 窗口 CSS 坐标（窗口铺满虚拟桌面，起点即虚拟桌面原点）
      this.pickerWin.webContents.send('picker:icons', {
        icons: icons.map(ic => ({
          name: ic.name,
          x: (ic.x - vd.x) / dpr, y: (ic.y - vd.y) / dpr,
          w: ic.w / dpr, h: ic.h / dpr,
        })),
      });
      console.log(`[launcher] 桌面图标选择器已打开（${icons.length} 个图标）`);
    });
    this.pickerWin.on('closed', () => { this.pickerWin = null; });
    // 选择器期间暂停转盘收起（视觉干扰）——关闭选择器后恢复正常轮换
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('launcher:hover', true); } catch (_) {}
    }
    return { ok: true };
  }

  _closePicker() {
    if (this.pickerWin && !this.pickerWin.isDestroyed()) this.pickerWin.close();
    this.pickerWin = null;
    if (this.win && !this.win.isDestroyed()) {
      try { this.win.webContents.send('launcher:hover', false); } catch (_) {}
    }
  }

  /** 选择器确认：把选中图标对应的桌面 .lnk/.url 收纳（移动到保管目录） */
  _confirmPick(names) {
    this._closePicker();
    if (!Array.isArray(names) || !names.length) return { ok: true, boxed: 0, skipped: 0 };

    const cfg = this.cfg;
    const shortcuts = [...(cfg.shortcuts || [])];
    const boxed = [...(cfg.boxed || [])];
    let done = 0;
    const skipped = { notFound: 0, noPerm: 0 };
    for (const name of names) {
      const found = this._findShortcutFile(name);
      if (!found) { skipped.notFound++; continue; }  // 系统图标/文件夹等非快捷方式
      if (found.publicDir) {
        console.warn(`[launcher] 跳过公共桌面项（需管理员）: ${name} @ ${found.file}`);
        skipped.noPerm++;
        continue;
      }
      const boxPath = this._boxPathFor(path.basename(found.file));
      if (!this._moveFile(found.file, boxPath)) {
        console.warn(`[launcher] 移动失败: ${found.file} → ${boxPath}`);
        skipped.noPerm++;
        continue;
      }
      shortcuts.push({ name, path: boxPath });
      boxed.push({ name, originPath: found.file, boxPath });
      done++;
    }
    if (done) this.applyPatch({ shortcuts, boxed });
    console.log(`[launcher] 桌面快捷方式收纳: ${done} 个（未匹配 ${skipped.notFound} / 无权限 ${skipped.noPerm}）`);
    // 主动带结果通知（applyPatch 内的 onChanged 无 payload，仅刷新）
    if (this.onChanged) this.onChanged({ picked: done, skipped: skipped.notFound + skipped.noPerm });
    return { ok: true, boxed: done, skipped: skipped.notFound + skipped.noPerm };
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
    ipcMain.handle('launcher:pick', () => this.openPicker());
    ipcMain.on('picker:confirm', (_e, names) => this._confirmPick(names));
    ipcMain.on('picker:cancel', () => this._closePicker());
    ipcMain.handle('launcher:remove-at', (_e, idx) => {
      this._removeAt(idx);
      return { ok: true };
    });
    ipcMain.handle('launcher:restore-all', () => {
      const { restored, failed } = this._restoreAllBoxed();
      // 恢复后清空转盘列表与收纳记录
      this.applyPatch({ shortcuts: [], boxed: [] });
      return { ok: true, restored, failed };
    });
    ipcMain.handle('launcher:get', async () => {
      const cfg = this.cfg;
      const boxSet = new Set((cfg.boxed || []).map(b => b.boxPath));
      const shortcuts = [];
      for (const s of cfg.shortcuts || []) {
        let icon = null;
        try { icon = (await app.getFileIcon(s.path, { size: 'normal' })).toDataURL(); } catch (_) {}
        shortcuts.push({ ...s, icon, boxed: boxSet.has(s.path) });
      }
      return { ...cfg, shortcuts };
    });
  }
}

module.exports = { LauncherHost };
