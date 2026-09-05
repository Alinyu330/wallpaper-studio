---
name: 版本发布更新
description: 壁纸工坊发版后的信息同步与部署。更新介绍网页（docs/index.html）、README、GitHub Releases 信息——新版安装包链接与版本信息放旧版前面、维护全部历史版本下载表（已有链接才放，不虚构）、核对更新 tags、备份提交推送代码、部署并验证 GitHub Pages 与 CloudFlare Pages。当用户提到：更新介绍网页 / 官网信息、更新 README 下载链接、历史版本下载表、更新 tags、发版后部署验证，或任何"发布完成后同步各处版本信息"的场景时使用；与 wallpaper-release（一站式发版全流程）配套，本技能聚焦发版前后的信息更新与部署验证。内外部通用：本文件随仓库分发，.zcode 目录内为 ZCode 自动执行流程，「人工手动流程」一节为无 ZCode 时可照做的完整命令。
---

# 版本发布更新 — 发版信息同步与部署验证

把「代码发版」之后的信息同步收敛为一条固定流水线。核心纪律只有两条：

1. **新版在前**：任何出现版本列表的地方（下载区、历史版本表、更新日志块、Releases 名称），新版本永远排在旧版本前面。
2. **已有链接才放**：只引用 GitHub Releases 上真实存在的安装包资产（exe + latest.yml + blockmap 齐全才算发成功），绝不虚构下载链接；没有资产的历史版本不生成链接，改引 Releases 页面。

## 适用场景

- 用户说「更新介绍网页 / 官网信息 / README 下载链接 / 历史版本表 / 更新 tags / 发版后部署验证」
- wallpaper-release 技能完成「构建→测试→打 tag→CI 出包」后，同步各处版本信息
- 未改 docs 的纯信息提交：网页内容不变时无需重部署，但**改了 docs/index.html 必须验证双 Pages 生效**

## 前置条件（每轮核对）

```bash
cd D:\WallPaper
git fetch && git status -uno        # 与远端同步，无未预期的脏文件
grep '"version"' package.json       # 确认目标版本号
```

- 本机无 `gh` CLI：Release 名称/说明修改走 GitHub REST API（见步骤 4）
- `py` 可用（勿用 `python`，本机是 Store 占位别名）；仓库已装依赖
- 个人/私有目录不入库：`收纳*(卸载恢复)/`、`tmp-*`、`.qoder/` 均已 gitignore，提交前 `git status` 逐项核对

## 自动流程（ZCode 执行）

### 步骤 1｜盘点现有版本资产（决定"放哪些链接"）

```bash
git tag -l | sort -V                          # 本地 tags
git ls-remote --tags origin | grep -o "refs/tags/v[0-9.]*"   # 远端 tags
NODE_OPTIONS=--use-system-ca node -e "<GET /repos/Alinyu330/wallpaper-studio/releases?per_page=30，打印 tag_name + assets>"
```

只把**资产三件套齐全**（exe/latest.yml/blockmap）的版本写进下载表。若发现本地有、远端没有的 tag：`git push origin <tag>` 补推（注意：推 tag 会触发该版本的 release.yml CI）。

### 步骤 2｜更新三处信息（全部"新版在前"）

1. **docs/index.html（官网）**
   - Hero 下载按钮 / cta-note 版本号 → 新版本
   - 「更新日志与历史版本」：新版本块（`<span class="tag">最新</span>`）插到最前，**把原最新块降级为普通历史块**（补真实下载链接），顺序严格新→旧
   - `sec-sub` 的「当前版本」同步
2. **README.md**
   - 「下载」区最新版句子 + 三个链接 → 新版本
   - 「历史版本下载」表：新版本行插到表格最前（列：版本 | 国内加速下载 | GitHub 直连；链接格式 `https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe`）
   - 「新增功能与修复问题」分节：新版本小节插到最前
   - 可用 `py .zcode/skills/wallpaper-release/scripts/bump_version.py <old> <new>` 同步版本号字符串（注意：该脚本只替换版本号，**块下沉与文案必须人工处理**；脚本跑完按提示复核残留旧版本字样）
3. **GitHub Releases**
   - 新 Release 由 tag 推送触发 CI 创建（生成英文 commit 列表）；创建后**立即 PATCH 中文说明**——客户端「检查更新」弹窗直读 Release body
   - 旧 Release 不动

### 步骤 3｜tags 核对与推送

本地与远端 tag 集合应一致；发版打 tag：`git tag vX.Y.Z`。tags 随 `git push origin main --tags` 一起推。

### 步骤 4｜提交推送 + 中文 Release 说明 + 部署验证

```bash
git add README.md docs/index.html <其他改动>
git commit -m "docs: vX.Y.Z 信息同步" 
git -c credential.helper="!git-credential-manager" push origin main --tags
```

- **凭据**：push 必须显式 `-c credential.helper="!git-credential-manager"`，否则报 could not read Username
- **代理被阻断时**（smart-http 502/empty reply 挂 10~25 分钟）：改走 GitHub Git Database API 旁路（逐文件 blobs→trees→commits→PATCH ref），见 wallpaper-release 技能阶段 2
- **中文说明 PATCH**：GET `/repos/Alinyu330/wallpaper-studio/releases/tags/vX.Y.Z` 拿 release id（轮询等资产齐全）→ PATCH `/releases/<id>`，token 从 `git credential fill` 取（password 字段）；GET 公开无需 token，PATCH 401 时补 `Authorization: Bearer <token>`
- **TLS**：node 直连 api.github.com 报证书链错误时加 `NODE_OPTIONS=--use-system-ca`
- **CI 勿 cancel**：Actions 网络抖动挂 25~40 分钟会自愈；cancel 已完成的 run 返回 409 属正常

### 步骤 5｜部署验证（改了 docs 才需要）

轮询（每 25~30s，最多 ~10 分钟）直到两个地址都包含新版本号与新版本关键字：

```bash
curl -s https://wallpaper-studio.pages.dev/ | grep -c "vX.Y.Z"
curl -s https://alinyu330.github.io/wallpaper-studio/ | grep -c "vX.Y.Z"
```

未生效 → 查 Actions 里 pages.yml；紧急兜底 `npx wrangler pages deploy docs --project-name wallpaper-studio`。

## 人工手动流程（无 ZCode 照做）

1. 改 `docs/index.html`：复制上一个版本的 `<div class="ver-block">` 整块贴到最前，改版本号、更新内容、下载链接；原最新块去掉 `最新` 标签降级；Hero 按钮文字与 cta-note 版本号替换。
2. 改 `README.md`：下载区链接替换为新版本；历史版本下载表第一行插入新版本行；「新增功能与修复问题」最前加新版本小节。
3. `git tag vX.Y.Z && git -c credential.helper="!git-credential-manager" push origin main --tags`
4. 等 GitHub Actions 的 release.yml 跑完（Releases 页看到 exe/latest.yml/blockmap），到 Release 页面点 Edit，把名称与正文换成中文说明。
5. 等 pages.yml 跑完，浏览器打开两个官网地址 Ctrl+F5 验证版本号。
6. 回滚：`git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z` + GitHub 页面删除对应 Release。

## 验收清单

- [ ] 三处信息（官网 / README / Releases）新版本号一致，新版内容都在旧版前面
- [ ] 历史版本表只含资产齐全的版本；抽点 2 个旧链接（浏览器或 curl -I）确认 200
- [ ] 本地与远端 tags 集合一致
- [ ] Release body 为中文（客户端检查更新弹窗直读）
- [ ] 双 Pages 均包含新版本号与新版本关键字
- [ ] `git status` 干净（无个人目录 / tmp 产物误入库）
