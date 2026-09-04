# 使用说明模板（阶段 7 输出用）

> 将 `vX.Y.Z` 替换为本次实际版本号，链接替换为本次实际地址。

## 一、内部使用方法（开发者 / 维护者）

### 1. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```

### 2. 如何再次执行"发布/部署"流程
- 在对话中直接说："发布壁纸工坊新版本" / "更新官网并部署" / "打 tag 出安装包" 等，
  会触发 `wallpaper-release` 技能，按阶段 0→7 引导完成。
- 仅想备份当前改动：`git add <文件> && git commit -m "..." && git push origin main`

### 3. 关键路径
- 应用入口：`main.js`、各 `preload-*.js`、`src/`、`renderer/`
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）

### 4. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d vX.Y.Z
git push origin :refs/tags/vX.Y.Z
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（vX.Y.Z，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-X.Y.Z.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 常见问题
- **下载慢**：优先用上方国内加速①/②；或改用官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择"仍要运行"或加入白名单；后续可签名解决。
- **壁纸不显示**：确认已 `npm run get-mpv` 对应的播放内核；检查显卡驱动与多显示器设置。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总（发版后填写）
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/vX.Y.Z
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe
