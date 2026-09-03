# 壁纸工坊 Wallpaper Studio

免费开源的 Windows 桌面壁纸软件 — 让桌面动起来。

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)
![Version](https://img.shields.io/badge/version-1.7.0-7c5cff)

> **官网介绍页**：<https://wallpaper-studio.pages.dev/> （GitHub Pages：<https://alinyu330.github.io/wallpaper-studio/> ）
>
> **安装包下载**（v1.7.0，Windows x64）：
>
> - 国内加速①：[gh-proxy.com 下载](https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.0/WallpaperStudio-Setup-1.7.0.exe)
>
> - 国内加速②：[ghfast.top 下载](https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.7.0/WallpaperStudio-Setup-1.7.0.exe)
>
> - GitHub 直连：[Releases 页面](https://github.com/Alinyu330/wallpaper-studio/releases)（含全部历史版本）

## 功能特性

- **四类壁纸**：静态图片（JPG/PNG/BMP/WEBP/GIF）· 动态视频（MP4/AVI/MKV/FLV/WebM/MOV）· 网页（URL/本地 HTML）· EXE 程序

- **mpv 播放引擎**：全格式硬解直读，无需转码，内置完整解码器

- **桌面快捷方式转盘**（v1.5.0，v1.7.0 增强）：常用 App 以转盘形式收纳在桌面 — 点击图标一键启动；按住图标条或拖动条左右拖动即可像转盘一样轮换（带惯性甩动）；拖动 ⋮ 手柄自由摆放位置；同屏数量 4\~12 可调；真彩图标解析（EXE / LNK / 系统项图标高清提取）、图标垂直倒影、去面板边框更沉浸；空闲自动收起为小药丸，悬停药丸展开，不遮挡窗口、不影响壁纸观感

- **点选 / 框选收纳**（v1.6.0，v1.7.0 增强）：全屏选择器直接点选或拖框选择桌面快捷方式，一键收纳进转盘 — 原桌面图标随之隐藏（实际移动文件到应用数据目录保管）；支持回收站、此电脑等系统项收纳与过滤无效文件；从转盘移除、一键"全部恢复"或关闭功能时，自动移回桌面原位置（恢复显示）

- **平滑循环过渡 2.0**（v1.5.0）：循环交界处新画面柔和淡入覆盖（旧画面保持不透明垫底），亮度恒定、无黑变无重影；smoothstep 缓动曲线，过渡如行云流水

- **循环无感升级**（v1.6.0）：只在视频结尾定格后开始溶解（静止帧叠加，肉眼无感）；结尾 70ms 高频轮询 + 淡入 33ms 专用步进，定格停顿压缩到 0.1s 级、淡入 \~30fps 平滑无跳变，长时间循环稳定如一

- **参数精确调节**：播放速度（0.25×–4×）、音量、亮度、对比度、饱和度；每项参数均有固定调整点一键跳转 + 数值精确输入

- **实时预览**：按主显示器真实比例预览；预览区可放大缩小；支持弹出独立预览窗口，参数实时同步

- **音律动效**（v1.7.0）：系统音频实时频谱可视化，随音乐律动；条形频谱 + 垂直镜像倒影，支持渐变色、大小缩放、灵敏度调节，融入壁纸不突兀

- **桌面 DIY 组件**（v1.2.0，v1.7.0 重构）：时钟（12/24 小时制点击切换）、CPU / GPU / 内存占用率实时监控条、音量控制条、音律动效 — 每个组件独立小窗口，无边框融入壁纸；新增「调整模式」：客户端一键进入拖动调整、桌面默认只显示不误触；组件 / 音律动效 / 转盘均支持九宫格快速定位（三行三列一键吸附，保留自由拖动）

- **壁纸暂停**（v1.2.0）：一键暂停视频播放与轮换，恢复桌面清爽；支持托盘操作，重启后保持状态

- **多壁纸定时轮换**（v1.2.0）：全部/收藏/自定义列表三种范围，随机或顺序切换，间隔自由设定，工具栏一键"下一张"

- **壁纸站点导航**（v1.3.0 扩充）：内置 4K Desk、TooPIC、好壁纸、魔玉部落、Wallhaven、必应壁纸、Unsplash 等 13 个热门免费壁纸站点，点击直达

- **智能自动暂停**（v1.3.0）：全屏应用 / 笔记本电池供电 / 其他窗口最大化（Wallpaper Engine 同款）三种场景自动暂停视频壁纸省电省资源，条件解除自动恢复

- **全局快捷键**（v1.3.0）：Ctrl+Alt+W 一键暂停/恢复壁纸，游戏或任意界面可用，可开关

- **停止使用壁纸**（v1.3.0）：一键停用当前壁纸恢复系统默认桌面，壁纸库记录保留

- **深度性能优化**：GPU 硬解 · 渲染分辨率限制（原生/1080P/720P/480P）· 渲染质量三档

- **桌面与锁屏**：壁纸嵌入系统 WorkerW 层（图标层之下），多显示器铺满；图片壁纸一键同步为 Windows 锁屏背景

- **无黑屏自愈**（v1.5.0 完整生效）：播放卡死/暂停脱节时，备用引擎先在冻结画面上方渲染出画面再替换旧进程——全程无黑屏、不打断使用；结尾定格僵死、时长未知等边缘场景均有兜底修复

- **播放健康检查**（v1.3.2）：渲染冻结/暂停状态脱节自动检测恢复，引擎事件日志（`engine.log`）可回溯定位

- **壁纸管理**：收藏 · 搜索 · 类型筛选 · 双击应用 · 托盘常驻

- **稳定看门狗**：壁纸窗口丢失自动恢复、桌面层级变化自动重挂载、mpv 进程异常退出自动重启、窗口操作隔离执行器（目标窗口冻结时主进程永不阻塞，队列化派发不误伤合法操作）

## 下载

前往 [Releases](https://github.com/Alinyu330/wallpaper-studio/releases) 下载最新版及历史版本安装包（国内访问慢可用上方加速链接）。

官网介绍页：[Cloudflare Pages](https://wallpaper-studio.pages.dev/)（GitHub Pages：<https://alinyu330.github.io/wallpaper-studio/> ）

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

MIT
