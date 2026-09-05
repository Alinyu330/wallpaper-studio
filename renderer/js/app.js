// app.js — 主界面逻辑
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  wallpapers: [],
  current: null,       // {wallpaper, params} 当前已应用的壁纸
  selected: null,      // {wallpaper, params} 当前选中（预览）的壁纸
  settings: null,
  filter: 'all',
  search: '',
  display: null,       // 主显示器信息（预览比例用）
  pausedAll: false,    // 全局暂停（视频冻结 + 轮换停止）
  update: null,        // {hasUpdate, current, latest, releaseUrl, notes?, installerUrl?, error?}
};

const TYPE_LABEL = { image: '图片', video: '视频', exe: '程序', web: '网页' };
const DEFAULT_PARAMS = {
  speed: 1, brightness: 0, contrast: 0, saturation: 0,
  volume: 70, mute: false, paused: false, loop: true,
  fit: 'cover', quality: 'high', resolution: 'source',
};

// ---------- 类型图标（SVG） ----------
const ICONS = {
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="#7c5cff" stroke-width="1.4"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5l5 2.5-5 2.5v-5z" fill="#7c5cff" stroke="none"/></svg>',
  exe: '<svg viewBox="0 0 24 24" fill="none" stroke="#ff5c6c" stroke-width="1.4"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M9 9l6 6M15 9l-6 6" stroke-linecap="round"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="#4f8cff" stroke-width="1.4"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.3 3.8 5.3 3.8 8.5S14.5 18.2 12 20.5c-2.5-2.3-3.8-5.3-3.8-8.5S9.5 5.8 12 3.5z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.5 5.1 5.6.8-4 4 .9 5.6L12 16.5l-5 2.6.9-5.6-4-4 5.6-.8L12 3.6z" fill="currentColor"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m3 0l-.8 12a2 2 0 01-2 1.9H8.8a2 2 0 01-2-1.9L6 7" stroke-linecap="round"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 012-2h4l2 2.5h8a2 2 0 012 2V17a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke-linecap="round"/></svg>',
};

// ---------- 初始化 ----------
async function init() {
  const store = await window.api.getStore();
  state.wallpapers = store.wallpapers || [];
  state.current = store.current;
  state.settings = store.settings;

  renderGrid();
  renderParamsPanel();
  renderRotationSettings();
  renderWidgetsSettings();
  renderSites();
  renderSettingsPage();
  renderLauncherSettings();
  renderFileboxSettings();
  renderAudioVizSettings();
  checkMpv();
  loadDisplayInfo();
  refreshLockScreenDetail();
  bindNav();
  bindToolbar();
  bindFilter();
  bindSearch();
  bindDragDrop();
  bindParamsPanel();
  bindModal();
  bindWindowControls();
  bindUpdateCheck();
  renderAboutVersion();

  // 全局暂停状态恢复
  state.pausedAll = !!state.settings.wallpaperPaused;
  updatePauseAllButton();
  updateStopButton();

  // 默认选中当前应用的壁纸，直接预览
  if (state.current) {
    const wp = state.wallpapers.find(w => w.id === state.current.wallpaper.id) || state.current.wallpaper;
    selectWallpaper(wp, state.current.params);
  }

  // 订阅主进程推送
  window.api.on('wallpaper:list-changed', (list) => {
    state.wallpapers = list;
    // 选中项可能已被移除
    if (state.selected && !list.find(w => w.id === state.selected.wallpaper.id)) {
      state.selected = null;
    }
    renderGrid();
    renderParamsPanel();
    renderRotationQueue(); // 轮换队列跟随壁纸库变化
  });
  window.api.on('wallpaper:current-changed', (d) => {
    state.current = d || null;
    // 该事件在过渡动画进行中就会到达，此时只更新标记，绝不重建网格
    syncGridSelection();
    renderParamsPanel();
    updateStopButton();
    renderRotationQueue(); // 队列中"当前"标记跟随切换
  });
  window.api.on('wallpaper:params-updated', (params) => {
    if (state.current) state.current.params = params;
    if (state.selected && state.current && state.selected.wallpaper.id === state.current.wallpaper.id) {
      state.selected.params = { ...state.selected.params, ...params };
    }
  });
  window.api.on('wallpaper:exe-exited', ({ name }) => toast(`程序壁纸「${name}」已退出`, 'error'));
  // 更新检查结果（主进程静默推送）：只做文字与亮点提示，绝不弹窗
  window.api.on('update:status', (result) => {
    state.update = result;
    renderUpdateStatus();
  });
  // 音律动效实时状态（捕获状态 + 电平）→ 设置页指示器
  window.api.on('audioViz:status', (s) => updateAvStatusMeter(s));
  // 配置同步：主进程写入后（桌面拖动保存位置等）回写本地 state，
  // 防止界面下一次保存用旧 state 覆盖新值（enabled/posX 被抹掉的根源）
  window.api.on('settings:sync', (s) => {
    if (s && typeof s === 'object') state.settings = s;
    syncAdjRows();
    syncPerfTierUi();
    maybeRenderBoardEditor();
  });
  // 硬件加速等「app ready 前才生效」的设置改动 / GPU 崩溃自愈 → 提示重启
  window.api.on('perf:restart-required', (info) => showRestartBanner(info));
  // 快捷方式转盘变化（收纳结果/移除/恢复）→ 刷新设置页
  window.api.on('launcher:changed', (result) => {
    renderLauncherSettings();
    if (result && typeof result.picked === 'number') {
      if (result.picked > 0) {
        toast(`已收纳 ${result.picked} 个快捷方式到转盘${result.skipped ? `（跳过 ${result.skipped} 个非快捷方式/无权限项）` : ''}`);
      } else if (result.skipped) {
        toast(`未收纳任何项（跳过 ${result.skipped} 个非快捷方式/无权限项）`, 'error');
      }
    }
  });
  window.api.on('wallpaper:paused-changed', (paused) => {
    state.pausedAll = !!paused;
    state.settings.wallpaperPaused = !!paused;
    updatePauseAllButton();
  });
  // 调整模式状态回传（主进程为权威，拖动结束自动退出）：同步按钮文案与设置页
  window.api.on('widgets:adjust-state', ({ key, on }) => {
    if (key === 'aviz') {
      avAdjusting = !!on;
      setAdjustBtnUi('#btn-av-adjust', '#av-adjust-hint', avAdjusting, '动效');
      if (!on) renderAudioVizSettings();
    } else {
      wgAdjustingKey = on ? key : (wgAdjustingKey === key ? null : wgAdjustingKey);
      renderWidgetsSettings();
    }
  });
  window.api.on('launcher:adjust-state', ({ on }) => {
    lcAdjusting = !!on;
    setAdjustBtnUi('#btn-lc-adjust', '#lc-adjust-hint', lcAdjusting, '转盘');
    if (!on) renderLauncherSettings();
  });
  // 文件收纳区变化（收纳结果/移除/恢复）→ 刷新设置页
  window.api.on('filebox:changed', (result) => {
    renderFileboxSettings();
    if (result && typeof result.picked === 'number' && result.picked > 0) {
      toast(`已收纳 ${result.picked} 个文件/文件夹到文件收纳区`);
    }
  });
  window.api.on('filebox:adjust-state', ({ on }) => {
    fbAdjusting = !!on;
    setAdjustBtnUi('#btn-fb-adjust', '#fb-adjust-hint', fbAdjusting, '收纳区');
    if (!on) renderFileboxSettings();
  });
}

// ---------- 全局暂停 / 下一张 ----------
function updatePauseAllButton() {
  const btn = $('#btn-pause-all');
  if (!btn) return;
  const label = btn.querySelector('span');
  label.textContent = state.pausedAll ? '恢复壁纸' : '暂停壁纸';
  btn.title = state.pausedAll ? '恢复视频播放与定时轮换' : '暂停视频播放与轮换，恢复桌面清爽';
}

async function togglePauseAll() {
  const res = await window.api.pauseAll(!state.pausedAll);
  state.pausedAll = !!res.paused;
  updatePauseAllButton();
  toast(state.pausedAll ? '壁纸已暂停（视频冻结、轮换停止）' : '壁纸已恢复');
}

// ---------- 停止使用壁纸 ----------
function updateStopButton() {
  const btn = $('#btn-stop-wallpaper');
  if (!btn) return;
  btn.disabled = !state.current;
}

async function stopUsingWallpaper() {
  await window.api.stopWallpaper();
  state.current = null;
  syncGridSelection();
  renderParamsPanel();
  updateStopButton();
  toast('已停止使用壁纸，桌面恢复系统默认');
}

// ---------- 导航 ----------
function bindNav() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach(b => b.classList.toggle('active', b === btn));
      const page = btn.dataset.page;
      $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
      // 轮换队列视频不自动播放（省 CPU、不打扰）：悬停缩略图时才播放，移开暂停
      if (page !== 'rotation') {
        document.querySelectorAll('#rot-queue video').forEach(v => v.pause());
      }
    });
  });
}

// ---------- 工具栏 ----------
function bindToolbar() {
  $('#btn-add-files').addEventListener('click', async () => {
    const added = await window.api.addFiles();
    if (added.length) toast(`已导入 ${added.length} 个壁纸`);
    else if (added.length === 0 && state.wallpapers.length === 0) toast('未选择有效的壁纸文件', 'error');
  });
  $('#btn-add-web').addEventListener('click', () => {
    $('#modal-web').classList.remove('hidden');
    $('#web-url-input').focus();
  });
  $('#btn-pause-all').addEventListener('click', togglePauseAll);
  $('#btn-stop-wallpaper').addEventListener('click', stopUsingWallpaper);
  $('#btn-rotation-next').addEventListener('click', async () => {
    const r = await window.api.rotationNext();
    if (r.ok) toast(`已切换到「${r.name}」`);
    else toast(r.error || '暂无可切换的壁纸', 'error');
  });
}

// ---------- 筛选 / 搜索 ----------
function bindFilter() {
  $$('#filter-bar .chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('#filter-bar .chip').forEach(c => c.classList.toggle('active', c === chip));
      state.filter = chip.dataset.filter;
      renderGrid();
    });
  });
}

function bindSearch() {
  let debounce = null;
  $('#search-input').addEventListener('input', (e) => {
    clearTimeout(debounce);
    const v = e.target.value.trim().toLowerCase();
    debounce = setTimeout(() => { state.search = v; renderGrid(); }, 120);
  });
}

// ---------- 拖拽导入 ----------
function bindDragDrop() {
  let dragCounter = 0;
  document.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    $('#drop-hint').classList.remove('hidden');
  });
  document.addEventListener('dragleave', (e) => {
    e.preventDefault();
    if (--dragCounter <= 0) { dragCounter = 0; $('#drop-hint').classList.add('hidden'); }
  });
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    $('#drop-hint').classList.add('hidden');
    const files = [...e.dataTransfer.files].map(f => window.api.getFilePath(f)).filter(Boolean);
    if (files.length) {
      const added = await window.api.addPaths(files);
      toast(added.length ? `已导入 ${added.length} 个壁纸` : '文件格式不支持', added.length ? '' : 'error');
    }
  });
}

// ---------- 壁纸网格 ----------
function renderGrid() {
  const grid = $('#grid');
  const empty = $('#empty-state');
  let list = state.wallpapers;
  if (state.search) list = list.filter(w => w.name.toLowerCase().includes(state.search));
  if (state.filter === 'favorite') list = list.filter(w => w.favorite);
  else if (state.filter !== 'all') list = list.filter(w => w.type === state.filter);

  // 旧卡片即将整体销毁，先释放观察器对其中 video 元素的引用
  releaseLazyThumbs(grid);
  grid.innerHTML = '';
  empty.classList.toggle('hidden', list.length > 0);
  if (!list.length) {
    const title = empty.querySelector('.empty-title');
    const sub = empty.querySelector('.empty-sub');
    if (state.wallpapers.length === 0) {
      title.textContent = '还没有壁纸';
      sub.innerHTML = '点击「添加壁纸文件」或将文件拖入窗口<br>支持 JPG / PNG / GIF / MP4 / AVI / MKV / EXE / HTML 等格式';
    } else {
      title.textContent = '没有匹配的壁纸';
      sub.textContent = '换个关键词或筛选条件试试';
    }
    return;
  }

  for (const wp of list) {
    grid.appendChild(createCard(wp));
  }
}

// 视频缩略图懒加载：进入视口附近才解码首帧。
// 一次性给整页卡片都挂上 <video src> 会同时开几十路硬件解码，
// 与桌面壁纸的 mpv 抢解码器/GPU，是操作时卡顿乃至整窗变黑的主要来源之一。
let thumbObserver = null;
function getThumbObserver() {
  if (!thumbObserver) {
    thumbObserver = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const v = en.target;
        thumbObserver.unobserve(v);
        const src = v.dataset.src;
        delete v.dataset.src;
        if (src) v.src = src;
      }
    }, { rootMargin: '300px' });
  }
  return thumbObserver;
}

/**
 * 容器即将整体清空时，释放观察器对其中待加载 video 的引用。
 * 观察器被主网格 / 轮换队列 / 自定义选择网格共用，故不能 disconnect()，
 * 否则会连带取消其他容器里尚未进入视口的缩略图加载。
 */
function releaseLazyThumbs(root) {
  if (!thumbObserver || !root) return;
  root.querySelectorAll('video[data-src]').forEach((v) => thumbObserver.unobserve(v));
}

function createCard(wp) {
  const isCurrent = !!(state.current && state.current.wallpaper.id === wp.id);
  const isSelected = !!(state.selected && state.selected.wallpaper.id === wp.id);
  const card = document.createElement('div');
  card.className = 'wallpaper-card' + (isCurrent ? ' current' : '') + (isSelected ? ' selected' : '');
  card.dataset.id = wp.id; // syncGridSelection 靠它定位卡片，避免整网格重建

  // 缩略图
  const thumb = document.createElement('div');
  thumb.className = `thumb ${wp.type}`;
  if (wp.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = 'file:///' + wp.path.replace(/\\/g, '/');
    img.onerror = () => img.remove();
    thumb.appendChild(img);
  } else if (wp.type === 'video') {
    // 尝试用 video 元素取第一帧作缩略图（Chromium 支持的格式），失败显示图标
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.dataset.src = 'file:///' + wp.path.replace(/\\/g, '/') + '#t=0.5';
    v.onerror = () => v.remove();
    thumb.appendChild(v);
    getThumbObserver().observe(v);
    const ic = document.createElement('div');
    ic.className = 'type-icon';
    ic.innerHTML = ICONS.video;
    thumb.appendChild(ic);
    v.addEventListener('loadeddata', () => ic.remove());
  } else {
    const ic = document.createElement('div');
    ic.className = 'type-icon';
    ic.innerHTML = ICONS[wp.type] || ICONS.web;
    thumb.appendChild(ic);
  }

  const badge = document.createElement('span');
  badge.className = `type-badge ${wp.type}`;
  badge.textContent = TYPE_LABEL[wp.type];
  thumb.appendChild(badge);

  if (isCurrent) {
    const using = document.createElement('span');
    using.className = 'using-badge';
    using.textContent = '使用中';
    thumb.appendChild(using);
  }

  const overlay = document.createElement('div');
  overlay.className = 'apply-overlay';
  overlay.textContent = isCurrent ? '双击重新应用' : '单击预览 · 双击设为壁纸';
  thumb.appendChild(overlay);

  // 单击 = 选中并预览；双击 = 应用为桌面壁纸
  thumb.addEventListener('click', () => selectWallpaper(wp));
  thumb.addEventListener('dblclick', () => applySelected());
  card.appendChild(thumb);

  // 信息行
  const info = document.createElement('div');
  info.className = 'card-info';
  const name = document.createElement('span');
  name.className = 'card-name';
  name.title = wp.name;
  name.textContent = wp.name;
  info.appendChild(name);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const fav = document.createElement('button');
  fav.className = 'icon-btn' + (wp.favorite ? ' active' : '');
  fav.title = wp.favorite ? '取消收藏' : '收藏';
  fav.innerHTML = ICONS.star;
  fav.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.favorite(wp.id, !wp.favorite);
  });
  actions.appendChild(fav);

  if (wp.type !== 'web') {
    const loc = document.createElement('button');
    loc.className = 'icon-btn';
    loc.title = '打开所在位置';
    loc.innerHTML = ICONS.folder;
    loc.addEventListener('click', (e) => {
      e.stopPropagation();
      window.api.showInFolder(wp.path);
    });
    actions.appendChild(loc);
  }

  const del = document.createElement('button');
  del.className = 'icon-btn';
  del.title = '从库中移除';
  del.innerHTML = ICONS.trash;
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    await window.api.remove(wp.id);
    toast('已移除');
  });
  actions.appendChild(del);

  info.appendChild(actions);
  card.appendChild(info);
  return card;
}

