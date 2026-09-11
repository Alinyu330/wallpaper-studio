# 壁纸工坊 Wallpaper Studio — 免费开源的 Windows 动态壁纸软件（壁纸引擎）

让桌面动起来：视频 / 图片 / 网页 / EXE 程序皆可设为壁纸，桌面组件、快捷方式转盘、文件收纳、音律动效融入桌面，调参时客户端自动变透明、桌面实时效果一眼可见。

**English**: Free & open-source live wallpaper engine for Windows — set videos, images, webpages and programs as your desktop wallpaper, with desktop widgets, a shortcut wheel, a file organizer and an audio visualizer. A free alternative to Wallpaper Engine.

![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)
![Version](https://img.shields.io/badge/version-1.20.0-7c5cff)

## 官网

- **主站（Cloudflare Pages）**：<https://wallpaper-studio.pages.dev/>
- 备用（GitHub Pages）：<https://alinyu330.github.io/wallpaper-studio/>

## 下载

**最新版 v1.20.0 安装包**（Windows 10 / 11 · x64 · 约 280 MB · 内置全格式解码器 + 精选壁纸 · GPL-3.0 开源并明确禁止闭源商用）：

> 本版修复：信息看板天气城市**搜不到区县（县/区/旗/镇）**的问题；修复城市搜索框**输入被异常打断、无法一次输完**的问题（常去城市搜索框此前完全未生效）。

- 国内加速①：[gh-proxy.com 下载](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.20.0/WallpaperStudio-Setup-1.20.0.exe)
- 国内加速②：[ghfast.top 下载](https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.20.0/WallpaperStudio-Setup-1.20.0.exe)
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

- **桌面快捷方式转盘**（v1.5.0，v1.7.0/v1.8.0 增强，v1.15.0 列表搜索置顶）：快捷方式（.lnk/.url）与程序文件（.exe/.bat/.cmd）以转盘形式收纳在桌面（系统项：控制面板 / 回收站 / 网络 / 此电脑 亦可收纳）— 点击图标即可启动对应 App；按住图标条或拖动条左右拖动即可像转盘一样轮换（带惯性甩动）；拖动 ⋮ 手柄自由摆放位置；同屏数量 4~12 可调；图标取系统真实图标（无空白占位）、垂直倒影、去面板边框更沉浸；空闲自动收起为小药丸，悬停药丸展开，不遮挡窗口、不影响壁纸观感；设置页快捷方式列表带搜索栏，输入即过滤，搜到即可点星设为常用排到转盘最前（v1.17.0 修复：搜索不再打断中文输入法组词，命中行点星即生效；v1.18.1 修复搜索栏被键盘焦点抢占导致无法输入的问题）

- **桌面文件收纳区**（v1.8.0 新增，v1.9.0 重构，v1.13.0 支持全部文件类型与空文件夹）：桌面上的任意普通文件（含 0 字节空文件、无扩展名与未知类型）与文件夹收进独立浮层，与快捷方式转盘职责分离 — 文件夹 / 文件自动分组排列（支持按名称 / 修改时间 / 手动排序），网格列数与面板透明度可调；文件名完整两行显示；空闲先转半透明毛玻璃、再收缩为单个文件图标，悬停自动展开、点击弹出收纳内容；面板镜像倒影与调色可调；收纳的文件与空文件夹移动隐藏（可一键恢复），非空文件夹仅登记引用不移动内容、点开即进入文件夹；支持自由拖动与九宫格快捷定位

- **应用内一键更新**（v1.8.1 新增）：检查更新发现新版本即弹出新版功能介绍窗口（更新日志直读发布页 Release Notes）；点「立即更新」在客户端内直接下载安装包（实时进度、可随时取消），下载完成自动静默安装并退出 — 全程无需跳转网页手动下载

- **音律动效**（v1.7.0，v1.9.0 重写，v1.18.0 参数与交互）：系统音频实时频谱可视化，随音乐律动；绘制走「离屏辉光层 + 两次合成」，每帧上百次高斯模糊填充降为 2 次图像合成，帧率可限（15/24/30/60/不限）；镜像倒影与主体同层绘制，彻底消除倒影区残影 / 撕裂。样式：频谱条 / 波浪 / 圆环 / 山峦 / 圆点 / 同心环 / LED块 / 霓虹。**v1.18.0 新增**：每种样式可调**数量**（柱数 / 灯管数 / 采样点 / 峰点数 / 列数 / 放射条数 / 环数，0 = 自动）、**高度**（0.3~2.0）与**宽度**（柱状类为内容宽度占窗口比例，圆环类为整体尺寸）；**鼠标划过交互** —— 光标附近柱子拉高、波形起涟漪、山体隆起、点阵与 LED 光圈内额外点亮、同心环出现跟手亮段、圆环按角向拉长，另有光标光晕与反馈圆环（动效层仍鼠标穿透，桌面图标照常点击）；渐变方式扩展为**纯色 / 亮色 / 方向多色**，多色支持 8 个方向与 2~6 种自定义颜色（含彩虹 / 日落 / 极光 / 霓虹 / 海洋 / 蜜桃 6 组预设），颜色沿方向依次排布

- **桌面 DIY 组件**（v1.2.0，v1.7.0 重构，v1.9.0~v1.11.0 持续增强，v1.17.0 看板编辑修复，v1.18.1 客户端看板输入修复，v1.19.0 天气地名到区县，v1.20.0 区县搜索与城市搜索输入修复）：时钟（12/24 小时制点击切换）、信息看板（日历 / 天气按 IP 自动定位（省 · 市 · 区县三级地名，城市可搜到县 / 区 / 旗 / 镇，可再加一座常去城市同屏显示）/ 待办，桌面直接编辑）、系统状态监控（网速 / CPU / GPU / 内存）、音量控制条、音律动效 — 每个组件独立小窗口，无边框融入壁纸；毛玻璃 / 液态玻璃样式与全局调色；新增「调整模式」：客户端一键进入拖动调整、桌面默认只显示不误触；组件 / 音律动效 / 转盘均支持九宫格快速定位与拖动吸附

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
| v1.20.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.20.0/WallpaperStudio-Setup-1.20.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.20.0/WallpaperStudio-Setup-1.20.0.exe) |
| v1.19.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.19.0/WallpaperStudio-Setup-1.19.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.19.0/WallpaperStudio-Setup-1.19.0.exe) |
| v1.18.1 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.1/WallpaperStudio-Setup-1.18.1.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.1/WallpaperStudio-Setup-1.18.1.exe) |
| v1.18.0 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.0/WallpaperStudio-Setup-1.18.0.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.18.0/WallpaperStudio-Setup-1.18.0.exe) |
| v1.17.2 | [gh-proxy.com](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.2/WallpaperStudio-Setup-1.17.2.exe) | [直连](https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.17.2/WallpaperStudio-Setup-1.17.2.exe) |
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

