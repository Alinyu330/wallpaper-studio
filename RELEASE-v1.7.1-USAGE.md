# 壁纸工坊 Wallpaper Studio · v1.7.1 发布与使用说明

> 维护版本（2026-09-04）。本文件由 `wallpaper-release` 技能在发版后产出。
> 状态：**GitHub Release + GitHub Pages 已完成（CI 收尾中）；CloudFlare Pages 待部署（需要 CloudFlare API Token）。**

## 一、本次变更（v1.7.1）
- **修复**：调节转盘数量后，已手动拖动的「自由位置」会被清空并弹回默认位置（涉及 `main.js` / `src/launcher.js` / `src/store.js` / `src/widgets-host.js`）。
- 官网「最新」块补充了上述修复说明；版本号同步至 1.7.1（`package.json` / `README.md` / `docs/index.html`）。

---

## 二、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 2. 如何再次执行「发布 / 部署」流程
- 在对话里说：「发布壁纸工坊新版本」「更新官网并部署」「打 tag 出安装包」等，会触发 `wallpaper-release` 技能，按阶段 0→7 引导。
- 仅备份当前改动：`git add <文件> && git commit -m "..." && git push origin main --tags`
- 推送注意（本机环境）：若 `git push` 卡在凭据弹窗，用
  `GIT_TERMINAL_PROMPT=0 git -c http.schannelCheckRevoke=false push origin main --tags`
  （依赖 Windows 凭据管理器里已缓存的 GitHub 凭据；本环境有一层 `BeyondDimension/SteamTools` 拦截代理，需关掉吊销检查才能握手）。

### 3. 关键路径
- 应用入口：`main.js`、`src/`、`renderer/`
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）

### 4. 回滚 / 补救
```bash
git tag -d v1.7.1
git push origin :refs/tags/v1.7.1
# 再到 GitHub Releases 页面删除对应 Release；修复后重新打 tag 即可重跑 CI
```

---

## 三、外部使用方法（最终用户）

### 1. 下载安装包（v1.7.1，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.7.1
- **最新 exe 直链**：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe
- **国内加速①（gh-proxy）**：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe
- **国内加速②（ghfast.top）**：https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe

### 2. 官网介绍页
- **GitHub Pages（已部署）**：https://alinyu330.github.io/wallpaper-studio/
- **CloudFlare Pages（待部署）**：https://wallpaper-studio.pages.dev/  ← 需 CloudFlare API Token
- 两站内容同源（`docs/`），一致。

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.7.1.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 常见问题
- **下载慢**：优先用上方国内加速①/②；或官网「国内高速下载」按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选「仍要运行」或加入白名单；后续可签名解决。
- **壁纸不显示**：确认 mpv 内核已就位；检查显卡驱动与多显示器设置。
- **想要旧版本**：Releases 页含全部历史版本，可直接下载对应 exe。

---

## 四、本次发布链接汇总
- Releases 页（已发布）：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.7.1
- exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe
- GitHub Pages（已部署）：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages（待部署）：https://wallpaper-studio.pages.dev/

## 五、CloudFlare Pages 部署（待办）
本环境无任何 CloudFlare 凭证（无 env token、无 `~/.wrangler` 缓存、无 Windows 凭据）。需二选一：
- **方式 A（给我 token）**：提供 `Cloudflare Pages: Edit` 权限、scope 限定到 `wallpaper-studio` 的 API Token。我会内联执行：
  `CLOUDFLARE_API_TOKEN=<token> npx wrangler pages deploy docs --project-name wallpaper-studio`
  （经拦截代理时，必要时临时加 `NODE_TLS_REJECT_UNAUTHORIZED=0` 仅本条命令）。
- **方式 B（你自己跑）**：在本机执行上面那条 `wrangler` 命令即可，`docs/` 已就绪。
