# 壁纸工坊 Wallpaper Studio

免费开源的 Windows 桌面壁纸软件 — 让桌面动起来。

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4)
![Version](https://img.shields.io/badge/version-1.1.0-7c5cff)

## 功能特性

- **四类壁纸**：静态图片（JPG/PNG/BMP/WEBP/GIF）· 动态视频（MP4/AVI/MKV/FLV/WebM/MOV）· 网页（URL/本地 HTML）· EXE 程序
- **mpv 播放引擎**：全格式硬解直读，无需转码，内置完整解码器
- **参数精确调节**：播放速度（0.25×–4×）、音量、亮度、对比度、饱和度；每项参数均有固定调整点一键跳转 + 数值精确输入
- **实时预览**：按主显示器真实比例预览；预览区可放大缩小；支持弹出独立预览窗口，参数实时同步
- **深度性能优化**：GPU 硬解 · 渲染分辨率限制（原生/1080P/720P/480P）· 渲染质量三档 · 全屏应用自动暂停/恢复
- **桌面与锁屏**：壁纸嵌入系统 WorkerW 层（图标层之下），多显示器铺满；图片壁纸一键同步为 Windows 锁屏背景
- **壁纸管理**：收藏 · 搜索 · 类型筛选 · 自动轮换 · 双击应用 · 托盘常驻
- **稳定看门狗**：壁纸窗口丢失自动恢复、桌面层级变化自动重挂载、播放状态自动对账

## 下载

前往 [Releases](https://github.com/Alinyu330/wallpaper-studio/releases) 下载最新版安装包。

官网介绍页：[GitHub Pages](https://alinyu330.github.io/wallpaper-studio/)

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
├── main.js               # 主进程：窗口/壁纸引擎调度/IPC/托盘
├── preload-main.js       # 主界面桥接
├── preload-wallpaper.js  # 壁纸窗口桥接
├── preload-preview.js    # 预览弹窗桥接
├── src/
│   ├── desktop.js        # 桌面嵌入（WorkerW 挂载/全屏检测/多显示器）
│   ├── mpv.js            # mpv 播放控制器（IPC/参数/分辨率限制）
│   ├── exe-wallpaper.js  # EXE 壁纸嵌入控制器
│   ├── lockscreen.js     # 锁屏壁纸（PersonalizationCSP）
│   ├── store.js          # 配置持久化
│   └── file-types.js     # 文件类型识别
├── renderer/             # 界面（主界面/壁纸窗口/预览弹窗）
├── assets/mpv/           # mpv 播放器（npm run get-mpv 下载，不入库）
├── scripts/              # 辅助脚本（mpv 下载）
└── docs/                 # 官网（GitHub Pages）
```

## License

MIT
