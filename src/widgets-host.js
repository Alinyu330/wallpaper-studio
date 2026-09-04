// widgets-host.js — 桌面组件 + 音律动效宿主（每组件独立小透明窗口）
//
// 架构（参照 Wallpaper Engine：每个桌面小组件都是独立小表面，从不在桌面上
// 放全屏透明窗口）：
// - 全屏透明组件窗口会把 DWM 对整个 Progman 树的合成毒化 —— mpv 视频帧被
//   抑制（壁纸冻结）、组件自身"鼠标靠近才显示"。v1.9.0 起废弃全屏窗口，
//   每个启用的组件（时钟/CPU/GPU/内存/音量）与音律动效各占一个独立小窗口；
// - 每个窗口都用转盘（launcher）已验证常驻显示的配方：小窗 + transparent +
//   focusable + 挂 Progman（图标层之上）+ WS_EX_NOACTIVATE + 默认鼠标穿透，
//   主进程 30ms 光标轮询命中渲染页上报的矩形后才可点击；
// - 组件拖动 = 直接拖窗口（launcher 同款 grabOff 方案），松手即按落位保存；
//   音律动效拖动后按窗口中心回写 posX/posY。
//
// ★ 位置模型（v1.7.1）：「自由位置」优先于「九宫格槽位」，两者互斥且来源单一：
//   - 自由位置：桌面拖动落位后写入（组件 item.posX/posY、动效 audioViz.posX/posY，
//     均为窗口中心相对工作区的比例）。自由位置有效时，九宫格槽位不再参与落位；
//   - 九宫格槽位：设置页点宫格时写入（组件 item.pos、转盘 launcher.grid），
//     同时清除自由位置 —— 交回九宫格定位；
//   - 其它任何参数调整（大小/颜色/数量/开关…）都不得改动位置字段，
//     否则拖动摆放的位置会被静默弹回九宫格/默认位置。
const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const desktop = require('./desktop');

const WIDGET_KEYS = ['clock', 'cpu', 'gpu', 'mem', 'volume'];

// 组件内容尺寸（CSS px）[宽, 高]，窗口贴内容开（多留一点呼吸边）
const WIDGET_SIZES = {
  clock:  { s: [216, 106], m: [272, 126], l: [352, 152] },
  cpu:    { s: [156, 74],  m: [190, 86],  l: [228, 100] },
  gpu:    { s: [156, 74],  m: [190, 86],  l: [228, 100] },
  mem:    { s: [156, 74],  m: [190, 86],  l: [228, 100] },
  volume: { s: [174, 92],  m: [210, 100], l: [250, 112] },
};
const MARGIN = 26; // 九宫格槽位与屏幕边缘的间距（CSS px）

class WidgetsHost {
  /**
   * @param {import('./store').Store} store
   * @param {object} hooks { onAvStatus, onVolume, onToggleMute, onConfigChanged }
   */
  constructor(store, hooks = {}) {
    this.store = store;
    this.hooks = hooks;
    this.parts = new Map(); // key → {key,win,hwnd,rects,interacting,adjusting,inputOn,dragging,grabOff}
    this.inputTimer = null;
    this._ipc = false;
    this._registerIpc();
  }

  // ---------- 配置 ----------
  /** 是否有组件/动效需要窗口 */
  _wantParts() {
    const want = new Set();
    const w = this.store.settings.widgets || {};
    if (w.enabled) {
      for (const k of WIDGET_KEYS) {
        if ((w.items || {})[k] && (w.items || {})[k].on) want.add(k);
      }
    }
    const av = this.store.settings.audioViz || {};
    if (av.enabled) want.add('aviz');
    return want;
  }

  /** 主进程是否需要启动性能数据采集（有指标/音量组件才采） */
  wantsStats() {
    for (const k of this.parts.keys()) if (k !== 'aviz') return true;
    return false;
  }

  /** 配置变化入口（设置页 / 桌面拖动落位后）：增删窗口 + 落位 + 推送 */
  sync() {
    // 序列化执行：ready-to-show 是异步事件，并发 sync 可能对同一组件
    // 重复 _createPart（表现为"调节参数后组件异常关闭/闪没"）；
    // catch 防止单次异常毒化后续整条链
    this._syncChain = (this._syncChain || Promise.resolve())
      .catch(() => {})
      .then(() => this._syncNow());
    return this._syncChain;
  }

