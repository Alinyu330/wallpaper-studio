// video-engine.js — 视频壁纸双槽引擎（前台/待命 两个 mpv 进程编排）
//
// 设计目标：
// 1. 平滑循环：前台播放至结尾定格时，待命槽（预生成、暂停在第 0 帧）起播并置于
//    前台之上，淡入覆盖 —— 循环交界处由「生硬跳变」变为「柔和溶解」。
// 2. 无黑屏自愈：前台冻结/意外暂停无法恢复时，先让待命槽（或临时替换进程）
//    在冻结画面上方渲染出画面，再杀掉旧进程 —— 全程无黑屏。
// 3. 待命槽自身故障时因处于隐藏层（alpha 0），杀掉重启用户完全无感。
//
// ★ 关键约束：本机 mpv/D3D11 在「运行时 seek」（set_property time-pos /
//   循环回绕）下会随机冻结。因此全程零 seek：
//   - 前台 --loop-file=no --keep-open=yes：播完定格最后一帧，从不回绕；
//   - 待命槽以 --start=0 --pause 生成（初始定位，非运行时 seek，已验证安全）；
//   - 槽位生命周期只靠「进程更替」，旧槽淡出后直接杀掉并重生为待命槽。
//
// ★ 过渡方案（v1.5.0）：旧前台全程保持不透明（alpha 255）垫底，只把待命槽
//   从 alpha 0 平滑淡入到 255。若同时淡化两窗（旧 255→0 + 新 0→255），
//   两个半透明窗口叠在黑色宿主之上，中点合成 = 50%新 + 25%旧 + 25%黑，
//   表现为「过渡瞬间画面变暗 + 影像重影」。只淡入新窗则是标准溶解：
//   任意时刻 = p*新 + (1-p)*旧，亮度恒定，无黑变、无异常重影。
const { MpvController } = require('./mpv');
const desktop = require('./desktop');
const { WinOps } = require('./win-ops');

const FADE_SEC = 1.1;          // 淡入覆盖时长（秒）
const TICK_MS = 200;           // 调度轮询间隔
const HEALTH_MS = 5000;        // 健康检查间隔
const REPAIR_COOLDOWN = 8000;  // 热修复限流
const EOF_STUCK_LIMIT = 3;     // 结尾定格僵死次数阈值（触发无黑屏修复）

class VideoEngine {
  constructor() {
    this.front = null;      // 前台槽（可见）
    this.standby = null;    // 待命槽（隐藏，暂停在第 0 帧）
    this.file = null;
    this.wid = 0;
    this.params = {};
    this.expectPause = false;
    this.duration = 0;
    this.smoothLoop = true;
    this.stopping = false;
    this.gen = 0;           // 会话代号：stop/start 使旧异步流程失效
    this.fading = null;     // { t0, dur }
    this.lastRepairAt = 0;
    this.stallCount = 0;            // 前台停滞计数
    this.unexpectedPauses = 0;      // 前台意外暂停计数
    this.eofStuck = 0;              // 结尾定格僵死计数（待命槽缺席时交替无法进行）
    this._prevHealthTp = undefined; // 上次健康检查的播放位置

    this._tickTimer = setInterval(() => this._tick(), TICK_MS);
    this._healthTimer = setInterval(() => this._healthTick(), HEALTH_MS);
    // mpv 子窗口的变更类窗口操作必须走隔离执行器：SetWindowPos 等会向目标
    // 窗口线程同步投递消息，mpv 冻结时会连带死锁 Electron 主线程（全局卡死）
    this.winOps = new WinOps(2);
  }

  /** 是否有槽位在正常运行 */
  get isRunning() {
    return !!(this.front && this.front.isRunning);
  }

  /** 当前是否循环模式（用户关闭循环时播完定格，不做交替） */
  get _loopEnabled() {
    return this.userLoop !== false;
  }

  /** 设置平滑循环开关（即时生效：开启补建待命槽，关闭释放之） */
  setSmoothLoop(on) {
    this.smoothLoop = !!on;
    console.log(`[engine] 平滑循环${this.smoothLoop ? '已开启' : '已关闭'}`);
    if (!this.file || this.stopping) return;
    if (this.smoothLoop) {
      this._ensureStandby().catch(() => {});
    } else {
      this._dropFadeIfAny();
      this._dropStandby();
    }
  }

