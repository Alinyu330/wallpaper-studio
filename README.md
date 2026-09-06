# 壁纸工坊 Wallpaper Studio

免费开源的 Windows 桌面壁纸软件 — 让桌面动起来。

![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)
![Version](https://img.shields.io/badge/version-1.17.1-7c5cff)

## 官网

- **主站（Cloudflare Pages）**：<https://wallpaper-studio.pages.dev/>
- 备用（GitHub Pages）：<https://alinyu330.github.io/wallpaper-studio/>

## 下载

**最新版 v1.17.1 安装包**（Windows 10 / 11 · x64 · 约 280 MB · 内置全格式解码器 + 精选壁纸 · GPL-3.0 开源并明确禁止闭源商用）：

- 国内加速①：[gh-proxy.com 下载](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe)
- 国内加速②：[ghfast.top 下载](https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe)
- GitHub 直连：[Releases 页面](https://github.com/Alinyu330/wallpaper-studio/releases)（含全部历史版本）

> 已安装旧版？客户端「设置 → 检查更新」即可应用内一键更新，无需重新下载安装包。

## 软件效果截图

| 主控界面 | 桌面组件 |
| --- | --- |
| ![壁纸工坊主控界面 — 壁纸库、实时预览与参数调节](docs/shot-main.png) | ![桌面组件 — 信息看板 / 时钟 / 网速监控 / 音量](docs/shot-widgets.png) |
| **快捷方式转盘** | **文件收纳区** |
| ![桌面快捷方式转盘 — 真实图标 + 倒影](docs/shot-launcher.png) | ![桌面文件收纳区 — 毛玻璃浮层](docs/shot-filebox.png) |

## 功能亮点

- **四类壁纸**：静态图片（JPG/PNG/BMP/WEBP/GIF）· 动态视频（MP4/AVI/MKV/FLV/WebM/MOV）· 网页（URL/本地 HTML）· EXE 程序

- **mpv 播放引擎**：全格式硬解直读，无需转码，内置完整解码器

- **内置精选壁纸**（v1.10.0 新增）：6 部精选动态壁纸随安装包附带（古风美女 / 初音未来 / 夏日绿树 / 圣诞夜 / 冬季雪林 / 大海云影），下载安装打开即可直接使用，已装旧版升级不受影响

- **桌面快捷方式转盘**（v1.5.0，v1.7.0/v1.8.0 增强，v1.15.0 列表搜索置顶）：快捷方式（.lnk/.url）与程序文件（.exe/.bat/.cmd）以转盘形式收纳在桌面（系统项：控制面板 / 回收站 / 网络 / 此电脑 亦可收纳）— 点击图标即可启动对应 App；按住图标条或拖动条左右拖动即可像转盘一样轮换（带惯性甩动）；拖动 ⋮ 手柄自由摆放位置；同屏数量 4~12 可调；图标取系统真实图标（无空白占位）、垂直倒影、去面板边框更沉浸；空闲自动收起为小药丸，悬停药丸展开，不遮挡窗口、不影响壁纸观感；设置页快捷方式列表带搜索栏，输入即过滤，搜到即可点星设为常用排到转盘最前（v1.17.0 修复：搜索不再打断中文输入法组词，命中行点星即生效）

- **桌面文件收纳区**（v1.8.0 新增，v1.9.0 重构，v1.13.0 支持全部文件类型与空文件夹）：桌面上的任意普通文件（含 0 字节空文件、无扩展名与未知类型）与文件夹收进独立浮层，与快捷方式转盘职责分离 — 文件夹 / 文件自动分组排列（支持按名称 / 修改时间 / 手动排序），网格列数与面板透明度可调；文件名完整两行显示；空闲先转半透明毛玻璃、再收缩为单个文件图标，悬停自动展开、点击弹出收纳内容；面板镜像倒影与调色可调；收纳的文件与空文件夹移动隐藏（可一键恢复），非空文件夹仅登记引用不移动内容、点开即进入文件夹；支持自由拖动与九宫格快捷定位

- **应用内一键更新**（v1.8.1 新增）：检查更新发现新版本即弹出新版功能介绍窗口（更新日志直读发布页 Release Notes）；点「立即更新」在客户端内直接下载安装包（实时进度、可随时取消），下载完成自动静默安装并退出 — 全程无需跳转网页手动下载

- **音律动效**（v1.7.0，v1.9.0 重写）：系统音频实时频谱可视化，随音乐律动；绘制改为「离屏辉光层 + 两次合成」，每帧上百次高斯模糊填充降为 2 次图像合成，帧率可限（15/24/30/60/不限）；镜像倒影与主体同层绘制，彻底消除倒影区残影 / 撕裂；条形频谱 + 霓虹样式 + 渐变色、大小缩放、灵敏度调节，融入壁纸不突兀

- **桌面 DIY 组件**（v1.2.0，v1.7.0 重构，v1.9.0~v1.11.0 持续增强，v1.17.0 看板编辑修复）：时钟（12/24 小时制点击切换）、信息看板（日历 / 天气按 IP 自动定位 / 待办，桌面直接编辑）、系统状态监控（网速 / CPU / GPU / 内存）、音量控制条、音律动效 — 每个组件独立小窗口，无边框融入壁纸；毛玻璃 / 液态玻璃样式与全局调色；新增「调整模式」：客户端一键进入拖动调整、桌面默认只显示不误触；组件 / 音律动效 / 转盘均支持九宫格快速定位与拖动吸附

- **点选 / 框选收纳**（v1.6.0，v1.7.0 增强）：全屏选择器直接点选或拖框选择桌面快捷方式，一键收纳进转盘 — 原桌面图标随之隐藏（实际移动文件到应用数据目录保管）；支持回收站、此电脑等系统项收纳与过滤无效文件；从转盘移除、一键"全部恢复"或关闭功能时，自动移回桌面原位置（恢复显示）

- **平滑循环过渡 2.0**（v1.5.0，v1.9.0 平滑升级）：循环交界处新画面柔和淡入覆盖（旧画面保持不透明垫底），亮度恒定、无黑变无重影；smoothstep 缓动曲线，过渡如行云流水；定时轮换提前 3 秒预热解码器，到点立即开始溶解；待命槽提前重建，压缩循环交界的定格停顿；关闭平滑循环改为硬切循环（不再播一遍就冻在末帧）

- **循环无感升级**（v1.6.0）：只在视频结尾定格后开始溶解（静止帧叠加，肉眼无感）；结尾 70ms 高频轮询 + 淡入 33ms 专用步进，定格停顿压缩到 0.1s 级、淡入 \~30fps 平滑无跳变，长时间循环稳定如一

- **参数精确调节**：播放速度（0.25×–4×）、音量、亮度、对比度、饱和度；每项参数均有固定调整点一键跳转 + 数值精确输入

- **透视调参**（v1.14.0 新增，v1.17.0 修复不恢复，v1.17.1 移除「保持透视」、恢复恒定 1.5 秒）：调节壁纸 / 桌面组件 / 音律动效 / 快捷方式转盘 / 文件收纳的位置与参数时，客户端窗口自动变透明，桌面上的实时效果直接可见，停止操作 1.5 秒后必复原；桌面拖动调整模式期间全程保持透明，松手保存即自动恢复；强度 10~70 可调（拖动滑杆实时预览，松手即复原），窗口淡出时按 Esc 可一键结束调整并恢复显示

- **实时预览**：按主显示器真实比例预览；预览区可放大缩小；支持弹出独立预览窗口，参数实时同步

- **壁纸暂停**（v1.2.0）：一键暂停视频播放与轮换，恢复桌面清爽；支持托盘操作，重启后保持状态

- **多壁纸定时轮换**（v1.2.0）：全部/收藏/自定义列表三种范围，随机或顺序切换，间隔自由设定，工具栏一键"下一张"

- **壁纸站点导航**（v1.3.0 扩充）：内置 4K Desk、TooPIC、好壁纸、魔玉部落、Wallhaven、必应壁纸、Unsplash 等 13 个热门免费壁纸站点，点击直达

- **智能自动暂停**（v1.3.0）：全屏应用 / 笔记本电池供电 / 其他窗口最大化（Wallpaper Engine 同款）三种场景自动暂停视频壁纸省电省资源，条件解除自动恢复

- **全局快捷键**（v1.3.0）：Ctrl+Alt+W 一键暂停/恢复壁纸，游戏或任意界面可用，可开关

- **停止使用壁纸**（v1.3.0）：一键停用当前壁纸恢复系统默认桌面，壁纸库记录保留

- **深度性能优化**：GPU 硬解 · 性能档位（省电/均衡/性能）· 渲染分辨率限制（原生/1080P/720P/480P）· 渲染质量三档 · 视频帧率上限

- **桌面与锁屏**：壁纸嵌入系统 WorkerW 层（图标层之下），多显示器铺满；图片壁纸一键同步为 Windows 锁屏背景

- **无黑屏自愈**（v1.5.0 完整生效）：播放卡死/暂停脱节时，备用引擎先在冻结画面上方渲染出画面再替换旧进程——全程无黑屏、不打断使用；结尾定格僵死、时长未知等边缘场景均有兜底修复

- **播放健康检查**（v1.3.2）：渲染冻结/暂停状态脱节自动检测恢复，引擎事件日志（`engine.log`）可回溯定位

- **壁纸管理**：收藏 · 搜索 · 类型筛选 · 双击应用 · 托盘常驻

- **稳定看门狗**：壁纸窗口丢失自动恢复、桌面层级变化自动重挂载、mpv 进程异常退出自动重启、窗口操作隔离执行器（目标窗口冻结时主进程永不阻塞，队列化派发不误伤合法操作）

## 历史版本下载（全部版本，新 → 旧，安装包均已随 Release 发布）

| 版本 | 国内加速下载 | GitHub 直连 |
|---|---|---|
| v1.17.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.1/WallpaperStudio-Setup-1.17.1.exe) |
| v1.17.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.0/WallpaperStudio-Setup-1.17.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.0/WallpaperStudio-Setup-1.17.0.exe) |
| v1.16.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.16.0/WallpaperStudio-Setup-1.16.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.16.0/WallpaperStudio-Setup-1.16.0.exe) |
| v1.15.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.15.0/WallpaperStudio-Setup-1.15.0.exe) |
| v1.14.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.14.0/WallpaperStudio-Setup-1.14.0.exe) |
| v1.13.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.13.0/WallpaperStudio-Setup-1.13.0.exe) |
| v1.12.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.1/WallpaperStudio-Setup-1.12.1.exe) |
| v1.12.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.12.0/WallpaperStudio-Setup-1.12.0.exe) |
| v1.11.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.11.0/WallpaperStudio-Setup-1.11.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.11.0/WallpaperStudio-Setup-1.11.0.exe) |
| v1.10.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.10.0/WallpaperStudio-Setup-1.10.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.10.0/WallpaperStudio-Setup-1.10.0.exe) |
| v1.9.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.9.0/WallpaperStudio-Setup-1.9.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.9.0/WallpaperStudio-Setup-1.9.0.exe) |
| v1.8.6 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.6/WallpaperStudio-Setup-1.8.6.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.6/WallpaperStudio-Setup-1.8.6.exe) |
| v1.8.5 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.5/WallpaperStudio-Setup-1.8.5.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.5/WallpaperStudio-Setup-1.8.5.exe) |
| v1.8.4 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.4/WallpaperStudio-Setup-1.8.4.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.4/WallpaperStudio-Setup-1.8.4.exe) |
| v1.8.3 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.3/WallpaperStudio-Setup-1.8.3.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.3/WallpaperStudio-Setup-1.8.3.exe) |
| v1.8.2 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.2/WallpaperStudio-Setup-1.8.2.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.2/WallpaperStudio-Setup-1.8.2.exe) |
| v1.8.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.1/WallpaperStudio-Setup-1.8.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.1/WallpaperStudio-Setup-1.8.1.exe) |
| v1.8.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.0/WallpaperStudio-Setup-1.8.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.8.0/WallpaperStudio-Setup-1.8.0.exe) |
| v1.7.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.1/WallpaperStudio-Setup-1.7.1.exe) |
| v1.7.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.0/WallpaperStudio-Setup-1.7.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.0/WallpaperStudio-Setup-1.7.0.exe) |
| v1.6.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.6.0/WallpaperStudio-Setup-1.6.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.6.0/WallpaperStudio-Setup-1.6.0.exe) |
| v1.5.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.5.0/WallpaperStudio-Setup-1.5.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.5.0/WallpaperStudio-Setup-1.5.0.exe) |
| v1.4.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.4.0/WallpaperStudio-Setup-1.4.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.4.0/WallpaperStudio-Setup-1.4.0.exe) |
| v1.3.2 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.2/WallpaperStudio-Setup-1.3.2.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.2/WallpaperStudio-Setup-1.3.2.exe) |
| v1.3.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.1/WallpaperStudio-Setup-1.3.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.1/WallpaperStudio-Setup-1.3.1.exe) |
| v1.3.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.0/WallpaperStudio-Setup-1.3.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.3.0/WallpaperStudio-Setup-1.3.0.exe) |
| v1.2.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.2.0/WallpaperStudio-Setup-1.2.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.2.0/WallpaperStudio-Setup-1.2.0.exe) |
| v1.1.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.1.0/WallpaperStudio-Setup-1.1.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.1.0/WallpaperStudio-Setup-1.1.0.exe) |

