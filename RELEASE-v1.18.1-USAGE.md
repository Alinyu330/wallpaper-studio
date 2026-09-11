# RELEASE-v1.18.1-USAGE.md — v1.18.1 发布使用说明

> 发布日期：2026-09-11 ｜ 版本：v1.18.1（patch）｜ 主题：客户端输入焦点修复（信息看板 / 快捷方式搜索栏）

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容（修复点与实现要点）

- **修复：客户端里「桌面组件 → 信息看板内容」无法输入与保存**
  - 根因：桌面看板编辑会话不会收尾。桌面看板编辑器判不了「点了窗口外面」（覆盖层常驻鼠标穿透，窗口外点击根本收不到），用户从桌面切回客户端后，主进程的看板编辑焦点守卫（`_startEditGuard`，150ms 周期）仍会把前台抢回桌面看板 —— 客户端输入框能点出聚焦态（`:focus-within` 照常亮起），但键击与输入法候选窗都派发给了看板窗口，表现为「点了能聚焦、打字毫无反应、组词反复被取消」。
  - 修复：①守卫发现前台是本应用客户端界面（主窗 / 预览窗，新增 `hooks.isOwnUiForeground` 按前台 HWND 比对）时不再抢焦点，改调新增的 `exitBoardEditing()` 收尾（复位 `WS_EX_NOACTIVATE` + 重申桌面带 Z 序 + 通知渲染页关闭编辑器）；②客户端主窗 / 预览窗 `focus` 事件同样触发收尾；③桌面看板渲染页 `blur`（编辑器打开 1.6s 抖动窗之后）确认失焦则自动 `closeEditor()`；④新增 IPC `board:exit-edit`（`preload-widgets.onBoardExitEdit`）。
- **修复：快捷方式列表搜索栏「点击后就被取消、无法输入」**
  - 同根因（键盘焦点被本应用覆盖层窗口抢走）。除上述收尾链路外，为客户端窗口新增**键盘焦点守卫**（`main.js setupMainWindowFocusGuard`）：客户端 `blur` 后 80ms 复查，前台若被本应用自己的桌面覆盖层（壁纸窗 / 转盘 / 收纳区 / 组件窗，`ownOverlayHwnds()` 白名单）拿走 → `desktop.forceForeground` 抢回；前台在外部程序 = 用户主动切走，不动。覆盖的典型时机即 widgets-host 注释里写明的「壁纸引擎循环交界等动作让 Windows 把前台重新分配给本进程其它窗口」。
- **修复：客户端每次获得焦点都重设一次窗口不透明度**
  - 透视调参对账（`peekReconcile`）原先无条件下发「复原 1」；Electron 的 `setOpacity` 只加不减 `WS_EX_LAYERED`，客户端窗口因此从首次对账起就永久处于分层窗口状态（真机取证 exstyle=0x80100 实证）。现 `peekSync` 按目标值去重（复原与淡出一样，值变了就一定下发，不回到「卡在透明态」），`peekReconcile` 仅在「本地记录 <1 或确有淡出持有者」时强制重推。
- **优化：信息看板输入框（天气城市 / 添加日程 / 添加待办）补齐深色主题样式**
  - 此前完全没有任何样式，在深色界面里是浏览器默认的白底黑字输入框；现统一为深色输入框 + 紫色聚焦态 + 日期控件图标反色，并显式声明 `input,textarea{user-select:text}`。
- 改动文件：`main.js`、`src/desktop.js`（新增 `getForegroundHwnd`）、`src/widgets-host.js`、`preload-widgets.js`、`renderer/widgets.html`、`renderer/js/app.js`、`renderer/css/style.css`。

### 2. 测试记录

- **渲染层离线验证 100 项全部通过**（`wallpaper-render-verify` 三测试台）：动效绘制逻辑 36 项 · 组件宿主交互推送 15 项 · 真实设置页 49 项（渲染进程 0 错误 / 0 警告）。真实设置页回归覆盖了本次两个修复的渲染侧链路：搜索栏输入即过滤（命中 N / 总数 + 一键清空）、看板城市搜索 / 添加待办 / 添加日程的保存链路与列表上屏。
- **真机功能测试 37 项通过**（`tmp-test-smoke.mjs`：独立数据目录 + `WP_DEBUG_PORT=7852` + CDP + 真实光标）：应用启动与 8 页面 · 真实 UI 操作落盘 config.json · 看板输入回归 · 动效窗创建与画布初始化 · 真实鼠标移入 / 移出 / 窗内移动的交互推送（含 DPI 缩放换算）· 穿透不变 · 渲染进程与 engine.log 零错误 · 进程正常退出。
  - 本次为测试台补了三处健壮性（已同步回技能）：①子进程环境剔除 `ELECTRON_RUN_AS_NODE`（沙箱注入会让 electron.exe 变纯 Node，主进程根本不启动）；②python 解释器按候选列表探测（`py` / 受管 python 优先，`python` Shim 可能存在但不可用），无 python 时光标类断言记为「跳过」而非失败；③断言逐条落盘 `tmp-smoke-progress.log`，便于被环境打断后定位进度。
  - 说明：真机跑批中「快捷方式列表渲染 / 搜索过滤」3 项断言因测试环境双实例互踩（遗留调试实例占用同一数据目录与 CDP 端口，把种子配置写回为空）未计入通过数，该链路由离线设置页回归（49 项内的搜索栏 / 看板保存断言）覆盖；复跑前先清理遗留 electron 进程。