  /** 启动视频壁纸（替换现有播放） */
  start(file, wid, params) {
    this.stopAll();
    this.stopping = false;
    this.gen++;
    const gen = this.gen;
    this.file = file;
    this.wid = wid;
    // 引擎约定：前台循环交给「播完定格 + 交替」机制，不用 mpv 内部回绕（回绕内部
    // 等效 seek，会触发本机 D3D11 冻结）。用户关闭循环时播完定格即可。
    // ★ 保留用户原始参数：restart/就地替换回退时必须以 userParams 重启，
    //   否则引擎内部的 loop:false 会污染用户循环开关 → 重启后永不循环、
    //   结尾定格被当作预期行为无人修复（"播放一段时间后无法播放"的元凶之一）
    this.userParams = { ...params };
    this.params = { ...params, loop: false };
    this.expectPause = !!params.paused;
    this.userLoop = params.loop !== false; // 用户循环开关（引擎内部固定不回绕）
    this.duration = 0;
    this.fading = null;
    this.stallCount = 0;
    this.unexpectedPauses = 0;
    this.eofStuck = 0;
    this._durNextTry = 0;
    this._prevHealthTp = undefined;

    // 前台槽起播
    this.front = this._makeSlot('front', { paused: params.paused });
    this._waitForReady(this.front, gen, 8000).then((ok) => {
      if (gen !== this.gen) return;
      if (!ok) console.error('[engine] 前台槽启动超时');
      this._applyFrontAlphaWhenFound(255);
      this.front.setPaused(this.expectPause);
      this.front.query('duration', 3000).then((d) => {
        if (gen !== this.gen || typeof d !== 'number') return;
        this.duration = d;
        console.log(`[engine] 前台槽就绪，视频时长 ${d.toFixed(1)}s`);
        if (this.smoothLoop && this._loopEnabled) {
          this._ensureStandby().catch(() => {});
        }
      });
    });
  }

  /** 停止全部（应用壁纸切换/停用/退出时调用） */
  stopAll() {
    this.stopping = true;
    this.gen++;
    this.fading = null;
    this.duration = 0;
    this.stallCount = 0;
    this.unexpectedPauses = 0;
    this.eofStuck = 0;
    for (const s of [this.front, this.standby]) {
      if (s) s.stop();
    }
    this.front = null;
    this.standby = null;
    this.file = null;
  }

  /** 实时应用参数（质量/分辨率等启动期参数变化请走 restart） */
  applyParams(patch) {
    this.params = { ...this.params, ...patch };
    if (this.userParams) this.userParams = { ...this.userParams, ...patch };
    if (patch.paused !== undefined) this.expectPause = !!patch.paused;
    for (const s of [this.front, this.standby]) {
      if (s && s.isRunning) s.applyParams(this.params);
    }
    if (patch.loop !== undefined) {
      const on = patch.loop !== false;
      if (on !== this.userLoop) {
        this.userLoop = on;
        if (on) this._ensureStandby().catch(() => {});
        else {
          this._dropFadeIfAny();
          this._dropStandby();
        }
      }
    }
  }

  /** 以当前参数完整重启（渲染质量/分辨率等启动期参数变化时） */
  restart() {
    if (!this.file) return;
    this.start(this.file, this.wid, this.userParams || this.params);
  }

  /** 同步期望暂停状态（用户暂停/全局暂停/性能暂停统一入口） */
  setExpectedPause(paused) {
    this.expectPause = !!paused;
    if (this.front && this.front.isRunning) this.front.setPaused(paused);
    // 待命槽保持暂停（除淡入淡出窗口期）
    if (this.standby && this.standby.isRunning && !this.fading) this.standby.setPaused(true);
  }

