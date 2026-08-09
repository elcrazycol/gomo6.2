#!/usr/bin/env python3
# =============================================================================
# coverage-report.py — build the combined coverage report site for Codeberg Pages
# =============================================================================
# Reads:
#   - Go coverage profile  (apps/backend-go/coverage.out, from
#     `go test -coverprofile=coverage.out -covermode=atomic ./...`)
#   - TS coverage summary  (coverage/frontend/coverage-summary.json, from
#     `vitest run --coverage` with reporters ["html", "json-summary"])
#
# Produces (in coverage-report/):
#   coverage-go.svg      — flat badge, e.g. "Go | 48.7%"  (red/orange/yellowgreen/green)
#   coverage-ts.svg      — flat badge, e.g. "TS | 38.6%"
#   coverage-total.svg   — weighted total badge (weighted by code size)
#   index.html           — dashboard: overall stats + links to per-language reports
#   summary.json         — machine-readable percentages (for CI gates)
#   go/index.html        — `go tool cover -html` per-function detail
#   ts/…                 — Vitest per-file HTML report (copied as-is)
#
# Usage (from repo root):
#   python3 scripts/coverage-report.py
#
# Env overrides:
#   GO_COVERAGE_OUT  — path to coverage.out            (default apps/backend-go/coverage.out)
#   TS_SUMMARY       — path to coverage-summary.json   (default coverage/frontend/coverage-summary.json)
#   OUT_DIR          — output directory                (default coverage-report)
#   GITHUB_SHA       — commit SHA shown in the footer  (optional)
#   GITHUB_REPOSITORY— "owner/repo" shown in footer    (optional)
# =============================================================================
import html
import json
import os
import re
import shutil
import subprocess
import sys
import xml.sax.saxutils as sax

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

GO_COVERAGE_OUT = os.environ.get("GO_COVERAGE_OUT", "apps/backend-go/coverage.out")
TS_SUMMARY = os.environ.get("TS_SUMMARY", "coverage/frontend/coverage-summary.json")
OUT_DIR = os.environ.get("OUT_DIR", "coverage-report")
GITHUB_SHA = os.environ.get("GITHUB_SHA", "")
GITHUB_REPOSITORY = os.environ.get("GITHUB_REPOSITORY", "")

# ─────────────────────────────────────────────────────────────────────────────
# Color scale (flat style, shields.io palette)
#   < 50%   red
#   50–70%  orange
#   70–85%  yellow-green
#   >= 85%  green
# ─────────────────────────────────────────────────────────────────────────────
RED = "#e05d44"
ORANGE = "#fe7d37"
YELLOWGREEN = "#a4a61d"
GREEN = "#97ca00"
LABEL_BG = "#555"


def color_for(pct: float) -> str:
    if pct < 50:
        return RED
    if pct < 70:
        return ORANGE
    if pct < 85:
        return YELLOWGREEN
    return GREEN


def badge_svg(label: str, value: str, color: str) -> str:
    """Flat-style SVG badge (similar to shields.io 'flat')."""
    # 11px Verdana ≈ 7px per char; +6px side padding
    label_w = 6 + int(len(label) * 7)
    value_w = 6 + int(len(value) * 7)
    total_w = label_w + value_w
    label = sax.escape(label)
    value = sax.escape(value)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{total_w}" height="20" role="img" aria-label="{label}: {value}">
  <title>{label}: {value}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="{total_w}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="{label_w}" height="20" fill="{LABEL_BG}"/>
    <rect x="{label_w}" width="{value_w}" height="20" fill="{color}"/>
    <rect width="{total_w}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="{label_w // 2}" y="14">{label}</text>
    <text x="{label_w + value_w // 2}" y="14">{value}</text>
  </g>
</svg>
'''


# ─────────────────────────────────────────────────────────────────────────────
# Go coverage
# ─────────────────────────────────────────────────────────────────────────────
def go_coverage(profile: str) -> tuple[float, int]:
    """Return (total-percentage, statement-count) for the Go profile.

    Go coverage is statement-based (`go tool cover` has no line metric).
    The statement count is summed from the profile's `numStmts` column so the
    cross-language weighted total uses real code sizes.
    """
    go_dir = os.path.join(ROOT, os.path.dirname(profile))
    profile_abs = os.path.join(ROOT, profile)
    if not os.path.exists(profile_abs):
        print(f"ERROR: Go coverage profile not found: {profile_abs}", file=sys.stderr)
        sys.exit(1)

    out = subprocess.run(
        ["go", "tool", "cover", "-func", profile_abs],
        cwd=go_dir, capture_output=True, text=True, check=True,
    ).stdout

    # Total line looks like:  total:			(statements)		48.7%
    total_pct = 0.0
    for line in out.splitlines():
        if line.startswith("total:"):
            match = re.search(r"([\d.]+)%", line)
            if match:
                total_pct = float(match.group(1))
            break

    # Profile format: "file.go:start.start,end.end numStmts count" per block
    statement_count = 0
    with open(profile_abs, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("mode:"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                try:
                    statement_count += int(parts[1])
                except ValueError:
                    pass
    return total_pct, statement_count


def go_html_report(profile: str, out_file: str) -> None:
    go_dir = os.path.join(ROOT, os.path.dirname(profile))
    profile_abs = os.path.join(ROOT, profile)
    # `go tool cover` resolves -o relative to cwd, so always pass an absolute path
    out_abs = out_file if os.path.isabs(out_file) else os.path.join(ROOT, out_file)
    os.makedirs(os.path.dirname(out_abs), exist_ok=True)
    subprocess.run(
        ["go", "tool", "cover", "-html", profile_abs, "-o", out_abs],
        cwd=go_dir, capture_output=True, text=True, check=True,
    )
    print(f"  go/html   -> {os.path.relpath(out_abs, ROOT)}")


# ─────────────────────────────────────────────────────────────────────────────
# TypeScript coverage
# ─────────────────────────────────────────────────────────────────────────────
def ts_coverage(summary_path: str) -> tuple[float, int]:
    """Return (line-percentage, line-count) from coverage-summary.json."""
    summary_abs = os.path.join(ROOT, summary_path)
    if not os.path.exists(summary_abs):
        print(f"ERROR: TS coverage summary not found: {summary_abs}", file=sys.stderr)
        sys.exit(1)
    with open(summary_abs, "r", encoding="utf-8") as f:
        data = json.load(f)
    total = data.get("total", {})
    lines = total.get("lines", {})
    pct = float(lines.get("pct", 0.0) or 0.0)
    count = int(lines.get("total", 0) or 0)
    return pct, count


# ─────────────────────────────────────────────────────────────────────────────
# Dashboard
# ─────────────────────────────────────────────────────────────────────────────
def dashboard_html(go_pct, ts_pct, total_pct, go_count, ts_count, sha, repo) -> str:
    def card(label, pct, detail_href, badge_file, desc):
        color = color_for(pct)
        return f'''
      <a class="card" href="{detail_href}">
        <div class="card-top">
          <span class="card-label">{label}</span>
          <span class="card-badge"><img src="{badge_file}" alt="{label} coverage badge"/></span>
        </div>
        <div class="card-pct" style="color:{color}">{pct:.1f}%</div>
        <div class="bar"><div class="bar-fill" style="width:{min(pct,100):.1f}%;background:{color}"></div></div>
        <div class="card-desc">{desc}</div>
      </a>'''

    go_detail = card("Go", go_pct, "go/index.html", "coverage-go.svg",
                     f"{go_count:,} statements · per-function detail")
    ts_detail = card("TypeScript", ts_pct, "ts/index.html", "coverage-ts.svg",
                     f"{ts_count:,} lines · per-file detail")
    total_card = card("Total", total_pct, "index.html", "coverage-total.svg",
                      "Weighted by code size (Go statements + TS lines)")

    footer = ""
    if repo or sha:
        bits = []
        if repo:
            bits.append(f"<a href=\"https://codeberg.org/{html.escape(repo)}\">{html.escape(repo)}</a>")
        if sha:
            bits.append(f"<code>{html.escape(sha[:10])}</code>")
        footer = f"<p class=\"footer\">Built from {' · '.join(bits)}</p>"

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Coverage report — Go + TypeScript</title>
<style>
  :root {{
    --bg: #0f1220; --card: #181c30; --border: #262b45; --text: #e8eaf6; --muted: #9aa0c0;
  }}
  * {{ box-sizing: border-box; }}
  body {{
    margin: 0; min-height: 100vh; background: radial-gradient(1200px 500px at 50% -10%, #232a4d 0%, var(--bg) 60%);
    color: var(--text); font-family: -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex; flex-direction: column; align-items: center; padding: 48px 20px;
  }}
  h1 {{ font-size: 28px; margin: 0 0 6px; letter-spacing: -.02em; }}
  .sub {{ color: var(--muted); margin: 0 0 36px; font-size: 15px; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; width: 100%; max-width: 920px; }}
  .card {{
    background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px;
    text-decoration: none; color: inherit; transition: transform .15s ease, border-color .15s ease, box-shadow .15s ease;
  }}
  .card:hover {{ transform: translateY(-3px); border-color: #3d4570; box-shadow: 0 12px 30px rgba(0,0,0,.35); }}
  .card-top {{ display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }}
  .card-label {{ font-size: 15px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }}
  .card-badge img {{ display: block; }}
  .card-pct {{ font-size: 46px; font-weight: 800; line-height: 1; margin-bottom: 12px; }}
  .bar {{ height: 6px; background: #2a2f4e; border-radius: 99px; overflow: hidden; margin-bottom: 14px; }}
  .bar-fill {{ height: 100%; border-radius: 99px; transition: width .3s ease; }}
  .card-desc {{ font-size: 13px; color: var(--muted); }}
  .footer {{ color: var(--muted); font-size: 13px; margin-top: 36px; }}
  .footer a {{ color: #7f8ce0; text-decoration: none; }}
  .footer code {{ background: var(--card); padding: 2px 6px; border-radius: 6px; font-size: 12px; }}
</style>
</head>
<body>
  <h1>Coverage report</h1>
  <p class="sub">Go backend + TypeScript frontend — generated from the CI pipeline</p>
  <div class="grid">
    {go_detail}
    {ts_detail}
    {total_card}
  </div>
  {footer}
</body>
</html>
'''


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> None:
    os.chdir(ROOT)  # everything below is relative to the repo root

    print("== Coverage report generator ==")

    print("[1/4] Go coverage")
    go_pct, go_count = go_coverage(GO_COVERAGE_OUT)
    print(f"  Go: {go_pct:.1f}% ({go_count:,} statements)")

    print("[2/4] TypeScript coverage")
    ts_pct, ts_count = ts_coverage(TS_SUMMARY)
    print(f"  TS: {ts_pct:.1f}% ({ts_count:,} lines)")

    # Weighted total by code size
    if go_count + ts_count > 0:
        total_pct = (go_pct * go_count + ts_pct * ts_count) / (go_count + ts_count)
    else:
        total_pct = (go_pct + ts_pct) / 2
    print(f"  Total: {total_pct:.1f}% (weighted by code size)")

    print(f"[3/4] Writing site to {OUT_DIR}/")
    os.makedirs(os.path.join(OUT_DIR, "go"), exist_ok=True)
    os.makedirs(os.path.join(OUT_DIR, "ts"), exist_ok=True)

    # Badges
    for name, label, pct in (("coverage-go", "Go", go_pct),
                             ("coverage-ts", "TS", ts_pct),
                             ("coverage-total", "Total", total_pct)):
        path = os.path.join(OUT_DIR, f"{name}.svg")
        with open(path, "w", encoding="utf-8") as f:
            f.write(badge_svg(label, f"{pct:.1f}%", color_for(pct)))
        print(f"  badge     -> {os.path.relpath(path, ROOT)}")

    # Dashboard
    index_path = os.path.join(OUT_DIR, "index.html")
    with open(index_path, "w", encoding="utf-8") as f:
        f.write(dashboard_html(go_pct, ts_pct, total_pct, go_count, ts_count,
                               GITHUB_SHA, GITHUB_REPOSITORY))
    print(f"  index     -> {os.path.relpath(index_path, ROOT)}")

    # Machine-readable summary (used by the PR coverage gate)
    summary_path = os.path.join(OUT_DIR, "summary.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump({
            "go_pct": round(go_pct, 2),
            "ts_pct": round(ts_pct, 2),
            "total_pct": round(total_pct, 2),
            "go_count": go_count,
            "ts_count": ts_count,
        }, f, indent=2)
    print(f"  summary   -> {os.path.relpath(summary_path, ROOT)}")

    print("[4/4] Detail reports")
    go_html_report(GO_COVERAGE_OUT, os.path.join(OUT_DIR, "go", "index.html"))

    # Vitest html report lives in the same dir as coverage-summary.json
    ts_dir = os.path.join(ROOT, os.path.dirname(TS_SUMMARY))
    if os.path.isdir(ts_dir):
        dst = os.path.join(OUT_DIR, "ts")
        for entry in os.listdir(ts_dir):
            src = os.path.join(ts_dir, entry)
            # Don't copy the summary json into the published site
            if entry == os.path.basename(TS_SUMMARY):
                continue
            if os.path.isdir(src):
                shutil.copytree(src, os.path.join(dst, entry), dirs_exist_ok=True)
            else:
                shutil.copy2(src, os.path.join(dst, entry))
        print(f"  ts/html   -> {os.path.relpath(dst, ROOT)}/")

    print("Done.")


if __name__ == "__main__":
    main()