> 各版本更新内容见下方「新增功能与修复问题」分节与 [官网更新日志](https://wallpaper-studio.pages.dev/#changelog)；更早版本（v1.0.0）见 [Releases 页面](https://github.com/Alinyu330/wallpaper-studio/releases)。

## v1.17.1 透视恢复修复

**修复问题**

- 修复透视调参「停止操作后客户端不能在 1.5 秒恢复正常显示」的问题 —— 根因是「保持透视」开关：它的唯一作用就是把调参淡出后的恢复时间从 1.5 秒推迟（更早版本开启后完全没有自动复原路径，窗口永久卡在透明态，淡出后连这个开关本身都看不清、点不回，只能重启客户端；v1.17.0 起改为空闲 30 秒兜底，但「过好久才恢复」依旧与设置页承诺的「停止操作 1.5 秒后自动恢复」直接矛盾）。本版将其移除，设置页同步去掉该开关：无论调节壁纸 / 桌面组件 / 音律动效 / 快捷方式转盘 / 文件收纳的哪一项位置与参数，停止操作 1.5 秒后窗口必定自动复原（实测恢复耗时 1500±100ms）
- 修复在设置中拖动「透视强度」滑杆后窗口恢复不及时的问题 —— 拖动滑杆本意是实时预览淡出强度，但受上述开关影响会迟迟不复原；现松手 1.5 秒即自动复原，拖动过程所见即所得
- 旧配置兼容：升级后配置里残留的 `tunePeek.locked` 锁定状态在读取配置时自动丢弃，不再延迟恢复，无需手动处理
- 加固 Esc 逃生门：窗口处于任何淡出状态（调参脉冲、桌面拖动调整模式、状态与实况脱节）时按 Esc，都立即结束全部桌面调整模式并恢复显示

## v1.17.0 新增功能与修复问题

**修复问题**

- 修复设置页快捷方式列表搜索栏「搜到却点不动、中文输入被打断」的问题（v1.15.0 搜索栏的三处连带缺陷）：① 每敲一个字都按过滤结果重建整表，几十上百行带真实图标（单条约 30 KB base64）的行反复重排重解码，输入框刚聚焦就被换掉、中文拼音组词直接中断 —— 现改为按内容签名增量重建，行节点不随输入更换，过滤只做显隐切换；② 新增输入法组词守卫，`compositionstart` 到 `compositionend` 之间不重绘，拼音候选不会被半截吞掉；③ 图标取图在主进程按「目标路径 + 文件修改时间」做内存 memo，同一路径不再重复读盘与 base64 重编码（此前一次搜索要重跑上百次图标派生，是主线程卡住的主因），点星 / 移除按钮加防重入，回包前不响应第二次点击
- 修复信息看板内容无法添加 / 修改 / 删除的问题（客户端与桌面两端各有根因）：① 客户端里点「添加日程 / 添加待办 / 删除」数据其实已写进配置，界面却永远不变 —— 保存时把内容修订号提前更新成当前值，随后配置同步回波发现修订号没变就直接跳过重绘，本次操作被自己的守卫抑制掉。现改为保存即重绘，同步回波自然成为空操作；② 删除按钮的点击回调捕获的是渲染当时的数组快照，期间桌面端勾过 / 加过的内容会被过期数组整体写回覆盖丢失 —— 改为容器事件委托，点击那一刻读当前数据再过滤；③ 列表原先每次重绘整表换节点，正在点的按钮会被同步回波顶掉，同样表现为「点了没反应」—— 现按内容签名增量重建，无变化不换节点；④ 桌面看板打字被异常打断：编辑器打开后的焦点自检与失焦重拉会在输入法候选窗（属另一进程）取得前台时立刻抢回前台，直接打断组词 —— 现组词期间、或本编辑器已输入过内容时不再抢焦点
- 修复透视调参「停止操作后客户端不能恢复正常显示」、窗口永久停在透明态的问题：① 快捷方式转盘与文件收纳区的覆盖层在调整模式中被销毁（关掉转盘 / 收纳区开关、换壁纸重建桌面合成带）时只复位了内部状态、没有把「退出调整」回传给客户端，客户端的淡出持有者于是永不释放，窗口永久透明 —— 且此时点「结束调整」也因窗口已不存在而直接返回失败，连手动退出都做不到。现与桌面组件一致，销毁时补发退出回传；② 淡出不透明度下发带「同值不重发」去重，一旦渲染层以为窗口已经是 1（IPC 丢包、`setOpacity` 抛错被吞、渲染进程崩溃重载）就永远不会再发复原指令 —— 现复原无条件送达，去重只用于淡出值；③「保持透视」开启后完全没有自动复原路径，把强度拉到 10% 后窗口几乎看不见，只能去摸那个看不清的解锁开关 —— 现改为空闲 30 秒后照样复原，并新增 **Esc 一键逃生门**：窗口淡出时按 Esc 结束所有仍在进行的桌面调整模式、立即恢复显示并解除保持透视；④ 客户端每次重新显示 / 重新聚焦都与主进程对账一次调整模式实况，任何一次状态回传丢失都能自愈；渲染进程崩溃重载前先把窗口复位为不透明

## v1.16.0 许可证变更与客户端声明

**许可证与版权**

- **许可证由 MIT 改为 GNU GPL-3.0-or-later，并采用「GPL + 商业授权」双许可模式**：仓库补齐 `LICENSE`（GPL-3.0 全文）与 `COPYRIGHT.md`（版权与许可声明、禁止行为清单、商业授权方式、维权声明），README 徽章与 License 章节、package.json 的 `license` / `author` / `copyright` 元数据、官网同步
- **明确禁止闭源商用**：修改本软件后**闭源发布或销售**（含改名、换图标、换皮、增删功能、重新打包为安装包分发而不公开源代码）、去除或篡改版权声明与署名、把本软件当作自有产品上架或投放下载站 —— 均超出许可证授权范围，构成违反 GPL 与侵犯软件著作权，权利人保留依法追究的责任
- **客户端内同样告知**：设置 → 关于 新增「许可证与版权」行（一键查看许可证全文）；安装包安装流程新增**许可协议页**，安装前即完整载明上述条款

> 说明：GPL **不禁止商业使用本身** —— 免费安装使用、学习、修改照旧；它要求的是"分发修改版必须同样开源"。需要闭源商用、OEM 预装或白标版本，请通过 Issues 洽谈商业授权。

## v1.15.0 新增功能与修复问题

**新增功能**

- **快捷方式列表搜索栏**：设置 → 桌面快捷方式 → 快捷方式列表顶部新增搜索框，输入即过滤（匹配显示名、目标程序 / .lnk 文件名与系统项），右侧实时显示「命中 N / 总数」并带一键清空 — 桌面快捷方式收进转盘几十上百个时，搜一下就能定位到要设为常用的那一个，点 ⭐ 直接排到转盘最前
- **命中结果里连续置顶不错位**：过滤视图的每一行仍按完整列表的原始位置定位，点星置顶的就是当前看到的这一行；置顶后列表保持当前筛选，可接着连续置顶下一条，全部排完再清空看整盘顺序

## v1.14.0 新增功能与修复问题

**新增功能**

- **透视调参 — 调参数时客户端自动变透明**：调节壁纸、桌面组件、音律动效、快捷方式转盘、文件收纳各自的位置与各项参数时（拖滑杆、改数值、点预设、点九宫格），客户端窗口立即淡出到设定的不透明度，桌面上的真实效果一眼可见，停止操作 1.5 秒后自动复原，调完即所见
- **桌面拖动调整模式全程透视**：组件 / 音律动效 / 转盘 / 收纳区点「调整位置」后，整段拖动期间客户端保持透明不抢视线，松手保存即自动恢复；淡出后的窗口仍可正常点击，不需要先退出调整模式
- **透视强度与锁定可调**（设置 → 透视调参）：淡出后的窗口不透明度 10~70 可调（越小越通透，拖动强度滑杆即可现场预览），并提供「保持透视」锁定（调完参数窗口不复原，便于在透明状态下反复对比）与总开关；关闭开关时窗口立即恢复不透明

## v1.13.0 新增功能与修复问题

**新增功能**

- **空文件夹可整体收纳**：桌面上没有内容的文件夹在「一键收纳」时整体移入主存储（桌面图标消失，移除或「全部恢复到桌面」即回到原位置）；非空文件夹仍只登记引用、不搬动用户内容。镜像双保险与卸载抢救同样覆盖文件夹项
- **「全部恢复到桌面」当场找回失联内容**：保管目录里清单未引用的历史文件（此前因下述缺陷滞留的快捷方式 / 文件）一并恢复到桌面，不必等下次启动自愈，提示中单独标注找回数量

**修复问题**

- 修复收纳后快捷方式 / 文件列表变空、点「全部恢复到桌面」无法恢复的问题（根因：一键收纳逐个让出事件循环跑批，期间再点一次会另起一批，旧实现按批次开始时的配置快照整体写回，后完成的一批把先完成那批的收纳记录覆盖掉 —— 文件已进保管目录、清单却是空的）。现改为按最新配置合并新增项，且连点只执行一批
- 修复文件收纳区收不进无扩展名与白名单外类型文件（含 0 字节空文件）的问题：去掉办公文档扩展名白名单，桌面上除转盘负责的快捷方式 / 程序文件与 desktop.ini 等系统元数据之外的任意文件都能收纳
- 修复更换安装目录或开发态 / 安装态切换后收纳记录指向别处收纳文件夹的问题（配置在数据目录两边共用，收纳文件夹随应用根目录定位，出现「文件在 A、清单指 B」）：启动自愈统一把记录改指当前主存储，实体仍留在旧位置时一并搬回

## v1.12.1 新增功能与修复问题

**新增功能**

- **转盘拖动条三连击回到最前方**：在快捷方式转盘的拖动旋转条上 700ms 内连点三次，转盘以最短路径平滑回绕到条目 0（最左 / 最上槽位）——轮换多了想回开头，不用一路拖回去；单击仍是就近吸附、不误触发，拖动条悬停提示同步更新

## v1.12.0 新增功能与修复问题

**新增功能**

- **更新数据三重保护**：升级 / 重装不再丢失任何用户数据 — 升级时自动跳过数据清理（--updated 守卫）、安装前自动备份配置与收纳内容、首次启动数据自愈核对；壁纸库、全部功能开关与数值参数、收纳的文件与快捷方式完整保留
- **收纳存储可见文件夹**：收纳的文件与快捷方式存放在应用根目录的「收纳快捷方式(卸载恢复)」「收纳文件(卸载恢复)」文件夹（默认为空、收纳时移入），位置公开透明、随时可查；设置页展示主存储 / 备用存储路径（点击直达所在文件夹）
- **收纳内容双保险镜像**：数据目录「收纳备份」实时镜像收纳内容 — 收纳时自动备份、恢复 / 移除时同步清理；主存储意外受损时，下次启动自动从镜像恢复，收纳与恢复功能不因单点受损失效

**修复问题**

- 修复更新版本后客户端收纳的快捷方式、文件无法恢复到桌面的问题（根因：NSIS 覆盖安装会静默运行旧版卸载器，旧逻辑误删全部数据目录；此后的每次升级均受保护）
- 修复更新版本后上传的壁纸从壁纸库消失、无法使用的问题（壁纸库索引随数据目录被误删所致，现完整保留）

## v1.11.0 新增功能与修复问题

**新增功能**

- **天气城市按 IP 自动定位**：信息看板天气开箱即显示所在地天气，无需手动设置；桌面看板点城市名或设置页搜索可手动指定（以手动为准），一键恢复自动定位

**修复问题**

- 修复桌面看板无法输入的问题 — 添加待办 / 日程、修改天气城市时打字无反应、中文输入法不弹出（三重根因均已修复）
- 修复看板编辑器卡住时删除按钮首次点击被吞的问题
- 修复任务栏 / 任务管理器中应用名显示为 Electron 的问题 — 正确显示为「壁纸工坊」

**优化**

- 看板输入框改为下划线式设计，与组件无边框融入壁纸的风格统一

## v1.10.0 新增功能与修复问题

**新增功能**

- **内置精选壁纸**：6 部精选动态壁纸随安装包附带（古风美女 · 初音未来 · 夏日绿树 · 圣诞夜 · 冬季雪林 · 大海云影），下载安装打开即可直接使用，无需自行寻找片源；已安装旧版升级不受影响
- **信息看板桌面直接编辑**：日程 / 待办直接在桌面看板上新增与删除，无需打开客户端；天气城市点击即可切换（常用城市一键选 + 全球城市搜索）

**修复问题**

- 修复桌面文件、快捷方式拖到转盘 / 收纳区「＋」附近无法收纳进去的问题
- 修复主文件夹、回收站、此电脑等系统图标无法收纳进快捷方式转盘的问题

**优化**

- 新用户首次开启各功能的默认位置与参数对齐实际使用习惯（组件位置、透明度、镜像模式、天气城市开箱即用少调整）

## 下载历史版本

前往 [Releases](https://github.com/Alinyu330/wallpaper-studio/releases) 下载历史版本安装包；官网底部「更新日志」有每个版本的完整变更说明。

## 开发

```bash
npm install     # 安装依赖（含 koffi、electron、electron-builder）
npm run get-mpv # 下载 mpv 播放器到 assets/mpv/（首次必做，仓库不含该二进制）
npm start       # 开发运行
npm run build   # 生成 Windows 安装包（dist/ 目录）
```

### 技术栈

- [Electron](https://www.electronjs.org/) — 应用框架

- [koffi](https://koffi.dev/) — Win32 API 调用（窗口嵌入/层级管理）

- [mpv](https://mpv.io/) — 视频播放内核（assets/mpv 内置）

### 目录结构

```
├── main.js               # 主进程：窗口/壁纸引擎调度/IPC/托盘/组件窗口/轮换/转盘
├── preload-main.js       # 主界面桥接
├── preload-wallpaper.js  # 壁纸窗口桥接
├── preload-preview.js    # 预览弹窗桥接
├── preload-widgets.js    # 桌面组件窗口桥接
├── preload-launcher.js   # 快捷方式转盘窗口桥接
├── src/
│   ├── desktop.js        # 桌面嵌入（WorkerW 挂载/全屏与最大化检测/多显示器/窗口移动）
│   ├── mpv.js            # mpv 播放控制器（IPC/参数/分辨率限制/进程竞态防护）
│   ├── video-engine.js   # 双槽视频引擎（淡入覆盖循环/无黑屏自愈/健康检查）
│   ├── win-ops.js        # 窗口操作隔离执行器（worker 线程池/队列化派发/超时保护）
│   ├── launcher.js       # 桌面快捷方式转盘宿主（图标层之上覆盖窗口）
│   ├── widgets-host.js   # 桌面组件独立窗口宿主（时钟/监控/音量/音律动效，每组件一窗口）
│   ├── icons.js          # 快捷方式图标解析（EXE/LNK/系统项 → PNG，icon-extract.ps1）
│   ├── exe-wallpaper.js  # EXE 壁纸嵌入控制器
│   ├── lockscreen.js     # 锁屏壁纸（PersonalizationCSP）
│   ├── widgets-stats.js  # 系统信息采集（CPU/GPU/内存，PDH 计数器）
│   ├── updater.js        # 版本更新检查
│   ├── store.js          # 配置持久化
│   └── file-types.js     # 文件类型识别
├── renderer/             # 界面（主界面/壁纸窗口/预览弹窗/组件窗口/转盘窗口/选择器窗口）
├── assets/mpv/           # mpv 播放器（npm run get-mpv 下载，不入库）
├── scripts/              # 辅助脚本（mpv 下载）
└── docs/                 # 官网（GitHub Pages）
```

## License

本项目 **壁纸工坊 Wallpaper Studio** Copyright (C) 2026 Alinyu330，以 **GNU GPL-3.0-or-later** 发布（许可证全文见 [LICENSE](LICENSE)）。

- ✅ **可以自由**：安装使用（个人 / 学习 / 企业内部使用免费，无需授权）、研究修改、再分发原版或修改版 —— 但再分发必须同样以 GPL-3.0 开源、保留版权声明与署名
- ❌ **明确禁止（超出授权范围，构成违反许可证与著作权侵权）**：修改后**闭源发布或销售**（含改名 / 换图标 / 换皮 / 重新打包安装包）、去除或篡改版权声明与署名、把本软件当作自有产品上架或投放下载站、商业使用却不履行开源义务
- 💼 **商业授权（双许可）**：需要闭源商用、OEM 预装、白标版本或并入非 GPL 兼容产品，请通过 [Issues](https://github.com/Alinyu330/wallpaper-studio/issues) 洽谈付费商业授权

完整条款、禁止行为清单与维权声明见 [COPYRIGHT.md](COPYRIGHT.md)。安装包首次运行前的许可页同样载明上述内容。

> 随附的第三方组件（mpv、Electron/Chromium、Node 依赖、内置壁纸素材）各自适用其原始许可证，版权归其原作者所有。
