#!/usr/bin/env bash
# =============================================================================
# Gomo6 — one-command local dev environment (`make dev`)
# =============================================================================
# Spins up Postgres + Redis + Garage (Docker Compose with ports published to
# the host), fills .env with generated secrets, then runs the processes from
# Procfile.dev — the Go backend (:8080) and the frontend dev servers
# (web :8081, docs :3001, dev-dashboard :3002).
#
# Process manager (C):
#   - overmind is used when installed (`make tools` installs it) — per-process
#     control: `overmind restart backend`, `overmind connect backend`.
#   - otherwise the same Procfile.dev is fanned out into tmux windows
#     (tmux is already required by overmind and is usually present).
#   - with neither, the backend runs in the background and `npm run dev`
#     takes the foreground.
#   Detach tmux with Ctrl-b d; re-attach with `make attach`; stop the
#   processes with `make dev-stop`. Infra containers keep running — stop them
#   with `make stop`.
#
# Environment:
#   GOMO6_RUNNER=plain|tmux|overmind   force a runner (default: auto-detect)
#   GOMO6_NO_DOCKER_AUTOSTART=1        do not try to launch Docker Desktop
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.." # repo root

COMPOSE="docker compose"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"
TMUX_SESSION="gomo6-dev"
BACKEND_PID=""

say()  { printf '\033[1;34m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# ── Prerequisites ───────────────────────────────────────────────────────────
for tool in docker node npm go openssl; do
    command -v "$tool" >/dev/null 2>&1 || { err "❌ $tool not found in PATH — install it first."; exit 1; }
done
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
    say "✓ ffmpeg found (video processing enabled)"
else
    warn "⚠  ffmpeg/ffprobe not found — video uploads will fail locally (e.g. brew install ffmpeg)"
fi

# ── Host port conflicts ─────────────────────────────────────────────────────
# The dev containers publish to 127.0.0.1:5432/6379/3900. A native service on
# one of them (a Homebrew Postgres is the usual suspect) makes the container
# fail to bind — fail fast with a clear message instead of a 2-minute timeout.
# Ports already held by Docker are fine (that is the dev stack itself).
for port in 5432 6379 3900; do
    holder_pid="$(lsof -nP -i4TCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
    [ -z "$holder_pid" ] && continue
    holder="$(ps -o comm= -p "$holder_pid" 2>/dev/null || true)"
    holder_lc="$(printf '%s' "$holder" | tr '[:upper:]' '[:lower:]')"
    case "$holder_lc" in
        *docker*|*vpnkit*) continue ;;
    esac
    err "❌ port $port is already in use on 127.0.0.1 by: ${holder:-pid $holder_pid}"
    err "   The dev container needs it. Stop that service (or move it off 127.0.0.1) and retry, e.g.:"
    err "     brew services stop postgresql@15   # or: redis"
    exit 1
done

# ── Docker Desktop ──────────────────────────────────────────────────────────
# The build/infra all run through Docker. Instead of failing, try to launch
# Docker Desktop and wait for the daemon (opt out with GOMO6_NO_DOCKER_AUTOSTART=1).
if ! docker info >/dev/null 2>&1; then
    if [ "${GOMO6_NO_DOCKER_AUTOSTART:-0}" = "1" ]; then
        err "❌ Docker daemon is not running (GOMO6_NO_DOCKER_AUTOSTART=1). Start Docker Desktop and retry."
        exit 1
    fi
    say "→ Docker daemon is not running — starting Docker Desktop..."
    open -a Docker >/dev/null 2>&1 || true
    for i in $(seq 1 90); do
        docker info >/dev/null 2>&1 && break
        [ "$i" = 90 ] && { err "❌ Docker did not become ready within 180s. Start Docker Desktop manually and retry."; exit 1; }
        sleep 2
    done
    say "✓ Docker is up"
fi

# ── npm dependencies (skipped while package-lock.json is unchanged) ──────────
LOCK_HASH="$(shasum -a 256 package-lock.json | awk '{print $1}')"
HASH_FILE="node_modules/.gomo6-lock-hash"
if [ -d node_modules ] && [ -f "$HASH_FILE" ] && [ "$(cat "$HASH_FILE")" = "$LOCK_HASH" ]; then
    say "✓ npm dependencies up to date (skipping install)"
else
    say "→ Installing npm dependencies..."
    npm install --no-audit --no-fund
    printf '%s' "$LOCK_HASH" > "$HASH_FILE"
fi

