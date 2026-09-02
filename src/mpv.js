// mpv.js — mpv 播放器控制器
// 通过 --wid 将 mpv 嵌入指定窗口播放视频壁纸，
// 并通过命名管道 IPC 在运行时动态调节速度、亮度、对比度、饱和度、音量等参数。
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

class MpvController {
  constructor() {
    this.process = null;
    this.ipcClient = null;
    this.pipeName = null;
    this.wid = null;
    this.currentParams = null;
    this.ipcReady = false;
    this._pendingCommands = [];
    this.onExit = null;
    this.onReady = null; // IPC 连接就绪回调（此时 mpv 渲染窗口已创建）
    // IPC 请求-响应分发与健康检查
    this._reqId = 1;
    this._pendingQueries = new Map(); // request_id -> {cb, timer}
    this._ipcBuf = '';
    this._healthTimer = null;
    this._expectPause = false;   // 应用侧期望的暂停状态（健康检查在暂停时跳过）
    this._lastTimePos = -1;
    this._stuckCount = 0;
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
   * @param {object} params 播放参数 {speed,brightness,contrast,saturation,volume,fit,loop,quality}
   */
  start(file, wid, params = {}) {
    this.stop();
    this.wid = wid;
    this.currentParams = params;

    const exe = MpvController.findMpv();
    this.pipeName = `\\\\.\\pipe\\wallpaper-mpv-${process.pid}`;

    // 缩放算法（渲染质量）：低=快速双线性 中=双三次 高=Lanczos
    const scalerMap = { low: 'bilinear', medium: 'bicubic', high: 'lanczos' };
    const scaler = scalerMap[params.quality] || 'lanczos';

    // 渲染分辨率限制（等比缩放，大幅降低解码与 GPU 负载）
    const RES_VF = { '1080p': 'scale=-2:1080', '720p': 'scale=-2:720', '480p': 'scale=-2:480' };
    const resVf = RES_VF[params.resolution] || null;

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
      '--hwdec=auto',               // 自动硬件解码（大幅降低 CPU 占用）
      '--framedrop=decoder+vo',     // 丢帧策略，避免解码堆积
      `--scale=${scaler}`,
      `--input-ipc-server=${this.pipeName}`,
      `--volume=${params.volume ?? 0}`,
      `--speed=${params.speed ?? 1}`,
      `--brightness=${params.brightness ?? 0}`,
      `--contrast=${params.contrast ?? 0}`,
      `--saturation=${params.saturation ?? 0}`,
      params.loop === false ? '--loop-file=no' : '--loop-file=inf',
      // 适配模式：cover=裁剪填充(panscan) contain=完整显示 stretch=拉伸(不保持比例)
      params.fit === 'cover' ? '--panscan=1' : '--panscan=0',
      params.fit === 'stretch' ? '--keepaspect=no' : '--keepaspect=yes',
      // 启动即应用暂停状态（与参数一致，避免状态脱节）
      params.paused ? '--pause' : '--no-pause',
    ];
    if (resVf) args.push(`--vf=${resVf}`);
    // 流畅模式：跳过 H.264 环路滤波 + 快速解码路径，进一步降低 CPU 占用
    if (params.quality === 'low') {
      args.push('--vd-lavc-skiploopfilter=all', '--vd-lavc-fast');
    }
    args.push('--', file);

    this.process = spawn(exe, args, { windowsHide: true });
    const proc = this.process;
    this._expectPause = !!params.paused;
    this.process.on('error', (err) => {
      if (this.process !== proc) return; // 旧进程的滞后事件，忽略
      console.error('[mpv] 启动失败:', err.message);
      this._stopHealthCheck();
      this.process = null;
    });
    this.process.on('exit', (code) => {
      // 关键竞态防护：切换壁纸时 stop() 杀旧进程后立刻 spawn 新进程，
      // 旧进程的 exit 事件异步到达时 this.process 已指向新进程。
      // 若不判断会把新进程引用误置 null，导致：
      //   1. IPC 永远连不上（_connectIpc 因 isRunning=false 直接返回），
      //      暂停/参数指令全部滞留队列，视频状态失控；
      //   2. onExit 误报"异常退出"触发重启，重复拉起第二个 mpv
      //      抢占同一 --wid 窗口 → 黑屏/画面冻结（动态壁纸无法播放的根源）。
      if (this.process !== proc) return;
      console.log(`[mpv] 进程退出 code=${code}`);
      this._stopHealthCheck();
      this._cleanupIpc();
      this.process = null;
      if (this.onExit) this.onExit(code);
    });

    // 延迟连接 IPC 管道（mpv 启动需要时间）
    setTimeout(() => this._connectIpc(), 800);
    // 启动播放健康检查（渲染卡死自动重启）
    this._startHealthCheck();
  }

  /** 连接 mpv IPC 命名管道 */
  _connectIpc() {
    if (!this.isRunning) return;
    this.ipcClient = net.connect({ path: this.pipeName }, () => {
      this.ipcReady = true;
      console.log('[mpv] IPC 已连接');
      // 发送排队中的命令
      for (const cmd of this._pendingCommands) this._send(cmd);
      this._pendingCommands = [];
      if (this.onReady) {
        try { this.onReady(); } catch (e) { console.warn('[mpv] onReady 回调异常:', e.message); }
      }
    });
    this.ipcClient.on('data', (chunk) => this._handleIpcData(chunk));
    this.ipcClient.on('error', (err) => {
      console.warn('[mpv] IPC 连接失败:', err.message);
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
        q.cb(msg.error === 'success' ? msg.data : undefined);
      }
    }
  }