// ---------- 选中与预览 ----------
/**
 * 只同步网格上的「选中 / 使用中」状态，不重建卡片。
 * renderGrid() 会为每张视频壁纸重新创建一个缩略图解码器，而单击预览、应用壁纸、
 * 当前壁纸变更都会触发它 —— 大量解码器同时销毁重建会把 GPU 进程打满，
 * 表现为界面卡顿甚至整窗变黑。
 */
function syncGridSelection() {
  const curId = state.current ? state.current.wallpaper.id : null;
  const selId = state.selected ? state.selected.wallpaper.id : null;
  for (const card of $$('#grid .wallpaper-card')) {
    const isCurrent = card.dataset.id === curId;
    card.classList.toggle('current', isCurrent);
    card.classList.toggle('selected', card.dataset.id === selId);
    const thumb = card.querySelector('.thumb');
    if (!thumb) continue;
    const overlay = thumb.querySelector('.apply-overlay');
    let using = thumb.querySelector('.using-badge');
    if (isCurrent && !using) {
      using = document.createElement('span');
      using.className = 'using-badge';
      using.textContent = '使用中';
      // 保持与 createCard 一致的层叠顺序（徽标在悬浮提示之下）
      if (overlay) thumb.insertBefore(using, overlay);
      else thumb.appendChild(using);
    } else if (!isCurrent && using) {
      using.remove();
    }
    if (overlay) {
      const text = isCurrent ? '双击重新应用' : '单击预览 · 双击设为壁纸';
      if (overlay.textContent !== text) overlay.textContent = text;
    }
  }
}

/** 向预览弹出窗口推送完整预览数据（选中变化/弹窗打开时） */
function syncPreviewFull() {
  const sel = state.selected;
  if (!sel) return;
  window.api.syncPreview({ wallpaper: sel.wallpaper, params: sel.params, display: state.display });
}

function selectWallpaper(wp, params) {
  state.selected = {
    wallpaper: wp,
    params: { ...DEFAULT_PARAMS, ...(wp.params || {}), ...(params || {}) },
  };
  syncGridSelection();
  renderParamsPanel();
  renderPreview();
  syncPreviewFull();
}

/** 应用当前选中的壁纸为桌面壁纸 */
async function applySelected() {
  const sel = state.selected;
  if (!sel) return;
  // 参数随 apply 一次送达：再补一次 updateParams 会因分辨率/质量差异触发 mpv 重启，
  // 正好打断淡入过渡，用户看到的就是切换瞬间卡一下
  const res = await window.api.apply(sel.wallpaper.id, sel.params);
  if (!res.ok) { toast(res.error, 'error'); return; }
  state.current = { wallpaper: sel.wallpaper, params: { ...sel.params } };
  syncGridSelection();
  renderParamsPanel();
  updateStopButton();
  syncPreviewFull();
  toast(`已应用「${sel.wallpaper.name}」`);
}

// 参数 → CSS 滤镜（mpv 语义: -100~100 → CSS: 0~2）
function buildFilter(p) {
  const b = (100 + (p.brightness || 0)) / 100;
  const c = (100 + (p.contrast || 0)) / 100;
  const s = (100 + (p.saturation || 0)) / 100;
  return `brightness(${b}) contrast(${c}) saturate(${s})`;
}

/** 构建预览媒体元素（选择变化时） */
let previewKey = null; // 当前预览元素对应的壁纸，避免反复销毁重建全分辨率解码器
function renderPreview() {
  const stage = $('#preview-stage');
  const ph = $('#preview-placeholder');
  const sel = state.selected;
  if (!sel) {
    previewKey = null;
    stage.querySelectorAll('img,video,iframe').forEach(el => el.remove());
    ph.classList.remove('hidden');
    ph.textContent = '预览区';
    return;
  }
  const wp = sel.wallpaper;
  // 同一张壁纸（重复点击、参数刷新）不重建元素：视频预览是全分辨率硬解，
  // 反复销毁重建会与桌面 mpv 抢解码器，是操作时卡顿的一大来源
  const key = `${wp.type}:${wp.id}`;
  if (key === previewKey && (wp.type === 'exe' || stage.querySelector('img,video,iframe'))) {
    applyPreviewParams();
    return;
  }
  previewKey = key;
  stage.querySelectorAll('img,video,iframe').forEach(el => el.remove());
  if (wp.type === 'image') {
    ph.classList.add('hidden');
    const img = document.createElement('img');
    img.src = 'file:///' + wp.path.replace(/\\/g, '/');
    img.onerror = () => { img.remove(); ph.classList.remove('hidden'); ph.textContent = '无法加载图片'; };
    stage.appendChild(img);
  } else if (wp.type === 'video') {
    ph.classList.add('hidden');
    const v = document.createElement('video');
    v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
    v.src = 'file:///' + wp.path.replace(/\\/g, '/');
    v.onerror = () => { v.remove(); ph.classList.remove('hidden'); ph.textContent = '浏览器不支持该视频编码，实际壁纸由 mpv 播放'; };
    stage.appendChild(v);
  } else if (wp.type === 'web') {
    ph.classList.add('hidden');
    const f = document.createElement('iframe');
    const url = wp.url || wp.path;
    f.src = /^https?:/i.test(url) ? url : 'file:///' + wp.path.replace(/\\/g, '/');
    f.setAttribute('allow', 'autoplay; fullscreen');
    f.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    stage.appendChild(f);
  } else {
    ph.classList.remove('hidden');
    ph.innerHTML = ICONS.exe + '<span>程序壁纸 · 应用后嵌入桌面显示</span>';
  }
  applyPreviewParams();
}

/** 把当前参数应用到预览元素（参数变化时，不重建元素） */
function applyPreviewParams() {
  const sel = state.selected;
  if (!sel) return;
  const p = sel.params;
  const media = $('#preview-stage').querySelector('img,video,iframe');
  if (!media) return;
  media.style.objectFit = p.fit === 'contain' ? 'contain' : (p.fit === 'stretch' ? 'fill' : 'cover');
  if (media.tagName !== 'IFRAME') media.style.filter = buildFilter(p);
  if (media.tagName === 'VIDEO') {
    media.playbackRate = Math.min(4, Math.max(0.25, Number(p.speed) || 1));
    if (p.paused) media.pause();
    else media.play().catch(() => {});
  }
}

// 主窗口隐藏到托盘时暂停预览视频：否则它在后台持续占用一路硬件解码，
// 与桌面壁纸的 mpv 抢资源，用户看不到界面却仍在付出代价
document.addEventListener('visibilitychange', () => {
  const v = $('#preview-stage') && $('#preview-stage').querySelector('video');
  if (!v) return;
  if (document.hidden) v.pause();
  else if (!(state.selected && state.selected.params && state.selected.params.paused)) v.play().catch(() => {});
});

/** 获取主显示器信息，设置预览区比例与分辨率标注 */
async function loadDisplayInfo() {
  try {
    const d = await window.api.getDisplays();
    state.display = d.primary;
    const { width, height } = d.primary.physical;
    $('#preview-stage').style.aspectRatio = `${width} / ${height}`;
    $('#preview-res-label').textContent = `${width}×${height} · 主显示器`;
  } catch (_) {}
}

// ---------- 参数面板 ----------
/**
 * 数值参数统一定义：滑块/数值输入/固定调整点（点击快速跳到指定值）
 */
const PARAM_CONFIG = {
  speed: {
    slider: '#v-speed', num: '#v-speed-num', presetsRow: '#v-speed-presets',
    presets: [0.25, 0.5, 1, 1.5, 2, 3, 4],
    fmt: v => v.toFixed(2), chip: v => (v % 1 === 0 ? v.toFixed(0) : String(v)) + '×',
  },
  volume: {
    slider: '#v-volume', num: '#v-volume-num', presetsRow: '#v-volume-presets',
    presets: [0, 25, 50, 70, 100],
    fmt: v => String(Math.round(v)), chip: v => String(Math.round(v)) + '%',
  },
  brightness: {
    slider: '#v-bright', num: '#v-bright-num', presetsRow: '#v-bright-presets',
    presets: [-100, -50, 0, 50, 100],
    fmt: v => String(Math.round(v)), chip: v => String(Math.round(v)),
  },
  contrast: {
    slider: '#v-contrast', num: '#v-contrast-num', presetsRow: '#v-contrast-presets',
    presets: [-100, -50, 0, 50, 100],
    fmt: v => String(Math.round(v)), chip: v => String(Math.round(v)),
  },
  saturation: {
    slider: '#v-saturation', num: '#v-saturation-num', presetsRow: '#v-saturation-presets',
    presets: [-100, -50, 0, 50, 100],
    fmt: v => String(Math.round(v)), chip: v => String(Math.round(v)),
  },
};

/** 高亮与当前值一致的预设点 */
function highlightPresets(key, v) {
  const cfg = PARAM_CONFIG[key];
  if (!cfg) return;
  $$(cfg.presetsRow + ' .preset-chip').forEach(b => {
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.val) - v) < 0.001);
  });
}

function renderParamsPanel() {
  const none = $('#pp-none');
  const controls = $('#pp-controls');
  const exeTip = $('#pp-exe-tip');
  const badge = $('#pp-type-badge');
  const videoOnly = $('#pp-video-only');
  const qualityRow = $('#pp-quality-row');
  const lockBtn = $('#btn-lockscreen');
  const applyBtn = $('#btn-apply');

  const sel = state.selected;
  if (!sel) {
    none.classList.remove('hidden');
    controls.classList.add('hidden');
    exeTip.classList.add('hidden');
    badge.textContent = '未选择';
    return;
  }

  const wp = sel.wallpaper;
  const p = sel.params;
  const isCurrent = !!(state.current && state.current.wallpaper.id === wp.id);

  badge.textContent = TYPE_LABEL[wp.type];
  $('#pp-name').textContent = wp.name;
  applyBtn.textContent = isCurrent ? '使用中 · 重新应用' : '应用壁纸';

  if (wp.type === 'exe') {
    none.classList.add('hidden');
    controls.classList.add('hidden');
    exeTip.classList.remove('hidden');
    return;
  }

  exeTip.classList.add('hidden');
  none.classList.add('hidden');
  controls.classList.remove('hidden');

  // 视频专属控件；图片显示「设为锁屏」
  videoOnly.classList.toggle('hidden', wp.type !== 'video');
  qualityRow.classList.toggle('hidden', wp.type !== 'video');
  lockBtn.classList.toggle('hidden', wp.type !== 'image');

  // 同步滑块/数值输入/预设点高亮
  for (const [key, cfg] of Object.entries(PARAM_CONFIG)) {
    const v = Number(p[key]);
    const numEl = $(cfg.num);
    $(cfg.slider).value = v;
    if (document.activeElement !== numEl) numEl.value = cfg.fmt(v);
    highlightPresets(key, v);
  }
  $('#btn-pause').textContent = p.paused ? '恢复' : '暂停';
  $('#btn-mute').textContent = p.mute ? '取消静音' : '静音';
  $('#btn-loop').classList.toggle('active', p.loop !== false);

  $$('#seg-fit button').forEach(b => b.classList.toggle('active', b.dataset.fit === p.fit));
  $$('#seg-quality button').forEach(b => b.classList.toggle('active', b.dataset.quality === p.quality));
  $$('#seg-resolution button').forEach(b => b.classList.toggle('active', b.dataset.resolution === (p.resolution || 'source')));
}

// 参数更新：本地选中参数 + 预览即时反映；若选中即当前壁纸则实时下发主进程
let pendingParams = null;
let pendingPreview = null;
let rafId = null;
function pushParams(patch) {
  if (state.selected) Object.assign(state.selected.params, patch);
  applyPreviewParams();

  // 预览弹出窗口跟随参数变化（patch 模式）。拖动滑块时 input 事件可达每秒上百次，
  // 与 updateParams 共用同一帧节流，避免每条事件都产生一次 IPC 往返
  pendingPreview = { ...(pendingPreview || {}), ...patch };

  const live = state.current && state.selected &&
    state.selected.wallpaper.id === state.current.wallpaper.id;
  if (live) pendingParams = { ...(pendingParams || {}), ...patch };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const pv = pendingPreview;
    pendingPreview = null;
    if (pv) window.api.syncPreview({ patch: pv });
    const data = pendingParams;
    pendingParams = null;
    if (data) window.api.updateParams(data);
  });
}

function bindParamsPanel() {
  // 滑块 + 数值输入 + 固定调整点 统一绑定
  const bindParam = (key, cfg) => {
    const slider = $(cfg.slider);
    const num = $(cfg.num);
    const row = $(cfg.presetsRow);

    const applyVal = (v) => {
      slider.value = v;
      num.value = cfg.fmt(v);
      pushParams({ [key]: v });
      highlightPresets(key, v);
    };

    slider.addEventListener('input', () => applyVal(parseFloat(slider.value)));

    // 数值输入：失焦/回车时生效，自动 clamp 到范围内
    const applyNum = () => {
      let v = parseFloat(num.value);
      if (Number.isNaN(v)) { num.value = cfg.fmt(parseFloat(slider.value)); return; }
      const min = parseFloat(num.min);
      const max = parseFloat(num.max);
      v = Math.min(max, Math.max(min, v));
      applyVal(v);
    };
    num.addEventListener('change', applyNum);
    num.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { applyNum(); num.blur(); }
    });

    // 生成固定调整点
    cfg.presets.forEach(val => {
      const b = document.createElement('button');
      b.className = 'preset-chip';
      b.dataset.val = val;
      b.title = `${key} = ${val}`;
      b.textContent = cfg.chip(val);
      b.addEventListener('click', () => applyVal(val));
      row.appendChild(b);
    });
  };
  for (const [key, cfg] of Object.entries(PARAM_CONFIG)) bindParam(key, cfg);

  // 预览区缩放（加宽/收窄参数面板，预览区随之变化）与弹出独立预览窗口
  const panel = $('#params-panel');
  $('#btn-preview-zoom-in').addEventListener('click', () => {
    panel.style.width = Math.min(760, panel.offsetWidth + 100) + 'px';
  });
  $('#btn-preview-zoom-out').addEventListener('click', () => {
    panel.style.width = Math.max(260, panel.offsetWidth - 100) + 'px';
  });
  $('#btn-preview-popout').addEventListener('click', async () => {
    await window.api.openPreview();
    syncPreviewFull();
  });

  $('#btn-apply').addEventListener('click', applySelected);

  $('#btn-lockscreen').addEventListener('click', () => setLockScreenFrom(state.selected?.wallpaper));

  $('#btn-pause').addEventListener('click', () => {
    const paused = !(state.selected?.params?.paused);
    pushParams({ paused });
    $('#btn-pause').textContent = paused ? '恢复' : '暂停';
  });
  $('#btn-mute').addEventListener('click', () => {
    const mute = !(state.selected?.params?.mute);
    pushParams({ mute });
    $('#btn-mute').textContent = mute ? '取消静音' : '静音';
  });
  $('#btn-loop').addEventListener('click', () => {
    const loop = !(state.selected?.params?.loop !== false);
    pushParams({ loop });
    $('#btn-loop').classList.toggle('active', loop);
  });

  $$('#seg-fit button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#seg-fit button').forEach(x => x.classList.toggle('active', x === b));
      pushParams({ fit: b.dataset.fit });
    });
  });
  $$('#seg-quality button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#seg-quality button').forEach(x => x.classList.toggle('active', x === b));
      pushParams({ quality: b.dataset.quality });
    });
  });
  $$('#seg-resolution button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#seg-resolution button').forEach(x => x.classList.toggle('active', x === b));
      pushParams({ resolution: b.dataset.resolution });
    });
  });

  $('#btn-reset-params').addEventListener('click', () => {
    if (!state.selected) return;
    const reset = { ...DEFAULT_PARAMS };
    state.selected.params = reset;
    renderParamsPanel();
    applyPreviewParams();
    // 若是当前壁纸则整组下发
    if (state.current && state.selected.wallpaper.id === state.current.wallpaper.id) {
      window.api.updateParams(reset);
    }
    toast('已恢复默认参数');
  });
}