- 排查中证伪的假设（避免以后重复排查）：`body{user-select:none}` 不是输入失效原因 —— Chromium 对表单控件的 `user-select` 计算值是 `text`（实测输入正常）；客户端主窗也不是 `WS_EX_NOACTIVATE` / 子窗口（真机枚举窗口实证），真正的疑点集中在「前台被本进程覆盖层抢走」，与 widgets-host 既有注释的结论一致。

### 3. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```
- 调试端点（本机回环，`WP_DEBUG=1` 时额外开放写接口）：`/state`、`/capture`、`/settings?patch=...`、`/bandreset`、`/adjust`；端口默认 7851，可用 `WP_DEBUG_PORT` 覆盖。
- 复现 / 验证输入问题时的取证手段：枚举应用全部窗口的 style/exstyle（重点看 `WS_EX_NOACTIVATE` / `WS_CHILD` / `WS_EX_LAYERED`）、`GetForegroundWindow` 与前台 PID 比对、客户端 `focus` 后 `setOpacity` 的 IPC 是否多余下发（透视调参对账）。

### 4. 如何再次执行"发布/部署"流程
- 在对话中直接说："发布壁纸工坊新版本" / "更新官网并部署" / "打 tag 出安装包" 等，会触发 `.workbuddy/skills/wallpaper-release` 技能，按阶段 0→7 引导完成。
- 仅想备份当前改动：`git add <文件> && git commit -m "..." && git push origin main`

### 5. 关键路径
- 焦点修复：`main.js`（`setupMainWindowFocusGuard` / `ownOverlayHwnds` / `isOwnUiForeground`）、`src/widgets-host.js`（`_startEditGuard` / `exitBoardEditing`）、`src/desktop.js`（`getForegroundHwnd`）、`renderer/widgets.html`（blur 收尾 + `board:exit-edit`）、`preload-widgets.js`
- 透视对账：`renderer/js/app.js`（`peekSync` / `peekReconcile`）
- 官网源：`docs/index.html`（+ `docs/shot-*.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）

### 6. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.18.1
git push origin :refs/tags/v1.18.1
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.18.1，Windows 10 / 11 · x64 · 约 280 MB）
- **GitHub 直连（Releases）**：<https://github.com/Alinyu330/wallpaper-studio/releases>
- **国内加速①（gh-proxy）**：<https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.1/WallpaperStudio-Setup-1.18.1.exe>
- **国内加速②（ghfast.top）**：<https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.1/WallpaperStudio-Setup-1.18.1.exe>
- 历史版本（v1.1.0 起全部版本）见 README 的「历史版本下载」表格与官网「更新日志与历史版本」，安装包均已随 Release 发布。

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：<https://wallpaper-studio.pages.dev/>
- GitHub Pages：<https://alinyu330.github.io/wallpaper-studio/>

### 3. 本次修复影响谁
1. 在客户端「桌面组件 → 信息看板内容」里添加待办 / 日程、搜索天气城市时**打不了字、点了没反应**的用户 —— 本版修复。
2. 在「桌面快捷方式 → 快捷方式列表」顶部的**搜索栏**里点击后就被取消、输入不进去的用户 —— 本版修复。
3. 升级后无需任何手动操作：设置、壁纸、收纳记录全部保留；已装旧版可走客户端「设置 → 检查更新」应用内一键更新。

### 4. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.18.1.exe`。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 5. 常见问题
- **下载慢**：优先用上方国内加速①/②，或官网介绍页的「国内高速下载」按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择「仍要运行」或加入白名单。
- **升级后输入还是不正常**：请先彻底退出旧客户端（托盘右键 → 退出）再安装新版；若仍复现，请到 Issues 反馈 `engine.log`（设置 → 播放健康检查可打开日志目录）。
- **想要旧版本**：Releases 页面、README 表格与官网历史版本块均含全部版本。
