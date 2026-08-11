#!/usr/bin/env python3
"""Rank files by most uncovered lines to prioritize test targets."""
import json
import sys

path = sys.argv[1] if len(sys.argv) > 1 else "coverage/frontend/coverage-summary.json"
with open(path) as f:
    d = json.load(f)

prefix = "/Users/lesha/codes/gomo6/apps/web/src"


def rel(p):
    return p[len(prefix):].lstrip("/") if p.startswith(prefix) else p


rows = []
for p, m in d.items():
    if p == "total":
        continue
    st = m["statements"]
    fn = m["functions"]
    br = m["branches"]
    rows.append(
        (
            rel(p),
            st["covered"],
            st["total"],
            st["total"] - st["covered"],
            fn["covered"],
            fn["total"],
            br["covered"],
            br["total"],
        )
    )

rows.sort(key=lambda r: r[3], reverse=True)
print("=== TOP 60 BY UNCOVERED STATEMENTS ===")
print(f"{'file':55s} {'cov':>6s} {'total':>7s} {'uncovered':>10s} {'fn':>8s} {'br':>8s}")
for name, c, t, u, fc, ft, bc, bt in rows[:60]:
    pct = 100.0 * c / t if t else 0.0
    fn_s = f"{fc}/{ft}" if ft else "-"
    br_s = f"{bc}/{bt}" if bt else "-"
    print(f"{name[:54]:55s} {pct:5.1f}% {t:7d} {u:10d} {fn_s:>8s} {br_s:>8s}")
