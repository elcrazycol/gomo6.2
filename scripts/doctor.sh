#!/usr/bin/env bash
# =============================================================================
# Gomo6 — local dev prerequisite doctor (`make doctor`)
# =============================================================================
# Read-only: reports tool versions, whether Docker is running, whether .env
# exists, and which dev ports are already taken. Exit code 1 if a hard
# requirement is missing.
# =============================================================================

set -uo pipefail

cd "$(dirname "$0")/.." || exit # repo root

GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; DIM='\033[2m'; NC='\033[0m'
ok()   { printf "${GREEN}✓${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC} %s\n" "$*"; }
bad()  { printf "${RED}✗${NC} %s\n" "$*"; }
note() { printf "${DIM}    %s${NC}\n" "$*"; }

FAIL=0

echo "Gomo6 dev doctor"
echo "────────────────"

# ── Tools ───────────────────────────────────────────────────────────────────
check_tool() { # label bin required(0|1) "version-command"
    local label="$1" bin="$2" req="${3:-1}" vcmd="${4:-$2 --version}"
    if command -v "$bin" >/dev/null 2>&1; then
        ok "$label: $($vcmd 2>&1 | head -1)"
    elif [ "$req" = 1 ]; then
        bad "$label: not found — required for 'make dev'"
        FAIL=1
    else
        warn "$label: not found (optional)"
    fi
}

echo "Tools:"
check_tool "docker" docker 1
check_tool "node"   node   1
check_tool "npm"    npm    1
check_tool "go"     go     1 "go version"
check_tool "openssl" openssl 1
check_tool "ffmpeg" ffmpeg 0
command -v tmux     >/dev/null 2>&1 && ok "tmux: $(tmux -V)"     || warn "tmux: not found (process runner falls back to plain mode)"
command -v overmind >/dev/null 2>&1 && ok "overmind: installed"  || note "overmind: not installed (optional, 'make tools')"

# ── Docker daemon ───────────────────────────────────────────────────────────
echo ""
if docker info >/dev/null 2>&1; then
    ok "Docker daemon: running ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"
else
    bad "Docker daemon: not running — 'make dev' will try to launch Docker Desktop"
    FAIL=1
fi

# ── .env ────────────────────────────────────────────────────────────────────
echo ""
if [ -f .env ]; then
    missing=""
    for key in JWT_SECRET MESSENGER_ENCRYPTION_KEY REDIS_PASSWORD POSTGRES_PASSWORD; do
        grep -q "^${key}=..*" .env || missing="$missing $key"
    done
    if [ -n "$missing" ]; then
        warn ".env exists but these are empty:$missing — run 'make env'"
    else
        ok ".env: present and required secrets set"
    fi
else
    warn ".env: missing — 'make dev' will create it from .env.example"
fi

# ── Ports ───────────────────────────────────────────────────────────────────
echo ""
echo "Ports:"
for port in 5432 6379 3900 3902 8080 8081 3001 3002; do
    pids=$(lsof -nP -i4TCP:"$port" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' ' | sed 's/ $//')
    if [ -z "$pids" ]; then
        note ":$port free"
        continue
    fi
    proc=$(ps -o comm= -p "${pids%% *}" 2>/dev/null | head -1)
    proc_lc="$(printf '%s' "$proc" | tr '[:upper:]' '[:lower:]')"
    is_docker=0
    case "$proc_lc" in *docker*|*vpnkit*) is_docker=1 ;; esac
    case "$port" in
        5432|6379|3900|3902) # infra ports — take by a dev container is expected
            if [ "$is_docker" = 1 ]; then
                note ":$port in use by a dev container (fine)"
            else
                warn ":$port in use by ${proc:-pid $pids} — the dev ${port} container will fail to bind; stop that service or free the port"
            fi
            ;;
        *)
            if [ "$is_docker" = 1 ]; then
                note ":$port in use by a container"
            else
                warn ":$port in use by ${proc:-pid $pids} — a dev server may already be running"
            fi
            ;;
    esac
done

echo ""
if [ "$FAIL" = 1 ]; then
    bad "Hard requirements missing — fix the ✗ items above."
    exit 1
fi
ok "All hard requirements satisfied."