## v1.20.0 区县搜索修复 + 城市搜索输入修复

**修复问题**

- 修复信息看板天气城市**输入区（县）名识别不到**的问题 —— 此前城市搜索只查 Open-Meteo 城市库，而它的地名库只到「市 / 地级以上区」，县级单位基本没有收录：输入「保德县」「忻府区」「五台县」一律提示「没有匹配的城市」。现改为**多源搜索**：识别到区县 / 乡镇关键字（县 / 区 / 旗 / 镇 / 乡 / 街道 / 苏木 / 自治州…）时优先走 Photon（基于 OpenStreetMap，中文区县覆盖完整），否则优先走 Open-Meteo（市级结果更规范），任一源为空自动用另一源兜底。搜索结果统一拼成「省 · 市 · 区县」三级，并按「与输入贴合度 → 行政中心优先 → 人口降序」排序
- 修复城市搜索**输入被异常打断、无法一次输完**的问题 —— 两处根因：① 搜索请求有竞态，防抖期间连续键入会并发多个请求，先发的若后到会用过期结果覆盖新列表（列表闪一下变成别的城市）；② 列表重建时可能丢失输入框焦点与正在键入的字符。现对每次查询编号、并按「请求序号 + 当前输入值」双重校验，过期回包直接丢弃；列表重建后若输入框原本有焦点则主动拉回，且结果列表不再抢占输入
- 修复**常去城市搜索框与「清除常去城市」按钮完全无效**的问题 —— 客户端「设置 → 桌面组件 → 信息看板内容 → 常去城市」下的搜索框与清除按钮此前在页面上可见，但渲染层从未绑定任何事件（搜索框打字毫无反应、清除按钮点击无效果），同时也缺少对应的主进程处理分支。现已补齐：搜索框可正常搜索并设为常去城市，清除按钮可清除（未设置时给出提示）
- 修复桌面看板**点击「常去城市」行编辑后无法保存**的问题 —— 桌面看板提交的 `favorite-set` / `favorite-clear` 操作在主进程组件宿主侧没有对应分支，会静默返回失败，表现为「选了城市但看板不显示、清除也清不掉」。现已补齐这两条操作，并与主城市一样触发天气重拉与看板高度重算
- 过滤城市搜索结果中的非行政区划条目 —— OSM 数据里混有法院 / 委员会 / 学校 / 机场 / 公司等兴趣点，此前会作为「城市」出现在候选列表；现只保留行政层级地名（place / boundary）
- 规范超长民族文字地名 —— 内蒙古 / 新疆等地的条目会带上大段民族文字注解（如「内蒙古自治区 ᠦᠪᠦᠷ ᠮᠣᠩᠭᠤᠯ …」），现已裁掉注解段，只保留中文名

**测试**

- 天气地名与真实定位 / 搜索链路 84 项全部通过，含新增区县搜索回归：保德县 / 忻府区 / 五台县 / 朝阳区 均能搜到且首条命中、结果含三级地名、坐标可用；市级搜索不混入法院机构等 POI；民族文字地名已裁短
- 城市搜索输入连续性 17 项全部通过（真实设置页 + 桩数据）：连续键入区县名不丢字、焦点不被抢走、回包后输入与焦点保持、**乱序回包（慢的旧请求不覆盖新结果）**、同步回推期间输入不丢字、常去城市搜索与清除按钮生效且正确落盘
- 信息看板真实渲染 94 项、真机功能测试 48 项（含 8 项本次修复的真机回归：逐字键入区县名 → 真实网络搜索 → 选中落盘 → 常去城市设置 / 清除）全部通过
- 回归：音律动效绘制 36 项、组件宿主交互 15 项、设置页真实渲染 49 项 — 全部 0 失败、0 控制台错误

## v1.19.0 信息看板天气地名精确到区县 + 常去城市

**新增功能**

- 信息看板天气城市由「市 · 省」两级升级为**「省 · 市 · 区县」三级** — 例如「山西省 · 忻州市 · 忻府区」。IP 自动定位先取坐标与基础省市，再用坐标做逆地理补齐区县；多源兜底、逆地理不可用时自动降级为两级，任何一级缺失都会被安全省略
- **常去城市天气**：信息看板可再设一座「常去城市」（客户端 设置 → 桌面组件 → 信息看板内容 → 常去城市，桌面看板点城市名也能直接改），与所在地城市**同屏显示** —— 天气块里多出一行「常去 城市名 温度 天气」，出差 / 两地通勤对照一眼可见。常去城市固定为手选城市、不随 IP 变化；与主城市并发拉取互不影响，拉取失败自动沿用上一次的值
- 城市名在天气块中**单独成行**，长地名不再与天气 / 体感挤在一行：最小尺寸（255px）下「内蒙古自治区 · 呼和浩特市 · 赛罕区」这类超长地名也完整显示，不截断、不溢出不遮挡下方逐时 / 逐日与待办内容
- 手动选择的城市名同步升级为「省 · 市」，去掉了原先跟在末尾的国家段（不再出现「广州 · 广东 · 中国」）；旧配置里已保存的旧格式城市名在读取时自动规范化，无需重新设置

**修复与优化**

- IP 定位不再因单个接口波动而串到隔壁城市 — 国内接口遇风控返回 412 时自动重试并逐级降级，HTTP 3xx 重定向自动跟随；定位更稳，实测连续 4 次结果完全一致
- 看板天气块高度按「城市名单独一行」重新计算，新增的一行不会挤压下方内容

**测试**

- 地名拼装与真实定位链路 56 项全部通过：省级后缀补全（山西→山西省 / 内蒙古→内蒙古自治区 / 北京→北京市）、直辖市同名去重（北京市 · 东城区）、旧配置规范化、真实 IP 定位（连续 4 次结果一致、无英文地名降级）、逆地理（忻州 / 北京 / 广州三地坐标）、城市搜索名称格式
- 信息看板真实渲染 65 项全部通过：三级地名正确上屏、城市名独立成行、最小尺寸（255px）与超长地名均不截断不溢出、逐时 / 逐日 / 日历 / 待办无回归、点击城市名仍可正常打开搜索编辑器
- 回归：音律动效绘制 36 项、组件宿主交互 15 项、设置页真实渲染 49 项 — 全部 0 失败、0 控制台错误

## v1.18.1 客户端输入焦点修复

**修复问题**

- 修复在客户端里「桌面组件 → 信息看板内容」无法输入与保存的问题 —— 根因是桌面看板编辑会话不会收尾：桌面看板编辑器判不了「点了窗口外面」（覆盖层鼠标穿透，窗口外点击根本收不到），用户从桌面切回客户端后，主进程的看板编辑焦点守卫仍每 150ms 把前台抢回桌面看板 —— 客户端输入框能点出聚焦态、却收不到任何键击，输入法组词反复被取消。现改为「切走即收尾」：编辑焦点守卫发现前台已是本应用客户端界面时不再抢焦点、直接收尾结束编辑会话（恢复窗口 NOACTIVATE 并通知渲染页关闭编辑器）；客户端窗口获得焦点时同样触发收尾；桌面看板渲染页失焦后延迟确认自动关闭编辑器
- 修复快捷方式列表搜索栏「点击后就被取消、无法输入」的问题 —— 与上一条同根因：键盘焦点被本应用的覆盖层窗口抢走。除上述收尾链路外，本次为客户端窗口补上键盘焦点守卫：客户端失焦后短延时复查，若前台被本应用自己的桌面覆盖层（壁纸窗 / 转盘 / 收纳区 / 组件窗 —— 常见于视频壁纸循环交界等 Windows 重新分配前台的时机）拿走，立即把前台还给客户端；前台在外部程序 = 用户主动切走，尊重不抢
- 修复客户端每次获得焦点都重设一次窗口不透明度的问题 —— 透视调参对账原先无条件下发「复原 1」，而 Electron 的 setOpacity 只加不减 `WS_EX_LAYERED` 分层样式，客户端窗口因此长期处于分层窗口状态；现按目标值去重（复原请求与淡出请求一样，值变了就一定下发），仅在确实处于 / 可能处于淡出态时才强制对账
- 信息看板输入框（天气城市 / 添加日程 / 添加待办）补齐深色主题样式：此前完全没有任何样式，在深色界面里是浏览器默认的白底黑字输入框，与整体观感割裂

**测试**

- 渲染层离线验证 100 项全部通过（渲染进程 0 错误 / 0 警告）：动效绘制逻辑 36 项、组件宿主交互推送 15 项、真实设置页 49 项（含搜索栏输入即过滤、看板城市搜索 / 添加待办 / 添加日程的保存链路与列表上屏回归）
- 真机功能测试 37 项通过：应用启动与 8 个页面、真实 UI 操作落盘到 config.json、看板输入回归、动效窗创建与真实鼠标交互推送（含 DPI 缩放换算）、渲染进程与 engine.log 零错误、进程正常退出