  _syncNow() {
    const want = this._wantParts();
    for (const [key, p] of [...this.parts]) {
      if (!want.has(key)) { this._destroyPart(key); continue; }
      if (!p.win || p.win.isDestroyed()) this.parts.delete(key);
    }
    for (const p of this.parts.values()) {
      if (!p.dragging) this._placePart(p);
    }
    this.pushConfig();
    this._syncInputTimer();
    // 新建组件经 hooks.createJob（主进程桌面带重置）执行：
    // 晚于壁纸挂载直接创建的覆盖层不被 DWM 合成（Win11 24H2 实测）
    const missing = [...want].filter((k) => !this.parts.has(k));
    if (!missing.length) return Promise.resolve();
    const job = async () => {
      for (const key of missing) if (!this.parts.has(key)) this._createPart(key);
      await Promise.all(missing.map((k) => this._whenPartShown(k, 5000)));
    };
    const settle = () => {
      for (const key of missing) {
        const p = this.parts.get(key);
        if (p && !p.dragging) this._placePart(p);
      }
    };
    return (this.hooks.createJob ? this.hooks.createJob(job) : job()).then(settle, settle);
  }

  // ---------- 窗口生命周期 ----------

  _createPart(key) {
    const p = {
      key, win: null, hwnd: 0, rects: [],
      interacting: false, adjusting: false, inputOn: false, dragging: false, grabOff: { dx: 0, dy: 0 },
    };
    const b = this._boundsFor(key);
    const sf = screen.getPrimaryDisplay().scaleFactor || 1;
    p.win = new BrowserWindow({
      x: Math.round(b.x / sf), y: Math.round(b.y / sf),
      width: Math.max(48, Math.round(b.w / sf)),
      height: Math.max(48, Math.round(b.h / sf)),
      frame: false,
      show: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      // focusable:true 是转盘验证过的关键：false 的透明+Progman 子窗口收不到鼠标
      focusable: true,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload-widgets.js'),
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false, // 时钟/占用率/频谱需要持续刷新
      },
    });
    p.win.loadFile(path.join(__dirname, '..', 'renderer', 'widgets.html'), { query: { part: key } });
    p.win.once('ready-to-show', () => {
      if (!p.win || p.win.isDestroyed()) return;
      p.hwnd = Number(p.win.getNativeWindowHandle().readBigInt64LE(0));
      // Win11 24H2：已显示过的 DComp 窗口挂入桌面带后 DWM 不再合成（组件隐身根因）。
      // 必须在首次显示前完成挂载，让 DComp 首帧即绑定桌面带。
      desktop.attachLauncherOverlay(p.hwnd);
      this._placePart(p); // 挂载后按物理像素精确落位（BrowserWindow 的 DIP 坐标在混合 DPI 下不精确）
      p.win.showInactive();
      p.shownOnce = true;
      p.win.setIgnoreMouseEvents(true);
      p.inputOn = false;
      // 首帧强制上屏
      const repaint = () => { try { if (p.win && !p.win.isDestroyed()) p.win.webContents.invalidate(); } catch (_) {} };
      repaint();
      for (const ms of [200, 600, 1500, 3000]) setTimeout(repaint, ms);
      console.log(`[widgets] 组件窗口已嵌入桌面: ${p.key} hwnd=${p.hwnd}`);
    });
    p.win.on('closed', () => {
      const wasAdjusting = p.adjusting;
      p.adjusting = false;
      console.log(`[widgets] closed ${p.key} hwnd=${p.hwnd}`);
      this.parts.delete(p.key);
      if (wasAdjusting && this.hooks.onAdjustState) this.hooks.onAdjustState(p.key, false);
      this._syncInputTimer();
    });
    this.parts.set(key, p);
  }

  _destroyPart(key) {
    const p = this.parts.get(key);
    if (!p) return;
    this.parts.delete(key);
    console.log(`[widgets] destroy ${key} hwnd=${p.hwnd} stack=`, new Error().stack);
    try { if (p.win && !p.win.isDestroyed()) p.win.close(); } catch (_) {}
  }

  destroyAll() {
    for (const key of [...this.parts.keys()]) this._destroyPart(key);
    this.parts.clear();
    if (this.inputTimer) { clearInterval(this.inputTimer); this.inputTimer = null; }
  }

  /** 页面已呈现真实内容帧（capturePage 读回含非透明像素） */
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

  /**
   * 等待组件首帧上屏 + 真实内容帧呈现（超时/销毁兜底立即返回）。
   * 仅等 shown 不够：showInactive 后首帧常是全透明帧（页面尚未画出组件），
   * 桌面带一旦重建，DWM 将永久保留最后呈现的帧，之后任何 invalidate /
   * hide-show / 样式修改都无法恢复合成（Win11 24H2 隐身根因）。
   * 因此桌面带重建前必须等到 capturePage 读回非透明内容。
   */
  _whenPartShown(key, timeoutMs = 2000) {
    const p = this.parts.get(key);
    if (!p) return Promise.resolve();
    const deadline = Date.now() + timeoutMs;
    const waitShown = new Promise((resolve) => {
      const tick = () => {
        if (p.shownOnce || !p.win || p.win.isDestroyed() || Date.now() > deadline) return resolve();
        setTimeout(tick, 60);
      };
      tick();
    });
    return waitShown.then(() => {
      if (!p.win || p.win.isDestroyed()) return;
      const attempt = () => {
        if (!p.win || p.win.isDestroyed() || Date.now() > deadline) return;
        return p.win.webContents.capturePage().then((img) => {
          if (this._captureHasContent(img)) return;
          return new Promise((r) => setTimeout(r, 80)).then(attempt);
        }).catch(() => {});
      };
      return attempt();
    });
  }

  /** 启动屏障：等待全部期望组件首帧上屏（壁纸挂载前必须完成，见 main.js） */
  whenSettled(timeoutMs = 3000) {
    const keys = [...this._wantParts()];
    return Promise.all(keys.map((k) => this._whenPartShown(k, timeoutMs))).then(() => {});
  }

  /**
   * 创建组件并等待首帧。经由 hooks.createJob 执行时，主进程会先剥离
   * 壁纸宿主再重建桌面带，让晚于壁纸挂载创建的组件也能被 DWM 合成
   * （Win11 24H2：晚于桌面带建立的覆盖层永久隐身）。
   */
  async _ensureCreated(key) {
    const job = async () => {
      if (!this.parts.has(key)) this._createPart(key);
      await this._whenPartShown(key, 5000);
    };
    if (this.hooks.createJob) await this.hooks.createJob(job);
    else await job();
  }

  /** 看门狗（主进程 4s 调用）：窗口丢失重建 + 层级校正（图标层之上） */
  watchdog() {
    for (const [key, p] of [...this.parts]) {
      if (!p.win || p.win.isDestroyed()) {
        console.log(`[widgets] watchdog 重建 ${key}（窗口丢失）`);
        this.parts.delete(key);
        this._ensureCreated(key);
        continue;
      }
      if (p.hwnd) desktop.ensureLauncherOverlay(p.hwnd);
    }
    this._syncInputTimer();
  }

  /** 强制重绘（主进程 1s 高频循环调用）：透明子窗口挂 Progman 后 DWM 可能停止合成 */
  repaintAll() {
    for (const p of this.parts.values()) {
      try {
        if (p.win && !p.win.isDestroyed()) {
          p.win.webContents.invalidate();
          if (p.hwnd) desktop.nudgeWindow(p.hwnd);
        }
      } catch (_) {}
    }
  }

  onDisplayChange() {
    for (const p of this.parts.values()) this._placePart(p);
  }

  // ---------- 落位 ----------

  /** 组件/动效的内容尺寸（CSS px）。九宫格槽位与自由位置换算共用 */
  _contentSize(key) {
    if (key === 'aviz') {
      const av = this.store.settings.audioViz || {};
      const size = Math.min(2, Math.max(0.5, Number(av.size) || 1));
      const circular = av.style === 'circle' || av.style === 'rings';
      const wa = screen.getPrimaryDisplay().workArea;
      if (circular) {
        const side = Math.min(480, Math.max(180, Math.min(wa.width, wa.height) * 0.30 * size));
        return { w: side + 70, h: side + 70 };
      }
      return {
        w: Math.min(1400, Math.max(400, wa.width * 0.5 * size)) + 70,
        h: Math.min(340, Math.max(140, wa.height * 0.16 * size)) + 60,
      };
    }
    const item = ((this.store.settings.widgets || {}).items || {})[key] || {};
    const tbl = WIDGET_SIZES[key] || WIDGET_SIZES.cpu;
    const size = tbl[item.size] ? item.size : 'm';
    const [w, h] = tbl[size];
    return { w, h };
  }

  /**
   * 窗口中心可移动范围（CSS px）：保证整窗留在工作区内。
   * 拖动落位与逆换算必须用同一套限制，否则「拖到边角 → 落位被钳回屏内」
   * 会让保存的比例与实际位置不符，下一次换算时位置漂移。
   */
  _centerLimits(w, h, wa) {
    const halfW = Math.min(w / 2, wa.width / 2);
    const halfH = Math.min(h / 2, wa.height / 2);
    return {
      minX: wa.x + halfW, maxX: wa.x + wa.width - halfW,
      minY: wa.y + halfH, maxY: wa.y + wa.height - halfH,
    };
  }

  /** 自由位置 → 窗口中心（CSS px）；无自由位置返回 null（交给九宫格槽位） */
  _freeCenter(item, w, h, wa) {
    if (item.posX == null || item.posY == null) return null;
    const lim = this._centerLimits(w, h, wa);
    const cx = Math.min(lim.maxX, Math.max(lim.minX, wa.x + Number(item.posX) * wa.width));
    const cy = Math.min(lim.maxY, Math.max(lim.minY, wa.y + Number(item.posY) * wa.height));
    return { cx, cy };
  }

  /**
   * 组件/动效的目标矩形（物理像素）。
   * 定位优先级：拖动保存的自由位置（posX/posY）> 九宫格槽位（pos）。
   */
  _boundsFor(key) {
    const d = screen.getPrimaryDisplay();
    const sf = d.scaleFactor || 1;
    const wa = d.workArea; // DIP {x,y,width,height}
    const { w, h } = this._contentSize(key); // CSS px
    let cx, cy;
    if (key === 'aviz') {
      const av = this.store.settings.audioViz || {};
      const circular = av.style === 'circle' || av.style === 'rings';
      const defY = circular ? 0.5 : (av.pos === 'top' ? 0.10 : 0.90);
      const posX = av.posX == null ? 0.5 : av.posX;
      const posY = av.posY == null ? defY : av.posY;
      cx = wa.x + Math.min(0.98, Math.max(0.02, posX)) * wa.width;
      cy = wa.y + Math.min(0.96, Math.max(0.04, posY)) * wa.height;
    } else {
      const item = ((this.store.settings.widgets || {}).items || {})[key] || {};
      // ★ 拖动保存的自由位置优先：有效时不再吸附九宫格槽位
      const free = this._freeCenter(item, w, h, wa);
      if (free) {
        cx = free.cx;
        cy = free.cy;
      } else {
        const pos = item.pos || 'tl';
        const row = pos[0], col = pos[1];
        const anchorX = col === 'l' ? wa.x + MARGIN : col === 'c' ? wa.x + wa.width / 2 : wa.x + wa.width - MARGIN;
        const anchorY = row === 't' ? wa.y + MARGIN : row === 'm' ? wa.y + wa.height / 2 : wa.y + wa.height - MARGIN;
        cx = anchorX + (col === 'l' ? w / 2 : col === 'c' ? 0 : -w / 2);
        cy = anchorY + (row === 't' ? h / 2 : row === 'm' ? 0 : -h / 2);
      }
    }
    const vd = desktop.getDesktopRect();
    const pw = Math.round(w * sf), ph = Math.round(h * sf);
    let x = Math.round(cx * sf - pw / 2);
    let y = Math.round(cy * sf - ph / 2);
    x = Math.min(Math.max(x, vd.x), vd.x + vd.width - pw);
    y = Math.min(Math.max(y, vd.y), vd.y + vd.height - ph);
    return { x, y, w: pw, h: ph };
  }

  _placePart(p) {
    if (!p.hwnd || p.dragging) return;
    const b = this._boundsFor(p.key);
    console.log(`[widgets] place ${p.key}: want=${b.x},${b.y} ${b.w}x${b.h} got=`, JSON.stringify(desktop.getWindowRectScreen(p.hwnd)));
    desktop.resizeWindowToScreen(p.hwnd, b.x, b.y, b.w, b.h);
  }

  // ---------- 输入轮询（穿透 ⇄ 可点击，launcher 同款 30ms） ----------

  _syncInputTimer() {
    if (this.parts.size && !this.inputTimer) {
      this.inputTimer = setInterval(() => {
        for (const p of this.parts.values()) {
          if (!p.win || p.win.isDestroyed() || !p.hwnd) continue;
          const hit = p.adjusting || p.interacting || p.dragging || desktop.cursorInRects(p.hwnd, p.rects);
          if (hit !== p.inputOn) {
            p.inputOn = hit;
            try {
              p.win.setIgnoreMouseEvents(!hit);
            } catch (_) {}
          }
        }
      }, 30);
    } else if (!this.parts.size && this.inputTimer) {
      clearInterval(this.inputTimer);
      this.inputTimer = null;
    }
  }

  // ---------- 调整模式（客户端按钮进入 → 桌面按住该窗口拖动 → 松手自动保存退出） ----------

  /**
   * 开关某部件的调整模式。开启：整窗可点击可拖动（渲染页显示虚线提示）；
   * 关闭：恢复默认（组件按矩形命中交互，音律动效纯展示）。
   * @returns {boolean} 是否生效（部件不存在返回 false）
   */
  setAdjust(key, on) {
    const p = this.parts.get(key);
    if (!p) return false;
    p.adjusting = !!on;
    try {
      if (p.win && !p.win.isDestroyed()) {
        p.win.setIgnoreMouseEvents(!p.adjusting);
        p.win.webContents.send('widgets:adjust-mode', { on: p.adjusting });
      }
    } catch (_) {}
    console.log(`[widgets] ${key} 调整模式${p.adjusting ? '开启' : '关闭'}`);
    if (this.hooks.onAdjustState) this.hooks.onAdjustState(key, p.adjusting);
    return true;
  }

  // ---------- 拖动（直接拖窗口；松手吸附/回写位置） ----------

  _dragStart(p) {
    if (!p.hwnd) return;
    const cur = desktop.getCursorPos();
    const r = desktop.getWindowRectScreen(p.hwnd);
    if (!cur || !r) return;
    p.grabOff = { dx: cur.x - r.x, dy: cur.y - r.y };
    p.dragging = true;
  }

  _dragMove(p) {
    if (!p.hwnd || !p.dragging) return;
    const cur = desktop.getCursorPos();
    if (!cur) return;
    const r = desktop.getWindowRectScreen(p.hwnd);
    if (!r) return;
    const vd = desktop.getDesktopRect();
    const x = Math.min(Math.max(cur.x - p.grabOff.dx, vd.x - r.w + 60), vd.x + vd.width - 60);
    const y = Math.min(Math.max(cur.y - p.grabOff.dy, vd.y - r.h + 30), vd.y + vd.height - 30);
    desktop.moveWindowToScreen(p.hwnd, x, y);
  }

  _dragEnd(p) {
    p.dragging = false;
    if (!p.hwnd) return;
    const r = desktop.getWindowRectScreen(p.hwnd);
    if (!r) { this._placePart(p); return; }
    const d = screen.getPrimaryDisplay();
    const sf = d.scaleFactor || 1;
    const wa = d.workArea;
    const cx = (r.x + r.w / 2) / sf;
    const cy = (r.y + r.h / 2) / sf;

    if (p.key === 'aviz') {
      // 音律动效：窗口中心 → posX/posY（工作区比例；与九宫格/精确滑杆同一数据源）
      const posX = Math.min(0.98, Math.max(0.02, (cx - wa.x) / wa.width));
      const posY = Math.min(0.96, Math.max(0.04, (cy - wa.y) / wa.height));
      const cur = this.store.settings.audioViz || {};
      if (cur.posX !== posX || cur.posY !== posY) {
        this.store.updateSettings({ audioViz: { ...cur, posX, posY } });
        if (this.hooks.onConfigChanged) this.hooks.onConfigChanged();
      }
    } else {
      // 桌面组件：★ 直接保存落位的自由位置。
      // 旧实现会吸附到最近的九宫格槽位（写回 item.pos），导致永远拖不到
      // 想要的位置、多个组件还会挤在同一槽位上 —— 现在只记录实际落位。
      const { w, h } = this._contentSize(p.key);
      const lim = this._centerLimits(w, h, wa);
      const ccx = Math.min(lim.maxX, Math.max(lim.minX, cx));
      const ccy = Math.min(lim.maxY, Math.max(lim.minY, cy));
      const posX = (ccx - wa.x) / Math.max(1, wa.width);
      const posY = (ccy - wa.y) / Math.max(1, wa.height);
      const wc = this.store.settings.widgets || {};
      const items = { ...(wc.items || {}) };
      const item = { ...(items[p.key] || {}) };
      if (item.posX !== posX || item.posY !== posY) {
        item.posX = posX;
        item.posY = posY;
        items[p.key] = item;
        this.store.updateSettings({ widgets: { ...wc, items } });
        if (this.hooks.onConfigChanged) this.hooks.onConfigChanged();
      }
    }
    this._placePart(p); // 按保存的位置精确落位（自由位置下与松手位置一致）
    // 调整模式拖动落位完成 → 自动退出（客户端按钮经 adjust-state 事件复位）
    if (p.adjusting) this.setAdjust(p.key, false);
  }

  // ---------- 配置/数据推送 ----------

  pushConfig() {
    for (const p of this.parts.values()) this._pushTo(p);
  }

  _pushTo(p) {
    try {
      if (!p.win || p.win.isDestroyed()) return;
      const sf = screen.getPrimaryDisplay().scaleFactor || 1;
      if (p.key === 'aviz') {
        p.win.webContents.send('wallpaper-config', {
          part: 'aviz',
          audioViz: this.store.settings.audioViz || {},
          scaleFactor: sf,
        });
      } else {
        const w = this.store.settings.widgets || {};
        p.win.webContents.send('wallpaper-config', {
          part: p.key,
          theme: w.theme || 'auto',
          item: ((w.items || {})[p.key]) || {},
          scaleFactor: sf,
        });
      }
    } catch (_) {}
  }

  /** 性能数据广播（CPU/GPU/内存/音量组件） */
  broadcast(stats) {
    for (const p of this.parts.values()) {
      if (p.key === 'aviz') continue;
      try { if (p.win && !p.win.isDestroyed()) p.win.webContents.send('wallpaper-stats', stats); } catch (_) {}
    }
  }

  /** 调试截图清单 */
  captureList() {
    const out = [];
    for (const [key, p] of this.parts) {
      if (p.win && !p.win.isDestroyed()) out.push([`widgets-${key}`, p.win]);
    }
    return out;
  }

  // ---------- IPC（渲染页 → 主进程；多窗口按 sender 归属） ----------

  _registerIpc() {
    if (this._ipc) return;
    this._ipc = true;
    const partOf = (e) => {
      for (const p of this.parts.values()) {
        try { if (p.win && !p.win.isDestroyed() && p.win.webContents === e.sender) return p; } catch (_) {}
      }
      return null;
    };
    ipcMain.on('wallpaper-report-rects', (e, rects) => {
      const p = partOf(e);
      if (p) p.rects = Array.isArray(rects) ? rects : [];
    });
    ipcMain.on('wallpaper-set-interacting', (e, v) => {
      const p = partOf(e);
      if (p) p.interacting = !!v;
    });
    // 渲染页就绪（双保险时序）：监听器注册完毕，请求下发配置
    ipcMain.on('wallpaper-widgets-ready', (e) => {
      const p = partOf(e);
      if (p) this._pushTo(p);
    });
    ipcMain.on('wallpaper-drag-start', (e) => { const p = partOf(e); if (p) this._dragStart(p); });
    ipcMain.on('wallpaper-drag-move', (e) => { const p = partOf(e); if (p) this._dragMove(p); });
    ipcMain.on('wallpaper-drag-end', (e) => { const p = partOf(e); if (p) this._dragEnd(p); });
    ipcMain.on('wallpaper-av-status', (_e, s) => {
      if (this.hooks.onAvStatus) this.hooks.onAvStatus(s || {});
    });
    ipcMain.on('wallpaper-set-volume', (_e, v) => {
      if (this.hooks.onVolume) this.hooks.onVolume(v);
    });
    ipcMain.on('wallpaper-toggle-mute', () => {
      if (this.hooks.onToggleMute) this.hooks.onToggleMute();
    });
  }
}

module.exports = { WidgetsHost };
