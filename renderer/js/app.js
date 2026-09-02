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
  });
  window.api.on('wallpaper:current-changed', (d) => {
    state.current = d || null;
    renderGrid();
    renderParamsPanel();
    updateStopButton();
  });
  window.api.on('wallpaper:params-updated', (params) => {
    if (state.current) state.current.params = params;
    if (state.selected && state.current && state.selected.wallpaper.id === state.current.wallpaper.id) {
      state.selected.params = { ...state.selected.params, ...params };
    }
  });
  window.api.on('wallpaper:exe-exited', ({ name }) => toast(`程序壁纸「${name}」已退出`, 'error'));
  window.api.on('wallpaper:paused-changed', (paused) => {
    state.pausedAll = !!paused;
    state.settings.wallpaperPaused = !!paused;
    updatePauseAllButton();
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
  renderGrid();
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

function createCard(wp) {
  const isCurrent = !!(state.current && state.current.wallpaper.id === wp.id);
  const isSelected = !!(state.selected && state.selected.wallpaper.id === wp.id);
  const card = document.createElement('div');
  card.className = 'wallpaper-card' + (isCurrent ? ' current' : '') + (isSelected ? ' selected' : '');

  // 缩略图
  const thumb = document.createElement('div');
  thumb.className = `thumb ${wp.type}`;
  if (wp.type === 'image') {
    const img = document.createElement('img');
    img.src = 'file:///' + wp.path.replace(/\\/g, '/');
    img.onerror = () => img.remove();
    thumb.appendChild(img);
  } else if (wp.type === 'video') {
    // 尝试用 video 元素取第一帧作缩略图（Chromium 支持的格式），失败显示图标
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.src = 'file:///' + wp.path.replace(/\\/g, '/') + '#t=0.5';
    v.onerror = () => v.remove();
    thumb.appendChild(v);
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
  renderGrid();
  renderParamsPanel();
  renderPreview();
  syncPreviewFull();
}

/** 应用当前选中的壁纸为桌面壁纸 */
async function applySelected() {
  const sel = state.selected;
  if (!sel) return;
  const res = await window.api.apply(sel.wallpaper.id);
  if (!res.ok) { toast(res.error, 'error'); return; }
  // 把预览期间调好的参数同步应用
  await window.api.updateParams(sel.params);
  state.current = { wallpaper: sel.wallpaper, params: { ...sel.params } };
  renderGrid();
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
function renderPreview() {
  const stage = $('#preview-stage');
  const ph = $('#preview-placeholder');
  stage.querySelectorAll('img,video,iframe').forEach(el => el.remove());
  const sel = state.selected;
  if (!sel) {
    ph.classList.remove('hidden');
    ph.textContent = '预览区';
    return;
  }
  const wp = sel.wallpaper;
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
let rafId = null;
function pushParams(patch) {
  if (state.selected) Object.assign(state.selected.params, patch);
  applyPreviewParams();

  // 预览弹出窗口跟随参数变化（patch 模式）
  window.api.syncPreview({ patch });

  const live = state.current && state.selected &&
    state.selected.wallpaper.id === state.current.wallpaper.id;
  if (!live) return;

  pendingParams = { ...(pendingParams || {}), ...patch };
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = null;
    const data = pendingParams;
    pendingParams = null;
    window.api.updateParams(data);
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
  grid.innerHTML = '';
  for (const wp of state.wallpapers) {
    const picked = list.includes(wp.id);
    const item = document.createElement('button');
    item.className = 'rot-pick' + (picked ? ' picked' : '');
    item.title = wp.name;
    // 缩略图
    if (wp.type === 'image') {
      const img = document.createElement('img');
      img.src = 'file:///' + wp.path.replace(/\\/g, '/');
      img.onerror = () => img.remove();
      item.appendChild(img);
    } else {
      const ic = document.createElement('div');
      ic.className = 'pick-icon';
      ic.innerHTML = ICONS[wp.type] || ICONS.web;
      item.appendChild(ic);
    }
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
}

// ---------- 桌面组件 ----------
const WIDGET_META = {
  clock:  { name: '时钟', desc: '时间 + 日期，点击切换 12/24 小时制', interactive: true },
  cpu:    { name: 'CPU 占用率', desc: '实时处理器占用 + 占用条', interactive: false },
  gpu:    { name: 'GPU 占用率', desc: '实时显卡占用 + 占用条', interactive: false },
  mem:    { name: '内存占用率', desc: '实时内存占用 + 占用条', interactive: false },
  volume: { name: '音量', desc: '壁纸播放音量，桌面直接拖动调节，点击图标静音', interactive: true },
};
const POS_LABELS = {
  tl: '左上', tc: '上中', tr: '右上',
  ml: '左中', mc: '居中', mr: '右中',
  bl: '左下', bc: '下中', br: '右下',
};

function saveWidgets(patch) {
  const w = { ...(state.settings.widgets || {}), ...patch };
  state.settings.widgets = w;
  window.api.updateSettings({ widgets: w });
}

function renderWidgetsSettings() {
  const w = state.settings.widgets || {};
  $('#wg-enabled').checked = !!w.enabled;
  $$('#wg-theme button').forEach(b => b.classList.toggle('active', b.dataset.theme === (w.theme || 'auto')));
  const op = Math.round((w.opacity ?? 0.72) * 100);
  $('#wg-opacity').value = op;
  $('#wg-opacity-num').value = op;
  // 组件卡片
  const wrap = $('#wg-items');
  wrap.innerHTML = '';
  for (const [key, meta] of Object.entries(WIDGET_META)) {
    const item = w.items?.[key] || { on: false, pos: 'tl', size: 'm' };
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
      pb.className = 'pos-cell' + (item.pos === pos ? ' active' : '');
      pb.title = POS_LABELS[pos];
      pb.dataset.pos = pos;
      pb.addEventListener('click', () => {
        saveWidgets({ items: { [key]: { ...item, pos } } });
        renderWidgetsSettings();
      });
      grid.appendChild(pb);
    }
    posWrap.appendChild(grid);
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
        saveWidgets({ items: { [key]: { ...item, size: s[0] } } });
        renderWidgetsSettings();
      });
      seg.appendChild(sb);
    }
    sizeWrap.appendChild(seg);
    body.appendChild(sizeWrap);
    card.appendChild(body);
    wrap.appendChild(card);
  }

  // 开关事件
  wrap.querySelectorAll('[data-wg-toggle]').forEach(t => {
    t.addEventListener('change', () => {
      const key = t.dataset.wgToggle;
      const item = state.settings.widgets?.items?.[key] || { on: false, pos: 'tl', size: 'm' };
      saveWidgets({ items: { [key]: { ...item, on: t.checked } } });
    });
  });
}

function bindWidgetsSettings() {
  $('#wg-enabled').addEventListener('change', (e) => {
    saveWidgets({ enabled: e.target.checked });
    toast(e.target.checked ? '桌面组件已开启，回到桌面查看效果' : '桌面组件已关闭');
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
  };
  $('#wg-opacity').addEventListener('input', (e) => {
    $('#wg-opacity-num').value = e.target.value;
  });
  $('#wg-opacity').addEventListener('change', (e) => applyOpacity(parseFloat(e.target.value)));
  $('#wg-opacity-num').addEventListener('change', (e) => applyOpacity(parseFloat(e.target.value)));
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
function renderSettingsPage() {
  $('#set-autostart').checked = !!state.settings.autoStart;
  $('#set-fs-pause').checked = state.settings.performance?.fullscreenPause !== false;
  $('#set-battery-pause').checked = state.settings.performance?.batteryPause !== false;
  $('#set-max-pause').checked = state.settings.performance?.maximizedPause === true;
  $('#set-hotkey').checked = state.settings.hotkeyPause !== false;
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
  $('#btn-mpv-download').addEventListener('click', () => window.api.openMpvDownload());
  $('#btn-lockscreen-use-current').addEventListener('click', () => setLockScreenFrom(state.current?.wallpaper));
  $('#btn-lockscreen-reset').addEventListener('click', async () => {
    await window.api.resetLockScreen();
    toast('已恢复默认锁屏');
    refreshLockScreenDetail();
  });
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
document.addEventListener('DOMContentLoaded', () => {
  init();
  bindRotation();
  bindSettings();
});
