#!/usr/bin/env python3
"""Analyze coverage-summary.json: print totals, lowest-covered files, per-dir stats."""
import json
import sys
from collections import defaultdict

path = sys.argv[1] if len(sys.argv) > 1 else "coverage/frontend/coverage-summary.json"
with open(path) as f:
    d = json.load(f)

t = d["total"]
print("=== TOTAL ===")
for k in ("statements", "branches", "functions", "lines"):
    v = t[k]
    print(f"  {k:10s} {v['pct']:6.2f}%  ({v['covered']}/{v['total']})")

prefix = "/Users/lesha/codes/gomo6/apps/web/src"

def rel(p):
    return p[len(prefix):].lstrip("/") if p.startswith(prefix) else p

files = [
    (rel(p), m["lines"]["pct"], m["functions"]["pct"], m["branches"]["pct"], m["statements"]["pct"])
    for p, m in d.items()
    if p != "total"
]
files.sort(key=lambda x: x[1])

print(f"\n=== LOWEST LINE COVERAGE (top {min(45, len(files))}) ===")
for p, l, f, b, s in files[:45]:
    print(f"{l:6.1f}% lines | {f:6.1f}% fn | {b:6.1f}% br | {s:6.1f}% st | {p}")

print("\n=== LINE COVERAGE BY DIR (2 levels) ===")
dirs = defaultdict(lambda: [0, 0])
for p, m in d.items():
    if p == "total":
        continue
    r = rel(p)
    parts = r.split("/")
    key = "/".join(parts[:2])
    dirs[key][0] += m["lines"]["covered"]
    dirs[key][1] += m["lines"]["total"]
for k in sorted(dirs, key=lambda x: dirs[x][0] / max(dirs[x][1], 1)):
    print(f"{100 * dirs[k][0] / max(dirs[k][1], 1):6.1f}%  {k}")

print("\n=== LINE COVERAGE BY DIR (3 levels) ===")
subdirs = defaultdict(lambda: [0, 0])
for p, m in d.items():
    if p == "total":
        continue
    r = rel(p)
    parts = r.split("/")
    key = "/".join(parts[:3]) if len(parts) > 2 else r
    subdirs[key][0] += m["lines"]["covered"]
    subdirs[key][1] += m["lines"]["total"]
for k in sorted(subdirs, key=lambda x: subdirs[x][0] / max(subdirs[x][1], 1)):
    print(f"{100 * subdirs[k][0] / max(subdirs[k][1], 1):6.1f}%  {k}")