// ---------- 锁屏壁纸 ----------
async function setLockScreenFrom(wp) {
  if (!wp || wp.type !== 'image') {
    toast('锁屏壁纸仅支持图片类型', 'error');
    return;
  }
  const res = await window.api.setLockScreen(wp.path);
  if (res.ok) {
    toast(res.elevated ? '锁屏壁纸已设置（已通过管理员权限）' : '锁屏壁纸已设置');
  } else {
    toast(res.error || '设置失败', 'error');
  }
  refreshLockScreenDetail();
}

async function refreshLockScreenDetail() {
  const el = $('#lockscreen-detail');
  if (!el) return;
  try {
    const path = await window.api.getLockScreen();
    if (path) {
      const name = path.replace(/^.*[\\/]/, '');
      el.textContent = `当前锁屏壁纸：${name}`;
      el.title = path;
    } else {
      el.textContent = '将图片壁纸同步设置为锁屏与登录界面背景';
      el.title = '';
    }
  } catch (_) {}
}

// ---------- 定时轮换 ----------
const ROT_INTERVAL_PRESETS = [1, 5, 15, 30, 60, 120, 360, 1440];

function renderRotationSettings() {
  const rot = state.settings.rotation || {};
  $('#rot-enabled').checked = !!rot.enabled;
  $('#rot-interval').value = rot.intervalMin || 30;
  $$('#rot-scope button').forEach(b => b.classList.toggle('active', b.dataset.scope === (rot.scope || 'all')));
  $$('#rot-order button').forEach(b => b.classList.toggle('active', b.dataset.order === (rot.order || 'random')));
  // 间隔固定调整点
  const row = $('#rot-interval-presets');
  row.innerHTML = '';
  ROT_INTERVAL_PRESETS.forEach(v => {
    const b = document.createElement('button');
    b.className = 'preset-chip' + ((rot.intervalMin || 30) === v ? ' active' : '');
    b.textContent = v < 60 ? `${v}分钟` : (v % 60 === 0 ? `${v / 60}小时` : `${Math.round(v / 60 * 10) / 10}小时`);
    b.addEventListener('click', () => {
      $('#rot-interval').value = v;
      saveRotation({ intervalMin: v });
      renderRotationSettings();
    });
    row.appendChild(b);
  });
  renderRotationPickGrid();
  renderRotationQueue();
}

/** 自定义轮换列表：多选网格 */
function renderRotationPickGrid() {
  const rot = state.settings.rotation || {};
  const card = $('#rot-custom-card');
  const grid = $('#rot-pick-grid');
  if (!card || !grid) return;
  card.style.display = rot.scope === 'custom' ? '' : 'none';
  if (rot.scope !== 'custom') return;
  const list = rot.list || [];
  $('#rot-custom-count').textContent = `已选 ${list.length} 张`;
  releaseLazyThumbs(grid);
  grid.innerHTML = '';
  for (const wp of state.wallpapers) {
    const picked = list.includes(wp.id);
    const item = document.createElement('button');
    item.className = 'rot-pick' + (picked ? ' picked' : '');
    item.title = wp.name;
    // 缩略图（视频取第一帧，不再是空白图标）
    item.appendChild(makeThumbMedia(wp));
    const name = document.createElement('span');
    name.className = 'pick-name';
    name.textContent = wp.name;
    item.appendChild(name);
    const mark = document.createElement('i');
    mark.className = 'pick-mark';
    mark.textContent = picked ? '✓' : '';
    item.appendChild(mark);
    item.addEventListener('click', () => {
      const cur = state.settings.rotation.list || [];
      const next = cur.includes(wp.id) ? cur.filter(id => id !== wp.id) : [...cur, wp.id];
      saveRotation({ list: next });
      renderRotationPickGrid();
    });
    grid.appendChild(item);
  }
}

function bindRotation() {
  $('#rot-enabled').addEventListener('change', (e) => {
    saveRotation({ enabled: e.target.checked });
  });
  $('#rot-interval').addEventListener('change', (e) => {
    saveRotation({ intervalMin: Math.max(1, parseInt(e.target.value) || 30) });
    renderRotationSettings();
  });
  $$('#rot-scope button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#rot-scope button').forEach(x => x.classList.toggle('active', x === b));
      saveRotation({ scope: b.dataset.scope });
      renderRotationPickGrid();
    });
  });
  $$('#rot-order button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#rot-order button').forEach(x => x.classList.toggle('active', x === b));
      saveRotation({ order: b.dataset.order });
    });
  });
}

function saveRotation(patch) {
  const rot = {
    ...(state.settings.rotation || { enabled: false, intervalMin: 30, scope: 'all', order: 'random', list: [] }),
    ...patch,
  };
  state.settings.rotation = rot;
  window.api.updateSettings({ rotation: rot });
  renderRotationQueue(); // 范围/列表变化 → 队列实时刷新
}

// ---------- 轮换队列实时预览 ----------
/** 客户端解析当前轮换列表（与主进程 getRotationList 同逻辑） */
function getRotationListClient() {
  const rot = state.settings.rotation || {};
  if (rot.scope === 'favorite') return state.wallpapers.filter(w => w.favorite);
  if (rot.scope === 'custom') {
    return (rot.list || []).map(id => state.wallpapers.find(w => w.id === id)).filter(Boolean);
  }
  return state.wallpapers;
}

/** 构建缩略媒体元素（图片=img / 视频=静音循环播放 / 其他=图标） */
function makeThumbMedia(wp, { playing = false } = {}) {
  if (wp.type === 'image') {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = 'file:///' + wp.path.replace(/\\/g, '/');
    img.onerror = () => img.remove();
    return img;
  }
  if (wp.type === 'video') {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    v.onerror = () => v.remove();
    if (playing) {
      v.autoplay = true;
      v.loop = true;
      v.src = 'file:///' + wp.path.replace(/\\/g, '/');
    } else {
      // 静态首帧缩略图：进视口才解码。轮换队列每次切换壁纸都会重建，
      // 若立即赋 src 就等于把所有视频壁纸的解码器再建一遍（哪怕设置页是隐藏的）
      v.dataset.src = 'file:///' + wp.path.replace(/\\/g, '/') + '#t=0.5';
      getThumbObserver().observe(v);
    }
    return v;
  }
  const ic = document.createElement('div');
  ic.className = 'pick-icon';
  ic.innerHTML = ICONS[wp.type] || ICONS.web;
  return ic;
}

// 队列成员签名：成员与轮换范围都没变时只更新「当前」标记，不重建整条胶片
let rotQueueSig = null;

/** 只更新轮换队列里的「当前显示」标记（切换壁纸时调用，避免整条重建） */
function syncRotationQueueCurrent() {
  const queue = $('#rot-queue');
  if (!queue) return;
  const curId = state.current?.wallpaper?.id || null;
  for (const tile of queue.querySelectorAll('.rot-tile')) {
    const isCur = tile.dataset.id === curId;
    tile.classList.toggle('current', isCur);
    tile.title = (tile.dataset.name || '') + (isCur ? '（当前显示）' : '（点击立即切换）');
    const thumb = tile.querySelector('.rot-thumb');
    if (!thumb) continue;
    const badge = thumb.querySelector('.using-badge');
    if (isCur && !badge) {
      const cur = document.createElement('span');
      cur.className = 'using-badge';
      cur.textContent = '当前';
      thumb.appendChild(cur);
    } else if (!isCur && badge) {
      badge.remove();
    }
  }
}

/**
 * 轮换队列：横向胶片条，实时展示参与轮换的壁纸（视频直接小窗播放）。
 * 调节轮换范围（全部/收藏/自定义勾选）时立即增删，一目了然；
 * 点击任意一张立即平滑切换；自定义范围可点 ✕ 移出。
 */
function renderRotationQueue() {
  const queue = $('#rot-queue');
  const empty = $('#rot-queue-empty');
  const count = $('#rot-queue-count');
  if (!queue || !empty || !count) return;
  const list = getRotationListClient();
  count.textContent = list.length ? `共 ${list.length} 张` : '';
  const rot = state.settings.rotation || {};
  const sig = `${rot.scope}:${list.map(w => w.id).join('|')}`;
  if (sig === rotQueueSig && queue.childElementCount === list.length) {
    syncRotationQueueCurrent();
    return;
  }
  rotQueueSig = sig;
  releaseLazyThumbs(queue);
  queue.innerHTML = '';
  empty.style.display = list.length ? 'none' : '';
  const curId = state.current?.wallpaper?.id;
  for (const wp of list) {
    const tile = document.createElement('div');
    tile.className = 'rot-tile' + (wp.id === curId ? ' current' : '');
    tile.dataset.id = wp.id;
    tile.dataset.name = wp.name;
    tile.title = wp.name + (wp.id === curId ? '（当前显示）' : '（点击立即切换）');
    const thumb = document.createElement('div');
    thumb.className = 'rot-thumb';
    thumb.appendChild(makeThumbMedia(wp, { playing: false }));
    tile.appendChild(thumb);
    const name = document.createElement('span');
    name.className = 'rot-name';
    name.textContent = wp.name;
    tile.appendChild(name);
    const badge = document.createElement('span');
    badge.className = 'type-badge ' + wp.type;
    badge.textContent = TYPE_LABEL[wp.type];
    thumb.appendChild(badge);
    if (wp.id === curId) {
      const cur = document.createElement('span');
      cur.className = 'using-badge';
      cur.textContent = '当前';
      thumb.appendChild(cur);
    }
    if (rot.scope === 'custom') {
      const rm = document.createElement('button');
      rm.className = 'rot-remove';
      rm.title = '从轮换列表移除';
      rm.textContent = '✕';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = state.settings.rotation.list || [];
        saveRotation({ list: cur.filter(id => id !== wp.id) });
        renderRotationSettings();
      });
      tile.appendChild(rm);
    }
    // 悬停才播放视频预览（不自动播放，省 CPU）
    tile.addEventListener('mouseenter', () => {
      thumb.querySelectorAll('video').forEach(v => v.play().catch(() => {}));
    });
    tile.addEventListener('mouseleave', () => {
      thumb.querySelectorAll('video').forEach(v => v.pause());
    });
    tile.addEventListener('click', async () => {
      const res = await window.api.apply(wp.id);
      if (res.ok) toast(`已切换到「${wp.name}」`);
      else toast(res.error || '切换失败', 'error');
    });
    queue.appendChild(tile);
  }
}

// ---------- 桌面组件 ----------
const WIDGET_META = {
  clock:  { name: '时钟', desc: '时间 + 日期，点击切换 12/24 小时制', interactive: true },
  volume: { name: '音量', desc: '系统主音量，桌面直接拖动调节，点击图标静音（壁纸音量在播放参数中设置）', interactive: true },
  netmon: { name: '系统状态监控', desc: '实时上/下行网速 + 迷你历史曲线 + CPU / GPU / 内存占用概览', interactive: false },
  board:  { name: '信息看板', desc: '日历（日程/纪念日）+ 天气（实时/预报）+ 待办（桌面可勾选），三块可各自开关', interactive: true },
};
const POS_LABELS = {
  tl: '左上', tc: '上中', tr: '右上',
  ml: '左中', mc: '居中', mr: '右中',
  bl: '左下', bc: '下中', br: '右下',
};

function saveWidgets(patch) {
  const cur = state.settings.widgets || {};
  const w = { ...cur, ...patch };
  // items 逐项深合并：只改某一个组件的 pos/size/开关时，不能把兄弟组件的
  // 配置从本地 state 里抹掉（否则界面上其它组件会瞬间变回关闭态）
  if (patch.items) {
    const items = { ...(cur.items || {}) };
    for (const [k, v] of Object.entries(patch.items)) {
      items[k] = { ...(items[k] || {}), ...(v && typeof v === 'object' ? v : {}) };
    }
    w.items = items;
  }
  state.settings.widgets = w;
  window.api.updateSettings({ widgets: w });
}

/** 组件当前是否为「自由摆放」（桌面拖动保存的位置，优先于九宫格槽位） */
function isWidgetFree(item) {
  return !!(item && item.posX != null && item.posY != null);
}

const WIDGET_ITEM_DEFAULT = { on: false, pos: 'tl', posX: null, posY: null, size: 'm' };

/**
 * 读取组件项的「当前」配置。
 * ★ 必须在点击时调用，绝不能在 render 时把结果缓存进闭包：
 *   state.settings 会被 settings:sync 整体按引用替换（见 init 里的订阅），
 *   任何缓存的 item 都会指向已脱离的对象。
 * 这正是「调节参数后组件被异常关闭」的根因 —— 九宫格/大小按钮的闭包持有
 * render 时的旧 item（on:false），点一下就把 on:false 回写覆盖了刚打开的开关。
 */
function liveWidgetItem(key) {
  return { ...WIDGET_ITEM_DEFAULT, ...((state.settings.widgets?.items || {})[key] || {}) };
}

/** 单项写入：只碰本项字段，位置字段永不被顺带修改（widgets-host.js 头注释的硬约束） */
function saveWidgetItem(key, patch) {
  saveWidgets({ items: { [key]: { ...liveWidgetItem(key), ...patch } } });
}

// ---------- 设置页通用：数值输入 + 固定调整点 + 调整模式 ----------
let wgAdjustingKey = null;   // 当前处于调整模式的组件 key（null = 无）
let avAdjusting = false;     // 音律动效调整模式
let lcAdjusting = false;     // 快捷方式转盘调整模式
let fbAdjusting = false;     // 文件收纳区调整模式

/** 高亮与当前值一致的固定调整点 */
function highlightPresetRow(row, v) {
  if (!row) return;
  row.querySelectorAll('.preset-chip').forEach(b => {
    b.classList.toggle('active', Math.abs(parseFloat(b.dataset.val) - v) < 0.001);
  });
}

/** 生成一行固定调整点（presets：标量数组或 {val,label} 数组），onPick(val) 生效 */
function renderPresetRow(row, presets, onPick) {
  if (!row) return;
  row.innerHTML = '';
  for (const p of presets) {
    const val = typeof p === 'object' ? p.val : p;
    const b = document.createElement('button');
    b.className = 'preset-chip';
    b.dataset.val = val;
    b.textContent = typeof p === 'object' ? p.label : String(p);
    b.addEventListener('click', () => onPick(val));
    row.appendChild(b);
  }
}

/** 音律动效 X/Y 角落预设：需 X/Y 同时匹配才高亮 */
function highlightXyPresets() {
  const row = $('#av-xy-presets');
  if (!row || !row.children.length) return;
  const px = Math.round(parseFloat($('#av-posx').value));
  const py = Math.round(parseFloat($('#av-posy').value));
  row.querySelectorAll('.preset-chip').forEach(b => {
    b.classList.toggle('active', +b.dataset.x === px && +b.dataset.y === py);
  });
}

/** 「调整位置」按钮与提示文案同步（主进程状态回传后调用） */
function setAdjustBtnUi(btnId, hintId, on, noun = '目标') {
  const btn = $(btnId);
  if (btn) btn.textContent = on ? '结束调整' : '开始调整';
  const hint = $(hintId);
  if (hint) {
    hint.textContent = on
      ? '调整中：直接在桌面上按住拖到目标位置，松开即保存并自动退出（也可再点一次按钮退出）'
      : `点「开始调整」后在桌面上按住${noun}直接拖动，松开即保存位置并自动退出`;
  }
}

function renderWidgetsSettings() {
  const w = state.settings.widgets || {};
  $('#wg-enabled').checked = !!w.enabled;
  $$('#wg-theme button').forEach(b => b.classList.toggle('active', b.dataset.theme === (w.theme || 'auto')));
  const op = Math.round((w.opacity ?? 0.72) * 100);
  $('#wg-opacity').value = op;
  $('#wg-opacity-num').value = op;
  highlightPresetRow($('#wg-opacity-presets'), op);
  $$('#wg-style button').forEach(b => b.classList.toggle('active', b.dataset.style === (w.style || 'none')));
  $$('#wg-shape button').forEach(b => b.classList.toggle('active', b.dataset.shape === (w.shape || 'rounded')));
  // 组件卡片
  const wrap = $('#wg-items');
  wrap.innerHTML = '';
  for (const [key, meta] of Object.entries(WIDGET_META)) {
    const item = w.items?.[key] || { on: false, pos: 'tl', size: 'm' };
    // 自由摆放状态（v1.8.4 修复：此前 freePos 未声明直接引用，
    // renderWidgetsSettings 抛 ReferenceError 中断 init → 全界面点击无响应）
    const freePos = isWidgetFree(item);
    const card = document.createElement('div');
    card.className = 'settings-card wg-card';

    const head = document.createElement('label');
    head.className = 'switch-row';
    head.innerHTML = `
      <div>
        <div class="row-title">${meta.name}${meta.interactive ? ' <span class="title-hint">可交互</span>' : ''}</div>
        <div class="row-sub">${meta.desc}</div>
      </div>
      <span class="switch"><input type="checkbox" data-wg-toggle="${key}" ${item.on ? 'checked' : ''}><i></i></span>`;
    card.appendChild(head);

    const body = document.createElement('div');
    body.className = 'wg-card-body';
    // 位置九宫格
    const posWrap = document.createElement('div');
    posWrap.className = 'wg-pos';
    posWrap.innerHTML = '<span class="wg-pos-label">位置</span>';
    const grid = document.createElement('div');
    grid.className = 'pos-grid';
    for (const pos of Object.keys(POS_LABELS)) {
      const pb = document.createElement('button');
      pb.className = 'pos-cell' + (!freePos && item.pos === pos ? ' active' : '');
      pb.title = freePos
        ? `${POS_LABELS[pos]}：点击即交回九宫格定位（清除当前自由位置）`
        : POS_LABELS[pos];
      pb.dataset.pos = pos;
      pb.addEventListener('click', () => {
        // 点九宫格 = 交回九宫格定位：清掉桌面拖动保存的自由位置
        // ★ 点击时穿透读，不能展开上文 render 时捕获的 item（可能已失效）
        saveWidgetItem(key, { pos, posX: null, posY: null });
        renderWidgetsSettings();
      });
      grid.appendChild(pb);
    }
    posWrap.appendChild(grid);
    // 自由摆放标记：拖动过位置后，九宫格不再接管
    if (freePos) {
      const tag = document.createElement('span');
      tag.className = 'wg-free-tag';
      tag.textContent = '自由摆放';
      tag.title = '当前位置由桌面拖动决定（九宫格暂不接管）；点任一宫格可交回九宫格定位';
      posWrap.appendChild(tag);
    }
    body.appendChild(posWrap);
    // 大小
    const sizeWrap = document.createElement('div');
    sizeWrap.className = 'wg-size';
    sizeWrap.innerHTML = '<span class="wg-pos-label">大小</span>';
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const s of [['s', '小'], ['m', '中'], ['l', '大']]) {
      const sb = document.createElement('button');
      sb.textContent = s[1];
      if ((item.size || 'm') === s[0]) sb.classList.add('active');
      sb.addEventListener('click', () => {
        // ★ 同九宫格：点击时穿透读，避免把已失效的 on:false 一起回写
        saveWidgetItem(key, { size: s[0] });
        renderWidgetsSettings();
      });
      seg.appendChild(sb);
    }
    sizeWrap.appendChild(seg);
    body.appendChild(sizeWrap);
    // 摆放：进入调整模式后整窗可拖动（桌面无手柄，位置保存后自动退出）
    const adjWrap = document.createElement('div');
    adjWrap.className = 'wg-size';
    adjWrap.innerHTML = '<span class="wg-pos-label">摆放</span>';
    const adjBtn = document.createElement('button');
    adjBtn.className = 'btn ghost small';
    adjBtn.textContent = wgAdjustingKey === key ? '调整中 · 点此结束' : '调整位置';
    adjBtn.title = '进入调整模式后，直接在桌面上按住组件拖动到任意位置，松开即保存（保存的位置优先于左侧九宫格）';
    adjBtn.addEventListener('click', async () => {
      const turnOn = wgAdjustingKey !== key;
      const ok = await window.api.setWidgetsAdjust(key, turnOn);
      if (!ok && turnOn) toast('该组件未启用，先打开开关再调整', 'error');
    });
    adjWrap.appendChild(adjBtn);
    body.appendChild(adjWrap);
    card.appendChild(body);
    wrap.appendChild(card);
  }

  // 开关事件
  wrap.querySelectorAll('[data-wg-toggle]').forEach(t => {
    t.addEventListener('change', () => {
      const key = t.dataset.wgToggle;
      const patch = { items: { [key]: { ...liveWidgetItem(key), on: t.checked } } };
      // 点亮单个组件时总开关没开 → 自动开启（否则"开了组件没效果"）
      if (t.checked && !(state.settings.widgets?.enabled)) {
        patch.enabled = true;
      }
      saveWidgets(patch);
      // ★ 无条件重渲染：卡片内九宫格/大小按钮的闭包必须重建。
      //   此前只在 patch.enabled（总开关也被打开）时才重渲染 —— 总开关已开时
      //   单独点亮某组件不重渲染，闭包里仍是 render 时的 on:false，
      //   紧接着点位置/大小就把刚打开的组件关掉（用户报的"调节参数后开关被关"）。
      //   卡片内没有文本输入框也没有滑杆（#wg-opacity 在 #wg-items 之外），
      //   重渲染不会打断任何输入。
      renderWidgetsSettings();
    });
  });
}

function bindWidgetsSettings() {
  $('#wg-enabled').addEventListener('change', (e) => {
    const on = e.target.checked;
    // 修复"开了没效果"：开启总开关但一个组件都没选时，默认点亮时钟
    if (on) {
      const items = state.settings.widgets?.items || {};
      const anyOn = Object.values(items).some(i => i && i.on);
      if (!anyOn) {
        saveWidgets({
          enabled: true,
          items: { clock: { ...liveWidgetItem('clock'), on: true } },
        });
        renderWidgetsSettings();
        toast('桌面组件已开启（已默认添加时钟，回到桌面查看效果）');
        return;
      }
    }
    saveWidgets({ enabled: on });
    toast(on ? '桌面组件已开启，回到桌面查看效果' : '桌面组件已关闭');
  });
  $$('#wg-theme button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#wg-theme button').forEach(x => x.classList.toggle('active', x === b));
      saveWidgets({ theme: b.dataset.theme });
    });
  });
  const applyOpacity = (v) => {
    v = Math.min(100, Math.max(20, Math.round(v) || 72));
    $('#wg-opacity').value = v;
    $('#wg-opacity-num').value = v;
    saveWidgets({ opacity: v / 100 });
    highlightPresetRow($('#wg-opacity-presets'), v);
  };
  $('#wg-opacity').addEventListener('input', (e) => {
    $('#wg-opacity-num').value = e.target.value;
    applyOpacity(parseFloat(e.target.value));
  });
  $('#wg-opacity-num').addEventListener('change', (e) => applyOpacity(parseFloat(e.target.value)));
  $('#wg-opacity-num').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { applyOpacity(parseFloat(e.target.value)); e.target.blur(); }
  });
  renderPresetRow($('#wg-opacity-presets'), [30, 50, 72, 85, 100], applyOpacity);
  $$('#wg-style button').forEach(b => b.addEventListener('click', () => {
    saveWidgets({ style: b.dataset.style });
    renderWidgetsSettings();
  }));
  $$('#wg-shape button').forEach(b => b.addEventListener('click', () => {
    saveWidgets({ shape: b.dataset.shape });
    renderWidgetsSettings();
  }));
  buildWidgetAdj($('#wg-adj'));
}

/** 组件全局调色三行：固定调节点 + 滑杆 + 自由输入（100 = 原样） */
function buildWidgetAdj(host) {
  host.innerHTML = '';
  const row = (title, key, min, presets) => addAdjRow(host, {
    title, sub: '（100 = 原样）', min, max: 200, step: 5, presets,
    fmt: (v) => `${v}%`,
    get: () => { const w = state.settings.widgets || {}; return Number.isFinite(w[key]) ? w[key] : 100; },
    set: (v) => saveWidgets({ [key]: v }),
  });
  row('组件亮度', 'brightness', 20, [60, 80, 100, 120, 160]);
  row('组件对比度', 'contrast', 20, [60, 80, 100, 120, 160]);
  row('组件饱和度', 'saturate', 0, [0, 50, 100, 150, 200]);
}

// ---------- 信息看板编辑器 ----------
const bdNow = () => ({ ...(state.settings.board || {}) });
let bdRev = '';
const bdRevision = () => {
  const b = bdNow();
  return JSON.stringify([b.sections, b.events, b.todos, b.weather]);
};

function saveBoard(patch) {
  const cur = bdNow();
  const b = {
    ...cur, ...patch,
    sections: { ...(cur.sections || {}), ...(patch.sections || {}) },
    weather: { ...(cur.weather || {}), ...(patch.weather || {}) },
  };
  state.settings.board = b;
  window.api.updateSettings({ board: b });
  bdRev = bdRevision();
}

/** settings:sync 回写后按需重绘：修订号没变或用户正在输入则不动 */
function maybeRenderBoardEditor() {
  const rev = bdRevision();
  if (rev === bdRev) return;
  bdRev = rev;
  const ae = document.activeElement;
  if (ae && ae.id && ae.id.startsWith('bd-')) return;
  renderBoardEditor();
}

function renderBoardEditor() {
  const b = bdNow();
  const s = b.sections || {};
  $('#bd-sec-calendar').checked = s.calendar !== false;
  $('#bd-sec-weather').checked = s.weather !== false;
  $('#bd-sec-todo').checked = s.todo !== false;
  const w = b.weather || {};
  $('#bd-city-now').textContent = (w.manual && w.cityName)
    ? `当前：${w.cityName}（${Number(w.lat).toFixed(2)}, ${Number(w.lon).toFixed(2)}）`
    : '自动定位（按 IP 所在地）· 搜索可手动指定';

  const evList = $('#bd-ev-list');
  evList.innerHTML = '';
  for (const e of (b.events || [])) {
    const row = document.createElement('div');
    row.className = 'lc-item';
    row.innerHTML = `<span class="lc-name">${e.type === 'anniversary' ? '🎂 ' : '📅 '}${escHtml(e.text)} <span class="lc-boxed-tag">${escHtml(e.date || '')}</span></span>`;
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.innerHTML = ICONS.trash;
    del.addEventListener('click', () => saveBoard({ events: (b.events || []).filter((x) => x.id !== e.id) }));
    row.appendChild(del);
    evList.appendChild(row);
  }
  if (!(b.events || []).length) evList.innerHTML = '<p class="hint">还没有日程 / 纪念日</p>';

  const tdList = $('#bd-todo-list');
  tdList.innerHTML = '';
  for (const t of (b.todos || [])) {
    const row = document.createElement('div');
    row.className = 'lc-item';
    row.innerHTML = `<span class="lc-name" style="${t.done ? 'text-decoration:line-through;opacity:.55' : ''}">${escHtml(t.text)}</span>`;
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.innerHTML = ICONS.trash;
    del.addEventListener('click', () => saveBoard({ todos: (b.todos || []).filter((x) => x.id !== t.id) }));
    row.appendChild(del);
    tdList.appendChild(row);
  }
  if (!(b.todos || []).length) tdList.innerHTML = '<p class="hint">还没有待办</p>';
  bdRev = bdRevision();
}

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let bdCityTimer = null;
function bindBoardEditor() {
  const sec = (key) => (e) => saveBoard({ sections: { [key]: e.target.checked } });
  $('#bd-sec-calendar').addEventListener('change', sec('calendar'));
  $('#bd-sec-weather').addEventListener('change', sec('weather'));
  $('#bd-sec-todo').addEventListener('change', sec('todo'));

  $('#bd-ev-add').addEventListener('click', () => {
    const text = $('#bd-ev-text').value.trim();
    const date = $('#bd-ev-date').value;
    if (!text || !date) { toast('日程需要文本和日期', 'error'); return; }
    const b = bdNow();
    const events = [...(b.events || []), {
      id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text, date, type: $('#bd-ev-ann').checked ? 'anniversary' : 'event',
    }];
    saveBoard({ events });
    $('#bd-ev-text').value = '';
    toast('已添加日程');
  });
  $('#bd-todo-add').addEventListener('click', () => {
    const text = $('#bd-todo-text').value.trim();
    if (!text) { toast('待办内容不能为空', 'error'); return; }
    const b = bdNow();
    const todos = [...(b.todos || []), {
      id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      text, done: false,
    }];
    saveBoard({ todos });
    $('#bd-todo-text').value = '';
    toast('已添加待办');
  });
  $('#bd-todo-clear').addEventListener('click', () => {
    const b = bdNow();
    saveBoard({ todos: (b.todos || []).filter((t) => !t.done) });
    toast('已清除已完成待办');
  });

  // 城市搜索：400ms 防抖，主进程代拉 Open-Meteo geocoding
  $('#bd-city-q').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (bdCityTimer) clearTimeout(bdCityTimer);
    const list = $('#bd-city-list');
    if (!q) { list.innerHTML = ''; return; }
    bdCityTimer = setTimeout(async () => {
      const res = await window.api.geocodeCity(q);
      list.innerHTML = '';
      for (const r of (res || [])) {
        const row = document.createElement('div');
        row.className = 'lc-item';
        row.style.cursor = 'pointer';
        row.innerHTML = `<span class="lc-name">${escHtml(r.name)}</span>`;
        row.addEventListener('click', () => {
          saveBoard({ weather: { cityName: r.name, lat: r.lat, lon: r.lon, tz: r.tz, manual: true } });
          list.innerHTML = '';
          $('#bd-city-q').value = '';
          toast(`看板天气已切到 ${r.name}`);
        });
        list.appendChild(row);
      }
      if (!(res || []).length) list.innerHTML = '<p class="hint">没有匹配的城市</p>';
    }, 400);
  });
  // 恢复自动定位：清掉手动城市，天气服务回到按 IP 定位
  $('#bd-city-auto').addEventListener('click', () => {
    saveBoard({ weather: { cityName: '', lat: null, lon: null, tz: 'auto', manual: false } });
    toast('已恢复按 IP 自动定位');
  });
  renderBoardEditor();
}

