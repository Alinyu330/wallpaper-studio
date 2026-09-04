---
name: wallpaper-release
description: "壁纸工坊 Wallpaper Studio（Electron 桌面壁纸软件，仓库 Alinyu330/wallpaper-studio）的『自动测试 → 备份推送 → 发版部署』一站式技能。当需要：发布前自动测试已完成的软件功能（本地构建安装包 + CDP 冒烟测试 + GUI 视觉验证）、把改动提交推送到 GitHub 备份、同步更新 README 与官网介绍页 docs/index.html、打 git tag 触发 CI 生成客户端安装包（NSIS exe）与 GitHub Release、部署 GitHub Pages 与 CloudFlare Pages（wallpaper-studio.pages.dev）、补写中文更新日志、产出内部/外部使用说明时使用。触发词：发布、上线、部署、打 tag、出安装包、测试后发版、更新官网/介绍页、推送到 github、release、打包、发版、backup and release。"
---

# wallpaper-release — 自动测试 + 一键发布部署

把"写代码/调界面"与"测试 → 发版上线"分开：本技能只负责后者。发布前必须先通过自动测试，测试不过一律回修复测，不进入发布流程。

## 何时使用

- 一段开发完成，需要先**自动测试**、通过后**备份推送 GitHub** 并**发布新版本**时。
- 仅需把当前改动推送到 GitHub 做"部分备份"时（跑完阶段 1、2 即止）。
- 需要同步刷新 README 与官网介绍页（docs/index.html）、打 tag、出安装包、创建 Release、部署 GitHub Pages 与 CloudFlare Pages 时。

## 流程总览

| 阶段 | 内容 | 停点 |
|---|---|---|
| 0 | 确认范围与版本号 | 与用户确认 |
| 1 | **自动测试**：本地构建 → CDP 冒烟 → GUI 视觉验证 | 失败即停，循环修复 |
| 2 | 备份提交并推送 GitHub | ★**确认点 1**：展示测试报告 |
| 3 | 版本号与 README / 官网页面内容更新 | — |
| 4 | release 提交 + 打 tag + 推送（触发双 CI） | ★**确认点 2**：推送 tag 前 |
| 5 | CI 监控、安装包与 Release 就绪、补中文更新日志 | — |
| 6 | 验证 GitHub Pages 与 CloudFlare Pages 部署生效 | — |
| 7 | 产出使用说明、链接汇总与回滚指引 | — |

## 前置条件（每次执行前确认）

- 工作目录为仓库根 `D:\WallPaper`，当前分支 `main`，`git fetch && git status -uno` 与远端同步。
- `node` / `npm` / `py` 可用（**本机必须用 `py` 而非 `python`**，见注意事项；`npm install` 已装过依赖）。
- `assets/mpv/` 存在（没有则先 `npm run get-mpv`，否则安装包缺视频内核）。
- `git remote origin` = `https://github.com/Alinyu330/wallpaper-studio.git`。
- **本机未安装 `gh` CLI**：Release 一律由 CI（`.github/workflows/release.yml`）在 tag 推送后自动构建创建，不要尝试 `gh release` 本地创建。
- 两个 CI 由仓库自带工作流驱动：push tag `v*` → 构建安装包并创建 Release；push main 且 `docs/**` 变更 → 部署双 Pages。

---

## 阶段 0｜确认范围与版本号

1. `git status` 摸底：列出已改/未跟踪文件；根目录散落大量临时截图与调试脚本（`full-*.png`、`screen-*.png`、`tmp-*.js` 等），**提交清单必须逐文件与用户核对**。
2. 与用户确认：① 本次发布包含哪些已完成的功能点（写更新文案用）；② 新版本号（读 `package.json` 的 `version`，默认 patch+1）。
3. 汇总变更：`py .zcode/skills/wallpaper-release/scripts/gen_changelog.py`（或 `git log <上个tag>..HEAD --oneline`）。

## 阶段 1｜自动测试（核心门禁，任一步失败即停）

按 `references/testing.md` 的详细指南执行，概要：