  /** 确保前台 mpv 渲染子窗口位于宿主内 Z 序顶部（隔离执行，主线程零阻塞） */
  raiseFront() {
    if (this.fading) return; // 淡入期间待命槽必须位于前台之上，抬升前台会盖住淡入画面
    const h = this._frontChildHwnd();
    if (h) this.winOps.fire('raise', h);
  }

  // ---------- 内部：槽位管理 ----------

  /**
   * PID 确定性绑定：把控制器与其 mpv 渲染子窗口一一对应。
   * mpv 渲染窗口由 mpv 进程创建（--wid 只改变父窗口），窗口 PID 必然等于
   * 本控制器的进程 PID —— 完全确定性、无竞态。旧写法按「未被认领的句柄」
   * 猜测身份，在循环交替（杀旧前台 + 重建待命槽）窗口期会把新待命槽绑到
   * 垂死窗口上 → 隐藏失效 → 暂停在第 0 帧的待命窗口盖住前台 → 画面永久冻结。
   */
  _bindChildWindow(c) {
    const bind = (n) => {
      if (this.stopping || c.childHwnd || !c.isRunning) return;
      const mine = desktop.findAllChildrenByClass(this.wid, 'mpv')
        .find((h) => desktop.getWindowPid(h) === (c.process?.pid || 0));
      if (mine) {
        c.childHwnd = mine;
      } else if (n > 0) {
        setTimeout(() => bind(n - 1), 150);
      }
    };
    bind(25);
  }

  _makeSlot(name, { startPos = 0, paused = true } = {}) {
    const c = new MpvController(name);
    c.onExit = (code) => this._onSlotExit(name, code);
    c.onReady = () => {
      this._bindChildWindow(c);
      this._onSlotReady(name);
    };
    c.start(this.file, this.wid, {
      ...this.params,
      startPos,
      paused,
      forceMute: name !== 'front', // 非前台槽一律静音，避免淡入期双声道
    });
    return c;
  }

  /** 槽位子窗口句柄（失效时返回 0） */
  _slotHwnd(slot) {
    if (!slot || !slot.isRunning || !slot.childHwnd) return 0;
    return desktop.isWindowAlive(slot.childHwnd) ? slot.childHwnd : 0;
  }

  _frontChildHwnd() {
    return this._slotHwnd(this.front);
  }

  _standbyChildHwnd() {
    return this._slotHwnd(this.standby);
  }

  /** 前台透明度设置（子窗口可能稍后才创建，带重试） */
  _applyFrontAlphaWhenFound(alpha, tries = 10) {
    const h = this._frontChildHwnd();
    if (h) {
      this.winOps.fire('alpha', h, alpha);
      return;
    }
    if (tries > 0 && !this.stopping) {
      setTimeout(() => this._applyFrontAlphaWhenFound(alpha, tries - 1), 200);
    }
  }

  _onSlotReady(name) {
    if (name === 'standby' && !this.fading) {
      // 新起的待命槽位于 Z 序顶部，立即隐藏（alpha 0）
      const s = this.standby;
      if (s && s.isRunning) {
        const tryHide = (n) => {
          if (this.stopping || this.standby !== s || this.fading) return;
          const h = this._standbyChildHwnd();
          if (h) this.winOps.fire('alpha', h, 0);
          else if (n > 0) setTimeout(() => tryHide(n - 1), 200);
        };
        tryHide(10);
      }
    }
  }

  _onSlotExit(name, code) {
    if (this.stopping) return; // 主动停止引发的退出
    if (name === 'front') {
      // 前台进程意外退出（崩溃）：无黑屏顶替，失败再回退。
      // 必须先清 fading：残留的 fading 会让 _ensureStandby/_onSlotReady 跳过
      // 隐藏步骤，新待命槽以不透明状态盖住新前台（表现为画面定格第 0 帧）
      this.fading = null;
      console.warn(`[engine] 前台槽意外退出(code=${code})，执行无黑屏顶替`);
      this._promoteStandbyAsFront()
        .then((ok) => (ok ? null : this._replaceFrontInPlace(0)))
        .catch((e) => {
          console.error('[engine] 顶替失败，回退就地替换:', e.message);
          return this._replaceFrontInPlace(0);
        })
        .finally(() => this._scheduleStandbyRebuild());
    } else {
      console.warn('[engine] 待命槽退出，静默重建（用户无感）');
      this.standby = null;
      this._scheduleStandbyRebuild(2000);
    }
  }