// ---------- 音律动效 ----------
const AV_DEFAULTS = {
  enabled: false, style: 'bars', color: '#7c5cff', gradient: true,
  opacity: 0.85, size: 1, pos: 'bottom', posX: null, posY: null,
  mirror: true, sensitivity: 1.2,
  brightness: 100, contrast: 100, saturate: 100, mirrorOpacity: 22, fps: 30,
};
/* 常用配色（点击快速切换） */
const AV_COLORS = [
  { c: '#7c5cff', n: '紫罗兰' },
  { c: '#4f8cff', n: '海蓝' },
  { c: '#22d3ee', n: '冰青' },
  { c: '#34d399', n: '翡翠绿' },
  { c: '#a3e635', n: '青柠' },
  { c: '#ffb15c', n: '琥珀橙' },
  { c: '#ff5c8a', n: '霓虹粉' },
  { c: '#f4f6ff', n: '月光白' },
];

/* 九宫格快速定位槽位 → 音律动效中心点（屏幕百分比 posX/posY） */
const AV_GRID = {
  tl: [8, 10], tm: [50, 10], tr: [92, 10],
  ml: [8, 50], mc: [50, 50], mr: [92, 50],
  bl: [8, 90], bc: [50, 90], br: [92, 90],
};

function saveAudioViz(patch) {
  const av = { ...AV_DEFAULTS, ...(state.settings.audioViz || {}), ...patch };
  state.settings.audioViz = av;
  window.api.updateSettings({ audioViz: av });
}

function renderAudioVizSettings() {
  const av = { ...AV_DEFAULTS, ...(state.settings.audioViz || {}) };
  $('#av-enabled').checked = !!av.enabled;
  $$('#av-style button').forEach(b => b.classList.toggle('active', b.dataset.style === av.style));
  // 位置：手动拖动过（posY 非空）则预设不亮，由拖动位置接管
  $$('#av-pos button').forEach(b => b.classList.toggle('active', av.posY == null && b.dataset.pos === av.pos));
  $$('#av-gradient button').forEach(b => b.classList.toggle('active', (b.dataset.gradient === 'on') === !!av.gradient));
  $('#av-color').value = av.color;
  const syncNum = (id, v) => {
    const el = $(id);
    if (document.activeElement !== el) el.value = v;
  };
  const opPct = Math.round(av.opacity * 100);
  $('#av-opacity').value = opPct;
  $('#av-opacity-val').textContent = opPct + '%';
  syncNum('#av-opacity-num', opPct);
  highlightPresetRow($('#av-opacity-presets'), opPct);
  $('#av-size').value = av.size;
  $('#av-size-val').textContent = Number(av.size).toFixed(1) + '×';
  syncNum('#av-size-num', Number(av.size).toFixed(1));
  highlightPresetRow($('#av-size-presets'), Number(av.size));
  $('#av-sens').value = av.sensitivity;
  $('#av-sens-val').textContent = Number(av.sensitivity).toFixed(1);
  syncNum('#av-sens-num', Number(av.sensitivity).toFixed(1));
  highlightPresetRow($('#av-sens-presets'), Number(av.sensitivity));
  $('#av-mirror').checked = av.mirror !== false;
  $$('#av-mirrormode button').forEach(b => b.classList.toggle('active', b.dataset.mirrormode === (av.mirrorMode || 'fade')));
  $('#av-occult').checked = av.pauseOnOccult !== false;
  // 圆环/同心环固定居中（底部/顶部预设不适用，仍可进入调整模式摆位）
  const circular = av.style === 'circle' || av.style === 'rings';
  $('#av-pos-row').style.opacity = circular ? 0.45 : 1;
  // 精确位置滑杆（手动拖动过 → 显示拖动位置；否则显示预设等效值）
  const defPosY = circular ? 0.5 : (av.pos === 'top' ? 0.10 : 0.90);
  const px = Math.round((av.posX ?? 0.5) * 100);
  const py = Math.round((av.posY ?? defPosY) * 100);
  $('#av-posx').value = px;
  $('#av-posy').value = py;
  syncNum('#av-posx-num', px);
  syncNum('#av-posy-num', py);
  $('#av-xy-val').textContent = `X ${px}% · Y ${py}%`;
  highlightXyPresets();
  syncAvGrid(av, circular);
  renderAvColors(av.color);
}

/** 常用配色色板 */
function renderAvColors(current) {
  const row = $('#av-colors');
  if (!row) return;
  row.innerHTML = '';
  for (const { c, n } of AV_COLORS) {
    const b = document.createElement('button');
    b.className = 'av-swatch' + (c.toLowerCase() === String(current || '').toLowerCase() ? ' active' : '');
    b.style.background = c;
    b.title = n;
    b.addEventListener('click', () => {
      $('#av-color').value = c;
      saveAudioViz({ color: c });
      renderAvColors(c);
    });
    row.appendChild(b);
  }
}

/** 音律动效九宫格高亮：posX/posY（未手动设置时用预设等效值）落在槽位上才点亮 */
function syncAvGrid(av, circular) {
  const grid = $('#av-pos9');
  if (!grid || !grid.children.length) return;
  const defY = circular ? 0.5 : (av.pos === 'top' ? 0.10 : 0.90);
  const free = av.posX != null || av.posY != null;
  const cx = Math.round((av.posX ?? 0.5) * 100);
  const cy = Math.round((av.posY ?? defY) * 100);
  grid.querySelectorAll('.pos-cell').forEach(b => {
    const [gx, gy] = AV_GRID[b.dataset.cell] || [];
    b.classList.toggle('active', !free && gx === cx && gy === cy);
  });
  // 拖动保存的自由位置优先于九宫格：提示用户当前由哪个来源决定位置
  const sub = document.querySelector('#av-pos9-row .row-sub');
  if (sub) {
    sub.textContent = free
      ? '当前为桌面拖动保存的自由位置（九宫格暂不接管）；点任一宫格即交回九宫格定位，点上方「顶部 / 底部」回到预设'
      : '点击快速摆放到中心 / 左中 / 右上等常用位置；拖动调整与精确滑杆仍可用';
  }
}

/** 实时音频状态（主进程每 600ms 推送）：文字 + 电平条 */
function updateAvStatusMeter(s) {
  const meter = $('#av-meter');
  const status = $('#av-status');
  if (!meter || !status) return;
  const av = { ...AV_DEFAULTS, ...(state.settings.audioViz || {}) };
  if (!av.enabled) {
    status.textContent = '已关闭';
    meter.querySelectorAll('i').forEach(i => i.classList.remove('on'));
    return;
  }
  if (!s) return;
  if (s.error) {
    status.textContent = `捕获异常：${s.error}（自动重试中…）`;
  } else if (s.capturing) {
    status.textContent = s.level > 0.01
      ? '正在捕获系统声音 · 随节奏起伏'
      : '正在捕获系统声音 · 当前安静（播放音乐试试）';
  } else {
    status.textContent = '正在建立音频捕获…';
  }
  const cells = meter.querySelectorAll('i');
  const lit = Math.round(Math.min(1, s.level || 0) * cells.length);
  cells.forEach((c, i) => c.classList.toggle('on', i < lit));
}

function buildAvMeter() {
  const meter = $('#av-meter');
  if (!meter || meter.children.length) return;
  for (let i = 0; i < 14; i++) {
    const bar = document.createElement('i');
    bar.style.height = (6 + i * 1.2) + 'px';
    meter.appendChild(bar);
  }
}

function bindAudioVizSettings() {
  $('#av-enabled').addEventListener('change', (e) => {
    saveAudioViz({ enabled: e.target.checked });
    if (!e.target.checked) updateAvStatusMeter(null);
    toast(e.target.checked ? '音律动效已开启，播放任意声音即可看到效果（外放/耳机均可）' : '音律动效已关闭');
  });
  $$('#av-style button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#av-style button').forEach(x => x.classList.toggle('active', x === b));
      saveAudioViz({ style: b.dataset.style });
      renderAudioVizSettings();
    });
  });
  $$('#av-pos button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#av-pos button').forEach(x => x.classList.toggle('active', x === b));
      // 点预设 = 清除手动拖动位置，回到底部/顶部
      saveAudioViz({ pos: b.dataset.pos, posX: null, posY: null });
      renderAudioVizSettings();
    });
  });
  // 九宫格快速定位：点击写入 posX/posY（与滑杆/拖动同一数据源，原有调节全部保留）
  const avGrid = $('#av-pos9');
  if (avGrid && !avGrid.children.length) {
    for (const cell of Object.keys(AV_GRID)) {
      const b = document.createElement('button');
      b.className = 'pos-cell';
      b.dataset.cell = cell;
      b.title = POS_LABELS[cell];
      b.addEventListener('click', () => {
        const [gx, gy] = AV_GRID[cell];
        saveAudioViz({ posX: gx / 100, posY: gy / 100 });
        renderAudioVizSettings();
      });
      avGrid.appendChild(b);
    }
  }
  // 精确位置滑杆（X/Y 百分比，拖动即保存；桌面调整模式拖动结果也同步到这里）
  const avXyApply = () => {
    const px = Math.round(parseFloat($('#av-posx').value));
    const py = Math.round(parseFloat($('#av-posy').value));
    $('#av-xy-val').textContent = `X ${px}% · Y ${py}%`;
    highlightXyPresets();
  };
  const avXyLine = (sliderId, numId, key) => {
    $(sliderId).addEventListener('input', (e) => {
      $(numId).value = e.target.value;
      saveAudioViz({ [key]: parseFloat(e.target.value) / 100 });
      avXyApply();
    });
    const applyNum = () => {
      const el = $(numId);
      let v = parseFloat(el.value);
      if (Number.isNaN(v)) return;
      v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), v));
      $(sliderId).value = v;
      el.value = v;
      saveAudioViz({ [key]: v / 100 });
      avXyApply();
    };
    $(numId).addEventListener('change', applyNum);
    $(numId).addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyNum(); e.target.blur(); } });
  };
  avXyLine('#av-posx', '#av-posx-num', 'posX');
  avXyLine('#av-posy', '#av-posy-num', 'posY');
  // X/Y 固定调整点：四角 + 居中
  const xyRow = $('#av-xy-presets');
  if (xyRow) {
    xyRow.innerHTML = '';
    for (const p of [
      { label: '↖ 左上', x: 10, y: 12 }, { label: '↗ 右上', x: 90, y: 12 },
      { label: '◎ 居中', x: 50, y: 50 },
      { label: '↙ 左下', x: 10, y: 88 }, { label: '↘ 右下', x: 90, y: 88 },
    ]) {
      const b = document.createElement('button');
      b.className = 'preset-chip';
      b.dataset.x = p.x;
      b.dataset.y = p.y;
      b.textContent = p.label;
      b.addEventListener('click', () => {
        $('#av-posx').value = p.x; $('#av-posx-num').value = p.x;
        $('#av-posy').value = p.y; $('#av-posy-num').value = p.y;
        saveAudioViz({ posX: p.x / 100, posY: p.y / 100 });
        avXyApply();
      });
      xyRow.appendChild(b);
    }
  }
  $$('#av-gradient button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#av-gradient button').forEach(x => x.classList.toggle('active', x === b));
      saveAudioViz({ gradient: b.dataset.gradient === 'on' });
    });
  });
  $('#av-color').addEventListener('input', (e) => {
    saveAudioViz({ color: e.target.value });
    renderAvColors(e.target.value);
  });
  const bindAvSlider = (id, key, fmt, presetsRow, presets) => {
    const apply = (v) => {
      $(id + '-val').textContent = fmt(v);
      saveAudioViz({ [key]: v });
      highlightPresetRow(presetsRow, v);
    };
    $(id).addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      $(id + '-num').value = v;
      apply(v);
    });
    const applyNum = () => {
      const el = $(id + '-num');
      let v = parseFloat(el.value);
      if (Number.isNaN(v)) return;
      v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), v));
      $(id).value = v;
      el.value = String(v);
      apply(v);
    };
    $(id + '-num').addEventListener('change', applyNum);
    $(id + '-num').addEventListener('keydown', (e) => { if (e.key === 'Enter') { applyNum(); e.target.blur(); } });
    if (presetsRow && presets) renderPresetRow(presetsRow, presets, apply);
  };
  bindAvSlider('#av-opacity', 'opacity', v => Math.round(v) + '%', $('#av-opacity-presets'), [30, 50, 70, 85, 100]);
  bindAvSlider('#av-size', 'size', v => v.toFixed(1) + '×', $('#av-size-presets'), [0.5, 0.8, 1, 1.5, 2]);
  bindAvSlider('#av-sens', 'sensitivity', v => v.toFixed(1), $('#av-sens-presets'), [0.5, 1, 1.5, 2, 3]);
  $('#av-mirror').addEventListener('change', (e) => saveAudioViz({ mirror: e.target.checked }));
  $$('#av-mirrormode button').forEach(b => {
    b.addEventListener('click', () => {
      $$('#av-mirrormode button').forEach(x => x.classList.toggle('active', x === b));
      saveAudioViz({ mirrorMode: b.dataset.mirrormode });
    });
  });
  buildAvAdj($('#av-adj'));
  // 调整位置：进入调整模式后桌面整窗可拖动（主进程回传状态同步按钮）
  $('#btn-av-adjust').addEventListener('click', async () => {
    const res = await window.api.setAvizAdjust(!avAdjusting);
    if (!res && !avAdjusting) toast('音律动效未启用，无法调整位置', 'error');
  });
  buildAvMeter();
}

/** 音律动效调色四行：固定调节点 + 滑杆 + 自由输入（100 = 原样） */
function buildAvAdj(host) {
  host.innerHTML = '';
  const row = (title, key, min, presets) => addAdjRow(host, {
    title, sub: key === 'mirrorOpacity' ? '（倒影与主体同层，自动继承上面三项调色）' : '（100 = 原样）',
    min, max: 200, step: 5, presets,
    fmt: (v) => `${v}%`,
    get: () => {
      const av = { ...AV_DEFAULTS, ...(state.settings.audioViz || {}) };
      return Number.isFinite(av[key]) ? av[key] : 100;
    },
    set: (v) => saveAudioViz({ [key]: v }),
  });
  row('动效亮度', 'brightness', 20, [60, 80, 100, 120, 160]);
  row('动效对比度', 'contrast', 20, [60, 80, 100, 120, 160]);
  row('动效饱和度', 'saturate', 0, [0, 50, 100, 150, 200]);
  row('镜像倒影强度', 'mirrorOpacity', 0, [0, 22, 40, 70, 100]);
}

// ---------- 桌面快捷方式转盘 ----------
let launcherCfg = null;

/** 一键收纳后的剩余情况提示：显示/隐藏管理员按钮 + 更新提示文案 */
function updateBoxLeftoverHint(res) {
  const btn = $('#btn-lc-box-public');
  const hint = $('#lc-leftover-hint');
  if (!btn || !hint) return;
  const hasPublic = res && res.publicLeft > 0;
  btn.classList.toggle('hidden', !hasPublic);
  if (res && (hasPublic || res.folders > 0)) {
    const parts = [];
    if (hasPublic) parts.push(`公共桌面还有 ${res.publicLeft} 个快捷方式待管理员授权收纳（点上方 🛡️ 按钮）`);
    if (res.folders > 0) parts.push(`桌面还有 ${res.folders} 个文件夹（用户数据，不自动移动）`);
    hint.textContent = parts.join('；') + '。系统图标（此电脑 / 回收站等）不是文件，无法收纳。';
  } else if (res) {
    hint.textContent = '桌面快捷方式已全部收纳。系统图标（此电脑 / 回收站等）不是文件、桌面文件夹是用户数据，均不移动。';
  }
}

