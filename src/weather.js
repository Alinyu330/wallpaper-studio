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

const GEOCODE_URL = (n) => 'https://geocoding-api.open-meteo.com/v1/search'
  + `?name=${encodeURIComponent(n)}&count=8&language=zh&format=json`;

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? http : https;
    const req = mod.get(url, { timeout: TIMEOUT_MS }, (res) => {
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

/**
 * IP 地理定位（免密钥）：返回 {cityName, lat, lon, tz}。
 * 首选 ip-api.com（免费档仅 HTTP，但支持 lang=zh-CN 中文地名）；
 * 失败回退 ipwho.is（HTTPS，英文地名）。两者都挂 → null（调用方用兜底城市）。
 */
async function ipLocate() {
  try {
    const r = await httpGetJson('http://ip-api.com/json/?lang=zh-CN&fields=status,country,regionName,city,lat,lon,timezone');
    if (r && r.status === 'success' && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      return {
        cityName: [r.city || r.regionName, r.regionName && r.city !== r.regionName ? r.regionName : '']
          .filter(Boolean).join(' · ') || r.country || '未知',
        lat: r.lat, lon: r.lon, tz: r.timezone || 'auto',
      };
    }
  } catch (e) {
    console.warn('[weather] ip-api 定位失败:', e.message);
  }
  try {
    const r = await httpGetJson('https://ipwho.is/');
    if (r && r.success !== false && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)) {
      return {
        cityName: r.city || r.region || r.country || '未知',
        lat: r.latitude, lon: r.longitude,
        tz: (r.timezone && r.timezone.id) || 'auto',
      };
    }
  } catch (e) {
    console.warn('[weather] ipwho.is 定位失败:', e.message);
  }
  return null;
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
      return { cityName: w.cityName, lat: w.lat, lon: w.lon, tz: w.tz || 'auto' };
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

  async refresh() {
    const w = await this.cfg();
    try {
      const raw = await httpGetJson(FORECAST_URL(w));
      this.data = this._normalize(raw, w);
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

  /** 城市搜索（客户端设置页用） */
  async geocode(name) {
    try {
      const raw = await httpGetJson(GEOCODE_URL(String(name || '').trim()));
      return (raw.results || []).map((r) => ({
        name: [r.name, r.admin1, r.country].filter(Boolean).join(' · '),
        lat: r.latitude, lon: r.longitude, tz: r.timezone || 'auto',
      }));
    } catch (e) {
      console.warn('[weather] 城市搜索失败:', e.message);
      return [];
    }
  }
}

module.exports = { WeatherService };
