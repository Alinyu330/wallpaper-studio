# 壁纸工坊 v1.13.0 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**收纳数据零丢失 + 空文件夹可收纳**

## 一、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行
```

### 2. 本版功能实现位置
- `src/box-rules.js`（新增）：两个收纳宿主共用的收纳判定 — 转盘范围（`.lnk/.url/.exe/.bat/.cmd`）、垃圾名（`._*` / `~$*`）、系统元数据（`desktop.ini` / `Thumbs.db`）、空目录判定
- `src/launcher.js`：`_commitAdds()` 收纳新增项按**当前最新配置**合并落库（替代批次快照整体覆盖写回）；`boxAll()` 外层连点屏障（复用进行中的同一批）；`_restoreOrphans()` 把保管目录里清单未引用的失联内容恢复到桌面
- `src/filebox.js`：`_commitItems()` 同上合并落库；`_boxAll()` 去掉扩展名白名单（任意文件可收）+ 空文件夹整体移入、非空文件夹仅登记；`_moveFile()` 支持目录；`_restoreAll()` 覆盖 folder 项与失联找回
- `src/box-mirror.js`：镜像同步支持目录条目（收纳的空文件夹双向对齐 / 清理）
- `src/repair.js`：第 3 步收纳路径归位泛化 — 旧 `%APPDATA%` 保管目录**及其它应用根目录下的同名收纳文件夹**一律改指当前主存储，实体仍在旧位置时一并搬回；第 5 步孤儿还原覆盖目录
- `renderer/index.html` / `renderer/js/app.js`：文件收纳页说明文案同步；「全部恢复到桌面」提示计入失联找回数

### 3. 回归验证
```bash
node node_modules/electron/cli.js .cache/box-e2e     # 沙箱收纳回归（临时桌面/userData，不碰真实桌面）
```
59 项断言全绿，覆盖：收纳范围、连点与绕过屏障的并发、全部恢复、失联找回、镜像双向、自愈归位与幂等、往返一致性。
对照实验（`git show HEAD:src/launcher.js` 跑同一并发场景）复现旧缺陷：`清单 0 条 / 保管目录 4 个文件`。

### 4. 回滚 / 补救
```bash
git tag -d v1.13.0
git push origin :refs/tags/v1.13.0
# 修复后重新打 tag 即重走 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.13.0，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 使用说明
1. 已装旧版：客户端「设置 → 检查更新」应用内一键更新即可，收纳内容与设置原样保留。
2. **历史上收纳后"列表变空、恢复不出来"的用户**：更新后打开「设置 → 快捷方式 / 文件收纳」，点「全部恢复到桌面」，滞留在收纳文件夹里的快捷方式与文件会当场回到桌面（提示会标注"含 N 个失联项"）。
3. 文件收纳区现在能收走桌面上任意类型的文件（含 0 字节空文件、无扩展名文件）；**空文件夹**会被整体收进收纳文件夹（图标消失，可恢复），有内容的文件夹仍只登记引用、不搬动。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.13.0
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe
- 国内加速直链：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe
