#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# ci-local.sh — Run the same checks as GitHub Actions CI, locally.
# Usage: ./scripts/ci-local.sh        (full CI)
#        ./scripts/ci-local.sh quick  (only fast checks: lint + typecheck)
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d "node_modules" ]; then
  echo "Dependencies not installed. Run: npm ci"
  exit 1
fi

MODE="${1:-full}"
PASS=0
FAIL=0

green()  { echo -e "\033[32m✔ $*\033[0m"; }
red()    { echo -e "\033[31m✘ $*\033[0m"; ((FAIL++)) || true; }
skip()   { echo -e "\033[33m○ $* (skipped)\033[0m"; }
header() { echo -e "\n\033[1m━━━ $* ━━━\033[0m"; }

check() {
  local label="$1" cmd="$2"
  if eval "$cmd" &>/dev/null; then
    green "$label"
    ((PASS++)) || true
  else
    red "$label"
    eval "$cmd" 2>&1 | head -6  # re-run to show errors
  fi
}

# ──────────────────────────────────────────────────────────────
#  Go backend
# ──────────────────────────────────────────────────────────────
header "Go Backend"

check "go build (all packages)"  "(cd apps/backend-go && go build ./...)"
check "gofmt (format check)"     "(cd apps/backend-go && test -z \"\$(gofmt -l .)\")"
check "go vet"                   "(cd apps/backend-go && go vet ./...)"

if command -v golangci-lint &>/dev/null; then
  check "golangci-lint"          "(cd apps/backend-go && golangci-lint run --timeout=5m ./...)"
else
  skip  "golangci-lint not installed — install: brew install golangci-lint"
fi

# ──────────────────────────────────────────────────────────────
#  Frontend — TypeScript
# ──────────────────────────────────────────────────────────────
header "TypeScript"

check "tsc — web"                "npx tsc --noEmit -p apps/web/tsconfig.app.json"
check "tsc — dev-dashboard"     "(cd apps/dev-dashboard && npx tsc --noEmit)"
check "tsc — docs"              "(cd apps/docs && npx tsc --noEmit)"

# ──────────────────────────────────────────────────────────────
#  Frontend — ESLint
# ──────────────────────────────────────────────────────────────
header "ESLint"

check "eslint — web"             "(cd apps/web && npx eslint .)"

# ──────────────────────────────────────────────────────────────
#  Frontend — builds (full mode only)
# ──────────────────────────────────────────────────────────────
if [ "$MODE" = "full" ]; then
  header "Builds"
  check "npm build — web"           "npm run build --workspace=@gomo6/web"
  check "npm build — dev-dashboard" "npm run build --workspace=@gomo6/dev-dashboard"
  check "npm build — docs"          "npm run build --workspace=@gomo6/docs"
else
  skip "Builds — run './scripts/ci-local.sh full' to include"
fi

# ──────────────────────────────────────────────────────────────
#  Summary
# ──────────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  green "All checks passed ($PASS/$((PASS+FAIL)))"
  exit 0
else
  red "$FAIL check(s) failed ($PASS passed, $FAIL failed)"
  exit 1
fi