## v1.18.0 音律动效参数、鼠标交互与方向多色渐变

**新增功能**

- 音律动效「数量 / 高度 / 宽度」参数（8 种样式各自生效）：数量 = 元素个数（频谱条柱数 8~160、霓虹灯管数 8~128、波浪采样点 32~256、山峦峰点数 8~160、圆点列数 6~64、LED块列数 6~56、圆环放射条数 16~180、同心环环数 1~6），填 0 即按样式默认值自动；高度 = 内容高度系数 0.3~2.0（纵向缩放）；宽度 —— 柱状 / 波浪 / 点阵类为内容宽度占窗口比例 0.2~1.0（同一数量下越宽柱子越粗），圆环 / 同心环为整体尺寸系数 0.3~2.0（圆形样式由宽度统一控制尺寸，「高度」自动置灰并给出说明）。切换样式后滑杆范围、固定调整点与说明文字自动对应
- 音律动效鼠标划过交互：鼠标扫过动效时产生对应反馈 —— 光标附近的柱子被拉高（≤1.3 倍）、波形叠加从光标扩散的涟漪、山体局部隆起并加粗顶部亮线、圆点与 LED 块在光圈内额外点亮、同心环出现跟手亮段、圆环按角向拉长，另有通用的光标光晕与反馈圆环。交互强度 0.2~2.0 可调，可整体开关。**动效层仍然保持鼠标穿透**（位置由主进程光标轮询推送，不接管鼠标事件），桌面图标照常点击、不挡任何操作
- 音律动效方向多色渐变：渐变方式扩展为「纯色 / 亮色 / 方向多色」；方向多色支持 **8 个方向**（→ ← ↓ ↑ 与四个斜向）与 **2~6 种颜色**自定义（点色块改色、✕ 删色、＋ 加色），并附彩虹 / 日落 / 极光 / 霓虹 / 海洋 / 蜜桃 6 组配色预设。颜色沿指定方向依次排布 —— 从左往右、从上往下都能依次呈现多种颜色（山体填充与顶部亮线同源铺色）

**修复与优化**

- 修复动效窗创建后输入轮询最长延迟约 4 秒才启动的问题 —— 这段时间里桌面组件点不动、动效划过也没有反馈；现窗口创建即拉起轮询（本次功能测试实测发现并修复）
- 数量 / 高度 / 宽度调大后内容不再溢出窗口：超出部分与倒影统一等比回收，主体与倒影水面线始终对齐，不会出现倒影错位或裁切
- 兼容性：旧配置的 `gradient` 字段继续生效（未设新的渐变方式时按旧字段推导），「纯色 / 亮色 + 默认参数」下的观感与 v1.17.2 保持一致，升级无需任何手动调整

**测试**

- 真机功能测试 33 项全部通过：应用启动与 8 个页面、新控件齐全与随样式联动、真实 UI 操作落盘到 config.json、动效窗创建与画布初始化、真实鼠标移入 / 移出 / 窗内移动的交互推送（含 DPI 缩放换算校验）、动效窗鼠标穿透不变、关闭动效后窗口销毁、渲染进程与 engine.log 零错误
- 渲染层离线验证 100 项全部通过：数量 / 高度 / 宽度递增、8 个方向的渐变走向与色标、山体填充取向、交互开关成对断言、8 样式 × 8 方向无异常、主进程交互推送的进出 / 节流 / 开关互斥

## v1.17.2 卸载后开机自启残留修复

**修复问题**

