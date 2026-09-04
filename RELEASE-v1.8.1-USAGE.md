# 壁纸工坊 v1.8.1 发布使用说明

> 发布日期：2026-09-04 · 版本：v1.8.1（patch）· 主题：检查更新改造——新版本功能介绍弹窗 + 应用内直接更新安装
> 发布状态：✅ 全部完成（源码提交 → 双官网部署 → GitHub Release 含安装包 + 中文说明）

---

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容
- **源码提交**：8f3d1e0 `feat: 检查更新改造——新版本功能介绍弹窗与应用内直接安装`（8 文件，+583/-23）
- **发布提交**：`release: v1.8.1 — 应用内一键更新，免跳网页安装`（package.json / README / docs）
- **tag**：`v1.8.1` → 触发 release.yml（构建 Release 安装包）+ pages.yml（GitHub Pages）
- **改动文件**：src/updater.js、main.js、preload-main.js、renderer/index.html、renderer/js/app.js、renderer/css/style.css + 文档

### 2. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 3. 更新功能自测方法
- 当前线上最新即为 v1.8.1 时，客户端检查更新会显示"已是最新"，弹窗不会出现——属正常。
- 测试弹窗+安装流程：把 package.json 版本临时改小（如 1.8.0）后 `npm start`，
  设置页点「检查更新」→ 应弹出 v1.8.1 功能介绍窗口 → 点「立即更新」观察下载进度，
  下载中点「取消下载」验证可中断；完整走完则会静默安装正式版并退出。
  ⚠ 测试会真实覆盖安装正式版到本机，测前知悉。

### 4. 如何再次执行"发布/部署"流程
- 在对话中说："发布壁纸工坊新版本" / "打 tag 出安装包"，触发 `wallpaper-release` 技能（阶段 0→7）。
- 仅备份：`git add <files> && git commit -m "..." && git push origin main`
  （本机 push 需显式凭据：`git -c credential.helper="!git-credential-manager" push origin main`）

### 5. 关键路径
- 更新模块：`src/updater.js`（检查/下载/静默安装）、`main.js`（update:* IPC）
- 弹窗 UI：`renderer/index.html`（#modal-update）、`renderer/js/app.js`（showUpdateModal 等）
- 官网源：`docs/index.html`；构建配置：`package.json`（build 段）；CI：`.github/workflows/{release,pages}.yml`
- 安装包产物：`dist/`（CI 生成，不入库；本地构建仅验证）

### 6. 回滚 / 补救
```bash
git tag -d v1.8.1
git push origin :refs/tags/v1.8.1
# 并在 GitHub Releases 页面删除 v1.8.1 Release；修复后重新打 tag 触发 CI
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.8.1，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.1/WallpaperStudio-Setup-1.8.1.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.1/WallpaperStudio-Setup-1.8.1.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.8.1.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 从旧版本升级（本次新体验）
- v1.8.0 及更早版本：手动下载上方安装包，直接覆盖安装（设置与壁纸自动保留）。
- 装上 v1.8.1 后，以后出新版本：客户端「设置 → 版本与更新 → 检查更新」，
  弹出新版功能介绍窗口后点「立即更新」，下载安装全自动，不再需要去网页下载。

### 5. 常见问题
- **下载慢**：优先用国内加速①/②，或官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选"仍要运行"或加入白名单。
- **检查更新失败**：多为网络/代理问题，稍后手动重试；不影响现有功能使用。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.8.1
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.1/WallpaperStudio-Setup-1.8.1.exe
