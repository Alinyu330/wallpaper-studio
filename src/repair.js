// repair.js — 启动数据自愈（v1.12.0）
//
// 背景（为什么需要自愈）：
// v1.11.0 及之前版本的安装脚本在"覆盖安装升级"时会静默运行旧版卸载器，而旧
// customUnInstall 无条件把 %APPDATA%\壁纸工坊 整目录删除（config.json =
// 全部设置 + 壁纸库索引），收纳的文件/快捷方式被旧卸载器改名到桌面
// 「壁纸工坊-收纳*(卸载恢复)」文件夹（或改名失败被误删）。
// v1.12.0 起 build/installer.nsh 已带三重防护（--updated 升级守卫 / customInit
// 升级前预备份 / 真卸载抢救兜底），本模块负责事后治愈与备份还原：
//
//   1) 预备份还原：config.json 缺失/损坏且 %APPDATA%\壁纸工坊-update-backup
//      存在（上次升级由 customInit 写下）→ 拷回配置；
//   2) 收纳存储迁移（v1.12.0 一次性）：收纳保管目录从 %APPDATA%\壁纸工坊\
//      {launcher-box,filebox-box} 迁往应用根目录的可见文件夹
//      收纳快捷方式(卸载恢复)/ 与 收纳文件(卸载恢复)/，并同步重写 config
//      里的 boxPath/path 引用（按文件名映射）；
//   3) 桌面救援回迁：桌面「卸载恢复」文件夹里的内容按 config 清单精确归位 ——
//      清单仍引用的（文件名匹配）移回收纳文件夹（与已有副本去重），
//      清单未引用的直接移回桌面根目录（历史受损用户的一次性治愈）；
//   4) 孤儿还原：收纳文件夹里存在但清单未引用的文件，恢复到桌面根目录
//      （清单与保管目录正常使用中永远同步，出现孤儿 = 清单曾丢失）；
//   5) 备份清理：配置健康时删除预备份，避免陈旧备份在下次升级误导自愈。
//
// 设计约束：必须在 Store 构造之前调用（会写回 config.json）；全程 try/catch，
// 任何失败只记日志，绝不阻塞应用启动。

const fs = require('fs');
const path = require('path');
const { getAppRoot, LAUNCHER_BOX_DIRNAME, FILEBOX_BOX_DIRNAME } = require('./app-root');
const { syncBoxMirror } = require('./box-mirror');

// 桌面救援文件夹命名（真卸载抢救产物，与 build/installer.nsh 严格一致）
const RESCUE_PREFIX = '壁纸工坊-收纳';
// 旧版（v1.11 及之前）收纳保管目录名（%APPDATA%\壁纸工坊 下）
const LEGACY_BOX_DIRS = { launcher: 'launcher-box', filebox: 'filebox-box' };
// launcher 运行期管理文件，不属于收纳内容
const BOX_ADMIN_FILES = new Set(['.box-admin.ps1', '.box-admin-result.txt']);
const isJunk = (name) => name.startsWith('._') || name.startsWith('~$');

/** 目标被占用时退让命名：name.ext → name (2).ext …（找不到空位返回 null） */
function collisionFree(dst) {
  if (!fs.existsSync(dst)) return dst;
  const ext = path.extname(dst);
  const base = path.basename(dst, ext);
  const dir = path.dirname(dst);
  for (let i = 2; i < 100; i++) {
    const p = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(p)) return p;
  }
  return null;
}

/** 移动单文件/目录：rename 失败（被占用/跨卷）时退化为复制+删除 */
function moveFile(src, dst) {
  try {
    fs.renameSync(src, dst);
    return true;
  } catch (_) {}
  try {
    fs.cpSync(src, dst, { recursive: true });
    fs.rmSync(src, { recursive: true, force: true });
    return true;
  } catch (err) {
    try { fs.rmSync(dst, { recursive: true, force: true }); } catch (_) {}
    return false;
  }
}

const readJson = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (_) { return null; }
};

/** 两份文件是否为同一内容（预备份与卸载器抢救自同一来源时 mtime/size 一致） */
const sameFile = (a, b) => {
  try {
    const sa = fs.statSync(a);
    const sb = fs.statSync(b);
    return sa.size === sb.size && Math.round(sa.mtimeMs) === Math.round(sb.mtimeMs) && sa.isDirectory() === sb.isDirectory();
  } catch (_) {
    return false;
  }
};

