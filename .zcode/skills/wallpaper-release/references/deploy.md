# 部署细节（GitHub Pages & CloudFlare Pages）

官网介绍页 = `docs/` 目录，两个站点内容同源，保持一致即可。

## 1. GitHub Pages（alinyu330.github.io/wallpaper-studio）

- 由 `.github/workflows/pages.yml` 驱动，Source 已设为 **GitHub Actions**。
- 触发条件：push 到 `main` 且改动包含 `docs/**`（或手动 `workflow_dispatch`）。
- 流程：checkout → configure-pages → upload-pages-artifact(docs) → deploy-pages。
- 访问地址：`https://alinyu330.github.io/wallpaper-studio/`
- 查看部署状态：仓库 **Actions** 标签 → 选 "Deploy Docs to Pages" 工作流。
- 若页面 404：确认仓库 Settings → Pages → Source = GitHub Actions；且 `docs/index.html` 存在。

## 2. CloudFlare Pages（wallpaper-studio.pages.dev）

- 项目名：`wallpaper-studio`（与 `https://wallpaper-studio.pages.dev/` 对应）。
- 部署命令（在仓库根执行）：
  ```bash
  npx wrangler pages deploy docs --project-name wallpaper-studio
  ```
- 鉴权（二选一）：
  - 交互登录：`npx wrangler login`（浏览器授权，本地持久化）。
  - CI / 无头环境：设置环境变量 `CLOUDFLARE_API_TOKEN`（需 Pages 编辑权限）。
- 查看部署与预览：CloudFlare 控制台 → Pages → wallpaper-studio；或
  ```bash
  npx wrangler pages deployment list --project-name wallpaper-studio
  ```
- 自定义域名（可选）：在 CloudFlare Pages 项目设置里绑定自有域名；当前默认 `*.pages.dev`。

## 3. 发布安装包（GitHub Release）

- 由 `.github/workflows/release.yml` 驱动，触发条件：`push` tag `v*`（或手动）。
- 流程：checkout → setup-node(20) → `npm ci` → `npm run get-mpv` → `npm run build` →
  upload-artifact + `softprops/action-gh-release` 上传 `dist/*.exe`。
- 因此**不要在本地手动上传 exe**；本地 `npm run build` 仅用于验证，验证后可删除 `dist/*.exe`。
- 本机未安装 `gh` CLI，Release 一律走 CI；tag 推送后即自动触发。
- 中文说明：CI 使用 `generate_release_notes: true`，发布后到 GitHub Releases 页面补充中文更新日志。

## 4. 常见排错

| 现象 | 原因 / 处理 |
|------|------------|
| CloudFlare 部署报 401/403 | 未登录或 token 无权限 → `wrangler login` 或重设 `CLOUDFLARE_API_TOKEN` |
| GitHub Pages 仍是旧版 | `docs/` 改动未 push、或 pages.yml 未触发 → 确认 `git push` 且含 `docs/**`；可手动 Run workflow |
| Release 没生成 exe | tag 未以 `v` 开头、或 release.yml 失败 → 检查 Actions 日志；确认 `vX.Y.Z` 格式 |
| 安装包装好后无 mpv 内核 | 构建机未拉到 mpv → 确认 `scripts/get-mpv.ps1` 在 CI 中执行且无网络阻断 |
| 本地 `npm run build` 很慢/失败 | 大依赖 + 首次打包；确认 `npm install` 与 `assets/mpv` 就位 |

## 5. 关键路径速查

- 官网源：`docs/index.html`（含 `docs/app-screenshot.png`、`docs/favicon.png`）
- 构建配置：`package.json` 的 `build` 段（appId/productName/nsis/artifactName）
- CI：`D:\WallPaper\.github\workflows\pages.yml`、`release.yml`
- 安装包产物：`D:\WallPaper\dist\`（不入库，CI 生成）
- 本地运行：`npm start`；开发模式：`npm run dev`
