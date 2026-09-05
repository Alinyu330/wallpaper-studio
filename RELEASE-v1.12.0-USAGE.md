# 壁纸工坊 v1.12.0 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**更新数据三重保护 + 收纳存储可见文件夹 + 双保险镜像**

## 一、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 2. 收纳存储新架构（v1.12.0 起必读）
- **主存储**（收纳文件实际所在，默认为空、收纳时移入）：
  - 开发态：项目根 `D:\WallPaper\收纳快捷方式(卸载恢复)\`（转盘收纳）、`D:\WallPaper\收纳文件(卸载恢复)\`（文件收纳）
  - 安装态：安装目录同名文件夹（与 壁纸工坊.exe 同级），路径由 `src/app-root.js` 决定
- **备用存储（镜像）**：`%APPDATA%\壁纸工坊\收纳备份\<同名文件夹>\`，收纳/恢复/移除后 2s 防抖自动同步（`src/box-mirror.js`）
- **自愈**：每次启动 `src/repair.js` 双向核对——主缺从镜像恢复、主有刷新镜像、孤儿文件归位桌面、桌面「卸载恢复」救援夹内容精确归位
- **升级保护**（`build/installer.nsh`）：`customInit` 升级前把 config 与收纳内容备份到 `%APPDATA%\壁纸工坊-update-backup`；`--updated` 升级守卫使 v1.12.0+ 卸载器升级时不动任何用户数据；`customInstall` 装完即还原
- **注意**：两个收纳文件夹已 gitignore 且被打包白名单排除，本地测试收纳的个人文件**永不入库、永不进安装包**

### 3. 关键路径
- 应用入口：`main.js`、各 `preload-*.js`、`src/`、`renderer/`
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）

### 4. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.12.0
git push origin :refs/tags/v1.12.0
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.12.0，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装 / 升级步骤
1. 下载 `WallpaperStudio-Setup-1.12.0.exe`（约 280MB，内置全格式解码器）。
2. 已安装旧版：客户端「设置 → 检查更新」应用内一键更新，或直接运行新版安装包覆盖安装 — **本版起升级不再丢失任何数据**。
3. 此前版本升级时丢失的收纳文件：升级到本版后**首次启动会自动**从桌面「壁纸工坊-收纳*(卸载恢复)」文件夹找回并归位到桌面。
4. 右键托盘图标可暂停壁纸、打开主界面；收纳设置页可查看主存储 / 备用存储位置（点击直达）。

### 4. 常见问题
- **下载慢**：优先用上方国内加速①/②；或改用官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择"仍要运行"或加入白名单；后续可签名解决。
- **壁纸不显示**：检查显卡驱动与多显示器设置；engine.log（`%APPDATA%\壁纸工坊\engine.log`）记录了引擎现场。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.12.0
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe
- 国内加速直链：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe
