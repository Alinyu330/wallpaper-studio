# 壁纸工坊 v1.14.0 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**透视调参 — 调参数时客户端自动变透明**

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
- `src/store.js`：`settings.tunePeek = { enabled, opacity, locked }`（默认开、强度 30、不锁定），`_load()` 内与新默认值深合并，老配置升级不丢项
- `main.js`：`ipcMain.on('win:set-opacity')` → `mainWindow.setOpacity()`（Windows 走分层窗口，淡到 0.1 仍可正常点击）
- `preload-main.js`：`setWindowOpacity(v)` 暴露给渲染层
- `renderer/js/app.js`：透视状态机 `peek` + `peekSync`（按最终下发的不透明度去重，所以拖强度滑杆能实时看到变化）、`peekPulse`（一次调参 → 淡出，空闲 1.5s 恢复；锁定时不排恢复计时器）、`peekHold`（桌面拖动调整模式按名字持有，全部释放才恢复）、`bindPeek`（设置页三项控件 + document 捕获阶段事件委托）
- 触发判定：作用域 `.settings-card, #params-panel`；`input/change` 命中 range/number/checkbox，`click` 命中 `.preset-chip / .seg button / .pos-cell`。总开关与锁定开关本身排除（否则刚打开透视窗口就闪没）
- `renderer/index.html`：设置页新增「透视调参」卡片（开关 + 强度滑杆 10~70 + 保持透视锁定）

### 3. 回归验证
`.cache/peek-e2e/app`（沙箱，不碰真实桌面与壁纸）— 真实 `preload-main.js` + 真实 `renderer/index.html` + 真实 `Store`，在渲染进程派发 input/change/click 事件走同一条委托路径，断言主进程 `win.getOpacity()`：
```bash
node node_modules/electron/cli.js .cache/peek-e2e/app     # 18 项断言，当前全绿
```
覆盖：组件滑杆、壁纸参数面板、预设 chip、强度实时改幅度与落库、普通按钮不误触发、转盘/组件调整模式全程保持、锁定不复原、解除锁定即复原、总开关关闭/重开。

### 4. 回滚 / 补救
```bash
git tag -d v1.14.0
git push origin :refs/tags/v1.14.0
# 修复后重新打 tag 即重走 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.14.0，Windows x64，约 269.5 MB）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 使用说明
1. 已装 v1.13.0：客户端「设置 → 检查更新」应用内一键更新即可。
2. 调节壁纸、桌面组件、音律动效、快捷方式转盘、文件收纳的位置或参数时，客户端会自动变透明，看到桌面上的真实效果；停手 1.5 秒自动恢复。
3. 「设置 → 透视调参」可改透视强度（10~70，越小越透）、打开「保持透视」（调完不复原，方便反复对比），或直接关闭该功能。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.14.0
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe
- 国内加速直链：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe
