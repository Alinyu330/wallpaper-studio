# 壁纸工坊 v1.15.0 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**快捷方式列表搜索栏 — 搜到即置顶到转盘最前**

## 一、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行
```
本机 `npm run build` / `npx electron` 会被系统拒绝（`spawn cmd.exe EACCES`），改用：
```bash
node node_modules/electron-builder/cli.js --win      # 出安装包
node node_modules/electron/cli.js <appDir>           # 跑指定目录的 electron 应用
```

### 2. 本版功能实现位置
- `renderer/index.html`：「快捷方式列表」卡片标题下新增 `.lc-toolbar`（复用 `.search-box` 样式的 `#lc-search-input` + `#lc-search-clear` + `#lc-search-hint`）
- `renderer/js/app.js`：
  - `lcQuery` 模块级搜索词状态
  - `lcSearchText(s)` — 匹配文本 = 显示名 + `path`/`originPath` 的文件名部分 + `sysId`（列表名是中文、目标是 `wemeetapp.exe` 这类也能搜到）
  - `renderLcList()` — 从 `renderLauncherSettings()` 拆出：过滤只影响显示，行上的 `i` 用 `all.indexOf(s)` 取**原始下标**（置顶会把条目挪到最前，用过滤后的下标点 ⭐ 会点到别的条目上）；命中数写进 `#lc-search-hint`，无命中给空态
  - `bindLauncherSettings()` — 输入即 `renderLcList()`（不重新拉配置），清空按钮复位搜索词并把焦点还给输入框
- `renderer/css/style.css`：`.lc-toolbar` / `.lc-search-clear` / `.lc-search-hint`，搜索框在该处放宽到 230px

### 3. 回归验证
`.cache/lc-search-e2e/app`（沙箱，真实 `preload-main.js` + 真实 `renderer/index.html` + 真实 `Store`，`launcher:set-pinned` 复刻 `src/launcher.js` 的 `setPinned` + `_orderPinned`）：
```bash
node node_modules/electron/cli.js .cache/lc-search-e2e/app     # 17 项断言 + 一张 shot.png
```
覆盖：默认全量、按显示名过滤、按目标 exe 文件名过滤（列表名是中文）、命中数提示、清空按钮显隐与复位、**过滤视图点末行 ⭐ 置顶的是看到的那条而非原列表同号条目**、置顶后仍留在命中结果并排到首位、无命中空态、系统项按 sysId 命中且无 ⭐。
另跑 `.cache/peek-e2e`（18 项，透视调参回归）与 `.cache/box-e2e`（59 项，收纳回归）确认无连带影响。

### 4. 回滚 / 补救
```bash
git tag -d v1.15.0
git push origin :refs/tags/v1.15.0
# 修复后重新打 tag 即重走 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.15.0，Windows x64，约 269.5 MB）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 使用说明
1. 已装 v1.14.0：客户端「设置 → 检查更新」应用内一键更新即可。
2. 「快捷方式 → 快捷方式列表」顶部输入关键词（中文名、英文显示名、目标 exe 名都行）→ 列表只剩命中的几条 → 点该行的 ⭐ 即设为常用、排到转盘最前；筛选保持不动，可连续把下一条也置顶；点 ✕ 恢复完整列表。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.15.0
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe
- 国内加速直链：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe
