// weather.js — 信息看板天气服务（主进程，Open-Meteo，免密钥）
//
// 为什么在主进程而不是组件窗口：组件窗口是极小的透明表面，不该承担网络 IO；
// 且多个消费方（看板窗 + 客户端设置页城市搜索）共用一份缓存。
//
// 行为约定：
// - 30 分钟刷新一次；失败保留上一次数据并置 stale:true（看板显示「缓存」标记），
//   5 分钟退避重试，最多 6 次；任何异常都不抛出（主进程定时器里的 rejected
//   promise 只会变成噪音日志）。
// - start() 先推磁盘缓存，保证开机/断网时看板不空白。
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const MAX_RETRY = 6;
const TIMEOUT_MS = 8000;
const IPLOC_TTL_MS = 12 * 60 * 60 * 1000; // IP 定位结果保鲜期（跨城移动半天内自愈）

// —— IP 定位端点（均免密钥）——
// ① 坐标 + 基础省市：优先 bilibili 国内接口（对国内 IP 的坐标最贴实际），
//    ip-api 兜底（HTTP 直连最稳，但国内 IP 的坐标常指向运营商注册地所在的省会，会串到隔壁市）；
// ② 区县：拿坐标做逆地理，补齐「省 · 市 · 区县」三级规范名。
const BILI_ZONE_URL = 'https://api.bilibili.com/x/web-interface/zone';
const IP_SB_URL = 'https://api.ip.sb/geoip';
const IP_API_URL = 'http://ip-api.com/json/?lang=zh-CN&fields=status,country,regionName,city,lat,lon,timezone';
const IPWHO_URL = 'https://ipwho.is/';
// 部分接口（bilibili 等）对无 UA 的请求会返回 412 风控，统一带上浏览器 UA
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REVERSE_URL = (lat, lon) => 'https://api.bigdatacloud.net/data/reverse-geocode-client'
  + `?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}&localityLanguage=zh-Hans`;

// WMO weather interpretation codes → 中文 + emoji
const WMO = {
  0: ['晴', '☀️'], 1: ['大致晴朗', '🌤️'], 2: ['局部多云', '⛅'], 3: ['阴', '☁️'],
  45: ['雾', '🌫️'], 48: ['雾凇', '🌫️'],
  51: ['小毛毛雨', '🌦️'], 53: ['毛毛雨', '🌦️'], 55: ['大毛毛雨', '🌧️'],
  56: ['冻毛毛雨', '🌧️'], 57: ['冻毛毛雨', '🌧️'],
  61: ['小雨', '🌧️'], 63: ['中雨', '🌧️'], 65: ['大雨', '🌧️'],
  66: ['冻雨', '🌧️'], 67: ['冻雨', '🌧️'],
  71: ['小雪', '🌨️'], 73: ['中雪', '🌨️'], 75: ['大雪', '❄️'], 77: ['雪粒', '❄️'],
  80: ['小阵雨', '🌦️'], 81: ['阵雨', '🌧️'], 82: ['强阵雨', '⛈️'],
  85: ['阵雪', '🌨️'], 86: ['强阵雪', '❄️'],
  95: ['雷阵雨', '⛈️'], 96: ['雷阵雨伴冰雹', '⛈️'], 99: ['强雷暴冰雹', '⛈️'],
};
const wmoOf = (code) => WMO[code] || ['未知', '🌡️'];

const FORECAST_URL = (w) => 'https://api.open-meteo.com/v1/forecast'
  + `?latitude=${encodeURIComponent(w.lat)}&longitude=${encodeURIComponent(w.lon)}`
  + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m'
  + '&hourly=temperature_2m,weather_code'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min'
  + `&timezone=${encodeURIComponent(w.tz || 'auto')}&forecast_days=7`;

// 常去城市只需当前实况，走轻量端点（不拉逐时/逐日，省流量也更快）
const BRIEF_URL = (w) => 'https://api.open-meteo.com/v1/forecast'
  + `?latitude=${encodeURIComponent(w.lat)}&longitude=${encodeURIComponent(w.lon)}`
  + '&current=temperature_2m,apparent_temperature,weather_code'
  + `&timezone=${encodeURIComponent(w.tz || 'auto')}`;

const GEOCODE_URL = (n) => 'https://geocoding-api.open-meteo.com/v1/search'
  + `?name=${encodeURIComponent(n)}&count=8&language=zh&format=json`;

function httpGetJson(url, extraHeaders, depth = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? http : https;
    const headers = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...(extraHeaders || {}) };
    const req = mod.get(url, { timeout: TIMEOUT_MS, headers }, (res) => {
      // 部分服务（如逆地理）会先回 3xx：不跟随只会拿到空响应体，表现为「接口挂了」。
      // 跟随最多 4 跳即可（正常只有一跳）。
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 4) {
        res.resume();
        let next;
        try { next = new URL(res.headers.location, url).toString(); } catch (_) { reject(new Error('bad redirect')); return; }
        resolve(httpGetJson(next, extraHeaders, depth + 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

// ---------- 地名工具：省 · 市 · 区县 ----------

// 中国省级行政区（不含后缀），用于把「山西」补成「山西省」；不在表内的一律原样返回，
// 以免把国外城市的省/州名误加中文后缀
const CN_PROVINCES = new Set([
  '北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江',
  '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南',
  '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '台湾',
  '香港', '澳门',
]);
const CN_AUTONOMOUS = ['内蒙古', '广西', '西藏', '宁夏', '新疆'];
const CN_MUNICIPAL = ['北京', '上海', '天津', '重庆'];
const CN_SAR = ['香港', '澳门'];
const HAS_PROV_SUFFIX = /(省|市|自治区|特别行政区)$/;

/** 省级名补全后缀（多数源的省级字段只给「山西」「广东」） */
function provName(raw) {
  const v = String(raw || '').trim();
  if (!v || HAS_PROV_SUFFIX.test(v) || !CN_PROVINCES.has(v)) return v;
  if (CN_AUTONOMOUS.includes(v)) return `${v}自治区`;
  if (CN_MUNICIPAL.includes(v)) return `${v}市`;
  if (CN_SAR.includes(v)) return `${v}特别行政区`;
  return `${v}省`;
}

const bareRegion = (s) => String(s || '').trim()
  .replace(/(省|市|县|区|自治区|特别行政区|自治县|自治州|地区|盟)$/, '');

/** 三级地名拼接：省 · 市 · 区县；空级与同名级（北京市 / 北京）自动省略 */
function joinRegion(parts) {
  const out = [];
  for (const raw of parts) {
    const v = String(raw ?? '').trim();
    if (!v || v === '0' || v === '-' || v === '未知') continue;
    const b = bareRegion(v);
    if (!b || out.some((x) => bareRegion(x) === b)) continue;
    out.push(v);
  }
  return out.join(' · ');
}

/**
 * 坐标 → 省 · 市 · 区县（免密钥逆地理）。
 * 只取 principalSubdivision / city / locality 三字段：localityInfo.administrative 里
 * 会混入「首都功能核心区」这类非行政区划，直接按层级取会取错（北京实测）。
 */
async function reverseRegion(lat, lon) {
  try {
    const r = await httpGetJson(REVERSE_URL(lat, lon));
    if (!r) return null;
    return {
      prov: r.principalSubdivision || '',
      city: r.city || '',
      district: r.locality || '',
    };
  } catch (e) {
    console.warn('[weather] 逆地理定位失败:', e.message);
    return null;
  }
}

/** 坐标 + 基础省市（多源兜底，按「对国内 IP 的准确度」排序） */
async function ipBaseLocate() {
  // ① bilibili 国内接口：对国内 IP 的坐标最贴实际。无 UA 会被 412 风控，
  //    必须带 Referer；偶发失败时重试一次再降级。
  for (let i = 0; i < 2; i++) {
    try {
      const r = await httpGetJson(BILI_ZONE_URL, { Referer: 'https://www.bilibili.com/' });
      const d = r && r.code === 0 && r.data;
      if (d && Number.isFinite(d.latitude) && Number.isFinite(d.longitude) && (d.latitude || d.longitude)) {
        return { prov: d.province || '', city: d.city || '', lat: d.latitude, lon: d.longitude, tz: 'auto' };
      }
    } catch (e) {
      if (i === 1) console.warn('[weather] bilibili 定位失败:', e.message);
    }
  }
  // ② ip.sb：与 bilibili 一致的国内城市判定，作为同档兜底
  try {
    const r = await httpGetJson(IP_SB_URL);
    if (r && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      return {
        prov: r.region || '', city: r.city || '',
        lat: r.latitude, lon: r.longitude, tz: r.timezone || 'auto',
      };
    }
  } catch (e) {
    console.warn('[weather] ip.sb 定位失败:', e.message);
  }
  // ③ ip-api.com：HTTP 直连最稳，但国内 IP 的坐标常指向运营商注册地（可能串到隔壁市）
  try {
    const r = await httpGetJson(IP_API_URL);
    if (r && r.status === 'success' && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      return { prov: r.regionName || '', city: r.city || '', lat: r.lat, lon: r.lon, tz: r.timezone || 'auto' };
    }
  } catch (e) {
    console.warn('[weather] ip-api 定位失败:', e.message);
  }
  // ④ ipwho.is（HTTPS，英文地名）
  try {
    const r = await httpGetJson(IPWHO_URL);
    if (r && r.success !== false && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      return {
        prov: r.region || '', city: r.city || '',
        lat: r.latitude, lon: r.longitude,
        tz: (r.timezone && r.timezone.id) || 'auto',
      };
    }
  } catch (e) {
    console.warn('[weather] ipwho.is 定位失败:', e.message);
  }
  return null;
}

/**
 * IP 地理定位（免密钥）：返回 {cityName, lat, lon, tz}，cityName 为「省 · 市 · 区县」。
 * 先取坐标与基础省市，再用坐标逆地理补区县；逆地理失败退化为「省 · 市」两级；
 * 全部失败 → null（调用方用兜底城市）。
 */
async function ipLocate() {
  const base = await ipBaseLocate();
  if (!base) return null;
  const rg = await reverseRegion(base.lat, base.lon);
  const cityName =
    (rg && joinRegion([provName(rg.prov), rg.city, rg.district]))
    || joinRegion([provName(base.prov), base.city])
    || base.city
    || '未知';
  return { cityName, lat: base.lat, lon: base.lon, tz: base.tz };
}

/** 旧配置里的手动城市名规范化：去掉国家段、省级补全后缀并提到最前（「广州 · 广东 · 中国」→「广东省 · 广州」） */
function cleanCityLabel(name) {
  const parts = String(name || '').split(/\s*·\s*/).map((s) => s.trim()).filter(Boolean);
  const keep = parts.filter((p) => !/^(中国|China|中华人民共和国)$/i.test(p));
  const i = keep.findIndex((p) => CN_PROVINCES.has(bareRegion(p)));
  if (i >= 0) {
    const [prov] = keep.splice(i, 1);
    keep.unshift(provName(prov));
  }
  return keep.join(' · ');
}

const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

class WeatherService {
  /**
   * @param {object} store Store 实例（读 settings.board.weather）
   * @param {(data: object|null) => void} onData 归一化后的天气数据
   * @param {string} cacheFile 磁盘缓存路径（userData/weather.json）
   */
  constructor(store, onData, cacheFile) {
    this.store = store;
    this.onData = onData;
    this.file = cacheFile;
    this.data = null;
    this.timer = null;
    this.retryTimer = null;
    this.retry = 0;
    this.ipLoc = null;    // {cityName,lat,lon,tz,at} IP 定位缓存（仅自动模式使用）
    this._ipLocating = null; // 进行中的定位 promise（去重并发）
  }

  /**
   * 城市配置解析：
   * - 手动模式（用户在桌面看板/设置页显式选过城市 → manual:true）：用存储坐标；
   * - 自动模式（默认）：按 IP 所在地定位，结果缓存 12h；定位失败兜底北京。
   *   自动模式不写回 store —— 换城市/换网络后下次启动重新定位，无需用户干预。
   */
  async cfg() {
    const w = (this.store.settings.board || {}).weather || {};
    if (w.manual && w.cityName && Number.isFinite(w.lat) && Number.isFinite(w.lon)) {
      // 旧配置里存的可能是「广州 · 广东 · 中国」这种旧格式，显示前规范化一次
      return { cityName: cleanCityLabel(w.cityName) || w.cityName, lat: w.lat, lon: w.lon, tz: w.tz || 'auto' };
    }
    const loc = await this._autoLoc();
    if (loc) return loc;
    return { cityName: '北京', lat: 39.9042, lon: 116.4074, tz: 'Asia/Shanghai' };
  }

  _autoLoc() {
    if (this.ipLoc && Date.now() - this.ipLoc.at < IPLOC_TTL_MS) return Promise.resolve(this.ipLoc);
    if (this._ipLocating) return this._ipLocating;
    this._ipLocating = ipLocate().then((r) => {
      this._ipLocating = null;
      if (r) {
        this.ipLoc = { ...r, at: Date.now() };
        console.log(`[weather] IP 自动定位: ${r.cityName} (${r.lat}, ${r.lon})`);
        return this.ipLoc;
      }
      return this.ipLoc; // 定位失败但有旧缓存 → 接着用
    }).catch(() => { this._ipLocating = null; return this.ipLoc; });
    return this._ipLocating;
  }

  start() {
    if (this.timer) return;
    this._loadCache();
    if (this.data) this._push();          // 开机/断网也不空白
    this.timer = setInterval(() => this.refresh(), REFRESH_MS);
    this.refresh();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }

  /** 城市变更后立即重拉 */
  reload() {
    this.retry = 0;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    this.refresh();
  }

  _push() {
    try { if (this.onData) this.onData(this.data); } catch (_) {}
  }

  _loadCache() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (raw && raw.current) { this.data = { ...raw, stale: true }; }
    } catch (_) {}
  }

  _saveCache() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.data), 'utf8'); } catch (_) {}
  }

  /**
   * 常去城市配置（可选）：用户显式选过才返回，未配置返回 null。
   * 与主城市相互独立 —— 主城市可自动定位，常去城市始终是用户手选的固定城市。
   */
  favoriteCfg() {
    const f = ((this.store.settings.board || {}).weather || {}).favorite || {};
    if (f.cityName && Number.isFinite(f.lat) && Number.isFinite(f.lon)) {
      return { cityName: cleanCityLabel(f.cityName) || f.cityName, lat: f.lat, lon: f.lon, tz: f.tz || 'auto' };
    }
    return null;
  }

  async refresh() {
    const w = await this.cfg();
    const fav = this.favoriteCfg();
    try {
      // 主城市（完整逐时/逐日）与常去城市（仅实况）并发拉取；常去城市失败不影响主城市
      const [raw, favRaw] = await Promise.all([
        httpGetJson(FORECAST_URL(w)),
        fav
          ? httpGetJson(BRIEF_URL(fav)).catch((e) => {
            console.warn('[weather] 常去城市拉取失败:', e.message);
            return null;
          })
          : Promise.resolve(null),
      ]);
      const prevFav = (this.data && this.data.favorite) || null;
      this.data = this._normalize(raw, w);
      if (fav) {
        // 拉取失败时保留上一次的值，看板不出现空档
        this.data.favorite = favRaw ? this._normalizeBrief(favRaw, fav) : prevFav;
      } else {
        this.data.favorite = null;
      }
      this.retry = 0;
      this._saveCache();
      this._push();
    } catch (e) {
      console.warn('[weather] 拉取失败:', e.message);
      if (this.data) { this.data = { ...this.data, stale: true }; this._push(); }
      if (this.retry < MAX_RETRY) {
        this.retry++;
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.refresh(); }, RETRY_MS);
      }
    }
  }

  _normalize(raw, w) {
    const c = raw.current || {};
    const [label, emoji] = wmoOf(c.weather_code);
    const hourly = [];
    const ht = raw.hourly || {};
    const times = ht.time || [];
    const nowIso = new Date().toISOString().slice(0, 13);
    let start = times.findIndex((t) => t >= nowIso);
    if (start < 0) start = 0;
    for (let i = start; i < Math.min(times.length, start + 8); i++) {
      const [ll, ee] = wmoOf((ht.weather_code || [])[i]);
      hourly.push({
        t: String(times[i] || '').slice(11, 16) || '--:--',
        temp: r1((ht.temperature_2m || [])[i]),
        label: ll, emoji: ee,
      });
    }
    const d = raw.daily || {};
    const daily = (d.time || []).slice(0, 7).map((dt, i) => {
      const [ll, ee] = wmoOf((d.weather_code || [])[i]);
      const md = String(dt).slice(5).split('-');
      return {
        date: `${Number(md[0])}/${Number(md[1])}`,
        label: ll, emoji: ee,
        max: r1((d.temperature_2m_max || [])[i]),
        min: r1((d.temperature_2m_min || [])[i]),
      };
    });
    return {
      at: Date.now(),
      stale: false,
      city: w.cityName,
      current: {
        temp: r1(c.temperature_2m), feels: r1(c.apparent_temperature),
        humidity: c.relative_humidity_2m ?? null, wind: r1(c.wind_speed_10m),
        code: c.weather_code, label, emoji,
      },
      hourly, daily,
    };
  }

  /** 常去城市：只保留看板一行所需的实况字段 */
  _normalizeBrief(raw, w) {
    const c = raw.current || {};
    const [label, emoji] = wmoOf(c.weather_code);
    return {
      city: w.cityName,
      temp: r1(c.temperature_2m),
      feels: r1(c.apparent_temperature),
      label, emoji,
    };
  }

  /** 城市搜索（客户端设置页用）：结果名统一为「省 · 市」——城市库不含区县，不再带国家段 */
  async geocode(name) {
    try {
      const raw = await httpGetJson(GEOCODE_URL(String(name || '').trim()));
      return (raw.results || []).map((r) => ({
        name: joinRegion([provName(r.admin1), r.admin2 || r.name]) || r.name,
        lat: r.latitude, lon: r.longitude, tz: r.timezone || 'auto',
      }));
    } catch (e) {
      console.warn('[weather] 城市搜索失败:', e.message);
      return [];
    }
  }
}

module.exports = { WeatherService };
