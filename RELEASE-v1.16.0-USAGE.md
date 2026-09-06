# 壁纸工坊 v1.16.0 发布使用说明

> 发布日期：2026-09-06 · 本版本主题：**许可证切换为 GPL-3.0-or-later + 商业双许可，并在客户端与安装包内明确告知**

## 一、本次变更内容

| 位置 | 变更 |
|---|---|
| `LICENSE`（新增） | GNU GPL-3.0 官方全文（取自 gnu.org，35,149 B / 674 行，未作修改） |
| `COPYRIGHT.md`（新增） | 版权与许可声明：允许什么、明确禁止什么（闭源商用＝超出授权范围、构成著作权侵权）、商业授权（双许可）方式、维权声明、第三方组件说明 |
| `build/license.txt`（新增） | 安装包许可协议页文本（中文，**必须带 UTF-8 BOM**，否则 NSIS 对话框中文乱码） |
| `package.json` | `license`: MIT → `GPL-3.0-or-later`；`author`: WallPaper Studio → `Alinyu330`；`build.copyright` → `Copyright © 2026 Alinyu330 · GPL-3.0-or-later`；`build.nsis.license`: `license.txt` |
| `renderer/index.html` / `js/app.js` | 设置 → 关于 新增「许可证与版权」行 + `#btn-open-license`（打开仓库 COPYRIGHT.md） |
| `README.md` | License 徽章 → GPL--3.0--or--later；License 章节重写；版本徽章 / 直链 / 历史版本表 / 更新日志同步 |
| `docs/index.html` | 新增 `#license` 章节与导航项「许可」；首屏徽章 / 下载按钮 / cta-note / 对比表 / 页脚全部同步 |

**改许可证的法律前提**：仓库 50 次提交全部为同一作者（`zhaoyuyyy <2789640289@qq.com>`，GitHub `Alinyu330`），版权完整，有权重新授权。此前仓库**根本没有 LICENSE 文件**，只有 README/package.json 里的"MIT"字样 —— 补一份真正的许可证本身就是加固。

**为什么不能"保留 MIT + 加一句禁止闭源商用"**：MIT 明确授予再分发与商用权利，单方面的禁止声明覆盖不了已授予的权利，反而造成条款冲突、削弱可执行性。要阻断闭源商用，必须换成著佐权（copyleft）许可证。

## 二、内部方法与坑

### 安装包许可页是否真的生效（已取证）
electron-builder 的 NSIS 许可页走 `!insertmacro MUI_PAGE_LICENSE "<file>"`，文本编译进 NSIS 的 LicenseData 块并被 LZMA 压缩 —— 因此 **7z 列目录与 zlib 明文扫描都查不到**，不能据此判定"没生效"。

有效的取证办法是**负向测试**：把选项指向不存在的文件，构建必须报错。

```bash
node node_modules/electron-builder/cli.js --win nsis -c.nsis.license=nope-missing.txt
# ⨯ cannot find specified resource "nope-missing.txt", nor relative to "D:\WallPaper\build", ...
```
报错即证明 `build.nsis.license` 选项被读取、解析目录就是 `build/`；正式构建指向真实存在的 `build/license.txt` 且成功 → 许可页确已内嵌。

### 本机环境（复现用）
```bash
node node_modules/electron-builder/cli.js --win          # npm run build 会 spawn cmd.exe EACCES
node node_modules/electron/cli.js .cache/<harness>/app   # npx electron 同样 EACCES
git push git@github.com:Alinyu330/wallpaper-studio.git main   # HTTPS 推送被网络重置，走 SSH over 443
node "C:/Users/Alin/.wb-tools/node_modules/wrangler/bin/wrangler.js" pages deploy docs --project-name=wallpaper-studio --commit-dirty=true
```
GitHub API 写操作：node 直连报 `unable to verify the first certificate`，加 `--use-system-ca` 用 Windows 证书库即可（或走 PowerShell Schannel）。

## 三、仓库加固（同批完成）

| 措施 | 状态 |
|---|---|
| `main` 分支保护：禁强推、禁删除 | ✅ `enforce_admins=false` → 他人（任何非管理员写权限）推不动，你保留全部权限（仍可强推/直推） |
| 发布 tag 不可删、不可改写 | ✅ ruleset `release-tags-immutable`：`target=tag`、`include=refs/tags/v*`、`rules=update,deletion`、`bypass_actors=[Alinyu330 always]` |
| 关闭 Wiki | ✅ `has_wiki=false`（公开仓库默认所有登录用户可编辑 wiki；此前无任何 wiki 页面，零损失） |
| Secret 扫描 + 推送保护 | ✅ 均 enabled |
| Dependabot 安全告警 | ❌ 未开启：`POST /vulnerability-alerts` 返回 404，需先在网页 Settings → Code security and analysis 手动开启依赖图 |
| Actions 白名单 / 第三方 Action 锁 SHA / 发布人工审批 | 未做（属 P1，按你的选择暂缓） |

> tag 规则集的坑：`target=tag` 下合法规则类型是 `update` / `deletion` / `creation` / `required_signatures`，**不是** `delete`；include 必须写 `refs/tags/v*`，`~^v[0-9]+\.[0-9]+\.[0-9]+$` 这类正则写法会被判 "Invalid target patterns"。

## 四、外部下载（v1.16.0，Windows x64）

- GitHub Releases：https://github.com/Alinyu330/wallpaper-studio/releases
- 国内加速①：https://gh-proxy.com/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.16.0/WallpaperStudio-Setup-1.16.0.exe
- 国内加速②：https://ghfast.top/https://github.com/Alinyu330/wallpaper-studio/releases/download/v1.16.0/WallpaperStudio-Setup-1.16.0.exe
- 官网：https://wallpaper-studio.pages.dev/ · https://alinyu330.github.io/wallpaper-studio/

已装 v1.15.0 的用户：客户端「设置 → 检查更新」应用内一键更新。

## 五、遗留 / 待确认

1. 版权主体目前写的是 GitHub 用户名 **Alinyu330**。维权时以真实姓名或营业执照名称署名更有力，若要替换需改 `COPYRIGHT.md` / `build/license.txt` / `package.json` 的 `author`+`copyright` / README / 官网页脚。
2. Dependabot 需在网页手动开启依赖图后再开告警。
3. 源文件头部未加 SPDX 标识行（`// SPDX-License-Identifier: GPL-3.0-or-later`）。GPL 的「如何使用」章节建议每个源文件都带，可再补一次（约 40 个文件的纯注释改动，不影响逻辑）。
