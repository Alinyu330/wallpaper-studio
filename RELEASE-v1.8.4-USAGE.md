# 壁纸工坊 v1.8.4 发布使用说明

> 发布日期：2026-09-04 · 版本：v1.8.4（patch）· 主题：修复主界面全区域点击无响应（每次启动必现）
> 发布状态：✅ 全部完成（源码提交 → CI Release 含安装包 + 中文说明 → 双官网部署验证命中）

---

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容
- **修复提交**：b67f619 `fix: 主界面全区域点击无响应——renderWidgetsSettings 引用未声明的 freePos`（renderer/js/app.js，+3）
- **发布提交**：46401e0 `release: v1.8.4 — 修复主界面全区域点击无响应`（package.json / README / docs）
- **tag**：`v1.8.4` → 触发 release.yml（构建 Release 安装包）+ pages.yml（GitHub Pages + CloudFlare Pages）
- **根因**：renderWidgetsSettings 渲染组件九宫格时引用未声明变量 `freePos`（isWidgetFree 帮手函数已存在但零调用），init 中断导致全部事件监听未绑定；自 v1.7.1（05dd779）引入，影响 v1.7.1~v1.8.3
- **定位方法**：CDP 远程调试（`electron --remote-debugging-port=9222 .` + tmp-tt/cdp-probe.cjs 探针）实测渲染层异常与真实鼠标点击

### 2. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/
npm start              # 开发运行（生产模式）
```

### 3. 本次修复自测方法
- **渲染层点击回归**：`./node_modules/.bin/electron --remote-debugging-port=9222 .` 启动后运行 `node tmp-tt/cdp-probe.cjs`（应 0 异常且 CLICK-OK）与 `node tmp-tt/cdp-sweep.cjs`（8 导航页 + 组件开关 + 九宫格按钮全部 PASS）。
- **安装版热修补**：本版为 unpack 目录（resources/app/ 非 asar），紧急时可直接用仓库 `renderer/js/app.js` 覆盖安装目录同名文件。

### 4. 如何再次执行"发布/部署"流程
- 在对话中说："发布壁纸工坊新版本" / "打 tag 出安装包"，触发 `wallpaper-release` 技能（阶段 0→7）。
- 本机 push 需显式凭据：`git -c credential.helper="!git-credential-manager" push origin main`
- 网络抖动期 push 偶发 SIGTERM/卡死：重试即可，前台易被超时打断时改用后台执行。

### 5. 关键路径
- 修复点：`renderer/js/app.js`（renderWidgetsSettings 内 `const freePos = isWidgetFree(item)`）
- 渲染层探针：`tmp-tt/cdp-probe.cjs`、`tmp-tt/cdp-sweep.cjs`（可复用为每次发版前的渲染层冒烟）
- 官网源：`docs/index.html`；CI：`.github/workflows/{release,pages}.yml`

### 6. 回滚 / 补救
```bash
git tag -d v1.8.4
git push origin :refs/tags/v1.8.4
# 并在 GitHub Releases 页面删除 v1.8.4 Release；修复后重新打 tag 触发 CI
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.8.4，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.4/WallpaperStudio-Setup-1.8.4.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.4/WallpaperStudio-Setup-1.8.4.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.8.4.exe`（约 200MB，内置全格式解码器）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 从旧版本升级（重要）
- **v1.7.1 ~ v1.8.3 用户**：这几个版本存在「窗口能打开但全部点击无反应」的问题，**直接下载 v1.8.4 覆盖安装即可恢复**（设置与壁纸自动保留，无需卸载）。
- 客户端内「设置 → 检查更新 → 立即更新」亦可一键升级（若界面已卡死无法点击，请用上方安装包覆盖安装）。

### 5. 常见问题
- **升级后仍卡死**：先完全退出客户端（托盘右键退出）再重新启动；仍异常则卸载后重装 v1.8.4（v1.8.3 起卸载可彻底清干净）。
- **下载慢**：优先用国内加速①/②，或官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选"仍要运行"或加入白名单。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.8.4
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.4/WallpaperStudio-Setup-1.8.4.exe