  _scheduleStandbyRebuild(delay = 1500) {
    setTimeout(() => {
      if (!this.stopping && this.smoothLoop && this._loopEnabled && this.file && !this.standby) {
        this._ensureStandby().catch(() => {});
      }
    }, delay);
  }

  /**
   * 待命槽 → 前台（无黑屏顶替）。
   * 待命槽本来就在第 0 帧（无 seek），直接起播上台。
   * @returns {Promise<boolean>} 是否成功
   */
  async _promoteStandbyAsFront() {
    const gen = this.gen;
    if (!this.standby || !this.standby.isRunning || !this.standby.ipcReady) {
      return false;
    }
    const back = this.standby;
    const old = this.front;

    // 待命槽在第 0 帧（出生即定位，无需 seek）；先让它完全不透明，再抬到最上
    const bh = this._standbyChildHwnd();
    if (bh) {
      this.winOps.fire('alpha', bh, 255);
      // 抬升走隔离执行器：若待命槽窗口异常，超时返回 false → 走就地替换回退
      const raised = await this.winOps.run('raise', bh, 0, 1500);
      if (!raised) {
        console.warn('[engine] 待命槽窗口抬升超时，回退就地替换');
        return false;
      }
    }
    back.setPaused(this.expectPause);

    this.fading = null; // 顶替即完成过渡，清除淡入状态（防止残留标志阻断后续待命槽隐藏）
    this.front = back;
    this.standby = null;
    if (old) old.stop(); // 已被完全遮盖，杀掉无黑屏
    console.log('[engine] 待命槽已顶替前台，全程无黑屏');

    this._scheduleStandbyRebuild();
    return true;
  }

  /** 建立待命槽（隐藏、暂停在第 0 帧） */
  async _ensureStandby() {
    if (this.standby && this.standby.isRunning) return;
    const gen = this.gen;
    const s = this._makeSlot('standby', { startPos: 0, paused: true });
    this.standby = s;
    const ok = await this._waitForReady(s, gen, 8000);
    if (gen !== this.gen || this.standby !== s) return;
    if (ok) {
      const trySetup = (n) => {
        if (this.stopping || this.standby !== s || this.fading) return;
        const sh = this._standbyChildHwnd();
        if (sh) {
          this.winOps.fire('alpha', sh, 0);
          s.setPaused(true);
          console.log('[engine] 待命槽就绪（隐藏，暂停在第 0 帧）');
        } else if (n > 0) {
          setTimeout(() => trySetup(n - 1), 200);
        }
      };
      trySetup(10);
    }
  }

  /** 释放待命槽 */
  _dropStandby() {
    if (this.standby) {
      this.standby.stop();
      this.standby = null;
      console.log('[engine] 待命槽已释放');
    }
  }

  /** 待命槽故障：隐藏层内静默重建（用户无感） */
  _rebuildStandby(reason) {
    console.warn(`[engine] 待命槽${reason}，静默重建`);
    this.stallCount = 0;
    if (this.standby) this.standby.stop();
    this.standby = null;
    this._scheduleStandbyRebuild(1500);
  }

  _waitForReady(slot, gen, timeoutMs) {
    return new Promise((resolve) => {
      if (slot.ipcReady) return resolve(true);
      const t0 = Date.now();
      const timer = setInterval(() => {
        if (gen !== this.gen || slot.ipcReady || !slot.isRunning || Date.now() - t0 > timeoutMs) {
          clearInterval(timer);
          resolve(slot.ipcReady);
        }
      }, 150);
    });
  }

  // ---------- 内部：循环交叉淡化调度 ----------