# ── .env ────────────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
    say "→ Creating .env from .env.example"
    cp .env.example .env
fi
say "→ Filling required secrets (existing non-empty values are preserved)..."
bash scripts/generate-keys.sh --quiet .env
bash scripts/generate-garage-config.sh .env

# ── Infrastructure ──────────────────────────────────────────────────────────
say "→ Starting Postgres + Redis + Garage (dev ports on localhost)..."
# garage-init must be named explicitly: Compose starts dependencies, not
# dependents, so `up postgres redis garage` would leave it out and the S3 key
# would never be created on a fresh volume.
$COMPOSE $COMPOSE_FILES up -d postgres redis garage garage-init

# Load generated secrets from the root .env
set -a
# shellcheck disable=SC1091
. ./.env
set +a

say "→ Waiting for Postgres..."
for i in $(seq 1 60); do
    $COMPOSE $COMPOSE_FILES exec -T postgres pg_isready -U gomo6 -d gomo6 >/dev/null 2>&1 && break
    [ "$i" = 60 ] && { err "❌ Postgres did not become ready."; exit 1; }
    sleep 2
done

say "→ Waiting for Redis..."
for i in $(seq 1 30); do
    $COMPOSE $COMPOSE_FILES exec -T redis redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null | grep -q PONG && break
    [ "$i" = 30 ] && { err "❌ Redis did not become ready."; exit 1; }
    sleep 2
done

# Garage S3 keys: garage-init generates them once and stores them in the
# garage_keys volume. Copy s3.env out of the (possibly still running)
# garage-init container when it appears.
say "→ Waiting for Garage (garage-init creates the S3 key)..."
GARAGE_S3_ACCESS_KEY=""
GARAGE_S3_SECRET_KEY=""
GARAGE_INIT_CONTAINER=""
for i in $(seq 1 90); do
    [ -z "$GARAGE_INIT_CONTAINER" ] && \
        GARAGE_INIT_CONTAINER=$(docker ps -aq --filter label=com.docker.compose.service=garage-init | head -1)
    if [ -n "$GARAGE_INIT_CONTAINER" ] && docker cp "$GARAGE_INIT_CONTAINER:/garage-keys/s3.env" /tmp/gomo6-s3.env >/dev/null 2>&1; then
        GARAGE_S3_ACCESS_KEY=$(grep "^export GARAGE_S3_ACCESS_KEY=" /tmp/gomo6-s3.env | cut -d"'" -f2)
        GARAGE_S3_SECRET_KEY=$(grep "^export GARAGE_S3_SECRET_KEY=" /tmp/gomo6-s3.env | cut -d"'" -f2)
        break
    fi
    sleep 2
done
rm -f /tmp/gomo6-s3.env

# ── Backend environment ─────────────────────────────────────────────────────
# Write the complete backend environment to .dev.env (root .env + dev
# overrides) and export it in this shell. Procfile.dev sources the same file,
# so the backend gets the right env no matter how its process was started:
# tmux windows do NOT reliably inherit the environment of the shell that
# created the tmux session.
DEV_ENV_FILE=".dev.env"
{
    echo "# Generated by scripts/dev.sh — do not commit."
    echo "# Complete backend environment for the local dev stack (sourced by Procfile.dev)."
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in ''|'#'*) continue ;; esac
        line="${line#export }"
        case "$line" in *=*) printf "export %s='%s'\n" "${line%%=*}" "${line#*=}" ;; esac
    done < .env
    echo "export ENVIRONMENT=development"
    echo "export DOMAIN=localhost"
    echo "export SERVER_DOMAIN=localhost:8080"
    echo "export SERVER_PORT=8080"
    printf "export DATABASE_URL='postgres://gomo6:%s@127.0.0.1:5432/gomo6?sslmode=disable'\n" "$POSTGRES_PASSWORD"
    printf "export REDIS_URL='redis://:%s@127.0.0.1:6379'\n" "$REDIS_PASSWORD"
    echo "export ALLOWED_ORIGINS='http://localhost:8081,http://localhost:3001,http://localhost:3002'"
    echo "export TURNSTILE_DISABLED=1"
    echo "export WEBAUTHN_RP_ID=localhost"
    echo "export WEBAUTHN_RP_ORIGIN=http://localhost:8081"
    echo "export WEBAUTHN_RP_NAME=gomo6-dev"
    echo "export GARAGE_S3_ENDPOINT=http://127.0.0.1:3900"
    echo "export GARAGE_S3_PUBLIC_ENDPOINT=http://127.0.0.1:3900"
    echo "export GARAGE_S3_REGION=garage"
    echo "export GARAGE_S3_USE_SSL=false"
    if [ -n "$GARAGE_S3_ACCESS_KEY" ] && [ -n "$GARAGE_S3_SECRET_KEY" ]; then
        printf "export GARAGE_S3_ACCESS_KEY='%s'\n" "$GARAGE_S3_ACCESS_KEY"
        printf "export GARAGE_S3_SECRET_KEY='%s'\n" "$GARAGE_S3_SECRET_KEY"
    fi
} > "$DEV_ENV_FILE"
chmod 600 "$DEV_ENV_FILE"
# shellcheck disable=SC1090,SC1091
. "./$DEV_ENV_FILE"