- 修复卸载客户端后重启电脑，「客户端突然启动、壁纸还在播放」的问题 —— 根因是卸载器清理开机自启时删错了注册表值名：Electron 在 Windows 上写入 `HKCU\...\Run` 的登录项**值名是应用 ID（AppUserModelId）**（本应用为 `com.alinyu.wallpaperstudio`，未设自定义 ID 的历史版本为 `electron.app.壁纸工坊`），而旧卸载器删除的是应用名「壁纸工坊 / wallpaper-studio」—— 从未命中真实登录项，卸载后自启项必然残留
- 修复「设置里已关闭开机自启，重启后客户端仍自启」的问题 —— `setLoginItemSettings` 只管理当前值名，历史版本写错值名的残留项关不掉；现客户端启动时自动清理「历史值名 + 数据指向本应用 exe」的残留项（与自启开关状态无关），卸载器侧同步按真实值名静态删除 + 枚举 Run 键按安装路径前缀兜底
- 多安装环境互不误伤：卸载 A 处安装不会清掉 B 处安装的自启项（按安装路径精确匹配）；本修复已用 NSIS 隔离模拟 + 注册表探针双向验证（应删全删、应留全留）

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

## 搜索关键词 / Keywords

**品牌词 / Brand**：壁纸工坊 · wallpaper-studio · Wallpaper-Studio · wallpaper studio · Wallpaper Studio · 壁纸工坊 Wallpaper-Studio · 壁纸工坊（Wallpaper-Studio） · 壁纸工坊（wallpaper-studio） · 壁纸工坊（Wallpaper Studio） · 壁纸工坊（wallpaper studio） · 壁纸工坊(Wallpaper-Studio) · 壁纸工坊(wallpaper-studio) · 壁纸工坊(Wallpaper Studio) · 壁纸工坊(wallpaper studio)

**中文**：壁纸工坊 · 壁纸引擎 · 壁纸软件 · 动态壁纸 · 视频壁纸 · 桌面壁纸 · 动态桌面 · 桌面美化 · 壁纸下载 · 免费壁纸引擎 · 开源壁纸软件 · Windows 11 动态壁纸 · Windows 10 视频壁纸 · Wallpaper Engine 免费 · Wallpaper Engine 替代 · 桌面组件 · 桌面便签 · 快捷方式转盘 · 文件收纳 · 音律动效

**English**: Wallpaper Studio · Wallpaper Engine · WallpaperEngine · wallpaper engine download · live wallpaper · video wallpaper · animated wallpaper · dynamic wallpaper · desktop wallpaper · desktop customization · desktop widgets · wallpaper app · wallpaper software · free wallpaper engine · open source Wallpaper Engine alternative · Windows wallpaper software · Electron wallpaper · mpv · audio visualizer

## License

本项目 **壁纸工坊 Wallpaper Studio** Copyright (C) 2026 Alinyu330，以 **GNU GPL-3.0-or-later** 发布（许可证全文见 [LICENSE](LICENSE)）。

- ✅ **可以自由**：安装使用（个人 / 学习 / 企业内部使用免费，无需授权）、研究修改、再分发原版或修改版 —— 但再分发必须同样以 GPL-3.0 开源、保留版权声明与署名
- ❌ **明确禁止（超出授权范围，构成违反许可证与著作权侵权）**：修改后**闭源发布或销售**（含改名 / 换图标 / 换皮 / 重新打包安装包）、去除或篡改版权声明与署名、把本软件当作自有产品上架或投放下载站、商业使用却不履行开源义务
- 💼 **商业授权（双许可）**：需要闭源商用、OEM 预装、白标版本或并入非 GPL 兼容产品，请通过 [Issues](https://github.com/Alinyu330/wallpaper-studio/issues) 洽谈付费商业授权

完整条款、禁止行为清单与维权声明见 [COPYRIGHT.md](COPYRIGHT.md)。安装包首次运行前的许可页同样载明上述内容。

> 随附的第三方组件（mpv、Electron/Chromium、Node 依赖、内置壁纸素材）各自适用其原始许可证，版权归其原作者所有。
