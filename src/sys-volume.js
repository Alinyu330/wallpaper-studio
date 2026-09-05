// src/sys-volume.js — 系统主音量（默认播放设备）
//
// Core Audio 的 IAudioEndpointVolume 是 COM 接口，koffi 直接按 vtable 调用需要
// 自己解指针（本机实测 koffi.call 只接受 external pointer，取 vtable 槽位很别扭），
// 因此这里用一个常驻 PowerShell worker 承载 CLR 的 COM interop：
//   stdin  每行一条命令：get / set <0..100> / mute <0|1> / ping
//   stdout 每行一条 JSON
// 首次调用才拉起进程，空闲 2 分钟自毁（worker 内部也有同样的看门狗）。
'use strict';

const path = require('path');
const { spawn } = require('child_process');

const SCRIPT = path.join(__dirname, 'sys-volume-worker.ps1');
const IDLE_KILL_MS = 120000;
const CMD_TIMEOUT_MS = 2500;

let proc = null;
let stdoutBuf = '';
const pending = [];      // {resolve, timer}
let idleTimer = null;

function touch() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(stop, IDLE_KILL_MS);
  if (idleTimer.unref) idleTimer.unref();
}

function ensure() {
  if (proc && !proc.killed && proc.exitCode === null) return proc;
  stdoutBuf = '';
  try {
    proc = spawn('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (_) {
    proc = null;
    return null;
  }
  proc.stdout.on('data', (d) => {
    stdoutBuf += d.toString();
    let i;
    while ((i = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, i).trim();
      stdoutBuf = stdoutBuf.slice(i + 1);
      if (!line) continue;
      const w = pending.shift();
      if (!w) continue;
      clearTimeout(w.timer);
      let obj = null;
      try { obj = JSON.parse(line); } catch (_) { obj = null; }
      w.resolve(obj);
    }
  });
  const drain = () => {
    while (pending.length) {
      const w = pending.shift();
      clearTimeout(w.timer);
      w.resolve(null);
    }
  };
  proc.on('exit', () => { proc = null; drain(); });
  proc.on('error', () => { proc = null; drain(); });
  clearTimeout(idleTimer);
  touch();
  return proc;
}

function command(line) {
  const p = ensure();
  if (!p || !p.stdin || p.stdin.destroyed) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const entry = { resolve: (obj) => { if (settled) return; settled = true; resolve(obj); }, timer: 0 };
    entry.timer = setTimeout(() => {
      const idx = pending.indexOf(entry);
      if (idx >= 0) pending.splice(idx, 1);
      entry.resolve(null);
    }, CMD_TIMEOUT_MS);
    pending.push(entry);
    try {
      p.stdin.write(line + '\n');
    } catch (_) {
      clearTimeout(entry.timer);
      const idx = pending.indexOf(entry);
      if (idx >= 0) pending.splice(idx, 1);
      entry.resolve(null);
    }
  });
}

function stop() {
  if (!proc) return;
  const p = proc;
  try { p.stdin.write('exit\n'); } catch (_) {}
  setTimeout(() => { try { p.kill(); } catch (_) {} }, 800).unref?.();
}

/** 读系统主音量 → {volume:0..100, muted:boolean}；不可用返回 null */
async function get() {
  const r = await command('get');
  if (!r || !r.ok || typeof r.volume !== 'number' || r.volume < 0) return null;
  return { volume: r.volume, muted: r.muted === 1 };
}

/** 写系统主音量（0..100） */
async function set(pct) {
  const v = Math.min(100, Math.max(0, Math.round(Number(pct) || 0)));
  const r = await command('set ' + v);
  touch();
  return !!(r && r.ok);
}

/** 系统静音开关（真 mute，不是把音量置 0） */
async function setMute(on) {
  const r = await command('mute ' + (on ? 1 : 0));
  touch();
  return !!(r && r.ok);
}

module.exports = { get, set, setMute, stop };