1. **本地构建验证**：`npm run build` → 确认生成 `dist/WallpaperStudio-Setup-<ver>.exe` 与 `latest.yml`。本地构建只做验证，产物不入库、不手动上传（正式包由 CI 出）。卡死处置见 testing.md 第 5 节。
2. **CDP 冒烟测试**：
   ```bash
   node .zcode/skills/wallpaper-release/scripts/smoke-test.js --extra tmp-feature-checks.js
   ```
   按 testing.md 第 3 节，针对**本次开发的功能**编写 `tmp-feature-checks.js` 专项断言（用完删除）。测试实例以 `WALLPAPER_DATA_DIR=tmp-smoke-data` 隔离运行，不碰用户真实配置。
3. **GUI 视觉验证**：用 `--keep` 跑冒烟测试后，以 computer-use 实际操作界面核对新功能生效（每步截图）。涉及真实切换桌面壁纸的验证先征询用户。
4. 失败处理：逐项修复 → 重跑全部测试 → 直到全 PASS。测试报告在 `tmp-smoke-report/report.md`。
5. 清理：关闭测试实例；临时断言文件与 tmp 目录可删。

### ★ 确认点 1

向用户展示：测试报告摘要（断言通过数、截图结论、发现的错误）、本次将纳入提交的文件清单、功能点与新版本号。**确认后**才进入发布流程。用户只想备份 → 执行阶段 2 后即止。

## 阶段 2｜备份提交并推送 GitHub

1. `git add <核对过的文件清单>` → `git commit -m "feat/fix/chore: <简短描述>"`。
2. 推送（本机凭据在 git-credential-manager，须显式指定 helper）：
   ```bash
   git -c credential.helper="!git-credential-manager" push origin main
   ```
3. **git smart-http 被代理完全阻断时**（502/empty reply，挂 10~25 分钟必败，但 api.github.com 返回 200）：改走 GitHub Git Database API 旁路推送——逐文件 `git show <commit>:<path>` → POST /git/blobs（base64）→ POST /git/trees（base_tree=parent tree）→ POST /git/commits（author/committer/message/时间戳全部复刻本地提交，远端 SHA 与本地逐字节一致）→ PATCH /git/refs/heads/main；随后 `git update-ref refs/remotes/origin/main <sha>` 同步跟踪引用。用 python urllib 直连 api.github.com 即可。
4. 新增的技能文件 `.zcode/skills/wallpaper-release/`（若尚未入库）随本提交一并入库。

## 阶段 3｜版本号与 README / 官网内容更新

1. 预览后实跑版本号同步（package.json / README / docs 三处"当前版本"）：
   ```bash
   py .zcode/skills/wallpaper-release/scripts/bump_version.py <old> <new> --dry-run
   py .zcode/skills/wallpaper-release/scripts/bump_version.py <old> <new>
   ```
   脚本故意不改历史特性注解，末尾会列出残留旧版本字样供人工复核。
2. **README.md**：功能特性区补新功能条目（带 `vX.Y.Z` 标注）；文首下载区的新功能语句人工补写。
3. **docs/index.html（官网）**：把上一版的"最新"更新日志块**下沉为历史版本块**，写入本次版本的功能/修复列表；确认 Hero 徽标、CTA、下载链接版本号全部就位；必要时替换 `docs/app-screenshot.png`。
4. 浏览器打开 `docs/index.html` 本地预览排版与链接。

## 阶段 4｜release 提交 + 打 tag（触发双 CI）

1. `git add package.json README.md docs/`（及其他源码/资源改动）→ `git commit -m "release: vX.Y.Z — <一句话特性>"` → `git tag vX.Y.Z`（沿用轻量 tag 惯例）。
2. ### ★ 确认点 2
   向用户展示：新版本号、docs 更新日志正文、README 改动、即将创建的 tag 与 release 提交。**明确确认后**再推送——tag 一推送即对外触发正式发布。
3. `git -c credential.helper="!git-credential-manager" push origin main --tags`（代理阻断时按阶段 2 的 API 旁路方案分别推 main 与 `refs/tags/vX.Y.Z`）。此步同时触发：
   - `release.yml`：Windows 构建 exe → 创建 GitHub Release 并上传（含 latest.yml / blockmap，供应用内更新器用）。
   - `pages.yml`：部署 GitHub Pages 与 Cloudflare Pages。

## 阶段 5｜CI 监控与中文 Release 说明

