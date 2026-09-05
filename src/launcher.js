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
// ★ v1.10.0：收纳范围收敛为「桌面快捷方式(.lnk/.url) + 程序文件(.exe/.bat/.cmd)
//   + 系统特殊项（回收站/控制面板/网络/此电脑）」。办公文档与文件夹收纳已拆分
//   到 filebox.js（文件收纳区），转盘不再收纳办公文档。
//
// 尺寸约定：窗口物理尺寸由渲染页实测上报（launcher:metrics），
// 主进程用物理像素 MoveWindow 调整 —— 避免两端各维护一套布局算法。
const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const desktop = require('./desktop');
const icons = require('./icons');

const DEFAULTS = {
  enabled: false, x: null, y: null, count: 8, autoCollapse: true,
  orientation: 'h',     // 排列方向：h 横向 / v 纵向
  bgOpacity: 0.32,      // 面板底色不透明度 0.1~0.85
  edgeFade: false,      // 边缘图标淡化（默认关闭：所有图标全亮度显示）
  mirror: true,         // 图标镜像倒影
  mirrorOpacity: 30,    // 倒影强度 %
  brightness: 100,      // 转盘亮度 %（100 = 原样）
  contrast: 100,        // 对比度 %
  saturate: 100,        // 饱和度 %
  opacity: 100,         // 整体不透明度 %
  collectMode: 'box',   // 收纳方式：box 移动到收纳目录 / hide 隐藏到壁纸后
  shortcuts: [], boxed: [], hidden: [],
};
const ORIENTATIONS = ['h', 'v'];
const CLAMP_KEEP_W = 56;  // 拖动出屏时至少保留的可视宽度（物理像素）
const CLAMP_KEEP_H = 28;
const SC_EXTS = ['.lnk', '.url']; // 可收纳的快捷方式扩展名
// 可收纳的程序文件扩展名（.exe 直接启动；.bat/.cmd 经 cmd 运行）
// 多数快捷方式打开后对应的是 .exe，故程序文件保留在转盘收纳
const APP_EXTS = ['.exe', '.bat', '.cmd'];
// 桌面「系统特殊项」清单（无实体文件，收纳后通过 shell: 协议 / CLSID 打开）
const SYSTEM_ITEMS = [
  { id: 'recycle',   name: '回收站',   launch: 'shell:RecycleBinFolder',   clsid: '{645FF040-5081-101B-9F08-00AA002F954E}', aliases: ['回收站', 'Recycle Bin'] },
  { id: 'control',   name: '控制面板', launch: 'shell:ControlPanelFolder', clsid: '{26EE0668-A00A-44D7-9371-BEB064C98683}', aliases: ['控制面板', 'Control Panel'] },
  { id: 'network',   name: '网络',     launch: 'shell:NetworkPlacesFolder', clsid: '{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}', aliases: ['网络', 'Network'] },
  { id: 'thispc',    name: '此电脑',   launch: 'shell:MyComputerFolder',    clsid: '{20D04FE0-3AEA-1069-A2D8-08002B30309D}', aliases: ['此电脑', '这台电脑', '计算机', '我的电脑', 'This PC'] },
  // 用户文件夹（个人目录）：桌面默认无此图标，故不带 clsid（隐藏/恢复自动跳过）
  { id: 'userfiles', name: '用户文件夹', launch: 'shell:Personal',            clsid: '', aliases: ['用户文件夹', '个人文件夹', 'User Files'] },
];
// 所有「可收纳」的扩展名（枚举桌面文件用：快捷方式 + 程序文件）
const ALL_BOX_EXTS = [...SC_EXTS, ...APP_EXTS].map(e => e.toLowerCase());

class LauncherHost {
  /** @param {import('./store').Store} store */
  constructor(store) {
    this.store = store;
    this.win = null;
    this.hwnd = 0;
    this.rects = [];          // 可交互矩形（物理像素，相对窗口客户区）
    this.interacting = false; // 拖动窗口/交互中（保持可点击）
    this.adjusting = false;   // 调整模式：整窗可点击可拖动（客户端按钮触发）
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
    // Shell 图标提取（SHGetFileInfoW，支持 shell: 虚拟项），图标 PNG 落盘缓存
    try { icons.init(app.getPath('userData')); } catch (_) {}
    this._purgeGhostShortcuts();
    this._registerIpc();
  }

  get cfg() {
    const saved = this.store.settings.launcher || {};
    return { ...DEFAULTS, ...saved, boxed: saved.boxed || [] };
  }

