# RELEASE-v1.17.1-USAGE.md — v1.17.1 发布使用说明

> 发布日期：2026-09-06 ｜ 版本：v1.17.1（patch）｜ 主题：透视调参恢复恒定 1.5 秒

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容
- **修复**：移除「保持透视」开关（`tunePeek.locked`）—— 它是「调参淡出后不能在 1.5 秒恢复 / 过好久才恢复 / 永久卡透明」的唯一根因：
  - v1.16.0 及以前：开启后完全没有自动复原路径，窗口永久透明且开关自身看不清点不回；
  - v1.17.0：空闲 30 秒兜底，但依旧违背「停止操作 1.5 秒复原」承诺；
  - v1.17.1：开关移除，恢复恒定 1.5 秒（`peekArm` 恒用 `PEEK_IDLE_MS`）；旧配置残留 `locked` 读取时自动丢弃；Esc 逃生门条件放宽为 `pulsing || holders.size > 0 || applied < 1`。
- **测试**：本地构建通过 + CDP 冒烟 22 项断言全 PASS（含五面板调参、强度滑杆、调整模式 holders、locked 残留回归、Esc；恢复耗时实测 1500~1606ms）+ GUI 视觉验证（OS 级截图确认真实淡出与复原）。

### 2. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 3. 如何再次执行"发布/部署"流程
- 在对话中直接说："发布壁纸工坊新版本" / "更新官网并部署" / "打 tag 出安装包" 等，
  会触发 `wallpaper-release` 技能，按阶段 0→7 引导完成。
- 仅想备份当前改动：`git add <文件> && git commit -m "..." && git push origin main`

### 4. 关键路径
- 应用入口：`main.js`、各 `preload-*.js`、`src/`、`renderer/`
- 透视模块：`renderer/js/app.js`（`// ---------- 透视调参 ----------`）、`renderer/index.html` 透视调参卡片、`src/store.js` `tunePeek` 默认值与迁移
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库；正式包只由 tag 触发 CI 产出）

### 5. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.17.1
git push origin :refs/tags/v1.17.1
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.17.1，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.17.1.exe`（约 280MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 常见问题
- **下载慢**：优先用上方国内加速①/②；或改用官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择"仍要运行"或加入白名单；后续可签名解决。
- **调参时窗口变透明不回来了**：升级到 v1.17.1 后该问题已根除（停止操作 1.5 秒自动复原）；当前窗口若仍透明，按 **Esc** 立即恢复，或重启客户端。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.17.1
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe
