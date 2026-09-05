// mpv.js — mpv 单槽播放控制器（纯进程/IPC 管理）
// 通过 --wid 将 mpv 嵌入指定窗口播放视频壁纸，并通过命名管道 IPC 控制。
// 多槽编排（前台/待命、平滑循环、无黑屏热修复）见 video-engine.js。
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const { guardChild } = require('./job-guard');

// ---------- 全局性能配置（设置页「省电/均衡/性能」档位 + 高级细分项） ----------
// 用模块单例注入而不是塞进 params：params 会被 store.setCurrent 持久化到
// config.json，全局档位不该污染每张壁纸自己的参数记录。
let GLOBAL_PERF = {};
function setGlobalPerf(p) { GLOBAL_PERF = p && typeof p === 'object' ? p : {}; }

const HWDEC_MODES = ['auto', 'auto-safe', 'auto-copy', 'no'];
// 分辨率 rank 越大越省：全局天花板与每壁纸值取更严格的那个（只往下压、不顶掉手选值）
const RES_RANK = { source: 0, '1080p': 1, '720p': 2, '480p': 3 };
const RES_VF = { '1080p': 'scale=-2:1080', '720p': 'scale=-2:720', '480p': 'scale=-2:480' };

class MpvController {
  static _seq = 0; // 全局实例序号：保证 IPC 管道名唯一，避免同名多实例跨连

  /**
   * @param {string} name 槽位名（日志标识，如 'front' / 'standby'）
   */
  constructor(name = 'mpv') {
    this.name = name;
    this.process = null;
    this.ipcClient = null;
    this.pipeName = null;
    this.wid = null;
    this.currentParams = null;
    this.ipcReady = false;
    this._pendingCommands = [];
    this.onExit = null;   // (code) => void
    this.onReady = null;  // () => void（IPC 就绪，渲染窗口已创建）
    this._reqId = 1;
    this._pendingQueries = new Map();
    this._ipcBuf = '';
    this.lastTimePos = -1; // 引擎健康检查/循环调度使用的最新播放位置
    this.childHwnd = 0;   // 本槽 mpv 渲染子窗口句柄（引擎绑定后不再变化）
  }

  /** 查找可用的 mpv：优先项目内置 assets/mpv/mpv.exe（兼容打包后 asar.unpacked 路径），其次系统 PATH */
  static findMpv() {
    const bundled = path.join(__dirname, '..', 'assets', 'mpv', 'mpv.exe');
    // 打包后资源被解包到 app.asar.unpacked，spawn 无法执行 asar 内的文件
    const unpacked = bundled.replace('app.asar', 'app.asar.unpacked');
    if (fs.existsSync(unpacked)) return unpacked;
    if (fs.existsSync(bundled)) return bundled;
    return 'mpv'; // 交给 PATH 解析
  }

  get isRunning() {
    return this.process !== null && this.process.exitCode === null;
  }

  /**
   * 启动 mpv 播放视频壁纸
   * @param {string} file 视频文件路径
   * @param {number} wid 宿主窗口句柄（Electron 壁纸窗口 HWND，十进制）
   * @param {object} params 播放参数 {speed,brightness,contrast,saturation,volume,fit,loop,quality,
   *                        paused,startPos,forceMute}（后三项为槽位级参数）
   */
  start(file, wid, params = {}) {
    this.stop();
    this.wid = wid;
    this.currentParams = params;

    const exe = MpvController.findMpv();
    // 管道名带全局唯一序号：同名多实例会被 Windows 随机路由到任意服务器实例，
    // 导致引擎指令/查询打到别的 mpv 进程上（表现为"意外暂停"反复出现）
    this.pipeName = `\\\\.\\pipe\\wallpaper-mpv-${this.name}-${process.pid}-${++MpvController._seq}`;

    // 缩放算法（渲染质量）：低=快速双线性 中=双三次 高=Lanczos
    const scalerMap = { low: 'bilinear', medium: 'bicubic', high: 'lanczos' };
    const scaler = scalerMap[params.quality] || 'lanczos';

    // 渲染分辨率：每壁纸 params.resolution 与全局天花板 videoResCap 取更严格的那个。
    // 天花板只往下压，不会顶掉用户在「壁纸调节」面板里的手选值。
    const rank = Math.max(RES_RANK[params.resolution] ?? 0, RES_RANK[GLOBAL_PERF.videoResCap] ?? 0);
    const res = Object.keys(RES_RANK).find((k) => RES_RANK[k] === rank) || 'source';
    // ★ mpv 的 --vf 是 list 选项：重复出现时后者覆盖前者（--vf-append 才是追加）。
    //   分辨率缩放与帧率上限必须合并成一条逗号链，绝不能 push 两次 --vf。
    const vfChain = [];
    if (RES_VF[res]) vfChain.push(RES_VF[res]);
    const fpsCap = Math.round(Number(GLOBAL_PERF.videoFpsCap) || 0);
    if (fpsCap >= 10 && fpsCap <= 144) vfChain.push(`fps=${fpsCap}`);

    const args = [
      `--wid=${wid}`,
      '--no-border',                // 无边框
      '--no-osc',                   // 无屏幕控制条
      '--no-input-default-bindings',// 禁用默认按键绑定
      '--no-input-vo-keyboard',     // 不接收键盘
      '--no-input-cursor',          // 不接收鼠标
      '--focus-on=never',           // 不抢焦点
      '--cursor-autohide=no',
      '--keep-open=yes',            // 播完不退出（配合循环）
      `--hwdec=${HWDEC_MODES.includes(GLOBAL_PERF.hwdec) ? GLOBAL_PERF.hwdec : 'auto-safe'}`, // 硬解模式（档位可调）
      '--framedrop=vo',           // 只在显示节奏内丢帧；解码丢帧是可见卡顿的来源
      `--scale=${scaler}`,
      `--input-ipc-server=${this.pipeName}`,
      `--volume=${params.forceMute ? 0 : (params.volume ?? 0)}`,
      params.forceMute ? '--mute=yes' : `--mute=${params.mute ? 'yes' : 'no'}`,
      `--speed=${params.speed ?? 1}`,
      `--brightness=${params.brightness ?? 0}`,
      `--contrast=${params.contrast ?? 0}`,
      `--saturation=${params.saturation ?? 0}`,
      params.loop === false ? '--loop-file=no' : '--loop-file=inf',
      // 循环无缝：加大解复用缓存，整段视频常驻内存时循环点零停顿（消除交界处卡顿/闪黑）。
      // 大小由全局档位控制 —— 平滑循环开双槽时实际占用是它的两倍，是最大的一块可控内存。
      `--demuxer-max-bytes=${Math.max(16, Math.round(Number(GLOBAL_PERF.videoCacheMb) || 128))}MiB`,
      '--demuxer-readahead-secs=30',
      // 适配模式：cover=裁剪填充(panscan) contain=完整显示 stretch=拉伸(不保持比例)
      params.fit === 'cover' ? '--panscan=1' : '--panscan=0',
      params.fit === 'stretch' ? '--keepaspect=no' : '--keepaspect=yes',
      // 启动即应用暂停状态（与参数一致，避免状态脱节）
      params.paused ? '--pause' : '--no-pause',
    ];
    if (params.startPos > 0) args.push(`--start=${params.startPos}`);
    if (vfChain.length) args.push(`--vf=${vfChain.join(',')}`);
    // 流畅模式：跳过 H.264 环路滤波 + 快速解码路径，进一步降低 CPU 占用
    if (params.quality === 'low') {
      args.push('--vd-lavc-skiploopfilter=all', '--vd-lavc-fast');
    }
    args.push('--', file);
    // 落 engine.log：用户报障时据此核对是否只有一个 --vf token、硬解/缓存档位是否生效
    console.log(`[mpv:${this.name}] argv: ${args.join(' ')}`);

    this.process = spawn(exe, args, { windowsHide: true });
    // 纳入孤儿守卫：主进程被强杀（如卸载器结束进程）时，系统自动终止 mpv，
    // 防止其残留锁定安装目录文件导致卸载删不掉
    try { guardChild(this.process); } catch (_) {}
    const proc = this.process;
    this.process.on('error', (err) => {
      if (this.process !== proc) return; // 旧进程的滞后事件，忽略
      console.error(`[mpv:${this.name}] 启动失败:`, err.message);
      this.process = null;
    });
    this.process.on('exit', (code) => {
      // 关键竞态防护：stop() 杀旧进程后可能立刻 spawn 新进程，
      // 旧进程的 exit 事件异步到达时 this.process 已指向新进程，
      // 若不判断会把新进程引用误置 null（IPC 断连/重复拉起/黑屏的根源）。
      if (this.process !== proc) return;
      console.log(`[mpv:${this.name}] 进程退出 code=${code}`);
      this._cleanupIpc();
      this.process = null;
      if (this.onExit) this.onExit(code);
    });

    // 延迟连接 IPC 管道（mpv 启动需要时间）
    setTimeout(() => this._connectIpc(), 800);
  }

