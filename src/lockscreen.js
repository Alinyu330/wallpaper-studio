// lockscreen.js — Windows 锁屏壁纸设置
// 通过注册表 PersonalizationCSP 策略设置锁屏与登录界面背景（Win10/Win11 通用方案）。
// 键位于 HKLM，需要管理员权限：先尝试直接写入，失败后通过 UAC 提权执行。
const { execFile, spawn } = require('child_process');

const CSP_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PersonalizationCSP';

/** 直接执行 reg 命令（当前进程权限） */
function reg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (err, _stdout, stderr) => {
      resolve({ ok: !err, err: err ? String(stderr || err.message) : '' });
    });
  });
}

/** 以管理员权限通过 PowerShell 执行 reg 命令（弹出 UAC 确认框） */
function regElevated(args) {
  return new Promise((resolve) => {
    // 把参数数组转为 PowerShell 单引号安全字符串
    const quoted = args.map(a => `'${String(a).replace(/'/g, "''")}'`).join(' ');
    const ps = `$p = Start-Process -FilePath 'reg.exe' -ArgumentList ${quoted} -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      { windowsHide: true }
    );
    child.on('error', () => resolve({ ok: false, err: '无法启动 PowerShell' }));
    child.on('close', (c) => resolve({ ok: c === 0, err: c === 0 ? '' : '提权执行失败（可能被取消）' }));
  });
}

/**
 * 设置锁屏壁纸
 * @param {string} imagePath 图片绝对路径（建议 JPG/PNG/BMP）
 * @returns {Promise<{ok:boolean,error?:string,elevated?:boolean}>}
 */
async function setLockScreen(imagePath) {
  if (!imagePath || !require('fs').existsSync(imagePath)) {
    return { ok: false, error: '文件不存在' };
  }
  const jobs = [
    ['add', CSP_KEY, '/v', 'LockScreenImage', '/t', 'REG_SZ', '/d', imagePath, '/f'],
    ['add', CSP_KEY, '/v', 'LockScreenImageStatus', '/t', 'REG_DWORD', '/d', '1', '/f'],
    ['add', CSP_KEY, '/v', 'LockScreenOverlaysEnabled', '/t', 'REG_DWORD', '/d', '0', '/f'],
  ];

  // 先以当前权限直接写（进程已提权时不会弹 UAC）
  const results = [];
  for (const args of jobs) results.push(await reg(args));
  if (results.every(r => r.ok)) return { ok: true, elevated: false };

  // 失败则 UAC 提权重试
  const elevResults = [];
  for (const args of jobs) elevResults.push(await regElevated(args));
  if (elevResults.every(r => r.ok)) return { ok: true, elevated: true };
  return { ok: false, error: '写入注册表失败，需要管理员权限（请在 UAC 弹窗中确认）' };
}

/** 恢复默认锁屏（删除自定义策略值） */
async function resetLockScreen() {
  const jobs = [
    ['delete', CSP_KEY, '/v', 'LockScreenImage', '/f'],
    ['delete', CSP_KEY, '/v', 'LockScreenImageStatus', '/f'],
    ['delete', CSP_KEY, '/v', 'LockScreenOverlaysEnabled', '/f'],
  ];
  // 值不存在时 delete 报错属正常，逐个忽略
  for (const args of jobs) {
    const r = await reg(args);
    if (r.ok) continue;
    await regElevated(args).catch(() => {});
  }
  return { ok: true };
}

/** 读取当前锁屏壁纸路径（无则返回 null） */
function getLockScreen() {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', CSP_KEY, '/v', 'LockScreenImage'],
      { windowsHide: true },
      (err, stdout) => {
        if (err) return resolve(null);
        const m = /REG_SZ\s+(.+)/.exec(stdout || '');
        resolve(m ? m[1].trim() : null);
      }
    );
  });
}

module.exports = { setLockScreen, resetLockScreen, getLockScreen };
