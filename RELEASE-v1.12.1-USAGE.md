# 壁纸工坊 v1.12.1 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**转盘拖动条三连击回到最前方**

## 一、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行
```

### 2. 本版功能实现位置
- `renderer/launcher.html`：`bindRotate(el, isBar)` 三连击检测（700ms 窗口）+ `snapTo(target, dur)` 就近回绕动画；仅作用于 `#dragbar`，图标条单击启动行为不受影响
- 交互细节：三连击目标 = `round(head / N) * N`（最短路径回绕到条目 0），单击保持原「就近吸附」

### 3. 回滚 / 补救
```bash
git tag -d v1.12.1
git push origin :refs/tags/v1.12.1
# 修复后重新打 tag 即重走 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.12.1，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 使用说明
1. 已装 v1.12.0：客户端「设置 → 检查更新」应用内一键更新即可。
2. 快捷方式转盘的拖动旋转条：**按住拖动**照常轮换；**700ms 内连点三次**，转盘平滑回到最前方（第一个图标）；单击仍是就近吸附。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.12.1
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe
- 国内加速直链：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe
