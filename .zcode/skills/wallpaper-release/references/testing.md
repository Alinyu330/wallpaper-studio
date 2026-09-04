# testing.md — 发布前自动测试设计指南

壁纸工坊没有单元测试框架，发布门禁由三层构成，从快到慢依次执行，任一层失败即停止发布流程：

| 层 | 内容 | 工具 | 耗时 |
|---|---|---|---|
| 1 | 本地构建验证（能出安装包） | `npm run build` | 1~3 分钟 |
| 2 | CDP 冒烟测试（启动应用 + 脚本断言 + 截图 + 错误捕获） | `scripts/smoke-test.js` | 约 1 分钟 |
| 3 | GUI 视觉验证（真实操作界面，核对新功能） | computer-use（桌面控制） | 数分钟 |

## 1. 环境隔离原理

- `main.js` 支持 `WALLPAPER_DATA_DIR` 环境变量重定向数据目录。`smoke-test.js` 固定把测试实例的数据目录指到仓库根的 `tmp-smoke-data/`，**不读写用户真实的 AppData 配置**。
- Electron 单实例锁按 userData 路径隔离，因此测试实例可与正在运行的正式实例并存；但**建议测试前先关闭正式实例**——避免桌面弹窗/托盘干扰，也避免测试期间真把东西铺到桌面。
- 测试实例配置从零开始，天然覆盖"首次启动"路径。
- `tmp-smoke-data/`、`tmp-smoke-report/` 均以 `tmp-` 开头，被 `.gitignore` 的 `tmp-*` 规则忽略，永远不会误入库。

## 2. smoke-test.js 用法

仓库根执行（Windows Git Bash）：

```bash
# 内置冒烟检查（导航/区块/版本号/逐页点击/错误捕获/截图）
node .zcode/skills/wallpaper-release/scripts/smoke-test.js

# 附加本次新功能专项断言（文件名必须 tmp- 开头以便自动忽略）
node .zcode/skills/wallpaper-release/scripts/smoke-test.js --extra tmp-feature-checks.js

# 测完不杀应用——供 computer-use GUI 视觉验证直接续用
node .zcode/skills/wallpaper-release/scripts/smoke-test.js --keep
```

内置断言清单（改动主界面结构时同步维护本脚本）：

- 主窗口（index.html）存在；壁纸渲染层（wallpaper.html）已创建
- 8 个导航项、8 个 `page-*` 区块齐全
- 「应用壁纸」按钮存在
- 关于页版本号 = package.json 的 version（防版本号忘同步）
- **逐页点击切换**（8 个导航逐个 click，断言对应区块与按钮高亮）——回归 v1.8.4「主界面全区域点击无响应」一类故障
- 渲染进程无未捕获异常 / console error / Log error（favicon 等无害项已白名单）
- 主进程 `engine.log`（在 tmp-smoke-data 内）无 `[error]` / 未捕获异常记录

产出：`tmp-smoke-report/report.md`（人读）+ `report.json`（机读）+ 逐页面截图；**退出码 = 是否有失败**，SKILL 流程据此决定放行或回修。

## 3. 编写本次新功能的专项断言

新建 `tmp-feature-checks.js`（用完删除，tmp- 前缀保证不入库），模式与根目录历史脚本 `cdp-test.js` 一致：

```js
// tmp-feature-checks.js — vX.Y.Z 专项断言示例
module.exports = async (ctx) => {
  const cdp = ctx.main;                       // 主窗口（index.html）的 Cdp 实例
  // —— 操作 UI：click / 赋值 / dispatchEvent ——
  await cdp.eval(`document.querySelector('#my-new-control').click()`);
  await new Promise((r) => setTimeout(r, 300)); // 等 UI/IPC 响应
  // —— 断言取值：读 UI 状态，不读内部变量 ——
  const val = await cdp.eval(`document.querySelector('#my-new-control').dataset.state`);
  ctx.check('新控件点击后状态切换', val === 'on', `state=${val}`);
};
```

要点：

- `ctx.check(name, ok, detail)` 是唯一登记出口，结果自动进报告。
- `ctx.main` 为 null（主窗口连接失败）时先判空。
- 需要其他窗口（launcher.html / filebox.html 等）：`const cdp2 = await ctx.attach('launcher.html');`（按 URL 子串匹配）。
- 数值输入类控件赋值后要 `dispatchEvent(new Event('change'))`，与真实用户路径一致。
- 经过主进程 IPC 往返的操作（如添加壁纸、应用设置）等待时间放宽到 800~1500ms。
- 无害的 console error 用 `ctx.ignoreError('子串')` 加白名单——**不要随意扩大**，白名单会在报告里单独计数。
- 断言尽量覆盖：控件存在 → 点击/输入生效 → 状态回显正确 → 持久化生效（可选：读 localStorage / 经 preload 暴露的配置）。

## 4. GUI 视觉验证（computer-use）

脚本断言验证"逻辑对"，GUI 验证核对"看着对"。流程：

1. 用 `--keep` 跑完冒烟测试，应用留在隔离数据目录下运行。
2. 用 computer-use 观察主窗口：逐标签页截图，核对布局/文案无错乱。
3. 实际操作走查**本次新功能**（点击、拖拽、输入），每步截图确认视觉反馈。
4. ⚠ **壁纸安全规则**：测试实例默认空配置，不会动用户桌面。若本次改动核心是壁纸应用链路、必须真实切换桌面壁纸验证，**先征得用户同意**，测完把壁纸恢复为用户原设置。
5. 验证完成后关闭测试实例（释放单实例锁与托盘图标）。

## 5. 已知坑（历史实测）

- **本地构建卡死在 packaging**：残留 `dist/win-unpacked` 会让 electron-builder 无限期挂起。处置：终止进程树 `MSYS_NO_PATHCONV=1 taskkill /F /T /PID <主进程>`（Git Bash 下 `//F` 写法失效）→ `rm -rf dist/win-unpacked` → 重跑（有缓存 1 分钟内完成）。
- **构建前必须确认 `assets/mpv/` 存在**（没有则先 `npm run get-mpv`），否则安装包缺视频内核。
- **应用启动即退出**：多为单实例锁冲突（用了与正式实例相同的数据目录）或端口被占。本脚本已用隔离数据目录规避锁冲突；换端口用 `--port`。
- **EADDRINUSE 127.0.0.1:7851**：main.js 的调试 HTTP 端口是固定的，测试实例（隔离 userData 能拿到单实例锁）会与正在运行的正式实例冲突。脚本启动前会预检该端口：被占时相关 EADDRINUSE 自动降级为"环境警告"（不计入失败），要完全干净的测试环境先关闭正式实例。
- **engine.log 里的错误**：主进程错误会写进 `tmp-smoke-data/engine.log`，脚本会扫描 `[error]` / 未捕获异常——看到大量引擎日志错误先查根因，不要忙着加白名单。
- **截图空白**：隐藏窗口（wallpaper.html 等）截图可能全黑/空白，属正常，只用于人工复核参考。
- **测后清理**：默认模式脚本自动杀进程；`--keep` 模式 GUI 验证完记得关闭应用；两个 tmp- 目录可随时整目录删除。