  /**
   * 启动净化：删除指向不存在文件的「幽灵」快捷方式（文件已被移回桌面但记录
   * 残留，导致转盘显示空白图标）。系统特殊项(type=system)不受影响。
   */
  _purgeGhostShortcuts() {
    try {
      const cfg = this.cfg;
      // 除幽灵项（文件已不在）外，顺带清掉垃圾文件项（._* macOS 资源 fork / ~$ Office 锁文件，
      // 历史版本一键收纳时可能已混入转盘，表现为"空白/无意义图标"）
      const isJunkName = (p) => {
        const b = path.basename(String(p || ''));
        return b.startsWith('._') || b.startsWith('~$');
      };
      const list = (cfg.shortcuts || []).filter((s) => {
        if (!s) return false;
        if (s.type === 'system') return true;
        if (!s.path || !fs.existsSync(s.path)) return false;
        return !isJunkName(s.path);
      });
      if (list.length !== (cfg.shortcuts || []).length) {
        const removed = (cfg.shortcuts || []).length - list.length;
        this.store.updateSettings({ launcher: { ...cfg, shortcuts: list } });
        console.log(`[launcher] 已清理 ${removed} 个幽灵/垃圾快捷方式`);
      }
    } catch (_) {}
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
    const targets = this._desktopDirs();
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
   * 移动文件（桌面 ⇄ 保管目录）。
   * 优先顺序：① 同卷 rename（原子、图标不丢）→ ② shell FO_MOVE（explorer
   * 语义移动，图标缓存随文件正确迁移，修复"恢复后图标变白"）→ ③ copy+delete
   * （跨卷/ACL 兜底）。③ 会导致 .lnk 图标缓存失效（白图标），恢复后由
   * notifyShellIconRefresh(paths) 逐项刷新。
   */
  _moveFile(src, dst) {
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) return false;
      if (!fs.existsSync(src)) return false;
      // ① 同卷优先 rename：原子移动、完整保留 .lnk 内容与图标元数据
      try { fs.renameSync(src, dst); if (fs.existsSync(dst)) return true; } catch (_) {}
      // ② shell 移动（FO_MOVE）：explorer 语义，能协调被持有的句柄且图标跟随
      if (desktop.shellMoveFile(src, dst)) {
        if (fs.existsSync(dst) && !fs.existsSync(src)) return true;
      }
      // ③ 复制：fs 优先，ACL 拒绝时走 shell 复制（公共桌面恢复场景）
      let copied = false;
      try { fs.copyFileSync(src, dst); copied = fs.existsSync(dst); } catch (_) { copied = false; }
      if (!copied) {
        if (!desktop.shellCopyFile(src, dst)) return false;
        copied = fs.existsSync(dst);
        if (!copied) return false;
      }
      // ④ 优先 shell 删除（回收站，可撤销，能删被 explorer 持有的文件）
      if (desktop.shellDeleteFile(src)) return true;
      // 回退 fs 删除（带重试）
      try { fs.unlinkSync(src); }
      catch (_) { try { fs.rmSync(src, { force: true, maxRetries: 10, retryDelay: 150 }); } catch (_) {} }
      if (!fs.existsSync(src)) return true;
      // 删除失败（如公共桌面无权限）：清掉副本，不留幽灵文件
      try { fs.rmSync(dst, { force: true }); } catch (_) {}
      return false;
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
    if (ORIENTATIONS.includes(patch.orientation)) next.orientation = patch.orientation;
    if (patch.shortcuts === undefined) next.shortcuts = cur.shortcuts;
    if (patch.boxed === undefined) next.boxed = cur.boxed;
    if (patch.hidden === undefined) next.hidden = cur.hidden;
    // 九宫格定位接管：清除自定义坐标（拖动保存的 x/y），后续由 grid 推导落位。
    // ★ 必须是「调用方显式传了 grid」才接管 —— 早期版本用 patch.grid !== undefined
    //   判断，而上游会把已存配置深合并进补丁（grid 恒有值，拖动后还是 null），
    //   结果任何参数调整（数量/方向/收纳…）都被当成点了九宫格，把拖动位置清空
    //   并弹回默认位置（v1.7.1）。
    if (Object.prototype.hasOwnProperty.call(patch, 'grid')) {
      next.grid = patch.grid || null;
      next.x = null;
      next.y = null;
    }
    if (wasEnabled && next.enabled === false) {
      // 关闭功能：已收纳的快捷方式移回桌面原位置（恢复显示），转盘清空。
      // 恢复失败项保留记录（文件仍在保管目录），下次"全部恢复"可重试，
      // 修复"关闭后不能全部恢复"（失败项被直接清空、永久失联）。
      const boxedBefore = cur.boxed || [];
      const { remaining } = this._restoreAllBoxed();
      const failedSet = new Set(remaining.map(b => b.boxPath));
      // 隐藏项（停放到视口外 / 注册表隐藏）同样恢复
      const hiddenBefore = cur.hidden || [];
      const hiddenRemaining = this._restoreAllHidden();
      const hiddenFailed = new Set(hiddenRemaining.map(h => h.name));
      const restoredHidden = new Set(hiddenBefore.filter((h) => !hiddenFailed.has(h.name)).map((h) => h.name));
      next.hidden = hiddenRemaining;
      // 移出所有已恢复的收纳项；失败项保留（含其 shortcuts 条目，供下次重试）
      next.shortcuts = next.shortcuts.filter(s =>
        (!boxedBefore.some(b => b.boxPath === s.path) || failedSet.has(s.path))
        && (!restoredHidden.has(s.name) || hiddenFailed.has(s.name)));
      next.boxed = remaining;
    }
    this.store.updateSettings({ launcher: next });
    if (next.enabled && !this.win) {
      this._createAsync();
    } else if (!next.enabled && this.win) {
      this.destroy();
    } else if (this.win) {
      // 数量/快捷方式/收起开关变化 → 重建图标并推送（渲染页会重新上报尺寸）
      this.pushConfig();
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'grid') && this.win && !this.win.isDestroyed() && this.hwnd) {
      this._applyGrid(next.grid);
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
      // focusable:true 是关键：false 的窗口在透明+挂 Progman 下收不到鼠标
      // 点击（"点击无法使用"的根因）。用 WS_EX_NOACTIVATE（挂载时设置）
      // 保证点击不抢焦点，不影响用户当前操作。
      focusable: true,
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
      this.hwnd = Number(this.win.getNativeWindowHandle().readBigInt64LE(0));
      // Win11 24H2：已显示过的 DComp 窗口挂入桌面带后 DWM 不再合成（转盘隐身根因）。
      // 必须在首次显示前完成挂载，让 DComp 首帧即绑定桌面带（widgets 同款修复）。
      desktop.attachLauncherOverlay(this.hwnd);
      this._placeDefault(980, 150); // 挂载后按物理像素精确落位（渲染页实测后再收缩）
      this.win.showInactive();
      this.shownOnce = true;
      this.win.setIgnoreMouseEvents(true);
      this.inputOn = false;
      // 强制首帧上屏（透明子窗口挂入 Progman 后 DWM 可能不主动合成）
      const repaint = () => { try { if (this.win && !this.win.isDestroyed()) this.win.webContents.invalidate(); } catch (_) {} };
      repaint();
      for (const ms of [200, 600, 1500, 3000]) setTimeout(repaint, ms);
      console.log(`[launcher] 快捷方式转盘已嵌入桌面（图标层之上）hwnd=${this.hwnd}`);
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
    this._closePicker();
    this._stopPolling();
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
   * 启动屏障：等待转盘首帧上屏 + 真实内容帧呈现（壁纸挂载前必须完成，见 main.js）。
   * 桌面带一旦重建，DWM 永久保留最后呈现的帧（Win11 24H2 隐身根因），
   * 全透明首帧一旦被保留，转盘将永久隐身且无法恢复。
   */
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

  /**
   * 创建转盘并等待首帧。经由 onCreateJob 执行时，主进程会先剥离壁纸宿主
   * 再重建桌面带，让晚于壁纸挂载创建的转盘也能被 DWM 合成
   * （Win11 24H2：晚于桌面带建立的覆盖层永久隐身）。
   */
  async _createAsync() {
    const job = async () => {
      this.create();
      await this.whenSettled(5000);
    };
    if (this.onCreateJob) await this.onCreateJob(job);
    else await job();
  }

  /** 看门狗（主进程 4s 调用）：保活 + 层级校正 */
  watchdog() {
    if (!this.cfg.enabled) return;
    this._reassertHidden();
    if (!this.win || this.win.isDestroyed()) {
      this._createAsync();
      return;
    }
    if (this.hwnd) desktop.ensureLauncherOverlay(this.hwnd);
  }

  /**
   * 隐藏项被还原（用户在资源管理器里取消隐藏属性 / 同步盘回滚）→ 重新加回。
   * 注册表模式由 explorer 自己持久化，无需重做。
   */
  _reassertHidden() {
    const hidden = (this.cfg.hidden || []).filter((h) => h.mode === 'attr' && h.path);
    if (!hidden.length) return;
    const icons = desktop.getDesktopIcons();
    if (!icons) return;
    for (const h of hidden) {
      if (icons.some((ic) => ic.name === h.name)) desktop.setFileHiddenAttr(h.path, true);
    }
  }

  /** 强制重绘（主进程 1s 高频循环调用）：透明子窗口挂 Progman 后 DWM 可能停止合成 */
  repaint() {
    try {
      if (this.win && !this.win.isDestroyed()) {
        this.win.webContents.invalidate();
        if (this.hwnd) desktop.nudgeWindow(this.hwnd);
      }
    } catch (_) {}
  }

  /** 分辨率/显示器变化：重新钳制位置（默认位置则重算底部居中） */
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

  // ---------- 配置/图标推送 ----------

  /** 提取某快捷方式的图标 DataURL。
   *  v1.9.0：改用 icons.js（Win32 SHGetFileInfoW）——
   *  - 系统特殊项（回收站/控制面板等虚拟项）也能取到真实系统图标
   *    （app.getFileIcon 只认真实文件，虚拟项只能返回 null）；
   *  - .lnk/.url/办公文件取关联图标，失败回退 app.getFileIcon，再失败由
   *    渲染层首字母/内置 SVG 兜底。 */
  async _iconFor(s) {
    await new Promise((r) => setImmediate(r)); // 让出事件循环（批量取图标不冻结主进程）
    try {
      if (s && s.type === 'system') {
        const url = icons.getIconDataUrl(s.launch || s.clsid || `shell:${s.sysId}`);
        return url || null; // null → 渲染层内置 SVG 兜底
      }
      if (s && s.path) {
        const url = icons.getIconDataUrl(s.path);
        if (url) return url;
      }
    } catch (_) {}
    try {
      const img = await app.getFileIcon(s.path, { size: 'large' });
      return img && !img.isEmpty() ? img.toDataURL() : null;
    } catch (_) {
      return null;
    }
  }

  /** 推送转盘配置给渲染层。
   *  pass：冷启动时 shell 命名空间 / GDI 偶发返回空图标句柄（同一调用稍后即成功），
   *  因此首轮若有项取图失败就延迟重推补取，最多三轮。已成功的项走磁盘缓存，开销极小。 */
  async pushConfig(pass = 1) {
    if (!this.win || this.win.isDestroyed()) return;
    const cfg = this.cfg;
    const shortcuts = [];
    let missing = 0;
    for (const s of cfg.shortcuts || []) {
      const icon = await this._iconFor(s);
      if (!icon) missing++;
      shortcuts.push({ name: s.name, path: s.path, icon, type: s.type, sysId: s.sysId, pinned: !!s.pinned });
    }
    try {
      this.win.webContents.send('launcher:config', {
        enabled: cfg.enabled,
        count: cfg.count,
        autoCollapse: cfg.autoCollapse,
        orientation: cfg.orientation || 'h',
        bgOpacity: cfg.bgOpacity ?? 0.32,
        edgeFade: !!cfg.edgeFade,
        mirror: cfg.mirror !== false,
        mirrorOpacity: Number.isFinite(cfg.mirrorOpacity) ? cfg.mirrorOpacity : 30,
        brightness: Number.isFinite(cfg.brightness) ? cfg.brightness : 100,
        contrast: Number.isFinite(cfg.contrast) ? cfg.contrast : 100,
        saturate: Number.isFinite(cfg.saturate) ? cfg.saturate : 100,
        opacity: Number.isFinite(cfg.opacity) ? cfg.opacity : 100,
        shortcuts,
      });
    } catch (_) {}
    if (missing && pass < 3) {
      clearTimeout(this._iconRetryTimer);
      this._iconRetryTimer = setTimeout(() => {
        this._iconRetryTimer = null;
        this.pushConfig(pass + 1);
      }, 1200);
    }
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
      if (this.cfg.grid) {
        // 九宫格定位：先按内容尺寸收缩，再重新换算槽位（尺寸变了吸附点跟着变）
        desktop.resizeWindowToScreen(this.hwnd, old.x, old.y, w, h);
        this._applyGrid(this.cfg.grid);
      } else {
        this._placeDefault(w, h);
      }
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

  /** 九宫格快速定位：cell ∈ tl..br（行 t/m/b + 列 l/c/r）；null = 恢复默认底部居中 */
  _applyGrid(cell) {
    if (!this.win || this.win.isDestroyed() || !this.hwnd) return;
    const r = desktop.getWindowRectScreen(this.hwnd);
    if (!r) return;
    if (!cell) {
      this._placeDefault(r.w, r.h);
      return;
    }
    const primary = screen.getPrimaryDisplay();
    const sf = primary.scaleFactor || 1;
    const m = Math.round(14 * sf); // 与 _placeDefault 同款边距
    const wx = Math.round(primary.workArea.x * sf);
    const wy = Math.round(primary.workArea.y * sf);
    const ww = Math.round(primary.workArea.width * sf);
    const wh = Math.round(primary.workArea.height * sf);
    const row = cell[0], col = cell[1];
    const x = col === 'l' ? wx + m : col === 'r' ? wx + ww - r.w - m : wx + Math.round((ww - r.w) / 2);
    const y = row === 't' ? wy + m : row === 'b' ? wy + wh - r.h - m : wy + Math.round((wh - r.h) / 2);
    desktop.moveWindowToScreen(this.hwnd, x, y);
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
      const hit = this.adjusting || this.interacting || desktop.cursorInRects(this.hwnd, this.rects);
      if (hit !== this.inputOn) {
        this.inputOn = hit;
        try {
          this.win.setIgnoreMouseEvents(!hit);
        } catch (_) {}
        try { this.win.webContents.send('launcher:hover', hit); } catch (_) {}
      }
    }, 30);
  }