const removePath = (p) => {
  try { fs.rmSync(p, { recursive: true, force: true }); return true; } catch (_) { return false; }
};

/**
 * 启动自愈入口。
 * @param {Electron.App} app  Electron app（也可传入 {getPath,isPackaged,getAppPath}
 *                            兼容对象，便于脱离 Electron 脚本运行）
 * @param {Console} log       日志输出（默认 console，输出同时落 engine.log）
 */
function repairUserData(app, log = console) {
  const summary = {
    backupRestored: false, migratedBoxes: 0, configRewritten: false,
    desktopRescued: 0, toBoxRescued: 0, deduped: 0, orphansRestored: 0, skippedStale: 0,
    actions: [],
  };
  try {
    const dataDir = app.getPath('userData');
    const desktopDir = app.getPath('desktop');
    const appRoot = getAppRoot(app);
    const backupDir = path.join(path.dirname(dataDir), '壁纸工坊-update-backup');
    const cfgPath = path.join(dataDir, 'config.json');
    // 新收纳保管目录（应用根目录可见文件夹）
    const newBoxDirs = {
      launcher: path.join(appRoot, LAUNCHER_BOX_DIRNAME),
      filebox: path.join(appRoot, FILEBOX_BOX_DIRNAME),
    };
    for (const d of Object.values(newBoxDirs)) {
      try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
    }

    const cfgHealthy = () => {
      const c = readJson(cfgPath);
      return !!(c && typeof c === 'object' && c.settings);
    };

    // ---------- 1) 预备份还原（配置缺失/损坏时） ----------
    if (!cfgHealthy() && fs.existsSync(path.join(backupDir, 'config.json'))) {
      log.warn('[repair] config.json 缺失/损坏，尝试从升级预备份还原…');
      try {
        fs.copyFileSync(path.join(backupDir, 'config.json'), cfgPath);
        for (const f of ['config.json.bak', 'weather.json']) {
          const src = path.join(backupDir, f);
          if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dataDir, f));
        }
        summary.backupRestored = true;
        summary.actions.push('从升级预备份还原了配置');
        log.log('[repair] 已从升级预备份还原 config.json');
      } catch (err) {
        log.error('[repair] 预备份还原失败:', err && err.message);
      }
    }

    // ---------- 2) 收纳存储迁移到应用根目录（v1.12.0 一次性） ----------
    // 来源：旧 %APPDATA% 保管目录 + 预备份里的新旧两种形态；目标去重（同名跳过）。
    const migrateInto = (srcDir, dstDir) => {
      let moved = 0;
      let entries = [];
      try { entries = fs.readdirSync(srcDir, { withFileTypes: true }); } catch (_) { return 0; }
      for (const e of entries) {
        if (isJunk(e.name)) continue;
        if (BOX_ADMIN_FILES.has(e.name)) continue;
        const dst = path.join(dstDir, e.name);
        if (fs.existsSync(dst)) continue; // 目标已有同名 → 视为同一内容，留新弃旧
        if (moveFile(path.join(srcDir, e.name), dst)) moved++;
      }
      return moved;
    };
    try {
      const legacyDirs = {
        launcher: path.join(dataDir, LEGACY_BOX_DIRS.launcher),
        filebox: path.join(dataDir, LEGACY_BOX_DIRS.filebox),
      };
      const srcMap = {
        launcher: [legacyDirs.launcher, path.join(backupDir, LEGACY_BOX_DIRS.launcher), path.join(backupDir, LAUNCHER_BOX_DIRNAME)],
        filebox: [legacyDirs.filebox, path.join(backupDir, LEGACY_BOX_DIRS.filebox), path.join(backupDir, FILEBOX_BOX_DIRNAME)],
      };
      for (const kind of ['launcher', 'filebox']) {
        let moved = 0;
        for (const src of srcMap[kind]) {
          if (fs.existsSync(src)) moved += migrateInto(src, newBoxDirs[kind]);
        }
        if (moved) {
          summary.migratedBoxes += moved;
          summary.actions.push(`迁移了 ${moved} 个收纳文件到「${path.basename(newBoxDirs[kind])}」`);
          log.log(`[repair] 收纳存储迁移: ${moved} 个 → ${newBoxDirs[kind]}`);
        }
      }
    } catch (err) {
      log.error('[repair] 收纳存储迁移失败:', err && err.message);
    }

    // ---------- 3) 重写 config 里的收纳路径引用（旧位置 → 应用根目录新文件夹） ----------
    // 无条件重写：v1.11 及之前 config 里引用的 %APPDATA% 旧保管路径一律改指
    // 新收纳文件夹（此时文件可能还在桌面救援夹/预备份里尚未归位，后续步骤会
    // 把文件移入新路径；若文件真已丢失，宿主的幽灵项清理会兜底移除记录）。
    try {
      const cfg = readJson(cfgPath);
      if (cfg && cfg.settings) {
        let changed = false;
        const legacyDirs = {
          launcher: [path.join(dataDir, LEGACY_BOX_DIRS.launcher)],
          filebox: [path.join(dataDir, LEGACY_BOX_DIRS.filebox)],
        };
        const remap = (kind, p) => {
          if (!p) return p;
          if (legacyDirs[kind].some((d) => String(p).startsWith(d))) {
            changed = true;
            return path.join(newBoxDirs[kind], path.basename(p));
          }
          return p;
        };
        const launcher = cfg.settings.launcher || {};
        const filebox = cfg.settings.filebox || {};
        for (const b of launcher.boxed || []) b.boxPath = remap('launcher', b.boxPath);
        for (const s of launcher.shortcuts || []) s.path = remap('launcher', s.path);
        for (const i of filebox.items || []) {
          i.boxPath = remap('filebox', i.boxPath);
          if (i.path) i.path = remap('filebox', i.path);
        }
        if (changed) {
          fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
          summary.configRewritten = true;
          summary.actions.push('更新了收纳文件的新位置记录');
          log.log('[repair] config 收纳路径已重写到应用根目录收纳文件夹');
        }
      }
    } catch (err) {
      log.error('[repair] config 收纳路径重写失败:', err && err.message);
    }

    // ---------- 清单引用表（重写后的 config）：basename → boxPath ----------
    const cfgNow = readJson(cfgPath) || {};
    const launcher = (cfgNow.settings || {}).launcher || {};
    const filebox = (cfgNow.settings || {}).filebox || {};
    const referencedByBase = new Map();
    const referencedAll = new Set();
    for (const p of [
      ...(launcher.boxed || []).map((b) => b.boxPath),
      ...(filebox.items || []).map((i) => i.boxPath),
    ]) {
      if (!p) continue;
      referencedAll.add(p);
      referencedByBase.set(path.basename(p), p);
    }

    // ---------- 4) 桌面救援文件夹内容精确归位 ----------
    // 出现 = 卸载器抢救过（真卸载或历史版本升级清场）。
    //  - 清单引用中：收纳文件夹缺这份文件 → 移回；已有 → 同一来源副本去重；
    //    内容不一致才落桌面根目录兜底（绝不覆盖任何一侧）。
    //  - 清单未引用 → 移回桌面根目录；桌面已有同名且更新的文件视为有效现行
    //    版本，跳过救援副本（如安装器重建的 壁纸工坊.lnk）。
    let rescueLeftover = false;
    let names = [];
    try { names = fs.readdirSync(desktopDir).filter((n) => n.startsWith(RESCUE_PREFIX) && n.includes('(卸载恢复)')); } catch (_) {}
    for (const name of names) {
      const dir = path.join(desktopDir, name);
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
      let moved = 0;
      for (const e of entries) {
        if (isJunk(e.name)) continue;
        const src = path.join(dir, e.name);
        const boxPath = referencedByBase.get(e.name);
        if (boxPath) {
          if (!fs.existsSync(boxPath)) {
            try { fs.mkdirSync(path.dirname(boxPath), { recursive: true }); } catch (_) {}
            if (moveFile(src, boxPath)) { summary.toBoxRescued++; moved++; continue; }
            log.warn(`[repair] 回收纳文件夹失败（保留原处）: ${src}`);
            rescueLeftover = true;
            continue;
          }
          if (sameFile(src, boxPath)) {
            if (removePath(src)) { summary.deduped++; continue; }
            rescueLeftover = true;
            continue;
          }
          log.warn(`[repair] 救援副本与收纳文件夹现内容不一致，转存桌面: ${e.name}`);
        }
        const dst0 = path.join(desktopDir, e.name);
        if (fs.existsSync(dst0)) {
          try {
            if (fs.statSync(dst0).mtimeMs > fs.statSync(src).mtimeMs) { summary.skippedStale++; continue; }
          } catch (_) { /* 比较失败按常规冲突处理，走退让命名 */ }
        }
        const dst = collisionFree(dst0);
        if (!dst) { rescueLeftover = true; continue; }
        if (moveFile(src, dst)) moved++;
        else rescueLeftover = true;
      }
      summary.desktopRescued += moved;
      if (moved) summary.actions.push(`从桌面「${name}」归位了 ${moved} 个文件`);
      // 内容清空后删除救援文件夹；仍有残留（锁定文件）则保留，下次启动重试
      try {
        if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
        else rescueLeftover = true;
      } catch (_) { rescueLeftover = true; }
      if (moved) log.log(`[repair] 已把 ${moved} 个文件从「${name}」归位`);
    }

    // ---------- 5) 收纳文件夹孤儿文件直接还原到桌面根目录 ----------
    // 清单未引用的保管文件 = 清单曾丢失的孤儿。逐文件判断而非"清单为空才动"，
    // 部分损坏（清单里有幽灵项）时也能找回其余孤儿。
    try {
      for (const boxDir of Object.values(newBoxDirs)) {
        let entries = [];
        try { entries = fs.readdirSync(boxDir, { withFileTypes: true }); } catch (_) { continue; }
        let moved = 0;
        for (const e of entries) {
          if (!e.isFile()) continue;
          if (BOX_ADMIN_FILES.has(e.name) || isJunk(e.name)) continue;
          const src = path.join(boxDir, e.name);
          if (referencedAll.has(src)) continue; // 清单仍在管 → 属正常收纳内容
          const dst = collisionFree(path.join(desktopDir, e.name));
          if (!dst) continue;
          if (moveFile(src, dst)) { moved++; summary.orphansRestored++; }
        }
        if (moved) {
          summary.actions.push(`把收纳文件夹 ${path.basename(boxDir)} 中 ${moved} 个失联文件恢复到了桌面`);
          log.log(`[repair] 收纳文件夹 ${path.basename(boxDir)} 有 ${moved} 个清单失联文件，已恢复到桌面`);
        }
      }
    } catch (err) {
      log.error('[repair] 孤儿保管文件还原失败:', err && err.message);
    }

    // ---------- 6) 收纳镜像双向对齐（双保险） ----------
    // 主存储与 %APPDATA%\壁纸工坊\收纳备份 互为备份：主缺从镜像恢复、主有刷新
    // 镜像、镜像残余清理。此后每次收纳/恢复/移除由宿主 applyPatch 防抖再同步。
    try {
      const m = syncBoxMirror(app, log);
      if (m.recovered) summary.actions.push(`从镜像备份恢复了 ${m.recovered} 个收纳文件`);
    } catch (err) {
      log.error('[repair] 收纳镜像同步失败:', err && err.message);
    }

    // ---------- 7) 备份清理 ----------
    // 配置健康即代表当前数据完整，预备份已完成使命。留着会在下次升级被
    // customInit 覆盖刷新，但期间若 config 再损坏可能被陈旧备份误导，故即用即删。
    if (cfgHealthy() && !rescueLeftover && fs.existsSync(backupDir)) {
      try { fs.rmSync(backupDir, { recursive: true, force: true }); } catch (_) {}
    }

    if (summary.backupRestored || summary.migratedBoxes || summary.configRewritten || summary.desktopRescued || summary.toBoxRescued || summary.deduped || summary.orphansRestored || summary.skippedStale) {
      log.log(`[repair] 数据自愈完成: ${JSON.stringify(summary)}`);
    }
  } catch (err) {
    log.error('[repair] 数据自愈异常（不影响应用启动）:', err && (err.stack || err.message));
  }
  return summary;
}

module.exports = { repairUserData };
