// box-mirror.js — 收纳内容镜像备份（双保险机制）
//
// 主存储：应用根目录的两个收纳文件夹（见 app-root.js，开发态=项目根、安装态=安装目录）；
// 镜像：%APPDATA%\壁纸工坊\收纳备份\<同名文件夹>\（数据目录内，受升级守卫保护）。
//
// 同步规则（syncBoxMirror 幂等，可反复执行）：
//   a) 主 → 镜像：主存储里清单引用的文件，镜像缺失或内容不一致时复制（备份刷新）；
//   b) 镜像 → 主：主存储缺失、但清单仍引用的文件从镜像恢复 —— 主存储受损
//      （误删/损坏/磁盘问题）时自动从备用位置找回，收纳与恢复功能不受影响；
//   c) 镜像清理：镜像里清单已不再引用的文件删除 —— 恢复/移除后镜像不留残余
//      （个人文件不散落）。
// 触发时机：应用启动自愈（repair.js）末尾全量同步一次；此后每次收纳/恢复/移除
// （两个宿主 applyPatch 收尾）经 2s 防抖再同步。
// 代价：收纳内容占用双份磁盘（镜像即备份，这是双保险的本意）。
const fs = require('fs');
const path = require('path');
const { getAppRoot, LAUNCHER_BOX_DIRNAME, FILEBOX_BOX_DIRNAME } = require('./app-root');

const MIRROR_DIRNAME = '收纳备份';
const isJunk = (name) => name.startsWith('._') || name.startsWith('~$');
const ADMIN_FILES = new Set(['.box-admin.ps1', '.box-admin-result.txt']);

const sameFile = (a, b) => {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.isFile() && sb.isFile() && sa.size === sb.size && Math.round(sa.mtimeMs) === Math.round(sb.mtimeMs);
  } catch (_) {
    return false;
  }
};

/** 清单引用的保管文件名集合（按收纳类别），从 config.json 读取 */
function referencedBasenames(cfgPath) {
  const ref = { launcher: new Set(), filebox: new Set() };
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    const s = cfg.settings || {};
    for (const b of (s.launcher || {}).boxed || []) {
      if (b && b.boxPath) ref.launcher.add(path.basename(b.boxPath));
    }
    for (const i of (s.filebox || {}).items || []) {
      if (i && i.boxPath) ref.filebox.add(path.basename(i.boxPath));
    }
  } catch (_) {}
  return ref;
}

/**
 * 双向对齐主存储与镜像。幂等；任何失败只记日志不抛出。
 * @returns {{mirrored:number, recovered:number, cleaned:number}} 同步摘要
 */
function syncBoxMirror(app, log = console) {
  const summary = { mirrored: 0, recovered: 0, cleaned: 0 };
  const appRoot = getAppRoot(app);
  const dataDir = app.getPath('userData');
  const mirrorRoot = path.join(dataDir, MIRROR_DIRNAME);
  const ref = referencedBasenames(path.join(dataDir, 'config.json'));
  const pairs = [
    { kind: 'launcher', primary: path.join(appRoot, LAUNCHER_BOX_DIRNAME) },
    { kind: 'filebox', primary: path.join(appRoot, FILEBOX_BOX_DIRNAME) },
  ];
  for (const { kind, primary } of pairs) {
    try {
      fs.mkdirSync(primary, { recursive: true });
      const mirror = path.join(mirrorRoot, { launcher: LAUNCHER_BOX_DIRNAME, filebox: FILEBOX_BOX_DIRNAME }[kind]);
      fs.mkdirSync(mirror, { recursive: true });
      const names = ref[kind];

      // a) 主 → 镜像：引用中的文件备份刷新
      for (const name of fs.readdirSync(primary)) {
        if (isJunk(name) || ADMIN_FILES.has(name)) continue;
        const src = path.join(primary, name);
        if (!names.has(name) || !fs.statSync(src).isFile()) continue;
        const dst = path.join(mirror, name);
        if (!fs.existsSync(dst) || !sameFile(src, dst)) {
          fs.copyFileSync(src, dst);
          summary.mirrored++;
        }
      }

      // b) 镜像 → 主：主存储缺失但清单仍引用 → 从备用位置恢复
      for (const name of fs.readdirSync(mirror)) {
        if (isJunk(name) || ADMIN_FILES.has(name)) continue;
        const mirrorPath = path.join(mirror, name);
        if (!fs.statSync(mirrorPath).isFile()) continue;
        const primaryPath = path.join(primary, name);
        if (names.has(name) && !fs.existsSync(primaryPath)) {
          try {
            fs.copyFileSync(mirrorPath, primaryPath);
            summary.recovered++;
            log.log(`[mirror] 主存储缺失，已从镜像恢复: ${name}`);
          } catch (err) {
            log.warn(`[mirror] 镜像恢复失败: ${name}`, err && err.message);
          }
          continue;
        }
        // c) 镜像清理：清单已不再引用的镜像副本删除（恢复/移除后不留残余）
        if (!names.has(name)) {
          try { fs.unlinkSync(mirrorPath); summary.cleaned++; } catch (_) {}
        }
      }
    } catch (err) {
      log.warn(`[mirror] ${kind} 收纳镜像同步失败:`, err && err.message);
    }
  }
  if (summary.mirrored || summary.recovered || summary.cleaned) {
    log.log(`[mirror] 收纳镜像同步完成: ${JSON.stringify(summary)}`);
  }
  return summary;
}

// 防抖单例：收纳操作高频发生（拖动批量收纳），合并到一次同步
let mirrorTimer = null;
function scheduleMirrorSync(app, log = console, delayMs = 2000) {
  if (mirrorTimer) clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => {
    mirrorTimer = null;
    try {
      syncBoxMirror(app, log);
    } catch (err) {
      log.warn('[mirror] 同步异常:', err && err.message);
    }
  }, delayMs);
  return mirrorTimer;
}

module.exports = { syncBoxMirror, scheduleMirrorSync, MIRROR_DIRNAME };