  _tick() {
    if (this.stopping || !this.front || !this.front.isRunning) return;
    if (this.fading) {
      this._stepFade();
      return;
    }
    if (!this.smoothLoop || !this._loopEnabled || this.expectPause) return;

    // 轮询前台播放位置（淡入调度用）
    this.front.query('time-pos', 1200).then((tp) => {
      if (this.stopping || this.fading || typeof tp !== 'number') return;
      if (this.front) this.front.lastTimePos = tp;
      if (this.duration < 1) {
        // 时长未知（初始查询失败）→ 限频重试。不重试将永远无法调度交替，
        // 前台会定格在最后一帧（健康检查的 EOF 自愈兜底之外再补一层）
        const now = Date.now();
        if (now >= (this._durNextTry || 0)) {
          this._durNextTry = now + 1000;
          this.front.query('duration', 3000).then((d) => {
            if (this.stopping || this.fading || typeof d !== 'number' || !this.front) return;
            this.duration = d;
            console.log(`[engine] 视频时长重试成功 ${d.toFixed(1)}s`);
            if (this.smoothLoop && this._loopEnabled) this._ensureStandby().catch(() => {});
          });
        }
        return;
      }
      const remaining = this.duration - tp;
      const eofHold = remaining <= 0.05; // 播完定格（keep-open）
      if (remaining <= FADE_SEC + 0.15) {
        // 待命槽就绪才做淡入；未就绪则前台定格等待（短暂静帧，非黑屏）
        if (this.standby && this.standby.isRunning && this.standby.ipcReady) {
          this._beginFade(eofHold ? FADE_SEC * 1000 : Math.max(0.35, remaining - 0.05) * 1000);
        } else if (eofHold) {
          this._scheduleStandbyRebuild(0);
        }
      }
    }).catch(() => {});
  }

  _beginFade(durMs) {
    const back = this.standby;
    if (!back || !back.isRunning) return;
    // 先确认待命槽 IPC 存活（失联则本轮放弃淡化并静默重建，前台定格等待）
    back.query('time-pos', 600).then((tp) => {
      if (this.stopping || this.fading) return;
      if (!back.isRunning || typeof tp !== 'number') {
        this._rebuildStandby('失联');
        return;
      }
      console.log('[engine] 循环交界：待命槽淡入覆盖（前台保持不透明垫底）');
      back.setProperty('pause', false); // 待命槽从第 0 帧起播（出生即在 0，无需 seek）
      const bh = this._standbyChildHwnd();
      if (bh) {
        this.winOps.fire('alpha', bh, 0);   // 确保从全透明起步（不闪现）
        this.winOps.fire('raise', bh);      // 淡入方置于最上
      }
      this.fading = { t0: Date.now(), dur: durMs };
    }).catch(() => {});
  }

  _stepFade() {
    const f = this.fading;
    if (!f) return;
    // 淡化中待命槽死亡/失联：中止淡化，前台本就保持不透明（无黑屏、无残留）
    if (!this.standby || !this.standby.isRunning) {
      console.warn('[engine] 淡化中待命槽失效，中止淡化并保持前台');
      this.fading = null;
      this._applyFrontAlphaWhenFound(255);
      const sh = this._standbyChildHwnd();
      if (sh) this.winOps.fire('alpha', sh, 0);
      return;
    }
    const p = Math.min(1, (Date.now() - f.t0) / f.dur);
    // smoothstep 缓动：起止柔和、中段平滑，视觉上比线性过渡更自然
    const e = p * p * (3 - 2 * p);
    const sh = this._standbyChildHwnd();
    if (sh) this.winOps.fire('alpha', sh, Math.round(255 * e));
    // 前台保持 alpha 255 垫底不动：合成结果恒为 e*新+(1-e)*旧，
    // 全程亮度恒定（旧方案两窗同时淡化会让黑色宿主透出：变暗+重影）
    if (p >= 1) this._finishFade();
  }

  _finishFade() {
    // 待命槽已完全不透明并完全遮盖旧前台：直接杀掉旧槽并重生为待命槽；角色互换
    const old = this.front;
    const cur = this.standby;
    this.fading = null;
    this.front = cur;
    this.standby = null;
    this._applyFrontAlphaWhenFound(255);
    if (old) old.stop(); // 已被完全遮盖，无黑屏
    console.log('[engine] 循环交界完成，角色已互换');
    this.stallCount = 0;
    this.unexpectedPauses = 0;
    this.eofStuck = 0;
    this._prevHealthTp = undefined;
    this._scheduleStandbyRebuild(800); // 尽快重建待命槽（下一轮交界要用）
  }