  /** 连接 mpv IPC 命名管道 */
  _connectIpc() {
    if (!this.isRunning) return;
    this.ipcClient = net.connect({ path: this.pipeName }, () => {
      this.ipcReady = true;
      console.log(`[mpv:${this.name}] IPC 已连接`);
      // 发送排队中的命令
      for (const cmd of this._pendingCommands) this._send(cmd);
      this._pendingCommands = [];
      if (this.onReady) {
        try { this.onReady(); } catch (e) { console.warn(`[mpv:${this.name}] onReady 回调异常:`, e.message); }
      }
    });
    this.ipcClient.on('data', (chunk) => this._handleIpcData(chunk));
    this.ipcClient.on('error', (err) => {
      console.warn(`[mpv:${this.name}] IPC 连接失败:`, err.message);
    });
    this.ipcClient.on('close', () => { this.ipcReady = false; });
  }

  /** 解析 IPC 响应行，按 request_id 分发给等待中的查询 */
  _handleIpcData(chunk) {
    this._ipcBuf += chunk.toString();
    let idx;
    while ((idx = this._ipcBuf.indexOf('\n')) >= 0) {
      const line = this._ipcBuf.slice(0, idx).trim();
      this._ipcBuf = this._ipcBuf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      if (msg.request_id && this._pendingQueries.has(msg.request_id)) {
        const q = this._pendingQueries.get(msg.request_id);
        clearTimeout(q.timer);
        this._pendingQueries.delete(msg.request_id);
        q.resolve(msg.error === 'success' ? msg.data : undefined);
      }
    }
  }

  /**
   * 带超时的属性查询（Promise）。
   * 超时或出错 resolve undefined —— 这是检测 mpv 主循环卡死的关键信号。
   */
  query(prop, timeoutMs = 2000) {
    if (!this.ipcReady || !this.ipcClient) return Promise.resolve(undefined);
    return new Promise((resolve) => {
      const id = this._reqId++;
      const timer = setTimeout(() => {
        this._pendingQueries.delete(id);
        resolve(undefined);
      }, timeoutMs);
      this._pendingQueries.set(id, { resolve, timer });
      try {
        this.ipcClient.write(JSON.stringify({ command: ['get_property', prop], request_id: id }) + '\n');
      } catch (_) {
        clearTimeout(timer);
        this._pendingQueries.delete(id);
        resolve(undefined);
      }
    });
  }

  /** 发送 IPC 命令（JSON 协议） */
  _send(command) {
    if (!this.ipcClient || !this.ipcReady) {
      this._pendingCommands.push(command);
      return;
    }
    try {
      this.ipcClient.write(JSON.stringify({ command }) + '\n');
    } catch (e) {
      console.warn(`[mpv:${this.name}] IPC 发送失败:`, e.message);
    }
  }

  /** 运行时设置属性（无需重启） */
  setProperty(name, value) {
    this._send(['set_property', name, value]);
  }

  /** 批量应用参数 */
  applyParams(params) {
    this.currentParams = { ...(this.currentParams || {}), ...params };
    const p = this.currentParams;
    if (!this.isRunning) return;
    if (params.speed !== undefined) this.setProperty('speed', Number(params.speed));
    if (params.brightness !== undefined) this.setProperty('brightness', Number(params.brightness));
    if (params.contrast !== undefined) this.setProperty('contrast', Number(params.contrast));
    if (params.saturation !== undefined) this.setProperty('saturation', Number(params.saturation));
    if (params.volume !== undefined && !p.forceMute) this.setProperty('volume', Number(params.volume));
    if (params.mute !== undefined && !p.forceMute) this.setProperty('mute', !!params.mute);
    if (params.paused !== undefined) this.setProperty('pause', !!params.paused);
    if (params.fit !== undefined) {
      if (params.fit === 'stretch') {
        this.setProperty('keepaspect', false);
        this.setProperty('panscan', 0);
      } else {
        this.setProperty('keepaspect', true);
        this.setProperty('panscan', params.fit === 'cover' ? 1 : 0);
      }
    }
    if (params.loop !== undefined) {
      this.setProperty('loop-file', params.loop ? 'inf' : 'no');
    }
  }

  /** 暂停/恢复 */
  setPaused(paused) {
    this.setProperty('pause', !!paused);
  }

  _cleanupIpc() {
    if (this.ipcClient) {
      try { this.ipcClient.destroy(); } catch (_) {}
      this.ipcClient = null;
    }
    this.ipcReady = false;
    this._pendingCommands = [];
    // 丢弃等待中的查询（避免悬挂的 Promise）
    for (const q of this._pendingQueries.values()) {
      clearTimeout(q.timer);
      q.resolve(undefined);
    }
    this._pendingQueries.clear();
  }

  /** 停止播放并清理 */
  stop() {
    this._cleanupIpc();
    const proc = this.process;
    this.process = null; // 先摘除引用：exit 事件到达时会被上面的竞态防护忽略
    if (proc) {
      try { proc.kill(); } catch (_) {}
    }
  }
}

module.exports = { MpvController, findMpv: MpvController.findMpv, setGlobalPerf };
