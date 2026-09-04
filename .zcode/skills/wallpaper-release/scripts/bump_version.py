#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bump_version.py — 壁纸工坊发版时跨文件同步版本号。

用法:
  python scripts/bump_version.py <old> <new> [--dry-run]
  python scripts/bump_version.py 1.7.0 1.8.0
  python scripts/bump_version.py 1.7.0 1.8.0 --dry-run

行为:
  - package.json        : 更新 "version": "X.Y.Z"
  - README.md           : 更新版本徽标(version-X.Y.Z)、下载区 (vX.Y.Z，Windows x64)、
                          加速链接 releases/download/vX.Y.Z/WallpaperStudio-Setup-X.Y.Z.exe
  - docs/index.html     : 更新"当前版本"下载链接、Hero 徽标、CTA、当前版本标题等"最新"标记

设计原则:
  - 只改写明确代表"当前版本"的字符串，绝不触碰历史特性注解(如 "v1.7.0 新增")，
    剩余未处理的旧版本字样会在末尾列出，交由人工复核。
  - 默认直接写盘；--dry-run 只打印改动不落盘。
"""

import os
import re
import sys

def find_repo_root(start):
    """从 start 向上查找包含 .git 的仓库根目录（技能位于 .workbuddy/ 下，不能直接用固定层数）。"""
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.path.abspath(start)
        cur = parent


REPO_ROOT = find_repo_root(os.path.dirname(os.path.abspath(__file__)))

FILES = {
    "package.json": os.path.join(REPO_ROOT, "package.json"),
    "README.md": os.path.join(REPO_ROOT, "README.md"),
    "docs/index.html": os.path.join(REPO_ROOT, "docs", "index.html"),
}


def per_file_patterns(old: str, new: str):
    """返回每个文件需要执行的 (regex, replacement) 列表。"""
    o = re.escape(old)
    n = new
    patterns = {
        "package.json": [
            (r'("version"\s*:\s*")' + o + r'(")', r'\g<1>' + n + r'\2'),
        ],
        "README.md": [
            # 版本徽标: version-1.7.0-7c5cff
            (r'version-' + o + r'-', 'version-' + n + '-'),
            # 下载区标题: （v1.7.0，Windows x64）
            (r'（v' + o + r'，Windows x64）', '（v' + n + '，Windows x64）'),
            # 加速链接(gh-proxy / ghfast.top): releases/download/v1.7.0/WallpaperStudio-Setup-1.7.0.exe
            (r'releases/download/v' + o + r'/WallpaperStudio-Setup-' + o + r'\.exe',
             'releases/download/v' + n + '/WallpaperStudio-Setup-' + n + '.exe'),
        ],
        "docs/index.html": [
            # 当前版本下载链接(hero / CTA / 下载区, 含 gh-proxy、ghfast.top、GitHub 直连)
            (r'releases/download/v' + o + r'/WallpaperStudio-Setup-' + o + r'\.exe',
             'releases/download/v' + n + '/WallpaperStudio-Setup-' + n + '.exe'),
            # Hero 徽标: <div class="ver-badge"><i></i>v1.7.0 · ...
            (r'(<div class="ver-badge"><i></i>)v' + o, r'\g<1>v' + n),
            # CTA 备注: v1.7.0 · 约 200 MB（内置全格式解码器）
            (r'v' + o + r'( · 约 200 MB)', 'v' + n + r'\1'),
            # 当前版本标题: 当前版本 <b ...>v1.7.0</b>
            (r'(当前版本 <b[^>]*>)v' + o + r'(</b>)', r'\g<1>v' + n + r'\2'),
            # 最新版本块标题: <h3>v1.7.0 <span class="tag">最新</span></h3>
            (r'(<h3>)v' + o + r'( <span class="tag">最新</span></h3>)', r'\g<1>v' + n + r'\2'),
        ],
    }
    return patterns


def apply_file(rel: str, patterns, dry_run: bool, old: str):
    path = FILES[rel]
    if not os.path.exists(path):
        print(f"  [跳过] 文件不存在: {rel}")
        return
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()

    total = 0
    for rx, rep in patterns:
        new_text, cnt = re.subn(rx, rep, text)
        if cnt:
            total += cnt
        text = new_text

    # 统计残留旧版本字样（仅 "v<old>" 形式），用于提示人工复核历史注解
    leftover_matches = re.findall(r'v' + re.escape(old) + r'\b', text)

    if dry_run:
        print(f"  [dry-run] {rel}: 将替换 {total} 处")
    else:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"  [已写入] {rel}: 替换 {total} 处")

    if leftover_matches:
        print(f"      ⚠ 残留 'v{old}' 字样 {len(leftover_matches)} 处（多为历史特性注解，请人工复核是否需要改动）")


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    old = sys.argv[1]
    new = sys.argv[2]
    dry_run = "--dry-run" in sys.argv

    if not re.match(r"^\d+\.\d+\.\d+$", old) or not re.match(r"^\d+\.\d+\.\d+$", new):
        print("错误：版本号需为 X.Y.Z 形式")
        sys.exit(1)

    print(f"版本号同步: {old} -> {new}  {'(dry-run)' if dry_run else ''}")
    patterns = per_file_patterns(old, new)
    for rel in FILES:
        print(f"· {rel}")
        apply_file(rel, patterns.get(rel, []), dry_run, old)
    print("完成。请随后执行阶段 3 人工复核 README / docs 的功能文案。")


if __name__ == "__main__":
    main()