async function renderLauncherSettings() {
  try {
    launcherCfg = await window.api.getLauncherConfig();
  } catch (_) {
    launcherCfg = { enabled: false, count: 8, autoCollapse: true, shortcuts: [] };
  }
  const lc = launcherCfg;
  $('#lc-enabled').checked = !!lc.enabled;
  $$('#lc-count button').forEach(b => b.classList.toggle('active', +b.dataset.count === (lc.count || 8)));
  const lcCountNum = $('#lc-count-num');
  if (document.activeElement !== lcCountNum) lcCountNum.value = lc.count || 8;
  $('#lc-autocollapse').checked = lc.autoCollapse !== false;
  $$('#lc-collect button').forEach(b => b.classList.toggle('active', b.dataset.collect === (lc.collectMode || 'box')));
  $$('#lc-orient button').forEach(b => b.classList.toggle('active', b.dataset.orient === (lc.orientation || 'h')));
  $('#lc-edgefade').checked = !!lc.edgeFade;
  $('#lc-mirror').checked = lc.mirror !== false;
  syncLcGrid();

  const list = $('#lc-list');
  list.innerHTML = '';
  $('#lc-shortcut-count').textContent = lc.shortcuts.length ? `已收纳 ${lc.shortcuts.length} 个` : '';
  if (!lc.shortcuts.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '还没有快捷方式，点击下方按钮添加常用 App。';
    list.appendChild(empty);
    return;
  }
  lc.shortcuts.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'lc-item';
    const ico = document.createElement('div');
    ico.className = 'lc-ico';
    if (s.type === 'system') {
      const sysEmoji = { recycle: '🗑️', control: '⚙️', network: '🌐', thispc: '💻' };
      ico.textContent = sysEmoji[s.sysId] || '🖥️';
    } else if (s.icon) {
      const img = document.createElement('img');
      img.src = s.icon;
      ico.appendChild(img);
    } else {
      ico.textContent = (s.name || '?').slice(0, 1).toUpperCase();
    }
    const name = document.createElement('span');
    name.className = 'lc-name';
    name.textContent = s.name;
    name.title = s.path;
    if (s.boxed) {
      const tag = document.createElement('span');
      tag.className = 'lc-boxed-tag';
      tag.textContent = '已收纳';
      tag.title = '原桌面快捷方式已隐藏，移除后恢复到桌面原位置';
      name.appendChild(tag);
    }
    if (s.pinned) {
      item.classList.add('pinned');
      const tag = document.createElement('span');
      tag.className = 'lc-pinned-tag';
      tag.textContent = '常用';
      tag.title = '开机/重启后打开转盘时优先显示在最前';
      name.appendChild(tag);
    }
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = s.boxed ? '从转盘移除并恢复到桌面原位置' : '从列表移除';
    del.innerHTML = ICONS.trash;
    del.addEventListener('click', async () => {
      // 走主进程 removeAt：收纳项自动恢复到桌面原位置
      await window.api.removeLauncherAt(i);
    });
    item.append(ico, name);
    // 系统项位置固定，不参与「常用」置顶
    if (s.type !== 'system') {
      const star = document.createElement('button');
      star.className = 'icon-btn star' + (s.pinned ? ' on' : '');
      star.title = s.pinned ? '取消常用（回到原顺序位置）' : '设为常用（始终排在转盘最前）';
      star.innerHTML = ICONS.star;
      star.addEventListener('click', async () => {
        await window.api.setLauncherPinned(i, !s.pinned);
        await renderLauncherSettings();
      });
      item.append(star);
    }
    item.append(del);
    list.appendChild(item);
  });
}

/** 转盘九宫格高亮跟随 launcherCfg.grid（null/拖动自定义位置 = 不亮） */
function syncLcGrid() {
  $$('#lc-pos9 .pos-cell').forEach(b =>
    b.classList.toggle('active', !!launcherCfg && launcherCfg.grid === b.dataset.cell));
}

/** 转盘调色五行：固定调节点 + 滑杆 + 自由输入（100 = 原样） */
function buildLcAdj(host) {
  host.innerHTML = '';
  const set = (key) => (v) => {
    launcherCfg = { ...(launcherCfg || {}), [key]: v };
    window.api.updateLauncherConfig({ [key]: v });
  };
  const get = (key, d) => () => {
    const lc = launcherCfg || {};
    return Number.isFinite(lc[key]) ? lc[key] : d;
  };
  const row = (title, key, min, presets) => addAdjRow(host, {
    title, sub: '（100 = 原样）', min, max: 200, step: 5, presets,
    fmt: (v) => `${v}%`, get: get(key, 100), set: set(key),
  });
  addAdjRow(host, {
    title: '倒影强度', sub: '（0 = 几乎看不见，100 = 与图标等亮）',
    min: 0, max: 100, step: 5, presets: [0, 30, 50, 80, 100],
    fmt: (v) => `${v}%`, get: get('mirrorOpacity', 30), set: set('mirrorOpacity'),
  });
  row('转盘亮度', 'brightness', 20, [60, 80, 100, 120, 160]);
  row('转盘对比度', 'contrast', 20, [60, 80, 100, 120, 160]);
  row('转盘饱和度', 'saturate', 0, [0, 50, 100, 150, 200]);
  row('转盘不透明度', 'opacity', 20, [40, 70, 100]);
}

function bindLauncherSettings() {
  $('#lc-enabled').addEventListener('change', async (e) => {
    await window.api.updateLauncherConfig({ enabled: e.target.checked });
    toast(e.target.checked ? '快捷方式转盘已开启，回到桌面查看效果' : '快捷方式转盘已关闭，收纳的快捷方式已恢复到桌面');
  });
  const applyLcCount = async (v) => {
    v = Math.min(12, Math.max(1, Math.round(v) || 8));
    $('#lc-count-num').value = v;
    launcherCfg.count = v;
    $$('#lc-count button').forEach(x => x.classList.toggle('active', +x.dataset.count === v));
    await window.api.updateLauncherConfig({ count: v });
  };
  $$('#lc-count button').forEach(b => {
    b.addEventListener('click', () => applyLcCount(+b.dataset.count));
  });
  const lcCountNum = $('#lc-count-num');
  lcCountNum.addEventListener('change', () => applyLcCount(parseFloat(lcCountNum.value)));
  lcCountNum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { applyLcCount(parseFloat(lcCountNum.value)); lcCountNum.blur(); }
  });
  $('#lc-autocollapse').addEventListener('change', (e) => {
    launcherCfg.autoCollapse = e.target.checked;
    window.api.updateLauncherConfig({ autoCollapse: e.target.checked });
  });
  $$('#lc-collect button').forEach(b => b.addEventListener('click', () => {
    launcherCfg.collectMode = b.dataset.collect;
    window.api.updateLauncherConfig({ collectMode: b.dataset.collect });
    $$('#lc-collect button').forEach(x => x.classList.toggle('active', x === b));
    toast(b.dataset.collect === 'hide'
      ? '已切换为「隐藏到壁纸后」：文件留在原地，恢复后回到原位'
      : '已切换为「移动到收纳目录」：文件由程序保管');
  }));
  $$('#lc-orient button').forEach(b => {
    b.addEventListener('click', async () => {
      $$('#lc-orient button').forEach(x => x.classList.toggle('active', x === b));
      launcherCfg.orientation = b.dataset.orient;
      await window.api.updateLauncherConfig({ orientation: b.dataset.orient });
    });
  });
  // 调整位置：进入调整模式后桌面整窗可拖动（主进程回传状态同步按钮）
  $('#btn-lc-adjust').addEventListener('click', async () => {
    const res = await window.api.setLauncherAdjust(!lcAdjusting);
    if (!res && !lcAdjusting) toast('快捷方式转盘未启用，无法调整位置', 'error');
  });
  // 九宫格快速定位：点击 → 主进程换算物理坐标并即时挪窗；「默认」恢复底部居中
  const lcGrid = $('#lc-pos9');
  if (lcGrid && !lcGrid.children.length) {
    for (const cell of Object.keys(POS_LABELS)) {
      const b = document.createElement('button');
      b.className = 'pos-cell';
      b.dataset.cell = cell;
      b.title = POS_LABELS[cell];
      b.addEventListener('click', async () => {
        await window.api.updateLauncherConfig({ grid: cell });
        if (launcherCfg) launcherCfg.grid = cell;
        syncLcGrid();
      });
      lcGrid.appendChild(b);
    }
  }
  $('#lc-pos-reset').addEventListener('click', async () => {
    await window.api.updateLauncherConfig({ grid: null });
    if (launcherCfg) launcherCfg.grid = null;
    syncLcGrid();
  });
  $('#lc-edgefade').addEventListener('change', (e) => {
    launcherCfg.edgeFade = e.target.checked;
    window.api.updateLauncherConfig({ edgeFade: e.target.checked });
  });
  $('#lc-mirror').addEventListener('change', (e) => {
    launcherCfg.mirror = e.target.checked;
    window.api.updateLauncherConfig({ mirror: e.target.checked });
  });
  buildLcAdj($('#lc-adj'));
  $('#btn-lc-add').addEventListener('click', async () => {
    const res = await window.api.addLauncherShortcuts();
    if (res?.added) toast(`已添加 ${res.added} 个快捷方式`);
    renderLauncherSettings();
  });
  $('#btn-lc-pick').addEventListener('click', async () => {
    const res = await window.api.pickDesktopShortcuts();
    if (!res.ok) toast(res.error || '无法打开桌面图标选择器', 'error');
    // 确认/取消后主进程通过 launcher:changed 通知刷新并提示结果
  });
  $('#btn-lc-box-all').addEventListener('click', async () => {
    const res = await window.api.boxAllDesktopShortcuts();
    if (res.boxed > 0) {
      let msg = `已收纳全部 ${res.boxed} 个桌面快捷方式`;
      const left = [];
      if (res.publicLeft > 0) left.push(`${res.publicLeft} 个公共桌面快捷方式（需管理员，点下方按钮授权收纳）`);
      if (res.folders > 0) left.push(`${res.folders} 个文件夹`);
      if (left.length) msg += `；桌面剩余 ${left.join('、')}`;
      toast(msg);
    } else {
      toast('桌面上没有可收纳的快捷方式', 'error');
    }
    updateBoxLeftoverHint(res);
    renderLauncherSettings();
  });
  $('#btn-lc-box-public').addEventListener('click', async () => {
    const btn = $('#btn-lc-box-public');
    btn.disabled = true;
    const res = await window.api.boxPublicDesktopShortcuts();
    btn.disabled = false;
    if (res.declined) toast('已取消授权（可稍后再试）', 'error');
    else if (res.moved > 0) toast(`已收纳 ${res.moved} 个公共桌面快捷方式${res.failed ? `（${res.failed} 个失败）` : ''}`);
    else if (res.failed) toast(`收纳失败 ${res.failed} 个`, 'error');
    else toast('公共桌面没有待收纳的快捷方式');
    renderLauncherSettings();
    // 重新统计剩余情况
    const cfg = await window.api.getLauncherConfig();
    updateBoxLeftoverHint({ publicLeft: 0 }); // boxPublic 后公共桌面已处理，粗略隐藏按钮
    if (!res.moved) $('#btn-lc-box-public').classList.remove('hidden');
  });
  $('#btn-lc-restore-all').addEventListener('click', async () => {
    const res = await window.api.restoreAllLauncher();
    toast(`已恢复 ${res.restored} 个快捷方式到桌面原位置${res.failed ? `（${res.failed} 个失败）` : ''}`);
    renderLauncherSettings();
  });
}

// ---------- 桌面文件收纳区 ----------
let fileboxCfg = null;

async function renderFileboxSettings() {
  try {
    fileboxCfg = await window.api.getFileboxConfig();
  } catch (_) {
    fileboxCfg = { enabled: false, gridCols: 5, groupBy: 'kind', bgOpacity: 0.32, idleOpacity: 0.28, autoIdle: true, items: [] };
  }
  const fb = fileboxCfg;
  $('#fb-enabled').checked = !!fb.enabled;
  $$('#fb-cols button').forEach(b => b.classList.toggle('active', +b.dataset.cols === (fb.gridCols || 5)));
  const fbColsNum = $('#fb-cols-num');
  if (document.activeElement !== fbColsNum) fbColsNum.value = fb.gridCols || 5;
  $$('#fb-groupby button').forEach(b => b.classList.toggle('active', b.dataset.groupby === (fb.groupBy || 'kind')));
  $$('#fb-style button').forEach(b => b.classList.toggle('active', b.dataset.style === (fb.style || 'frosted')));
  $$('#fb-bgop button').forEach(b => b.classList.toggle('active', Math.abs(+b.dataset.op - (fb.bgOpacity ?? 0.32)) < 0.01));
  $('#fb-autoidle').checked = fb.autoIdle !== false;
  $('#fb-mirror').checked = fb.mirror !== false;
  syncFbGrid();

  const list = $('#fb-list');
  list.innerHTML = '';
  $('#fb-item-count').textContent = (fb.items || []).length ? `已收纳 ${fb.items.length} 个` : '';
  if (!(fb.items || []).length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = '还没有收纳文件或文件夹，点击下方按钮添加。';
    list.appendChild(empty);
    return;
  }
  fb.items.forEach((it, i) => {
    const item = document.createElement('div');
    item.className = 'lc-item';
    const ico = document.createElement('div');
    ico.className = 'lc-ico';
    if (it.type === 'folder') {
      ico.textContent = '📁';
    } else if (it.icon) {
      const img = document.createElement('img');
      img.src = it.icon;
      ico.appendChild(img);
    } else {
      ico.textContent = (it.name || '?').slice(0, 1).toUpperCase();
    }
    const name = document.createElement('span');
    name.className = 'lc-name';
    name.textContent = it.name;
    name.title = it.path;
    if (it.type === 'folder') {
      const tag = document.createElement('span');
      tag.className = 'lc-boxed-tag';
      tag.textContent = '文件夹';
      tag.title = '文件夹仅登记收纳，点开进入文件夹，不移动内容';
      name.appendChild(tag);
    }
    const del = document.createElement('button');
    del.className = 'icon-btn';
    del.title = '从收纳区移除' + (it.type === 'file' && it.boxPath ? '并恢复到桌面原位置' : '');
    del.innerHTML = ICONS.trash;
    del.addEventListener('click', async () => {
      await window.api.removeFileboxAt(i);
    });
    item.append(ico, name, del);
    list.appendChild(item);
  });
}

function syncFbGrid() {
  $$('#fb-pos9 .pos-cell').forEach(b =>
    b.classList.toggle('active', !!fileboxCfg && fileboxCfg.grid === b.dataset.cell));
}

/** 文件收纳区调色五行：固定调节点 + 滑杆 + 自由输入（100 = 原样） */
function buildFbAdj(host) {
  host.innerHTML = '';
  const set = (key) => (v) => {
    fileboxCfg = { ...(fileboxCfg || {}), [key]: v };
    window.api.updateFileboxConfig({ [key]: v });
  };
  const get = (key, d) => () => {
    const fb = fileboxCfg || {};
    return Number.isFinite(fb[key]) ? fb[key] : d;
  };
  const row = (title, key, min, presets) => addAdjRow(host, {
    title, sub: '（100 = 原样）', min, max: 200, step: 5, presets,
    fmt: (v) => `${v}%`, get: get(key, 100), set: set(key),
  });
  addAdjRow(host, {
    title: '倒影强度', sub: '（0 = 几乎看不见，100 = 与面板等亮）',
    min: 0, max: 100, step: 5, presets: [0, 25, 45, 75, 100],
    fmt: (v) => `${v}%`, get: get('mirrorOpacity', 25), set: set('mirrorOpacity'),
  });
  row('收纳区亮度', 'brightness', 20, [60, 80, 100, 120, 160]);
  row('收纳区对比度', 'contrast', 20, [60, 80, 100, 120, 160]);
  row('收纳区饱和度', 'saturate', 0, [0, 50, 100, 150, 200]);
  row('收纳区不透明度', 'opacity', 20, [40, 70, 100]);
}

function bindFileboxSettings() {
  $('#fb-enabled').addEventListener('change', async (e) => {
    await window.api.updateFileboxConfig({ enabled: e.target.checked });
    toast(e.target.checked ? '文件收纳区已开启，回到桌面查看效果' : '文件收纳区已关闭，收纳的文件已恢复到桌面');
  });
  const applyFbCols = async (v) => {
    v = Math.min(12, Math.max(3, Math.round(v) || 5));
    $('#fb-cols-num').value = v;
    fileboxCfg.gridCols = v;
    $$('#fb-cols button').forEach(x => x.classList.toggle('active', +x.dataset.cols === v));
    await window.api.updateFileboxConfig({ gridCols: v });
  };
  $$('#fb-cols button').forEach(b => {
    b.addEventListener('click', () => applyFbCols(+b.dataset.cols));
  });
  const fbColsNum = $('#fb-cols-num');
  fbColsNum.addEventListener('change', () => applyFbCols(parseFloat(fbColsNum.value)));
  fbColsNum.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { applyFbCols(parseFloat(fbColsNum.value)); fbColsNum.blur(); }
  });
  $$('#fb-groupby button').forEach(b => {
    b.addEventListener('click', async () => {
      $$('#fb-groupby button').forEach(x => x.classList.toggle('active', x === b));
      fileboxCfg.groupBy = b.dataset.groupby;
      await window.api.updateFileboxConfig({ groupBy: b.dataset.groupby });
    });
  });
  $$('#fb-style button').forEach(b => {
    b.addEventListener('click', async () => {
      $$('#fb-style button').forEach(x => x.classList.toggle('active', x === b));
      fileboxCfg.style = b.dataset.style;
      await window.api.updateFileboxConfig({ style: b.dataset.style });
    });
  });
  $$('#fb-bgop button').forEach(b => {
    b.addEventListener('click', async () => {
      $$('#fb-bgop button').forEach(x => x.classList.toggle('active', x === b));
      fileboxCfg.bgOpacity = +b.dataset.op;
      await window.api.updateFileboxConfig({ bgOpacity: +b.dataset.op });
    });
  });
  $('#fb-autoidle').addEventListener('change', (e) => {
    fileboxCfg.autoIdle = e.target.checked;
    window.api.updateFileboxConfig({ autoIdle: e.target.checked });
  });
  $('#fb-mirror').addEventListener('change', (e) => {
    fileboxCfg.mirror = e.target.checked;
    window.api.updateFileboxConfig({ mirror: e.target.checked });
  });
  buildFbAdj($('#fb-adj'));
  $('#btn-fb-adjust').addEventListener('click', async () => {
    const res = await window.api.setFileboxAdjust(!fbAdjusting);
    if (!res && !fbAdjusting) toast('文件收纳区未启用，无法调整位置', 'error');
  });
  const fbGrid = $('#fb-pos9');
  if (fbGrid && !fbGrid.children.length) {
    for (const cell of Object.keys(POS_LABELS)) {
      const b = document.createElement('button');
      b.className = 'pos-cell';
      b.dataset.cell = cell;
      b.title = POS_LABELS[cell];
      b.addEventListener('click', async () => {
        await window.api.updateFileboxConfig({ grid: cell });
        if (fileboxCfg) fileboxCfg.grid = cell;
        syncFbGrid();
      });
      fbGrid.appendChild(b);
    }
  }
  $('#fb-pos-reset').addEventListener('click', async () => {
    await window.api.updateFileboxConfig({ grid: null });
    if (fileboxCfg) fileboxCfg.grid = null;
    syncFbGrid();
  });
  $('#btn-fb-add').addEventListener('click', async () => {
    const res = await window.api.addFileboxItems();
    if (res?.added) toast(`已添加 ${res.added} 个文件/文件夹`);
    renderFileboxSettings();
  });
  $('#btn-fb-box-all').addEventListener('click', async () => {
    const res = await window.api.boxAllDesktopFiles();
    if (res.boxed > 0) {
      toast(`已收纳 ${res.boxed} 个文件/文件夹（文件 ${res.files} / 文件夹 ${res.folders}）`);
    } else {
      toast('桌面上没有可收纳的普通文件或文件夹', 'error');
    }
    renderFileboxSettings();
  });
  $('#btn-fb-restore-all').addEventListener('click', async () => {
    const res = await window.api.restoreAllFilebox();
    toast(`已恢复 ${res.restored} 个文件到桌面原位置${res.failed ? `（${res.failed} 个失败）` : ''}`);
    renderFileboxSettings();
  });
}

// ---------- 壁纸站点 ----------
const SITES = [
  { name: '4K Desk', url: 'https://www.4kdesk.com/', desc: '4K 超高清壁纸站，风景 / 动漫 / 游戏分类齐全', tags: ['4K', '超高清'] },
  { name: 'TooPIC 电脑壁纸', url: 'https://www.toopic.cn/dnbz/', desc: '国内图库站电脑壁纸专区，每日更新海量精选', tags: ['国内', '每日更新'] },
  { name: '好壁纸', url: 'https://haowallpaper.com/', desc: '海量高清电脑壁纸，按分辨率与分类快速筛选', tags: ['高清', '分类全'] },
  { name: '魔玉部落', url: 'https://www.moyubuluo.com/hdwallpapers/', desc: 'HD 高清壁纸合集，4K / 5K / 8K 超大图库', tags: ['4K/8K', '图库'] },
  { name: 'Wallhaven', url: 'https://wallhaven.cc', desc: '全球热门壁纸社区，海量 4K/8K 壁纸，分类检索强大', tags: ['4K/8K', '动漫', '游戏'] },
  { name: 'Unsplash', url: 'https://unsplash.com', desc: '高质量摄影壁纸，可免费商用', tags: ['摄影', '免费商用'] },
  { name: 'Pexels', url: 'https://www.pexels.com', desc: '免费高清图片与视频素材库', tags: ['图片', '视频'] },
  { name: 'Pixabay', url: 'https://pixabay.com', desc: '海量免费图片 / 视频 / 插画', tags: ['免费', '插画'] },
  { name: 'Wallpaper Abyss', url: 'https://wall.alphacoders.com', desc: '超大壁纸库，游戏 / 动漫 / 影视专题', tags: ['游戏', '动漫'] },
  { name: '必应壁纸', url: 'https://bing.ioliu.cn', desc: '微软必应每日一图，可下载历史全部图片', tags: ['每日一图', '4K'] },
  { name: '极像素', url: 'https://www.sigoo.com', desc: '国内超高清原创壁纸，风光大片', tags: ['国内', '超高清'] },
  { name: '彼岸图网', url: 'https://www.netbian.com', desc: '国内老牌壁纸站，4K 分类齐全', tags: ['国内', '4K'] },
  { name: 'Simple Desktops', url: 'https://simpledesktops.com', desc: '极简主义壁纸，清爽不花哨', tags: ['极简'] },
];

function renderSites() {
  const grid = $('#sites-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (const s of SITES) {
    const card = document.createElement('button');
    card.className = 'site-card';
    card.title = `在新窗口打开 ${s.url}`;
    const host = s.url.replace(/^https?:\/\//, '');
    card.innerHTML = `
      <div class="site-head">
        <span class="site-name">${s.name}</span>
        <span class="site-open">前往 →</span>
      </div>
      <div class="site-desc">${s.desc}</div>
      <div class="site-tags">${s.tags.map(t => `<span>${t}</span>`).join('')}</div>
      <div class="site-host">${host}</div>`;
    card.addEventListener('click', () => window.api.openExternal(s.url));
    grid.appendChild(card);
  }
}

// ---------- 设置页 ----------
// ---------- 通用「固定调节点 + 滑杆 + 自由输入」调节行 ----------
// 性能档位高级项、组件/音律/转盘/收纳区的亮度·透明度·对比度·饱和度等十几行调节
// 全部复用它（模板取自 bindAvSlider + renderPresetRow），避免逐处复制。
const ADJ_ROWS = [];

/**
 * 生成并绑定一行调节行（switch-row + preset-row）。
 * @param {HTMLElement} host 容器
 * @param {object} o { title, sub, min, max, step, presets, fmt, get(), set(v) }
 * @returns {HTMLElement} 行元素
 */
function addAdjRow(host, o) {
  const id = `adj-${Math.random().toString(36).slice(2, 8)}`;
  const row = document.createElement('div');
  row.className = 'switch-row';
  row.innerHTML = `
    <div>
      <div class="row-title">${o.title} <span class="title-hint" id="${id}-val"></span></div>
      <div class="row-sub"><input type="number" id="${id}-num" min="${o.min}" max="${o.max}" step="${o.step}" style="width:64px"> ${o.sub || ''}</div>
    </div>
    <input type="range" id="${id}" min="${o.min}" max="${o.max}" step="${o.step}" style="width:150px">`;
  const pre = document.createElement('div');
  pre.className = 'preset-row';
  host.append(row, pre);
  const slider = row.querySelector(`#${id}`);
  const num = row.querySelector(`#${id}-num`);
  const val = row.querySelector(`#${id}-val`);
  const fmt = o.fmt || ((v) => String(v));
  const paint = (v) => {
    slider.value = v;
    if (document.activeElement !== num) num.value = v;
    val.textContent = fmt(v);
    highlightPresetRow(pre, v);
  };
  const apply = (raw) => {
    let v = parseFloat(raw);
    if (!Number.isFinite(v)) return;
    v = Math.min(o.max, Math.max(o.min, v));
    slider.value = v; num.value = v; val.textContent = fmt(v);
    highlightPresetRow(pre, v);
    o.set(v);
  };
  slider.addEventListener('input', (e) => apply(e.target.value));
  num.addEventListener('change', (e) => apply(e.target.value));
  num.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(e.target.value); e.target.blur(); } });
  if (o.presets) renderPresetRow(pre, o.presets, (v) => apply(v));
  row._adjSync = () => paint(o.get());
  row._adjSync();
  ADJ_ROWS.push(row);
  return row;
}

/** 配置被主进程回写（settings:sync）后刷新所有仍挂在文档上的调节行 */
function syncAdjRows() {
  for (let i = ADJ_ROWS.length - 1; i >= 0; i--) {
    const r = ADJ_ROWS[i];
    if (!r.isConnected) { ADJ_ROWS.splice(i, 1); continue; }
    try { r._adjSync(); } catch (_) {}
  }
}

function renderSettingsPage() {
  $('#set-autostart').checked = !!state.settings.autoStart;
  $('#set-fs-pause').checked = state.settings.performance?.fullscreenPause !== false;
  $('#set-battery-pause').checked = state.settings.performance?.batteryPause !== false;
  $('#set-max-pause').checked = state.settings.performance?.maximizedPause === true;
  $('#set-hotkey').checked = state.settings.hotkeyPause !== false;
  $('#set-smooth-loop').checked = state.settings.smoothLoop !== false;
  buildPerfAdv($('#perf-adv'));
  syncPerfTierUi();
}

function bindSettings() {
  $('#set-autostart').addEventListener('change', (e) => {
    state.settings.autoStart = e.target.checked;
    window.api.updateSettings({ autoStart: e.target.checked });
    toast(e.target.checked ? '已设置开机自启' : '已取消开机自启');
  });
  const savePerf = (key, val, msgOn, msgOff) => {
    const perf = { ...(state.settings.performance || {}), [key]: val };
    state.settings.performance = perf;
    window.api.updateSettings({ performance: perf });
    toast(val ? msgOn : msgOff);
  };
  $('#set-fs-pause').addEventListener('change', (e) =>
    savePerf('fullscreenPause', e.target.checked, '已开启全屏自动暂停', '已关闭全屏自动暂停'));
  $('#set-battery-pause').addEventListener('change', (e) =>
    savePerf('batteryPause', e.target.checked, '已开启电池供电自动暂停', '已关闭电池供电自动暂停'));
  $('#set-max-pause').addEventListener('change', (e) =>
    savePerf('maximizedPause', e.target.checked, '已开启窗口最大化自动暂停', '已关闭窗口最大化自动暂停'));
  $('#set-hotkey').addEventListener('change', (e) => {
    state.settings.hotkeyPause = e.target.checked;
    window.api.updateSettings({ hotkeyPause: e.target.checked });
    toast(e.target.checked ? '已启用全局快捷键 Ctrl+Alt+W' : '已停用全局快捷键');
  });
  $('#set-smooth-loop').addEventListener('change', (e) => {
    state.settings.smoothLoop = e.target.checked;
    window.api.updateSettings({ smoothLoop: e.target.checked });
    toast(e.target.checked ? '已开启平滑循环过渡' : '已关闭平滑循环过渡');
  });
  $('#btn-mpv-download').addEventListener('click', () => window.api.openMpvDownload());
  $('#btn-lockscreen-use-current').addEventListener('click', () => setLockScreenFrom(state.current?.wallpaper));
  $('#btn-lockscreen-reset').addEventListener('click', async () => {
    await window.api.resetLockScreen();
    toast('已恢复默认锁屏');
    refreshLockScreenDetail();
  });
  bindPerfCard();
}

// ---------- 性能档位（省电/均衡/性能）+ 高级细分 ----------
const PERF_TIERS = {
  eco:         { avFps: 24, statsInterval: 2000, hwdec: 'auto-copy', videoFpsCap: 30, videoResCap: '720p',   videoCacheMb: 48 },
  balanced:    { avFps: 30, statsInterval: 1000, hwdec: 'auto-safe', videoFpsCap: 0,  videoResCap: '1080p',  videoCacheMb: 128 },
  performance: { avFps: 60, statsInterval: 500,  hwdec: 'auto',      videoFpsCap: 0,  videoResCap: 'source', videoCacheMb: 128 },
};
const TIER_LABEL = { eco: '省电', balanced: '均衡', performance: '性能' };

const perfNow = () => ({ ...(state.settings?.performance || {}) });

/**
 * 写性能补丁。默认视为「手改细分项」→ tier 置 null 取消档位高亮；
 * 点三档按钮时传 keepTier 并带上该档全部字段。
 */
function savePerf(patch, { keepTier = false, tier = null } = {}) {
  if (!state.settings) return;
  const perf = { ...perfNow(), ...patch };
  perf.tier = keepTier ? tier : null;
  const extra = {};
  // 档位里的音律帧率要同步到 audioViz.fps（widgets 窗读的是 audioViz）
  if (patch.avFps !== undefined) {
    extra.audioViz = { ...(state.settings.audioViz || {}), fps: patch.avFps };
    state.settings.audioViz = extra.audioViz;
  }
  state.settings.performance = perf;
  window.api.updateSettings({ performance: perf, ...extra });
  syncPerfTierUi();
}

/** 枚举型调节行（.seg），供 hwdec / 分辨率天花板等使用 */
function addSegRow(host, o) {
  const row = document.createElement('div');
  row.className = 'switch-row';
  row.innerHTML = `
    <div>
      <div class="row-title">${o.title}</div>
      <div class="row-sub">${o.sub || ''}</div>
    </div>
    <div class="seg" style="flex-wrap:wrap; max-width:300px; justify-content:flex-end"></div>`;
  const seg = row.querySelector('.seg');
  for (const [val, label] of o.options) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.val = String(val);
    b.addEventListener('click', () => o.set(val));
    seg.appendChild(b);
  }
  row._adjSync = () => {
    const cur = String(o.get());
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.val === cur));
  };
  row._adjSync();
  host.appendChild(row);
  ADJ_ROWS.push(row);
  return row;
}

function buildPerfAdv(host) {
  host.innerHTML = '';
  addAdjRow(host, {
    title: '音律动效帧率', sub: '（0 = 跟随显示器刷新率）',
    min: 0, max: 60, step: 1, presets: [15, 24, 30, 60, 0],
    fmt: (v) => (v > 0 ? `${v} fps` : '不限'),
    get: () => perfNow().avFps ?? 30,
    set: (v) => savePerf({ avFps: v }),
  });
  addAdjRow(host, {
    title: '组件刷新间隔', sub: 'CPU/GPU/内存/网速数据采集周期',
    min: 250, max: 10000, step: 250, presets: [500, 1000, 2000, 5000],
    fmt: (v) => (v >= 1000 ? `${v / 1000}s` : `${v}ms`),
    get: () => perfNow().statsInterval ?? 1000,
    set: (v) => savePerf({ statsInterval: v }),
  });
  addSegRow(host, {
    title: '视频 GPU 解码', sub: 'auto-safe 只允许零拷贝白名单；auto 允许一切硬解；no = 纯 CPU',
    options: [['auto-safe', 'auto-safe'], ['auto', 'auto'], ['auto-copy', 'auto-copy'], ['no', 'no']],
    get: () => perfNow().hwdec ?? 'auto-safe',
    set: (v) => savePerf({ hwdec: v }),
  });
  addAdjRow(host, {
    title: '视频帧率上限', sub: '（0 = 不限；改动会重启视频引擎）',
    min: 0, max: 144, step: 1, presets: [0, 30, 60],
    fmt: (v) => (v > 0 ? `${v} fps` : '不限'),
    get: () => perfNow().videoFpsCap ?? 0,
    set: (v) => savePerf({ videoFpsCap: v }),
  });
  addSegRow(host, {
    title: '视频分辨率天花板', sub: '与每张壁纸自己的「渲染分辨率」取更严格者，只往下压不顶掉手选值',
    options: [['source', '原始'], ['1080p', '1080p'], ['720p', '720p'], ['480p', '480p']],
    get: () => perfNow().videoResCap ?? '1080p',
    set: (v) => savePerf({ videoResCap: v }),
  });
  addAdjRow(host, {
    title: '视频解码缓存', sub: '（平滑循环开双槽时实际占用 ×2）',
    min: 16, max: 512, step: 16, presets: [48, 128, 256],
    fmt: (v) => `${v} MiB`,
    get: () => perfNow().videoCacheMb ?? 128,
    set: (v) => savePerf({ videoCacheMb: v }),
  });
}

function syncPerfTierUi() {
  const perf = perfNow();
  $$('#perf-tier button').forEach((b) => {
    const t = PERF_TIERS[b.dataset.tier];
    const match = t && Object.entries(t).every(([k, v]) => perf[k] === v);
    b.classList.toggle('active', !!match && perf.tier === b.dataset.tier);
  });
  const gpu = $('#set-gpu-accel');
  if (gpu) gpu.checked = perf.gpuAccel !== false;
  syncAdjRows();
}

function bindPerfCard() {
  $$('#perf-tier button').forEach((b) => {
    b.addEventListener('click', () => {
      const t = PERF_TIERS[b.dataset.tier];
      if (!t) return;
      savePerf({ ...t }, { keepTier: true, tier: b.dataset.tier });
      toast(`已切换到「${TIER_LABEL[b.dataset.tier]}」档`);
    });
  });
  const gpu = $('#set-gpu-accel');
  if (gpu) {
    gpu.addEventListener('change', (e) => {
      savePerf({ gpuAccel: e.target.checked }, { keepTier: true, tier: perfNow().tier ?? null });
      showRestartBanner({ gpuAccel: e.target.checked, auto: false });
    });
  }
  $('#btn-perf-relaunch').addEventListener('click', () => window.api.relaunchApp());
  // 高级细分行需要 state.settings，构建放在 renderSettingsPage()
}

/** 硬件加速等「app ready 前才生效」的设置改动后提示重启 */
function showRestartBanner(info) {
  const card = $('#perf-restart-card');
  if (!card) return;
  card.classList.remove('hidden');
  const sub = $('#perf-restart-sub');
  if (sub) {
    sub.textContent = info && info.auto
      ? '检测到 GPU 进程反复崩溃，已自动改为软件渲染以保证稳定 —— 重启后生效'
      : `硬件加速已改为「${info?.gpuAccel ? '开启' : '关闭'}」，该设置只在启动时生效 —— 重启后生效`;
  }
}

// ---------- mpv 状态 ----------
async function checkMpv() {
  const el = $('#mpv-status');
  const detail = $('#mpv-detail');
  try {
    const res = await window.api.checkMpv();
    if (res.bundled) {
      el.textContent = 'mpv 引擎：内置就绪';
      el.className = 'mpv-status ok';
      detail.textContent = '已使用内置 mpv 播放引擎（assets/mpv）';
    } else if (res.inPath) {
      el.textContent = 'mpv 引擎：系统 PATH';
      el.className = 'mpv-status ok';
      detail.textContent = '检测到系统 PATH 中的 mpv，将用于视频壁纸播放';
    } else {
      el.textContent = 'mpv 引擎：未安装';
      el.className = 'mpv-status bad';
      detail.textContent = '未检测到 mpv，视频壁纸暂不可用。下载后解压到 assets/mpv/ 或加入 PATH';
    }
  } catch (e) {
    el.textContent = 'mpv 引擎：检测失败';
    el.className = 'mpv-status bad';
  }
}

// ---------- 检查更新（自动检查静默；手动检查发现新版本 → 功能介绍弹窗 → 应用内直接安装） ----------
/** 字节数 → 可读文本 */
function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 下载速度 → 可读文本（慢速时保留 1 位小数，避免长期显示 0 KB/s） */
function fmtSpeed(bytesPerSec) {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return '—';
  return `${fmtBytes(bytesPerSec)}/s`;
}

/** 剩余秒数 → 可读文本 */
function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '计算中…';
  if (sec < 60) return `约 ${Math.ceil(sec)} 秒`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `约 ${m} 分 ${s} 秒` : `约 ${m} 分钟`;
}

/** 轻量 Markdown 渲染（标题/列表/加粗/行内代码/链接，全部先转义防注入） */
function renderUpdateNotes(md) {
  if (!md || !md.trim()) return '<p class="upd-note-empty">本次更新以修复与优化为主。</p>';
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="#" data-ext-url="$2">$1</a>');
  let html = '';
  let inList = false;
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const raw of esc(md).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*$/.test(line)) { closeList(); continue; }
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { closeList(); html += `<div class="upd-note-h">${inline(h[1])}</div>`; continue; }
    const li = line.match(/^\s*[-*+]\s+(.*)$/) || line.match(/^\s*\d+[.、]\s+(.*)$/);
    if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

function renderUpdateStatus() {
  const dot = $('#update-dot');
  const status = $('#update-status');
  const installBtn = $('#btn-install-update');
  const dlBtn = $('#btn-open-download');
  if (!dot || !status) return;
  const u = state.update;
  if (!u) {
    dot.classList.add('hidden');
    installBtn?.classList.add('hidden');
    dlBtn?.classList.add('hidden');
    return;
  }
  if (u.hasUpdate) {
    // 有新版本：标题栏呼吸亮点 + "立即更新"按钮（应用内直接安装）+ 可点击查看更新内容
    dot.classList.remove('hidden');
    dot.title = `发现新版本 v${u.latest}（当前 v${u.current}），点击查看`;
    status.innerHTML = `<b class="upd-hint">发现新版本 v${u.latest}</b>（当前 v${u.current}）· <span class="upd-link" id="upd-view-notes">查看更新内容</span>`;
    $('#upd-view-notes')?.addEventListener('click', showUpdateModal);
    if (u.installerUrl) {
      // 发布页有 NSIS 安装包：应用内直接下载安装
      installBtn?.classList.remove('hidden');
      dlBtn?.classList.add('hidden');
    } else {
      // 找不到安装包资产：兜底保留发布页入口
      installBtn?.classList.add('hidden');
      dlBtn?.classList.remove('hidden');
    }
  } else if (u.error) {
    dot.classList.add('hidden');
    installBtn?.classList.add('hidden');
    dlBtn?.classList.add('hidden');
    status.textContent = `检查更新失败：${u.error}（可在网络恢复后手动重试）`;
  } else {
    dot.classList.add('hidden');
    installBtn?.classList.add('hidden');
    dlBtn?.classList.add('hidden');
    status.textContent = `已是最新版本 v${u.current}`;
  }
}

// ---------- 新版本功能介绍弹窗 + 应用内直接安装 ----------
let updInstalling = false;

function resetUpdateModalUi() {
  $('#upd-dl')?.classList.add('hidden');
  $('#upd-dl-fill')?.classList.remove('err');
  $('#upd-dl-fill').style.width = '0%';
  $('#upd-dl-text').textContent = '准备下载…';
  const installBtn = $('#upd-install');
  const cancelBtn = $('#upd-cancel');
  if (installBtn) installBtn.disabled = false;
  if (cancelBtn) cancelBtn.textContent = '稍后再说';
}

function showUpdateModal() {
  const u = state.update;
  if (!u || !u.hasUpdate) return;
  $('#upd-modal-title').textContent = `发现新版本 v${u.latest}`;
  const dateStr = u.publishedAt ? ` · ${new Date(u.publishedAt).toLocaleDateString('zh-CN')} 发布` : '';
  $('#upd-modal-sub').textContent = `当前版本 v${u.current}${dateStr} · 更新将自动完成，无需跳转网页`;
  $('#upd-modal-notes').innerHTML = renderUpdateNotes(u.notes);
  resetUpdateModalUi();
  $('#modal-update').classList.remove('hidden');
}

function closeUpdateModal() {
  if (updInstalling) {
    // 下载中关闭弹窗 = 取消下载（半成品文件由主进程清理）
    window.api.cancelUpdateInstall();
    updInstalling = false;
  }
  $('#modal-update').classList.add('hidden');
}

async function startUpdateInstall() {
  if (updInstalling) return;
  updInstalling = true;
  const box = $('#upd-dl');
  const fill = $('#upd-dl-fill');
  const text = $('#upd-dl-text');
  const installBtn = $('#upd-install');
  const cancelBtn = $('#upd-cancel');
  box.classList.remove('hidden');
  fill.classList.remove('err');
  fill.style.width = '0%';
  text.textContent = '正在准备更新…';
  installBtn.disabled = true;
  cancelBtn.textContent = '取消下载';

  const offProg = window.api.on('update:download-progress', (p) => {
    if (!p) return;
    const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
    // 慢速网络下百分比会长时间停在 0.x%：用 1 位小数展示，并保留最小可见宽度，
    // 让用户能看出「在动」，而不是像旧版那样被四舍五入钉死在 0%。
    fill.style.width = `${Math.max(1.5, pct).toFixed(2)}%`;
    const detail = [
      p.note || (p.source ? `下载源：${p.source}` : ''),
      p.note ? '' : fmtSpeed(p.speed),
      p.note ? '' : (p.eta ? `剩余 ${fmtEta(p.eta)}` : ''),
    ].filter(Boolean).join(' · ');
    text.innerHTML = `正在下载更新包… <b>${pct.toFixed(1)}%</b>（${fmtBytes(p.receivedBytes)} / ${fmtBytes(p.totalBytes)}）`
      + (detail ? `<span class="upd-dl-sub">${detail}</span>` : '');
  });
  const offState = window.api.on('update:install-state', (s) => {
    if (!s) return;
    if (s.stage === 'launching') {
      fill.style.width = '100%';
      text.textContent = '下载完成，正在启动安装程序… 客户端即将退出';
      cancelBtn.textContent = '关闭';
      updInstalling = false;
      offProg(); offState();
    } else if (s.stage === 'error') {
      failInstall(s.error || '下载失败');
    }
  });
  const failInstall = (msg) => {
    // 旧实现把承载提示的进度框一并隐藏了 → 失败原因用户完全看不到，
    // 只会觉得「进度停在 0 然后什么都没发生」。这里改为保留可见的错误提示。
    fill.classList.add('err');
    fill.style.width = '100%';
    text.textContent = '';
    const err = document.createElement('span');
    err.className = 'upd-dl-err';
    err.textContent = msg || '下载失败';
    const sub = document.createElement('span');
    sub.className = 'upd-dl-sub';
    sub.textContent = '可点击「立即更新」重试，或前往发布页手动下载';
    text.appendChild(err);
    text.appendChild(sub);
    installBtn.disabled = false;
    cancelBtn.textContent = '稍后再说';
    updInstalling = false;
    offProg(); offState();
  };
  try {
    const res = await window.api.installUpdate();
    if (!res?.ok) failInstall(res?.error || '下载失败');
  } catch (e) {
    failInstall(e?.message || '下载失败');
  }
}

function bindUpdateCheck() {
  // 标题栏亮点：点击跳到设置页"版本与更新"
  $('#update-dot').addEventListener('click', () => {
    const nav = document.querySelector('.nav-item[data-page="settings"]');
    if (nav) nav.click();
    const card = $('#about-card');
    if (card) {
      card.classList.remove('upd-flash');
      void card.offsetWidth; // 重置动画
      card.classList.add('upd-flash');
    }
  });
  $('#btn-check-update').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const status = $('#update-status');
    btn.disabled = true;
    status.textContent = '正在检查更新…';
    const result = await window.api.checkUpdateNow();
    state.update = result;
    renderUpdateStatus();
    btn.disabled = false;
    // 手动检查发现新版本：弹出新版本功能介绍窗口
    if (result && result.hasUpdate) showUpdateModal();
  });
  // 设置页"立即更新"：打开功能介绍弹窗
  $('#btn-install-update').addEventListener('click', showUpdateModal);
  // 弹窗按钮
  $('#upd-install').addEventListener('click', startUpdateInstall);
  $('#upd-cancel').addEventListener('click', closeUpdateModal);
  // 点击遮罩关闭（下载中同样视为取消）
  $('#modal-update').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeUpdateModal();
  });
  // 更新内容中的链接：默认浏览器打开
  $('#upd-modal-notes').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-ext-url]');
    if (a) {
      e.preventDefault();
      window.api.openExternal(a.dataset.extUrl);
    }
  });
}

// 关于页版本号动态显示（避免硬编码过期）
async function renderAboutVersion() {
  try {
    const v = await window.api.getAppVersion();
    const el = $('#about-version');
    if (el && v) {
      el.innerHTML = `壁纸工坊 <b>v${v}</b> — 静态 / 动态 / 网页 / EXE 壁纸 · 平滑轮换过渡 · 音律动效 · 桌面组件 · 快捷方式收纳转盘 · 桌面与锁屏`;
    }
  } catch (_) { /* 静态兜底文本已在 HTML 中 */ }
}

// ---------- 网页壁纸弹窗 ----------
function bindModal() {
  $('#web-cancel').addEventListener('click', () => $('#modal-web').classList.add('hidden'));
  $('#web-confirm').addEventListener('click', async () => {
    const url = $('#web-url-input').value.trim();
    if (!url) return;
    const wp = await window.api.addWeb(url);
    $('#modal-web').classList.add('hidden');
    $('#web-url-input').value = '';
    const res = await window.api.apply(wp.id);
    if (res.ok) toast('网页壁纸已应用');
    else toast(res.error, 'error');
  });
  $('#web-url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('#web-confirm').click();
  });
}

// ---------- 窗口控制 ----------
function bindWindowControls() {
  $('#btn-min').addEventListener('click', () => window.api.minimize());
  $('#btn-max').addEventListener('click', () => window.api.maximize());
  $('#btn-close').addEventListener('click', () => window.api.close());
}

// ---------- Toast ----------
let toastTimer = null;
function toast(msg, type = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// ---------- 启动 ----------
/**
 * 单个设置卡片的绑定失败不应连带后面所有 bind 一起跳过 ——
 * v1.8.4「窗口可见但全区域点击无响应」正是这个连带效应，这里隔离并大声报错。
 */
function safeBind(name, fn) {
  try { fn(); } catch (e) { console.error(`[bind] ${name} 失败:`, e && e.message); }
}

document.addEventListener('DOMContentLoaded', async () => {
  // 必须等 init() 拿到 settings 再绑定：多处 bind 会立刻构建 UI 并读 state.settings
  try { await init(); } catch (e) { console.error('[bind] init 失败:', e && e.message); }
  safeBind('bindRotation', bindRotation);
  safeBind('bindSettings', bindSettings);
  safeBind('bindWidgetsSettings', bindWidgetsSettings);
  safeBind('bindBoardEditor', bindBoardEditor);
  safeBind('bindLauncherSettings', bindLauncherSettings);
  safeBind('bindFileboxSettings', bindFileboxSettings);
  safeBind('bindAudioVizSettings', bindAudioVizSettings);
});
