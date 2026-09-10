# RELEASE-v1.18.0-USAGE.md — v1.18.0 发布使用说明

> 发布日期：2026-09-11 ｜ 版本：v1.18.0（minor）｜ 主题：音律动效参数、鼠标交互与方向多色渐变

## 一、内部使用方法（开发者 / 维护者）

### 1. 本次发布内容（功能点）

- **音律动效「数量 / 高度 / 宽度」参数**（8 种样式各自生效）
  - 数量：频谱条柱数 8~160 · 霓虹灯管数 8~128 · 波浪采样点 32~256 · 山峦峰点数 8~160 · 圆点列数 6~64 · LED块列数 6~56 · 圆环放射条数 16~180 · 同心环环数 1~6；填 **0 = 自动**（用该样式默认值）。
  - 高度：内容高度系数 0.3~2.0（纵向缩放）；圆环 / 同心环为圆形样式，高度自动置灰并给出说明。
  - 宽度：柱状 / 波浪 / 点阵类 = 内容宽度占窗口比例 0.2~1.0（同数量下越宽柱子越粗）；圆环 / 同心环 = 整体尺寸系数 0.3~2.0。
  - 实现要点：两个系数折进 `avGeom()`（不是绘制时相乘）——`avAxis / avMirrorAxis` 也读 maxH/R/maxLen，倒影水面线必须与主体同步收紧；另加「内容不得溢出窗口」的等比回收（开倒影可用高度 = 0.62H，否则整窗）。
- **音律动效鼠标划过交互**
  - 各样式局部增强：柱子拉高（≤1.3×）· 波形涟漪（从光标扩散）· 山体隆起 + 顶部亮线加粗 · 点阵 / LED 光圈内额外点亮 · 同心环跟手亮段 · 圆环按角向拉长；外加通用光标光晕 + 反馈圆环（画在主画布，**不进倒影层**，倒影里不会出现假光标）。
  - 实现要点：动效窗为不吞桌面图标点击，常驻 `setIgnoreMouseEvents(true)`（鼠标穿透），页面拿不到 DOM 鼠标事件 —— 位置改由主进程已有的 **30ms 光标轮询**推送（`widgets-host._pushAvHover` → `aviz:hover`）；节流：光标静止早退 / 位移 <3px 不发 / 窗口矩形 800ms 缓存 / 离开只发一次 `{in:false}`。
  - 设置页有开关与交互强度 0.2~2.0。
- **方向多色渐变**
  - 渐变方式三选：纯色 / 亮色（原观感）/ 方向多色；方向 8 个（→ ← ↓ ↑ 与四个斜向）；多色序列可自定义 **2~6 色**（点色块改色、✕ 删色、＋ 加色），另有彩虹 / 日落 / 极光 / 霓虹 / 海洋 / 蜜桃 6 组预设。
  - 实现要点：用**一条「整片方向渐变」当填充 / 描边色** —— canvas 渐变按绘制位置取色，每根柱、每个点、每段线自然拿到自己所在位置的颜色，于是「从左往右 / 从上往下依次显示多种颜色」是像素级生效的。
  - 兼容性：旧字段 `gradient` 继续作为兜底（`gradType` 未设时按它推导）；纯色 / 亮色 + 默认参数下的观感与 v1.17.2 一致。
- **修复**：动效窗创建后输入轮询最长延迟约 4 秒才启动 —— 期间桌面组件点不动、动效划过无反馈。根因：`_syncNow()` 里的 `_syncInputTimer()` 跑在创建窗口之前（那时 parts 为空、不建定时器），下一个建定时器的时机是看门狗（约 4s）。现已改为 `_createPart()` 注册部件后立即拉起轮询。

### 2. 测试记录（本次功能测试发现的真实缺陷）

- **真机功能测试 33 项全通过**（新增测试台 `tmp-test-smoke.mjs`：独立数据目录 `WALLPAPER_DATA_DIR` + WP_DEBUG HTTP 端点 `/state`、`/capture` + CDP 断言 + 真实光标划过）：
  应用启动与 8 页面 · 新控件齐全并随样式联动 · 真实 UI 操作落盘 config.json · 动效窗创建与画布初始化 · 真实鼠标移入 / 移出 / 窗内移动的交互推送（含 DPI 缩放换算校验）· 动效窗保持鼠标穿透 · 关闭开关后窗口销毁 · 渲染进程与 engine.log 零错误。
  - 过程中抓到并修复了上面那条「输入轮询延迟 4 秒」的真实缺陷。
  - 踩坑记录：①本机常驻实例占着调试端口 7851，新加 `WP_DEBUG_PORT` 环境变量覆盖，测试实例改用 7852（否则 `/state` 会被常驻实例应答）；②`python` 调 `SetCursorPos` 前必须 `SetProcessDPIAware()`，否则 150% 缩放下光标到不了目标点，会误判成交互失效。
- **渲染层离线验证 100 项全通过**（`.workbuddy/skills/wallpaper-render-verify/` 的三个测试台）：数量 / 高度 / 宽度递增 · 8 个方向渐变走向与色标 · 山体填充取向 · 交互开关成对断言 · 8 样式 × 8 方向无异常 · 主进程交互推送的进出 / 节流 / 开关互斥 / 穿透不变 · 真实设置页 49 项 UI 联动。
- 深度测试与离屏验证均不启动壁纸引擎、不接管桌面（`wallpaper-render-verify` 技能）。