if [ -n "$GARAGE_S3_ACCESS_KEY" ] && [ -n "$GARAGE_S3_SECRET_KEY" ]; then
    say "✓ Garage S3 keys loaded — uploads enabled"
else
    warn "⚠  Garage S3 keys not ready — uploads will be unavailable (everything else works)"
fi

# ── Health summary ──────────────────────────────────────────────────────────
say ""
say "   ✅  infra up — Postgres :5432  •  Redis :6379  •  Garage :3900"
say ""
say "   🚀  http://localhost:8081        — main web app"
say "       http://localhost:3001        — docs"
say "       http://localhost:3002        — dev dashboard"
say "       http://localhost:8080/health — backend"
say ""

# ── Process runners ─────────────────────────────────────────────────────────
# One source of truth for the process list: Procfile.dev.

run_overmind() {
    say "→ Starting processes with overmind (Procfile.dev)..."
    say "   overmind restart <backend|web|docs|dev-dashboard>  •  Ctrl+C stops everything"
    say ""
    exec overmind start -f Procfile.dev
}

run_tmux() {
    if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        say "→ tmux session '$TMUX_SESSION' already exists — attaching"
        exec tmux attach -t "$TMUX_SESSION"
    fi
    say "→ Starting processes in tmux session '$TMUX_SESSION' (Procfile.dev)..."
    local first=1 name cmd
    while IFS= read -r line || [ -n "$line" ]; do
        line="${line%%#*}"                       # strip comments
        [ -z "${line//[[:space:]]/}" ] && continue
        name="${line%%:*}"
        cmd="${line#*:}"; cmd="${cmd# }"
        if [ "$first" = 1 ]; then
            tmux new-session -d -s "$TMUX_SESSION" -n "$name" "$cmd"
            first=0
        else
            tmux new-window -t "$TMUX_SESSION" -n "$name" "$cmd"
        fi
        # Keep the pane around after the process exits so a crash is readable.
        tmux set-window-option -t "$TMUX_SESSION:$name" remain-on-exit on >/dev/null 2>&1 || true
    done < Procfile.dev
    tmux select-window -t "$TMUX_SESSION:0" >/dev/null 2>&1 || true
    say ""
    say "   Windows: backend  web  docs  dev-dashboard"
    say "   Detach:  Ctrl-b d      Re-attach: make attach"
    say "   Restart: Ctrl-b n to pick a window, then re-run its command"
    say "   Stop:    make dev-stop"
    say ""
    exec tmux attach -t "$TMUX_SESSION"
}

run_plain() {
    warn "⚠  tmux/overmind not found — plain mode (backend in background, frontends in front)."
    warn "   Install a process manager for per-service control: make tools"
    say "→ Starting backend on http://localhost:8080 (log: /tmp/gomo6-backend.log)"
    (
        cd apps/backend-go
        exec go run cmd/server/main.go
    ) > /tmp/gomo6-backend.log 2>&1 &
    BACKEND_PID=$!
    cleanup() {
        say ""
        say "→ Stopping backend..."
        [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null || true
        say "  Infra containers are still running:  make stop"
    }
    trap cleanup INT TERM EXIT
    say ""
    npm run dev
}

case "${GOMO6_RUNNER:-auto}" in
    overmind) run_overmind ;;
    tmux)     run_tmux ;;
    plain)    run_plain ;;
    auto)
        if command -v overmind >/dev/null 2>&1; then
            run_overmind
        elif command -v tmux >/dev/null 2>&1; then
            run_tmux
        else
            run_plain
        fi
        ;;
    *)
        err "❌ GOMO6_RUNNER must be one of: auto, overmind, tmux, plain"
        exit 1
        ;;
esac