  // ---------- 内部：健康检查（渲染冻结 / 暂停状态脱节） ----------

  async _healthTick() {
    if (this.stopping || !this.file) return;
    const front = this.front;
    if (!front || !front.isRunning) return;
    if (this.fading) return; // 淡入淡出窗口期跳过
    if (!front.ipcReady) {
      this._bumpStall('IPC 无响应');
      return;
    }

    // 1) 实际暂停状态核对
    const paused = await front.query('pause', 2000);
    if (this.stopping || this.fading || this.front !== front) return;
    if (typeof paused !== 'boolean') {
      this._bumpStall('IPC 无响应');
      return;
    }
    if (paused === true) {
      if (this.expectPause) {
        this.stallCount = 0;
        this.unexpectedPauses = 0;
        return; // 应用侧要求的正常暂停
      }
      // 播完定格（EOF keep-open）时 mpv 可能自行置暂停：属正常等待交替
      const eof = await front.query('eof-reached', 1500);
      if (eof === true) {
        this.stallCount = 0;
        this.unexpectedPauses = 0;
        this._handleEofHold();
        return;
      }
      console.warn(`[engine] 健康检查：前台意外暂停 [slot=${front.name} pid=${front.process?.pid} expectPause=${this.expectPause} fading=${!!this.fading}]，尝试恢复播放`);
      if (++this.unexpectedPauses >= 2) {
        this.unexpectedPauses = 0;
        await this._repairFront('意外暂停且自动恢复无效（暂停状态脱节）');
      } else {
        front.setPaused(false);
      }
      return;
    }
    this.unexpectedPauses = 0;

    // 2) 播放进度停滞核对（对比连续两次健康检查的采样）
    const tp = await front.query('time-pos', 2000);
    if (this.stopping || this.fading || this.front !== front) return;
    if (typeof tp !== 'number') {
      this._bumpStall('进度查询超时');
      return;
    }
    front.lastTimePos = tp;
    const prev = this._prevHealthTp;
    this._prevHealthTp = tp;
    if (prev !== undefined && Math.abs(tp - prev) < 0.05) {
      // 定格在结尾属正常（等待淡入交替）
      const eof = await front.query('eof-reached', 1500);
      if (eof === true) {
        this.stallCount = 0;
        this._handleEofHold();
        return;
      }
      this._bumpStall('播放进度停滞');
    } else {
      this.stallCount = 0;
    }
  }

  /**
   * 结尾定格处置（EOF keep-open 后 mpv 自行暂停）：
   * - 待命槽就绪 → 立即淡入交替（时长未知也能走，不依赖 _tick 的预调度）；
   * - 待命槽缺席 → 立刻重建；连续多次仍无进展判定僵死 → 无黑屏热修复。
   * 修复“播放一段时间后画面定格不动”的遗留场景（待命槽重建失败/时长未知）。
   */
  _handleEofHold() {
    if (!this._loopEnabled || !this.smoothLoop) return; // 用户关闭循环/平滑：定格结尾是预期行为
    if (this.fading) { this.eofStuck = 0; return; }
    if (this.standby && this.standby.isRunning && this.standby.ipcReady) {
      this.eofStuck = 0;
      this._beginFade(FADE_SEC * 1000);
      return;
    }
    this._scheduleStandbyRebuild(0);
    if (++this.eofStuck >= EOF_STUCK_LIMIT) {
      this.eofStuck = 0;
      console.warn(`[engine] 健康检查：结尾定格且待命槽缺席（${EOF_STUCK_LIMIT} 次无进展），执行无黑屏修复`);
      this._repairFront('结尾定格僵死（待命槽缺席）');
    }
  }

  _bumpStall(reason) {
    const n = ++this.stallCount;
    if (n >= 3) {
      this.stallCount = 0;
      this._repairFront(reason);
    } else {
      console.warn(`[engine] 健康检查：前台${reason}（${n}/3）`);
    }
  }