  _stopPolling() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.inputOn = false;
  }

  // ---------- 内部：调整模式（客户端按钮进入 → 桌面按住拖动 → 松手自动保存退出） ----------

  /** 开关调整模式。开启：整窗可点击可拖动、强制展开不自动收起；关闭：恢复矩形命中 */
  setAdjust(on) {
    // 窗口不存在（转盘未启用）时不改变状态，返回 false 让客户端提示
    if (!this.win || this.win.isDestroyed()) return false;
    this.adjusting = !!on;
    this.win.setIgnoreMouseEvents(!this.adjusting);
    this.win.webContents.send('launcher:adjust-mode', { on: this.adjusting });
    console.log(`[launcher] 调整模式${this.adjusting ? '开启' : '关闭'}`);
    if (this.onAdjustState) this.onAdjustState(this.adjusting);
    return this.adjusting;
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
    if (this.hwnd) {
      const r = desktop.getWindowRectScreen(this.hwnd);
      if (r) {
        const cfg = this.cfg;
        // ★ 拖动保存的是绝对坐标，九宫格让位（grid=null）。
        //   位置没变就不写盘（避免调整模式下的空点一下把定位模式切走）
        if (cfg.x !== r.x || cfg.y !== r.y || cfg.grid != null) {
          this.store.updateSettings({ launcher: { ...cfg, x: r.x, y: r.y, grid: null } });
          // 通知客户端刷新设置页：九宫格高亮复位为「自由摆放」状态
          if (this.onChanged) this.onChanged();
        }
      }
    }
    // 调整模式拖动落位完成 → 自动退出（客户端按钮经 adjust-state 事件复位）
    if (this.adjusting) this.setAdjust(false);
  }

  // ---------- 内部：快捷方式增删/启动 ----------

  async _addShortcuts() {
    const res = await dialog.showOpenDialog(this.win && !this.win.isDestroyed() ? this.win : undefined, {
      title: '选择要收纳的程序 / 快捷方式',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '程序与快捷方式', extensions: ['lnk', 'exe', 'url', 'bat', 'cmd'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (res.canceled || !res.filePaths.length) return 0;
    return this._ingestPaths(res.filePaths);
  }

  /** 把一批路径登记为转盘项（文件对话框与桌面拖拽共用） */
  async _ingestPaths(filePaths) {
    const cfg = this.cfg;
    const exist = new Set((cfg.shortcuts || []).map(s => s.path));
    const added = (filePaths || [])
      .filter(p => !exist.has(p) && (SC_EXTS.includes(path.extname(p).toLowerCase()) || APP_EXTS.includes(path.extname(p).toLowerCase())))
      .map(p => {
        const ext = path.extname(p).toLowerCase();
        const type = APP_EXTS.includes(ext) ? 'app' : 'shortcut';
        return { name: path.basename(p, ext), path: p, type };
      });
    if (added.length) this.applyPatch({ shortcuts: this._insertAfterPinned(cfg.shortcuts || [], added) });
    return added.length;
  }

  /**
   * 桌面拖到转盘「＋」上松手：
   * 来自桌面目录的项走与点选收纳同一条路（隐藏/移动到保管目录，桌面图标消失），
   * 其它位置的项只登记为转盘项。
   */
  async _dropPaths(filePaths) {
    const dirs = this._desktopDirs().map((d) => String(d).toLowerCase() + path.sep);
    const names = [], others = [];
    for (const p of filePaths || []) {
      if (!p) continue;
      const lp = String(p).toLowerCase();
      if (dirs.some((d) => lp.startsWith(d))) names.push(path.basename(p, path.extname(p)));
      else others.push(p);
    }
    let added = 0;
    if (names.length) {
      const skipped = { notFound: 0, noPerm: 0 };
      const { done, shortcuts, boxed, hidden } = await this._boxNames(names, skipped);
      if (done) {
        this.applyPatch({ shortcuts, boxed, hidden });
        desktop.notifyShellIconRefresh();
      }
      added += done;
    }
    if (others.length) added += await this._ingestPaths(others);
    return added;
  }

  /** 常用在前重排（稳定：两组内部各自保持原顺序）。
   *  ★ 渲染层按数组下标回传点击/移除，所以「常用优先」必须落成物理顺序，
   *    不能在 pushConfig 里临时重排 —— 那样下标就和 shortcuts 对不上了。 */
  _orderPinned(list) {
    const pinned = list.filter((s) => s && s.pinned);
    const rest = list.filter((s) => !s || !s.pinned);
    return [...pinned, ...rest];
  }

  /** 新条目插到最后一条「常用」之后（没有常用项时等价于追加到末尾） */
  _insertAfterPinned(list, added) {
    const k = list.findIndex((s) => !s || !s.pinned);
    return k < 0 ? [...list, ...added] : [...list.slice(0, k), ...added, ...list.slice(k)];
  }

  /** 设置/取消某条目的「常用」标记。取消时同样重排：失去标记的项退到常用区之后，
   *  否则「常用项占据列表前部」这一不变量会被破坏（渲染层按下标回传，顺序即语义）。 */
  setPinned(idx, on) {
    const cfg = this.cfg;
    const list = [...(cfg.shortcuts || [])];
    if (idx < 0 || idx >= list.length) return false;
    const next = !!on;
    if (!!list[idx].pinned === next) return true;
    list[idx] = { ...list[idx], pinned: next };
    this.applyPatch({ shortcuts: this._orderPinned(list) });
    return true;
  }

  _removeAt(idx) {
    const cfg = this.cfg;
    const list = [...(cfg.shortcuts || [])];
    const boxed = [...(cfg.boxed || [])];
    const hidden = [...(cfg.hidden || [])];
    if (idx < 0 || idx >= list.length) return;
    const [removed] = list.splice(idx, 1);
    // 隐藏项移除 = 恢复桌面图标（去隐藏属性 / 系统项删注册表值）
    if (removed) {
      const hIdx = hidden.findIndex((h) =>
        (removed.path && h.path && h.path === removed.path) || h.name === removed.name);
      if (hIdx >= 0) {
        const h = hidden[hIdx];
        hidden.splice(hIdx, 1);
        if (this._unhideOne(h)) {
          console.log(`[launcher] 已恢复桌面图标: ${h.name}`);
          desktop.notifyShellIconRefresh();
        } else {
          hidden.push(h); // 恢复失败保留记录，供"全部恢复"重试
        }
      }
      const bIdx = boxed.findIndex(b => b.boxPath === removed.path);
      if (bIdx >= 0) {
        const b = boxed[bIdx];
        boxed.splice(bIdx, 1);
        if (fs.existsSync(b.boxPath)) {
          const dst = this._restorePathFor(b.originPath);
          if (this._moveFile(b.boxPath, dst)) {
            console.log(`[launcher] 已恢复到桌面: ${b.name}`);
            desktop.notifyShellIconRefresh([dst]);
          } else {
            console.warn(`[launcher] 恢复失败（文件保留在保管目录）: ${b.name}`);
            boxed.push(b); // 保留记录，供"全部恢复"重试
          }
        }
      }
    }
    this.applyPatch({ shortcuts: list, boxed, hidden });
  }

  /**
   * 把保管目录中的全部收纳项移回桌面原位置。
   * 失败项保留（返回 remaining），调用方可继续持有记录供重试；
   * 结束后通知 Shell 重建图标缓存（修复恢复后快捷方式图标变白）。
   */
  _restoreAllBoxed() {
    const cfg = this.cfg;
    let restored = 0, failed = 0;
    const remaining = [];
    const restoredPaths = []; // 恢复成功的桌面目标路径（用于逐个刷新图标缓存）
    for (const b of cfg.boxed || []) {
      if (!fs.existsSync(b.boxPath)) continue; // 文件已不在保管目录（此前已恢复）→ 只丢弃记录
      const dst = this._restorePathFor(b.originPath);
      if (this._moveFile(b.boxPath, dst)) {
        restored++;
        restoredPaths.push(dst);
      } else { failed++; remaining.push(b); }
    }
    if ((cfg.boxed || []).length) {
      console.log(`[launcher] 恢复全部收纳项: 成功 ${restored} 失败 ${failed}${failed ? '（失败项保留记录，可重试）' : ''}`);
    }
    if (restored) desktop.notifyShellIconRefresh(restoredPaths);
    return { restored, failed, remaining };
  }

  _launch(idx) {
    const s = (this.cfg.shortcuts || [])[idx];
    if (!s) return;
    console.log(`[launcher] 启动: ${s.name} ← ${s.path} (type=${s.type || 'shortcut'})`);

    // 系统特殊项：直接走 shell: 协议（回收站/控制面板/网络/此电脑）
    if (s.type === 'system' && s.launch) {
      try {
        shell.openPath(s.launch).catch(() => {
          require('child_process').exec(`explorer.exe "${s.launch}"`, { windowsHide: true });
        });
      } catch (_) {}
      return;
    }

    const p = s.path;
    if (!p) return;
    // .bat/.cmd 脚本：openPath 可能被当作文本打开，统一用 cmd 执行
    if (s.type === 'app' && /\.(bat|cmd)$/i.test(p)) {
      try {
        require('child_process').exec(`cmd /c start "" "${p}"`, { windowsHide: true, timeout: 8000 });
      } catch (e2) {
        console.warn('[launcher] 脚本启动异常:', e2.message);
      }
      return;
    }

    shell.openPath(p).then((err) => {
      if (!err) return;
      console.warn(`[launcher] openPath 失败(${err})，改用 shell start 兜底: ${p}`);
      // 兜底：cmd start 走资源管理器语义，能解析 .lnk / .url / .exe，办公文档以关联程序打开
      try {
        require('child_process').exec(
          `cmd /c start "" "${p}"`,
          { windowsHide: true, timeout: 8000 },
          (e) => { if (e) console.warn(`[launcher] 兜底启动也失败: ${p}`, e.message); }
        );
      } catch (e2) {
        console.warn('[launcher] 启动兜底异常:', e2.message);
      }
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
      // ★ 不再挂入 Progman（Win11 24H2 呈现冻结）：选择器是模态拾取 UI，
      // 保持普通顶层窗口（可聚焦、正常呈现），用完即关。
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
  async _confirmPick(names) {
    this._closePicker();
    if (!Array.isArray(names) || !names.length) return { ok: true, boxed: 0, skipped: 0 };
    const skipped = { notFound: 0, noPerm: 0 };
    const { done, shortcuts, boxed, hidden } = await this._boxNames(names, skipped);
    if (done) {
      this.applyPatch({ shortcuts, boxed, hidden });
      desktop.notifyShellIconRefresh();
    }
    console.log(`[launcher] 桌面快捷方式收纳: ${done} 个（未匹配 ${skipped.notFound} / 无权限 ${skipped.noPerm}）`);
    // 主动带结果通知（applyPatch 内的 onChanged 无 payload，仅刷新）
    if (this.onChanged) this.onChanged({ picked: done, skipped: skipped.notFound + skipped.noPerm });
    return { ok: true, boxed: done, skipped: skipped.notFound + skipped.noPerm };
  }

  /**
   * 按显示名收纳一批桌面快捷方式（点选确认 / 一键全收共用）：
   * 非快捷方式（系统图标/文件夹）与公共桌面项自动跳过。
   * 每个文件让出一次事件循环 —— 一键全收几十个快捷方式时主界面不冻结。
   * @returns {Promise<{done:number, shortcuts:Array, boxed:Array}>} 合并后的完整新列表
   */
  async _boxNames(names, skipped) {
    const cfg = this.cfg;
    const shortcuts = [...(cfg.shortcuts || [])];
    const boxed = [...(cfg.boxed || [])];
    const hidden = [...(cfg.hidden || [])];
    // 资源管理器开了「显示隐藏的文件」或「显示受保护的操作系统文件」时，
    // 隐藏属性（HIDDEN|SYSTEM）藏不住图标 → 退回移动收纳
    let hideMode = cfg.collectMode === 'hide' && !desktop.explorerHidingUnusable();
    if (cfg.collectMode === 'hide' && !hideMode) {
      console.warn('[launcher] 资源管理器开启了「显示隐藏的文件 / 受保护的操作系统文件」，隐藏属性无法让图标消失 → 本次按「移动到收纳目录」收纳');
    }
    const existPaths = new Set(shortcuts.map(s => s.path));
    const existIds = new Set(shortcuts.map(s => s.sysId).filter(Boolean));
    let done = 0;
    for (const name of names) {
      await new Promise((r) => setImmediate(r));
      // ① 系统特殊项（回收站/控制面板/网络/此电脑）：无实体文件可移动，
      //    显示名/别名命中即按虚拟项收纳（修复"系统图标点选收纳失败"）。
      //    ★ 系统项恒走「隐藏到壁纸后」：注册表原生开关，恢复即在原位。
      const key = String(name).trim().toLowerCase();
      const sys = SYSTEM_ITEMS.find((it) =>
        [it.name, ...(it.aliases || [])].some((a) => String(a).toLowerCase() === key));
      if (sys) {
        if (!existIds.has(sys.id)) {
          if (desktop.setSystemIconHidden(sys.id, true)) {
            hidden.push({ name: sys.name, sysId: sys.id, clsid: sys.clsid, mode: 'registry' });
            shortcuts.push({ name: sys.name, path: `shell:${sys.id}`, type: 'system', sysId: sys.id, launch: sys.launch, clsid: sys.clsid });
            existIds.add(sys.id);
            done++;
          } else {
            skipped.noPerm++;
          }
        }
        continue;
      }
      const found = this._findShortcutFile(name);
      if (!found) { skipped.notFound++; continue; }  // 文件夹等非快捷方式
      if (found.publicDir) {
        console.warn(`[launcher] 跳过公共桌面项（需管理员）: ${name} @ ${found.file}`);
        skipped.noPerm++;
        continue;
      }
      if (hideMode) {
        // 原地隐藏：加 HIDDEN|SYSTEM（只加 HIDDEN 视图不重排，见 desktop.js 注释）。
        // ★ 仍要回读校验：这台机能成，别的机器（资源管理器设置不同、Win10 视图实现不同）
        //   不保证 —— 试一次没真消失就撤销属性并把整批降级为「移动到收纳目录」，
        //   绝不让用户看到「图标还在、却被记成已收纳」的假成功。
        const ic = (desktop.getDesktopIcons() || []).find((x) => x.name === name);
        let gone = false;
        if (desktop.setFileHiddenAttr(found.file, true)) {
          desktop.notifyShellIconRefresh([found.file]);
          for (let t = 0; t < 1600 && !gone; t += 200) {
            await new Promise((r) => setTimeout(r, 200));
            gone = !(desktop.getDesktopIcons() || []).some((x) => x.name === name);
          }
        }
        if (gone) {
          const ext = path.extname(found.file).toLowerCase();
          if (!existPaths.has(found.file)) {
            shortcuts.push({ name, path: found.file, type: APP_EXTS.includes(ext) ? 'app' : 'shortcut' });
            existPaths.add(found.file);
          }
          hidden.push({ name, path: found.file, x: ic ? ic.x : null, y: ic ? ic.y : null, mode: 'attr' });
          done++;
          continue;
        }
        desktop.setFileHiddenAttr(found.file, false);
        hideMode = false;
        console.warn('[launcher] 桌面视图未响应隐藏属性（多为资源管理器「显示隐藏/受保护文件」设置所致）→ 本次及后续按「移动到收纳目录」收纳');
      }
      const boxPath = this._boxPathFor(path.basename(found.file));
      if (!this._moveFile(found.file, boxPath)) {
        console.warn(`[launcher] 移动失败: ${found.file} → ${boxPath}`);
        skipped.noPerm++;
        continue;
      }
      if (!existPaths.has(boxPath)) {
        // 与 _addShortcuts 同一规则补 type，否则收纳来的条目缺字段走错分支
        const ext = path.extname(boxPath).toLowerCase();
        shortcuts.push({ name, path: boxPath, type: APP_EXTS.includes(ext) ? 'app' : 'shortcut' });
        existPaths.add(boxPath);
      }
      boxed.push({ name, originPath: found.file, boxPath });
      done++;
    }
    return { done, shortcuts, boxed, hidden };
  }

  /** 恢复一条隐藏项（attr = 去隐藏属性并写回坐标；registry = 删注册表值） */
  _unhideOne(h) {
    if (h.mode === 'registry') return desktop.setSystemIconHidden(h.sysId, false);
    if (!desktop.setFileHiddenAttr(h.path, false)) return false;
    if (h.x != null && h.y != null) desktop.showDesktopIcon(h.name, h.x, h.y);
    return true;
  }

  /** 恢复全部隐藏项；失败项保留在 remaining 供重试 */
  _restoreAllHidden() {
    const remaining = [];
    for (const h of (this.cfg.hidden || [])) {
      if (!this._unhideOne(h)) remaining.push(h);
    }
    return remaining;
  }

  /**
   * 一键收纳桌面全部快捷方式（仿 Wallpaper Engine「收纳桌面图标」）：
   * ★ 直接枚举桌面目录的 .lnk/.url 文件（不再按图标显示名反查）——
   *   显示名 ≠ 文件名的快捷方式（如显示"腾讯QQ"文件名"QQ.lnk"）也能收全，
   *   修复"没有完全收纳进去"。
   * 公共桌面（所有用户）项普通权限删不动 → 返回 publicLeft，
   * 由设置页提供"管理员授权收纳"入口（boxPublic，UAC 一次授权批量移动）。
   */
  async boxAll() {
    const cfg = this.cfg;
    const shortcuts = [...(cfg.shortcuts || [])];
    const boxed = [...(cfg.boxed || [])];
    const existPaths = new Set(shortcuts.map(s => s.path));
    const existIds = new Set(shortcuts.map(s => s.sysId).filter(Boolean));
    let done = 0;
    let publicLeft = 0; // 公共桌面普通权限收不进的数目（需 boxPublic 管理员授权）

    const boxOne = (origin) => {
      const boxPath = this._boxPathFor(path.basename(origin));
      if (!this._moveFile(origin, boxPath)) return false;
      const name = path.basename(origin, path.extname(origin));
      const ext = path.extname(origin).toLowerCase();
      const type = APP_EXTS.includes(ext) ? 'app' : 'shortcut'; // .lnk / .url
      if (!existPaths.has(boxPath)) {
        shortcuts.push({ name, path: boxPath, type });
        existPaths.add(boxPath);
      }
      boxed.push({ name, originPath: origin, boxPath });
      return true;
    };

    // 1) 所有桌面目录（用户桌面 / OneDrive 重定向桌面 / 公共桌面）：直接枚举全部可收纳文件
    const publicDir = this._publicDesktop().toLowerCase();
    for (const dir of this._desktopDirs()) {
      const isPublic = dir.toLowerCase() === publicDir;
      for (const f of this._collectShortcuts(dir)) {
        await new Promise((r) => setImmediate(r)); // 逐文件让出事件循环，大批量不冻结 UI
        if (boxOne(f)) done++;
        else if (isPublic) publicLeft++;
      }
    }

    // 2) 系统特殊项（回收站/控制面板/网络/此电脑）：无实体文件，作为虚拟项收纳。
    //    参照 Wallpaper Engine：读取桌面图标列表，只收纳「实际显示在桌面上」的系统图标
    //    （Win11 默认隐藏这些图标，需在「个性化→主题→桌面图标设置」手动开启才显示）。
    let sysAdded = 0;
    const desktopIcons = desktop.getDesktopIcons() || [];
    const iconNames = new Set(desktopIcons.map(ic => ic.name.trim()));
    for (const sys of SYSTEM_ITEMS) {
      if (existIds.has(sys.id)) continue;
      // 仅当该系统图标确实显示在桌面上时才收纳（显示名可本地化，做别名匹配）
      const aliases = (sys.aliases || [sys.name]).map(a => a.trim().toLowerCase());
      if (![...iconNames].some(n => aliases.includes(n.toLowerCase()))) continue;
      shortcuts.push({ name: sys.name, path: `shell:${sys.id}`, type: 'system', sysId: sys.id, launch: sys.launch, clsid: sys.clsid });
      existIds.add(sys.id);
      sysAdded++;
    }
    if (sysAdded) done += sysAdded;

    if (done) {
      this.applyPatch({ shortcuts, boxed });
      desktop.notifyShellIconRefresh();
    }
    const summary = this._boxSummary();
    console.log(`[launcher] 一键收纳全部: ${done} 个（含系统项 ${sysAdded}；公共桌面待授权 ${publicLeft} · 桌面剩余文件夹 ${summary.folders}）`);
    if (this.onChanged) this.onChanged({ picked: done, skipped: 0 });
    return { ok: true, boxed: done, publicLeft, ...summary };
  }

  /** 枚举目录中可收纳的文件（.lnk/.url 快捷方式 + 程序 .exe/.bat/.cmd）。
   *  办公文档与文件夹已拆分到 filebox.js（文件收纳区）。
   *  过滤垃圾：._* （macOS 资源 fork，如 ._cache_geek.exe）、~$*（Office 锁文件） */
  _collectShortcuts(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true })
        .filter((f) => f.isFile()
          && !f.name.startsWith('._')
          && !f.name.startsWith('~$')
          && ALL_BOX_EXTS.includes(path.extname(f.name).toLowerCase()))
        .map((f) => path.join(dir, f.name));
    } catch (_) {
      return [];
    }
  }

  /** 公共桌面路径（所有用户共享，修改需要管理员） */
  _publicDesktop() {
    return path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'Desktop');
  }

  /**
   * 全部桌面目录（去重）：用户桌面 + OneDrive 重定向桌面 + 公共桌面。
   * 开启 OneDrive 备份/同步"桌面"后，explorer 会把 OneDrive\Desktop
   * 合并显示在桌面上 —— 只扫用户桌面会漏掉这批快捷方式
   * （修复"没有完全收纳进去"的主要场景）。
   */
  _desktopDirs() {
    const dirs = [app.getPath('desktop')];
    const oneDrive = process.env.OneDrive || process.env.ONEDRIVE;
    const candidates = [];
    if (oneDrive) candidates.push(path.join(oneDrive, 'Desktop'), path.join(oneDrive, '桌面'));
    candidates.push(
      path.join(process.env.USERPROFILE || '', 'OneDrive', 'Desktop'),
      path.join(process.env.USERPROFILE || '', 'OneDrive', '桌面'),
    );
    for (const c of candidates) {
      try { if (c && fs.existsSync(c) && fs.statSync(c).isDirectory()) dirs.push(c); } catch (_) {}
    }
    dirs.push(this._publicDesktop());
    // 去重（大小写不敏感）
    const seen = new Set();
    return dirs.filter((d) => {
      const k = d.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  /** 收纳后桌面剩余情况（文件夹 / 非快捷方式文件 / 公共桌面待授权数） */
  _boxSummary() {
    let folders = 0, otherFiles = 0;
    try {
      for (const d of fs.readdirSync(app.getPath('desktop'), { withFileTypes: true })) {
        if (d.isDirectory()) folders++;
        else if (!SC_EXTS.includes(path.extname(d.name).toLowerCase())) otherFiles++;
      }
    } catch (_) {}
    const publicLeft = this._collectShortcuts(this._publicDesktop()).length;
    return { folders, otherFiles, publicLeft };
  }

  /**
   * 管理员授权收纳公共桌面快捷方式（boxAll 后设置页按钮触发）：
   * 生成 PowerShell 脚本 → Start-Process -Verb RunAs（UAC 确认一次）→
   * 批量 Move-Item 到保管目录 → 轮询结果文件回读成败。
   * UAC 被拒绝 → declined=true；脚本与结果文件用后即删。
   */
  boxPublic() {
    return new Promise((resolve) => {
      const files = this._collectShortcuts(this._publicDesktop());
      if (!files.length) return resolve({ ok: true, moved: 0, failed: 0, declined: false });
      const cfg = this.cfg;
      const shortcuts = [...(cfg.shortcuts || [])];
      const boxed = [...(cfg.boxed || [])];
      const existPaths = new Set(shortcuts.map(s => s.path));
      const pairs = files.map((f) => ({ src: f, dst: this._boxPathFor(path.basename(f)) }));

      const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;
      const scriptPath = path.join(this.boxDir, '.box-admin.ps1');
      const resultPath = path.join(this.boxDir, '.box-admin-result.txt');
      try { fs.unlinkSync(resultPath); } catch (_) {}
      const script = [
        '$ErrorActionPreference = "Continue"',
        '$moved = @()',
        'foreach ($p in @(' + pairs.map((x) => `@{src=${esc(x.src)}; dst=${esc(x.dst)}}`).join(', ') + ')) {',
        '  try {',
        '    Move-Item -LiteralPath $p.src -Destination $p.dst -ErrorAction Stop',
        "    $moved += ('OK|' + $p.src + '|' + $p.dst)",
        '  } catch { }',
        '}',
        `[System.IO.File]::WriteAllText(${esc(resultPath)}, ($moved -join [char]10), (New-Object System.Text.UTF8Encoding($true)))`,
      ].join('\r\n');
      fs.writeFileSync(scriptPath, '\ufeff' + script, 'utf8'); // BOM：PS 正确读中文路径

      const cleanup = () => {
        try { fs.unlinkSync(scriptPath); } catch (_) {}
        try { fs.unlinkSync(resultPath); } catch (_) {}
      };
      const finish = (movedPairs, declined) => {
        cleanup();
        let moved = 0;
        for (const p of movedPairs) {
          const name = path.basename(p.src, path.extname(p.src));
          if (!existPaths.has(p.dst)) {
            shortcuts.push({ name, path: p.dst });
            existPaths.add(p.dst);
          }
          boxed.push({ name, originPath: p.src, boxPath: p.dst });
          moved++;
        }
        if (moved) this.applyPatch({ shortcuts, boxed });
        if (moved) desktop.notifyShellIconRefresh();
        const movedSet = new Set(movedPairs.map((p) => p.src));
        const failed = pairs.filter((p) => !movedSet.has(p.src)).length;
        console.log(`[launcher] 管理员收纳公共桌面: 成功 ${moved} / 失败 ${failed}${declined ? '（UAC 被拒绝）' : ''}`);
        resolve({ ok: moved > 0, moved, failed, declined });
      };

      // UAC：Start-Process -Verb RunAs 被拒绝时外层 powershell 非零退出
      const child = require('child_process').spawn('powershell', ['-NoProfile', '-Command',
        `Start-Process powershell -Verb RunAs -WindowStyle Hidden -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${esc(scriptPath)})`], { windowsHide: true });
      let declined = false;
      child.on('error', () => { declined = true; });
      child.on('exit', (code) => { if (code !== 0) declined = true; });

      const t0 = Date.now();
      const poll = setInterval(() => {
        if (declined) { clearInterval(poll); return finish([], true); }
        let raw = null;
        try { raw = fs.readFileSync(resultPath, 'utf8'); } catch (_) {}
        if (raw === null) {
          if (Date.now() - t0 > 120000) { clearInterval(poll); return finish([], false); } // 超时（脚本未完成）
          return;
        }
        clearInterval(poll);
        const movedPairs = [];
        for (const line of raw.split('\n')) {
          const t = line.trim().replace(/^\ufeff/, '');
          if (!t) continue;
          const [st, src, dst] = t.split('|');
          if (st === 'OK' && src && dst) movedPairs.push({ src, dst });
        }
        finish(movedPairs, false);
      }, 600);
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
    ipcMain.handle('launcher:drop-paths', async (_e, paths) => {
      const arr = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p) : [];
      const n = arr.length ? await this._dropPaths(arr) : 0;
      return { ok: true, added: n };
    });
    ipcMain.handle('launcher:pick', () => this.openPicker());
    ipcMain.on('picker:confirm', (_e, names) => this._confirmPick(names));
    ipcMain.on('picker:cancel', () => this._closePicker());
    ipcMain.handle('launcher:box-all', () => this.boxAll());
    ipcMain.handle('launcher:box-public', () => this.boxPublic());
    ipcMain.handle('launcher:remove-at', (_e, idx) => {
      this._removeAt(idx);
      return { ok: true };
    });
    ipcMain.handle('launcher:set-pinned', (_e, { idx, on } = {}) => {
      const ok = this.setPinned(Number(idx) | 0, !!on);
      return { ok };
    });
    ipcMain.handle('launcher:restore-all', () => {
      const cfg = this.cfg;
      const { restored, failed, remaining } = this._restoreAllBoxed();
      // 恢复成功的清出转盘；失败项保留记录（文件仍在保管目录，可再次恢复）
      // ★ 用 boxed 的 boxPath 全集过滤：恢复成功的项（含从桌面收纳的）应移除，
      //   失败项(remaining)保留。否则 remaining 为空时 filter 恒真，shortcuts 残留
      //   指向已移回桌面的文件 → 转盘显示"幽灵"空白图标。
      const failedSet = new Set(remaining.map(b => b.boxPath));
      const hiddenRemaining = this._restoreAllHidden();
      const hiddenFailed = new Set(hiddenRemaining.map(h => h.name));
      const restoredHidden = new Set((cfg.hidden || [])
        .filter((h) => !hiddenFailed.has(h.name)).map((h) => h.name));
      this.applyPatch({
        shortcuts: (cfg.shortcuts || []).filter(s =>
          (!cfg.boxed.some(b => b.boxPath === s.path) || failedSet.has(s.path))
          && (!restoredHidden.has(s.name) || hiddenFailed.has(s.name))),
        boxed: remaining,
        hidden: hiddenRemaining,
      });
      return { ok: true, restored, failed };
    });
    ipcMain.handle('launcher:get', async () => {
      const cfg = this.cfg;
      const boxSet = new Set((cfg.boxed || []).map(b => b.boxPath));
      const shortcuts = [];
      for (const s of cfg.shortcuts || []) {
        const icon = await this._iconFor(s);
        shortcuts.push({ ...s, icon, boxed: boxSet.has(s.path) });
      }
      return { ...cfg, shortcuts };
    });
  }
}

module.exports = { LauncherHost };
