#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_changelog.py — 生成本次发版的 commit 汇总（上一 tag 到 HEAD）。

用法:
  python scripts/gen_changelog.py
  python scripts/gen_changelog.py --last v1.7.0

输出:
  - 上一 tag 版本号
  - 该 tag 到当前 HEAD 的全部 commit（oneline）
  - 若无可发布 commit，给出提示
"""

import os
import re
import subprocess
import sys

def find_repo_root(start):
    cur = os.path.abspath(start)
    while True:
        if os.path.exists(os.path.join(cur, ".git")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            return os.path.abspath(start)
        cur = parent


REPO_ROOT = find_repo_root(os.path.dirname(os.path.abspath(__file__)))


def git(*args):
    return subprocess.check_output(
        ["git", "-C", REPO_ROOT, *args], text=True
    ).strip()


def last_tag():
    try:
        return git("describe", "--tags", "--abbrev=0").strip()
    except subprocess.CalledProcessError:
        # 退而求其次：取所有 tag 中版本号最大的
        try:
            tags = git("tag", "--sort=-v:refname").splitlines()
            return tags[0] if tags else ""
        except subprocess.CalledProcessError:
            return ""


def main():
    override = None
    for i, a in enumerate(sys.argv[1:]):
        if a == "--last" and i + 1 < len(sys.argv[1:]):
            override = sys.argv[1:][i + 1]

    tag = override or last_tag()
    if not tag:
        print("未找到任何 tag，将列出全部 commit：")
        rng = ["--all"]
    else:
        print(f"上一 tag: {tag}")
        rng = [f"{tag}..HEAD"]

    try:
        log = git("log", *rng, "--oneline")
    except subprocess.CalledProcessError as e:
        print("获取 commit 日志失败:", e)
        sys.exit(1)

    lines = [l for l in log.splitlines() if l.strip()]
    if not lines:
        print("自上一 tag 起没有任何新 commit，无需发版。")
        sys.exit(0)

    print(f"待发布 commit 数: {len(lines)}\n")
    for l in lines:
        print("  " + l)

    # 简单分类统计（按常见前缀）
    cats = {"feat": 0, "fix": 0, "docs": 0, "chore": 0, "refactor": 0, "other": 0}
    for l in lines:
        m = re.match(r"^[0-9a-f]+\s+(\w+)[(:]", l)
        if m and m.group(1) in cats:
            cats[m.group(1)] += 1
        else:
            cats["other"] += 1
    print("\n分类统计:", {k: v for k, v in cats.items() if v})


if __name__ == "__main__":
    main()