  /**
   * 前台热修复（无黑屏，零 seek）：
   * - 有待命槽：直接上台顶替（从第 0 帧起播）；
   * - 无待命槽（平滑循环关闭/重建中）：先起替换进程渲染出画面再杀旧进程。
   */
  async _repairFront(reason) {
    const now = Date.now();
    if (now - this.lastRepairAt < REPAIR_COOLDOWN) {
      console.warn(`[engine] 健康检查：${reason}（修复限流中，跳过本次）`);
      return;
    }
    this.lastRepairAt = now;
    console.warn(`[engine] 健康检查：${reason}，执行无黑屏热修复`);

    this._dropFadeIfAny();
    if (this.standby && this.standby.isRunning && this.standby.ipcReady) {
      const ok = await this._promoteStandbyAsFront();
      if (!ok) await this._replaceFrontInPlace();
    } else {
      await this._replaceFrontInPlace();
    }
  }

  /** 无待命槽时的就地替换：新进程先渲染出画面，再杀旧进程 */
  async _replaceFrontInPlace() {
    const gen = this.gen;
    const old = this.front;
    // 替换进程从第 0 帧暂停起步（--start=0 --pause，初始定位无 seek），渲染出画面后上台
    const rep = new MpvController('replace');
    // 关键：必须设置 onReady 绑定子窗口（v1.4.0 遗漏 → childHwnd 恒为 0 →
    // 就地替换判定失败 → 总是回退完整重启（短暂黑屏）。无黑屏替换从未生效过）
    rep.onReady = () => this._bindChildWindow(rep);
    rep.start(this.file, this.wid, {
      ...this.params,
      startPos: 0,
      paused: true,
    });
    const ok = await this._waitForReady(rep, gen, 6000);
    // 等待句柄绑定（onReady 回调里绑定，可能滞后于 IPC 就绪）
    for (let i = 0; i < 20 && !rep.childHwnd && gen === this.gen; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (gen !== this.gen) {
      rep.stop();
      return;
    }
    if (!ok || !rep.childHwnd) {
      console.error('[engine] 替换进程启动超时，直接杀旧进程重启');
      if (old) old.stop();
      rep.stop();
      this.front = null;
      if (this.file && !this.stopping) this.start(this.file, this.wid, this.userParams || this.params);
      return;
    }
    // 新窗口上台并恢复不透明（隔离执行），旧窗口压暗后杀掉（无黑屏）
    this.winOps.fire('alpha', rep.childHwnd, 255);
    const raised = await this.winOps.run('raise', rep.childHwnd, 0, 1500);
    if (!raised) {
      // 替换窗口无法上台（异常）：丢弃替换，走完整重启
      console.warn('[engine] 替换窗口抬升失败，回退完整重启');
      rep.stop();
      if (old) old.stop();
      this.front = null;
      if (this.file && !this.stopping) this.start(this.file, this.wid, this.userParams || this.params);
      return;
    }
    const oldHwnd = old ? this._slotHwnd(old) : 0;
    if (oldHwnd) this.winOps.fire('alpha', oldHwnd, 0);
    if (old) old.stop(); // 已被遮盖，无黑屏
    rep.setPaused(this.expectPause);
    // 收编为前台槽：接上崩溃自愈回调（否则替换后前台崩溃无人接管）
    rep.onExit = (code) => this._onSlotExit('front', code);
    this.front = rep;
    this.standby = null;
    this.stallCount = 0;
    this.unexpectedPauses = 0;
    this.eofStuck = 0;
    this._prevHealthTp = undefined;
    console.log('[engine] 前台已无黑屏替换');
    if (this.smoothLoop && this._loopEnabled) this._scheduleStandbyRebuild(1500);
  }

  _dropFadeIfAny() {
    if (this.fading) {
      this.fading = null;
      this._applyFrontAlphaWhenFound(255);
      if (this.standby) {
        const sh = this._standbyChildHwnd();
        if (sh) this.winOps.fire('alpha', sh, 0);
      }
    }
  }
}

module.exports = { VideoEngine };
