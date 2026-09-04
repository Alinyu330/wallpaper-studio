# 壁纸工坊 v1.8.2 发布使用说明

> 发布日期：2026-09-04 · 版本：v1.8.2（patch）· 主题：卸载修复：Job Object 孤儿守卫，卸载可完整删除
> 发布状态：✅ 全部完成（源码提交 → 双官网部署 → GitHub Release 含安装包 + 中文说明）

---

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容
- **源码提交**：11dc1b2 `fix: 卸载时文件删不掉——Job Object 孤儿守卫自动清场引擎子进程`（5 文件，+114）
- **发布提交**：`release: v1.8.2 — 修复卸载时文件删不掉（引擎子进程防孤儿）`（package.json / README / docs）
- **tag**：`v1.8.2` → 触发 release.yml（构建 Release 安装包）+ pages.yml（GitHub Pages）
- **改动文件**：src/job-guard.js（新增）、src/mpv.js、src/exe-wallpaper.js、main.js + 文档

### 2. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 3. 本次修复自测方法
- **机制验证**（无需界面）：node 脚本 spawn 长跑子进程 → `guardChild` 纳入守卫 →
  关闭 Job 句柄（等价主进程退出）→ 子进程应被系统自动结束。
- **整机验证**（模拟卸载强杀）：启动应用播放视频壁纸 → 确认 mpv 进程存在 →
  `taskkill /F /IM electron.exe` 强杀主进程 → 3 秒后 mpv 进程数应为 0（修复前会残留）。
- **真实卸载验证**：装 v1.8.2 安装包 → 播放视频壁纸状态下直接运行卸载程序 →
  应能完整删除安装目录（重点看 assets/mpv/ 是否删净）。

### 4. 如何再次执行"发布/部署"流程
- 在对话中说："发布壁纸工坊新版本" / "打 tag 出安装包"，触发 `wallpaper-release` 技能（阶段 0→7）。
- 仅备份：`git add <files> && git commit -m "..." && git push origin main`
  （本机 push 需显式凭据：`git -c credential.helper="!git-credential-manager" push origin main`）

### 5. 关键路径
- 卸载防锁：`src/job-guard.js`（Job Object 孤儿守卫）、`src/mpv.js` / `src/exe-wallpaper.js`（接入点）
- 更新模块：`src/updater.js`、`main.js`（update:* IPC）；官网源：`docs/index.html`
- 构建配置：`package.json`（build 段）；CI：`.github/workflows/{release,pages}.yml`
- 安装包产物：`dist/`（CI 生成，不入库；本地构建仅验证）

### 6. 回滚 / 补救
```bash
git tag -d v1.8.2
git push origin :refs/tags/v1.8.2
# 并在 GitHub Releases 页面删除 v1.8.2 Release；修复后重新打 tag 触发 CI
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.8.2，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.2/WallpaperStudio-Setup-1.8.2.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.2/WallpaperStudio-Setup-1.8.2.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.8.2.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 从旧版本升级
- v1.8.1 及更早版本：手动下载上方安装包直接覆盖安装（设置与壁纸自动保留）；
  或打开客户端「设置 → 版本与更新 → 检查更新 → 立即更新」在应用内一键升级。
- 本次为稳定性修复：修复卸载时文件删不掉（引擎子进程 Job Object 防孤儿），功能与 v1.8.1 一致。

### 5. 常见问题
- **下载慢**：优先用国内加速①/②，或官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选"仍要运行"或加入白名单。
- **卸载仍失败**：先右键托盘图标退出客户端再卸载；若曾用任务管理器强杀过，重启一次系统确保无残留进程后再卸载。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.8.2
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.2/WallpaperStudio-Setup-1.8.2.exe
