# RELEASE-v1.17.2-USAGE.md — v1.17.2 发布使用说明

> 发布日期：2026-09-06 ｜ 版本：v1.17.2（patch）｜ 主题：卸载后开机自启残留修复

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容
- **修复**：卸载客户端后重启电脑「客户端突然启动、壁纸还在播放」。根因是 Electron 在 Windows 上写开机自启（`setLoginItemSettings`）时，`HKCU\...\Run` 的登录项**值名是应用 ID（AppUserModelId）**——本应用打包版为 `com.alinyu.wallpaperstudio`（`main.js` 显式 `setAppUserModelId`），未设自定义 ID 的历史版本为 `electron.app.壁纸工坊`，开发态为 `electron.app.Electron`；而旧卸载器删除的是应用名「壁纸工坊 / wallpaper-studio」——从未命中真实登录项，卸载后自启项必然残留，重启即自启并恢复壁纸播放。
- **修复**：「设置里已关闭开机自启，重启后客户端仍自启」——`setLoginItemSettings` 只管理当前值名，历史版本写错值名的残留项关不掉。
- **修复实施（两侧冗余）**：
  - 卸载器 `build/installer.nsh`：按全部真实值名静态删除（`com.alinyu.wallpaperstudio` / `electron.app.壁纸工坊` / `壁纸工坊` / `wallpaper-studio`），再枚举 HKCU Run 兜底——凡值数据（exe 路径）以本次卸载的 `$INSTDIR` 开头一律删除（剥首引号、NSIS StrCmp 天然大小写不敏感、支持带引号/带参数形式）；`electron.app.Electron` 为通用开发态值名，绝不静态删除（避免误伤其他 Electron 项目）。
  - 应用 `main.js` 新增 `removeLegacyAutoStartEntries()`：按「值名属于历史变体 且 数据指向本 execPath」双条件清理（当前值名显式排除），在自启开关切换、启动自愈、每次启动时执行——覆盖 autoStart=false 但有残留的升级用户；数据精确匹配保证多安装环境互不误伤、现役项不受影响。
- **测试**：NSIS 编译通过（两次构建）；隔离模拟验证——把 `customUnInstall` 清理段逐行复制进独立 .nsi（`$INSTDIR` 指向模拟目录），用 electron-builder 缓存的 makensis 单编运行，注册表植入 7 个应删探针 + 对照组：第一轮抓出「首字符探针覆盖数据导致无引号路径漏删」的真实 bug，修复后第二轮 7 删全中、对照组（其他目录同名应用 / notepad / 第三方自启 / dev 残留项）全留；JS 匹配逻辑 harness TEST PASS；CDP 冒烟 16 项断言全 PASS（含主进程 engine.log 无错误，验证启动期新清理调用不破坏启动）。GUI 视觉验证不适用（无 UI 界面）。
- **机器现状清理**：开发机上 3 条残留自启项（`electron.app.壁纸工坊` → 已删测试目录、`com.alinyu.wallpaperstudio` → 正式安装但 autoStart=false 属陈旧、`electron.app.Electron` → dev 残留）已全部手动清除并核验。

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
- 应用入口：`main.js`（`applyAutoStartSetting` / `removeLegacyAutoStartEntries`）、各 `preload-*.js`、`src/`、`renderer/`
- 卸载清理：`build/installer.nsh`（`customUnInstall` 第 1) 段，头部注释含完整根因记录）
- 官网源：`docs/index.html`（+ `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库；正式包只由 tag 触发 CI 产出）

### 5. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.17.2
git push origin :refs/tags/v1.17.2
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.17.2，Windows x64）
- **GitHub 直连（Releases）**：https://github.com/Alinyu330/wallpaper-studio/releases
- **国内加速①（gh-proxy）**：
  https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.2/WallpaperStudio-Setup-1.17.2.exe
- **国内加速②（ghfast.top）**：
  https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.2/WallpaperStudio-Setup-1.17.2.exe

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/

### 3. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.17.2.exe`（约 280MB，内置全格式解码器 + 精选壁纸）。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 4. 常见问题
- **下载慢**：优先用上方国内加速①/②；或改用官网介绍页的"国内高速下载"按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择"仍要运行"或加入白名单；后续可签名解决。
- **卸载后重启客户端仍自启（v1.17.2 之前版本卸载）**：v1.17.1 及更早版本的卸载器不清理自启注册；升级到 v1.17.2 再卸载即可彻底清理，或在客户端「设置」里关闭开机自启后于系统「任务管理器 → 启动应用」手动禁用残留项。
- **壁纸不显示**：确认已 `npm run get-mpv` 对应的播放内核；检查显卡驱动与多显示器设置。
- **想要旧版本**：Releases 页面含全部历史版本，可直接下载对应 exe。

---

## 三、本次发布链接汇总
- Releases 页：https://github.com/Alinyu330/wallpaper-studio/releases/tag/v1.17.2
- GitHub Pages：https://alinyu330.github.io/wallpaper-studio/
- CloudFlare Pages：https://wallpaper-studio.pages.dev/
- 最新 exe 直链：https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.2/WallpaperStudio-Setup-1.17.2.exe
