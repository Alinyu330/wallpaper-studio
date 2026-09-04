# 壁纸工坊 Wallpaper Studio · v1.8.0 发布与使用说明

> 新功能版本（2026-09-04）。本文件由 `wallpaper-release` 技能在发版后产出。
> 状态：**GitHub Release（CI 构建中）+ GitHub Pages（CI 部署中）+ CloudFlare Pages 已上线 ✅**

## 一、本次变更（v1.8.0）

- **新增 桌面文件收纳区**：桌面上的普通文件（办公文档 / 媒体 / 归档）与文件夹收纳进独立浮层，与快捷方式转盘职责分离。文件夹 / 文件自动分组排列（支持按名称 / 修改时间 / 手动排序），网格列数与面板透明度可调；鼠标靠近正常显示、离开自动转半透明毛玻璃，与壁纸协调。
- **收纳范围收敛**：快捷方式转盘专注收纳快捷方式（.lnk/.url）、程序文件（.exe/.bat/.cmd）与系统项（控制面板 / 回收站 / 网络 / 此电脑）。
- **真实图标**：文件收纳区与转盘图标均取系统真实图标（Win32 SHGetFileInfoW），无空白占位。
- **自由摆放**：文件收纳区支持「调整模式」自由拖动定位 + 九宫格快速吸附。
- **设置页新增**「文件收纳」独立导航页（启用 / 一键收纳 / 从文件添加 / 网格列数 / 分类排列 / 透明度调节 / 已收纳列表 / 一键恢复）。
- 涉及：`src/filebox.js`（新增宿主）、`renderer/filebox.html`（新增渲染层）、`preload-filebox.js`（新增桥接）、`src/launcher.js`、`src/store.js`、`main.js`、`preload-main.js`、`renderer/index.html`、`renderer/js/app.js`、`package.json`。
- 提交：`c6ad600`（feat）+ `aa72c91`（release），tag `v1.8.0`。

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
- 仅备份当前改动：`git add <文件> && git commit -m "..." && git push origin main`
- **推送凭据（本机实测有效）**：本机 `.gitconfig` 中 `credential.helperselector.selected = <no helper>`，默认 `git push` 会报 `could not read Username`。已缓存的 GitHub 凭据在 git-credential-manager 里，推送时显式指定 helper：
  ```bash
  git -c credential.helper="!git-credential-manager" push origin main --tags
  ```
  推送 tag 会同时触发 `release.yml`（GitHub Release）与 `pages.yml`（GitHub Pages）。

### 3. 关键路径
- 应用入口：`main.js`、各 `preload-*.js`、`src/`、`renderer/`
- 文件收纳区：`src/filebox.js`（宿主）、`renderer/filebox.html`（浮层）、`preload-filebox.js`
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）
- 发布技能：`.workbuddy/skills/wallpaper-release/`（SKILL.md + scripts + references）

### 4. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.8.0
git push origin :refs/tags/v1.8.0
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 三、外部使用方法（最终用户）

### 1. 下载安装包（v1.8.0，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.0/WallpaperStudio-Setup-1.8.0.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.0/WallpaperStudio-Setup-1.8.0.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.8.0.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 新功能速览（v1.8.0）
- 桌面「文件收纳区」：把桌面上的文件与文件夹收进独立浮层（设置页 → 文件收纳 → 启用），文件夹 / 文件自动分组、支持排序与自定义网格；鼠标靠近显示、离开变半透明毛玻璃。
- 快捷方式转盘专注收纳快捷方式与程序文件（.exe），点击即启动对应 App。
- 常用问题：**收纳的文件去哪了？** 收纳 = 移动到应用数据目录保管（桌面隐藏），从设置页移除该项或点「全部恢复到桌面」即可还原；文件夹仅登记、不移动内容。

### 5. 常见问题
- **下载慢**：优先用上方国内加速①/②；或改用官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择"仍要运行"或加入白名单。
- **壁纸不显示**：检查显卡驱动与多显示器设置；确认播放内核完整。
- **想要旧版本**：Releases 页面含全部历史版本。

---

## 四、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.8.0
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.0/WallpaperStudio-Setup-1.8.0.exe