  /**
   * 带超时的属性查询（请求-响应）。
   * 超时或出错回调 undefined —— 这是检测 mpv 主循环卡死的关键信号。
   */
  _query(prop, cb, timeoutMs = 2500) {
    if (!this.ipcReady || !this.ipcClient) { cb(undefined); return; }
    const id = this._reqId++;
    const q = {
      cb,
      timer: setTimeout(() => {
        this._pendingQueries.delete(id);
        cb(undefined);
      }, timeoutMs),
    };
    this._pendingQueries.set(id, q);
    try {
      this.ipcClient.write(JSON.stringify({ command: ['get_property', prop], request_id: id }) + '\n');
    } catch (_) {
      clearTimeout(q.timer);
      this._pendingQueries.delete(id);
      cb(undefined);
    }
  }

  // ---------- 播放健康检查 ----------
  // 场景一：显示器功耗切换/睡眠唤醒后 GPU 硬解设备（D3D11）可能失效，
  //   mpv 主循环阻塞在渲染调用上 —— 进程存活、CPU 为 0、IPC 无响应，
  //   视频永久冻结在最后一帧。
  // 场景二：暂停/恢复指令与 mpv 实际状态脱节（如全屏暂停后恢复指令
  //   在 IPC 半失效时丢失），mpv 卡在暂停态 → 冻结帧，且应用侧
  //   认为"该暂停"而跳过检查（v1.3.1 的盲区，长时间挂机/全屏退出后出现）。
  // 策略：每 5s 先查询 mpv **实际** pause 状态（带超时）：
  //   - 实际已暂停但应用侧未要求暂停 → 意外暂停，重发恢复指令，
  //     连续 2 次仍暂停 → 强制重启进程；
  //   - 实际在播 → 查询 time-pos，进度停滞或查询超时连续 3 次（约 15s）
  //     → 强制杀掉进程，由 onExit 自动重启恢复。
  _startHealthCheck() {
    this._stopHealthCheck();
    this._lastTimePos = -1;
    this._stuckCount = 0;
    this._unexpectedPauseCount = 0;
    this._healthTimer = setInterval(() => this._checkHealth(), 5000);
  }

  _stopHealthCheck() {
    if (this._healthTimer) {
      clearInterval(this._healthTimer);
      this._healthTimer = null;
    }
  }

  _checkHealth() {
    if (!this.isRunning || !this.ipcReady) return;
    this._query('pause', (paused) => {
      if (!this.isRunning || !this.ipcReady) return;

      // 查询超时（IPC 无响应）：按停滞处理
      if (typeof paused !== 'number' && typeof paused !== 'boolean') {
        this._bumpStall('IPC 无响应');
        return;
      }

      // 实际已暂停：
      if (paused === true) {
        if (this._expectPause) {
          // 应用侧要求的正常暂停
          this._stuckCount = 0;
          this._unexpectedPauseCount = 0;
          return;
        }
        // 意外暂停（状态脱节）：重发恢复指令，连续 2 次仍暂停则重启
        if (++this._unexpectedPauseCount >= 2) {
          this._unexpectedPauseCount = 0;
          this._forceRestart('意外暂停且恢复无效（暂停状态脱节）');
        } else {
          console.warn('[mpv] 健康检查：mpv 处于意外暂停状态，尝试恢复播放');
          this.setProperty('pause', false);
        }
        return;
      }

      // 实际在播（意外暂停已自愈，清零计数）
      this._unexpectedPauseCount = 0;
      this._query('time-pos', (tp) => {
        if (!this.isRunning || !this.ipcReady) return;
        const stalled = typeof tp !== 'number' ||
          (this._lastTimePos >= 0 && Math.abs(tp - this._lastTimePos) < 0.05);
        if (stalled) {
          this._bumpStall(typeof tp !== 'number' ? '进度查询超时' : '播放进度停滞');
        } else {
          this._stuckCount = 0;
        }
        if (typeof tp === 'number') this._lastTimePos = tp;
      });
    });
  }

  /** 停滞计数：连续 3 次（约 15 秒）判定渲染卡死，强制重启 */
  _bumpStall(reason) {
    if (++this._stuckCount >= 3) {
      this._stuckCount = 0;
      this._forceRestart(reason);
    } else {
      console.warn(`[mpv] 健康检查：检测到${reason}（${this._stuckCount}/3）`);
    }
  }

  /** 强制重启渲染进程（exit 事件 → onExit → 自动重启） */
  _forceRestart(reason) {
    console.warn(`[mpv] 健康检查：${reason}，强制重启渲染进程`);
    this._stopHealthCheck();
    try { this.process?.kill(); } catch (_) {}
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
      console.warn('[mpv] IPC 发送失败:', e.message);
    }
  }

  /** 运行时设置属性（无需重启） */
  setProperty(name, value) {
    if (name === 'pause') this._expectPause = !!value;
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
    if (params.volume !== undefined) this.setProperty('volume', Number(params.volume));
    if (params.mute !== undefined) this.setProperty('mute', !!params.mute);
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
  }

  /** 停止播放并清理 */
  stop() {
    this._stopHealthCheck();
    this._cleanupIpc();
    const proc = this.process;
    this.process = null; // 先摘除引用：exit 事件到达时会被上面的竞态防护忽略
    if (proc) {
      try { proc.kill(); } catch (_) {}
    }
  }
}

module.exports = { MpvController, findMpv: MpvController.findMpv };