### 3. 本地运行与调试
```bash
cd D:\WallPaper
npm install            # 安装依赖（含 koffi / electron / electron-builder）
npm run get-mpv        # 首次必做：下载 mpv 播放器到 assets/mpv/（仓库不含该二进制）
npm start              # 开发运行（生产模式）
npm run dev            # 开发运行（--dev 模式，便于调试）
```
- 调试端点（本机回环，`WP_DEBUG=1` 时额外开放写接口）：`/state`（组件命中和音律动效交互实况）、`/capture`（窗口截图到 userData/.workbuddy/）、`/settings?patch=...`、`/bandreset`、`/adjust`；端口默认 7851，可用 `WP_DEBUG_PORT` 覆盖。

### 4. 如何再次执行"发布/部署"流程
- 在对话中直接说："发布壁纸工坊新版本" / "更新官网并部署" / "打 tag 出安装包" 等，会触发 `.workbuddy/skills/wallpaper-release` 技能，按阶段 0→7 引导完成。
- 仅想备份当前改动：`git add <文件> && git commit -m "..." && git push origin main`

### 5. 关键路径
- 应用入口：`main.js`（含调试端点与 `WP_DEBUG_PORT`）、各 `preload-*.js`、`src/`、`renderer/`
- 音律动效：`renderer/widgets.html`（绘制主体 + 样式参数表 `AV_STYLE_PARAMS`）、`src/widgets-host.js`（窗口宿主 + 交互位置推送）、`renderer/js/app.js`（设置页控件，`AV_STYLE_PARAMS` 需与渲染页同步）
- 官网源：`docs/index.html`（+ `docs/shot-*.png`、`docs/favicon.png`）
- 构建/发布配置：`package.json`（`build` 段）、`.github/workflows/{pages,release}.yml`
- 安装包产物：`dist/`（CI 生成，不入库）

### 6. 回滚 / 补救
```bash
# 删除本地与远端 tag（会撤销 CI 已生成的 Release，需在 GitHub 页面同步删除该 Release）
git tag -d v1.18.0
git push origin :refs/tags/v1.18.0
# 修复后重新打 tag 即可重新触发 release.yml / pages.yml
```

---

## 二、外部使用方法（最终用户）

### 1. 下载安装包（v1.18.0，Windows 10 / 11 · x64 · 约 280 MB）
- **GitHub 直连（Releases）**：<https://github.com/Alinyu330/wallpaper-studio/releases>
- **国内加速①（gh-proxy）**：<https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.0/WallpaperStudio-Setup-1.18.0.exe>
- **国内加速②（ghfast.top）**：<https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.0/WallpaperStudio-Setup-1.18.0.exe>
- 历史版本（v1.1.0 起全部版本）见 README 的「历史版本下载」表格，安装包均已随 Release 发布。

### 2. 官网介绍页（二选一，内容一致）
- CloudFlare Pages：<https://wallpaper-studio.pages.dev/>
- GitHub Pages：<https://alinyu330.github.io/wallpaper-studio/>

### 3. 本次新功能怎么用
1. 客户端「音律动效」页 → 打开「启用音律动效」（播放任意声音即可看到效果）。
2. 选好动效样式后，用新增的 **数量 / 高度 / 宽度** 三个滑杆微调形态（数量 0 = 自动；圆形样式用「宽度」调整体尺寸）。
3. 想要多色动效：**渐变方式 → 方向多色** → 选方向（如「从左往右」「从上往下」）→ 编辑 2~6 个颜色或直接点配色预设。
4. 让鼠标 **划过动效条带**：光标附近的柱子会拉高、波形起涟漪、山体隆起、点阵聚光、环上出现跟手亮段，并有光晕与反馈圆环；强度在「交互强度」里调。动效层保持鼠标穿透，桌面图标照常点击。
5. 已装旧版：客户端「设置 → 检查更新」可应用内一键更新，设置与壁纸全部保留。

### 4. 安装步骤
1. 下载 `WallpaperStudio-Setup-1.18.0.exe`。
2. 双击运行，可选择安装目录，建议允许创建桌面 / 开始菜单快捷方式。
3. 首次启动按提示完成初始化；右键托盘图标可暂停壁纸、打开主界面。

### 5. 常见问题
- **下载慢**：优先用上方国内加速①/②，或官网介绍页的「国内高速下载」按钮。
- **安装失败 / 报病毒**：Windows 可能误报未签名 exe，选择「仍要运行」或加入白名单。
- **壁纸不显示**：确认播放内核存在（安装包已内置）；检查显卡驱动与多显示器设置。
- **鼠标划过没有反应**：确认「鼠标划过交互」开关是开的，且鼠标落在动效条带所在的窗口区域（可用九宫格 / 精确位置把动效挪到顺手的位置）；若上层有窗口最大化，动效默认会被判「被遮挡」暂停，关掉「被遮挡时自动暂停」即可。
- **想要旧版本**：Releases 页面与 README 表格均含全部历史版本。
