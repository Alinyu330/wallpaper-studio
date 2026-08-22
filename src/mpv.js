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
    this.process.on('error', (err) => {
      console.error('[mpv] 启动失败:', err.message);
      this.process = null;
    });
    this.process.on('exit', (code) => {
      console.log(`[mpv] 进程退出 code=${code}`);
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
      console.log('[mpv] IPC 已连接');
      // 发送排队中的命令
      for (const cmd of this._pendingCommands) this._send(cmd);
      this._pendingCommands = [];
      if (this.onReady) {
        try { this.onReady(); } catch (e) { console.warn('[mpv] onReady 回调异常:', e.message); }
      }
    });
    this.ipcClient.on('error', (err) => {
      console.warn('[mpv] IPC 连接失败:', err.message);
    });
    this.ipcClient.on('close', () => { this.ipcReady = false; });
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
    this._cleanupIpc();
    if (this.process) {
      try { this.process.kill(); } catch (_) {}
      this.process = null;
    }
  }
}

module.exports = { MpvController, findMpv: MpvController.findMpv };
