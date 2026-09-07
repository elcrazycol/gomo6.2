#!/usr/bin/env bash
# =============================================================================
# Gomo6 — one-command local dev environment (`make dev`)
# =============================================================================
# Spins up Postgres + Redis + Garage (Docker Compose with ports published to
# the host), fills .env with generated secrets, then runs the Go backend
# (localhost:8080) and the frontend dev servers (web :8081, docs :3001,
# dev-dashboard :3002) in parallel. Ctrl+C stops the backend + frontends;
# the infra containers keep running — use `make stop` to stop them.
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.." # repo root

COMPOSE="docker compose"
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.dev.yml"

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

# ── npm dependencies ────────────────────────────────────────────────────────
say "→ Installing npm dependencies..."
npm install --no-audit --no-fund

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
$COMPOSE $COMPOSE_FILES up -d postgres redis garage

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

# ── Backend environment (overrides anything in apps/backend-go/.env) ───────
export ENVIRONMENT=development
export DOMAIN=localhost
export SERVER_DOMAIN=localhost:8080
export SERVER_PORT=8080
export DATABASE_URL="postgres://gomo6:${POSTGRES_PASSWORD}@127.0.0.1:5432/gomo6?sslmode=disable"
export REDIS_URL="redis://:${REDIS_PASSWORD}@127.0.0.1:6379"
export ALLOWED_ORIGINS="http://localhost:8081,http://localhost:3001,http://localhost:3002"
export TURNSTILE_DISABLED=1
export WEBAUTHN_RP_ID=localhost
export WEBAUTHN_RP_ORIGIN=http://localhost:8081
export WEBAUTHN_RP_NAME=gomo6-dev
export GARAGE_S3_ENDPOINT=http://127.0.0.1:3900
export GARAGE_S3_PUBLIC_ENDPOINT=http://127.0.0.1:3900
export GARAGE_S3_REGION=garage
export GARAGE_S3_USE_SSL=false
if [ -n "$GARAGE_S3_ACCESS_KEY" ] && [ -n "$GARAGE_S3_SECRET_KEY" ]; then
    export GARAGE_S3_ACCESS_KEY
    export GARAGE_S3_SECRET_KEY
    say "✓ Garage S3 keys loaded — uploads enabled"
else
    warn "⚠  Garage S3 keys not ready — uploads will be unavailable (everything else works)"
fi

# ── Backend (background) ────────────────────────────────────────────────────
say "→ Starting backend on http://localhost:8080 (log: /tmp/gomo6-backend.log)"
BACKEND_PID=""
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

# ── Frontends (foreground) ──────────────────────────────────────────────────
say ""
say "   🚀  http://localhost:8081   — main web app"
say "       http://localhost:3001   — docs"
say "       http://localhost:3002   — dev dashboard"
say ""
say "   Press Ctrl+C to stop."
say ""
npm run dev