1. 轮询等待 Release 就绪：本机直连 api.github.com 若被 TLS 拦截，用 electron 的 net 模块或 python urllib 走可用通道；`GET /repos/Alinyu330/wallpaper-studio/releases/tags/vX.Y.Z` 每 25s 一次。**Actions 偶发网络抖动挂 25~40 分钟会自愈，勿 cancel run**（cancel 已完成的 run 返回 409 属正常）。
2. Release 创建后立即 **PATCH 中文 markdown body**（CI 的 `generate_release_notes` 是英文 commit 列表，而新版客户端「检查更新」弹窗直接读 Release body 展示）：`PATCH /repos/.../releases/<id>`，body 用中文、含功能点，支持 # 标题 / - 列表 / **粗体**。
3. 确认 asset 齐全：`WallpaperStudio-Setup-<ver>.exe` + `latest.yml` + `.blockmap`。

## 阶段 6｜验证双 Pages 部署生效

1. GitHub Pages：抓取 `https://alinyu330.github.io/wallpaper-studio/`；Cloudflare Pages：抓取 `https://wallpaper-studio.pages.dev/`。确认页面版本号已更新为新版（两个地址内容同源于 `docs/`）。
2. 未生效时排查（见 `references/deploy.md`）：Actions 里 pages.yml 是否成功；Cloudflare job 依赖仓库 Secret `CLOUDFLARE_API_TOKEN`。
3. 紧急兜底：本地 `npx wrangler pages deploy docs --project-name wallpaper-studio` 直推 Cloudflare（需 wrangler login 或设置 `CLOUDFLARE_API_TOKEN`）。

## 阶段 7｜收尾

1. 按 `references/usage-template.md` 生成根目录 `RELEASE-vX.Y.Z-USAGE.md`（内部使用方法 + 外部使用方法），`docs: vX.Y.Z 发布使用说明` 提交推送（**不打新 tag**）。
2. 向用户输出链接汇总：GitHub Releases 页、GitHub Pages、Cloudflare Pages、最新 exe 直连（`releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe`）与国内加速镜像（gh-proxy / ghfast 前缀）。
3. 附回滚指引：删除 tag（`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z`）+ 删除 GitHub Release（API 或网页），修复后重新打 tag 即重走全部 CI。

---

## 注意事项 / 常见陷阱（历史实测沉淀）

- **先测后发**：阶段 1 全 PASS 是铁门槛；测试实例数据目录隔离，别把 `WALLPAPER_DATA_DIR` 指回真实 AppData。
- **`python` 在本机不可用**：`python` / `python3` 是 Microsoft Store 占位别名（静默无输出、退出码 49），必须用 **`py`**（Python 3.13）调用脚本。
- **勿提交大体积临时文件**：根目录散落调试截图（数 MB~10MB+），`git add` 前逐文件核对。
- **凭据**：`git push` 默认可能报 `could not read Username`，必须 `-c credential.helper="!git-credential-manager"`。
- **gh CLI 不存在**：一切 Release 操作靠 CI + GitHub API（electron net / python urllib 通道）。
- **CI 卡顿勿 cancel**：npm ci / wrangler 下载挂 25~40 分钟会自愈。
- **本地构建卡死**：`dist/win-unpacked` 残留导致 packaging 无限挂起 → taskkill 进程树 → 删目录重跑（详见 testing.md）。
- **bump 只改版本号不改文案**：docs 旧"最新"块下沉、README 功能条目、历史注解均人工处理。
- **tag 即发布**：推 tag 前务必完成确认点 2。
- **本地 exe 不上传**：正式安装包只由 CI 产出，避免双产物冲突。
- **本技能文件随仓库入库**（`.zcode/` 未被 ignore），迭代本技能后随下次备份提交。

## 参考文件

- `scripts/smoke-test.js` — CDP 冒烟测试框架（内置断言 + 专项断言 + 截图 + 错误捕获 + 报告）。
- `scripts/bump_version.py` — 版本号跨文件同步（package.json / README / docs/index.html）。
- `scripts/gen_changelog.py` — 本次发版的 commit 汇总生成。
- `references/testing.md` — 三层测试设计、专项断言写法、GUI 验证规则、测试类踩坑。
- `references/deploy.md` — GitHub Pages 与 Cloudflare Pages 部署细节与排错。
- `references/usage-template.md` — 内部/外部使用说明模板。
