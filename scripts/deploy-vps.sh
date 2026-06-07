#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — Pull pre-built images from ghcr.io and restart containers
# =============================================================================
# Images are built on GitHub Actions runners (fast, HTTPS works) and pushed to
# GitHub Container Registry (ghcr.io). This script just pulls and restarts.
#
# GHCR_PAT is passed from GitHub Actions and used for docker login.
# =============================================================================
set -euo pipefail

# Auto-locate repo root via git
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(find / -maxdepth 4 -name docker-compose.yml -path "*/gomo6.2/*" 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
fi
[ -n "$PROJECT_DIR" ] || { echo "Cannot find gomo6.2 repo"; exit 1; }
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ── Login to ghcr.io ───────────────────────────────────────────────────────
if [ -n "${GHCR_PAT:-}" ]; then
  echo "[0/3] Logging in to ghcr.io..."
  echo "$GHCR_PAT" | docker login ghcr.io -u scramble22 --password-stdin
else
  echo "[0/3] GHCR_PAT not set, assuming already logged in"
fi

# ── Capture current commit ──────────────────────────────────────────────────
OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "[1/3] Current commit: $OLD_COMMIT"

# ── Pull latest git (for docker-compose.yml, Caddyfile, .env changes) ──────
echo "       Pulling latest changes..."
rm -f .env.deploy-backup
if [ -f .env ]; then cp .env .env.deploy-backup; fi
trap 'if [ -f .env.deploy-backup ]; then mv .env.deploy-backup .env; fi' EXIT
git fetch origin main
git reset --hard origin/main
if [ -f .env.deploy-backup ]; then mv .env.deploy-backup .env; fi
trap - EXIT

GIT_COMMIT=$(git rev-parse --short HEAD)
echo "       Deploying commit: $GIT_COMMIT (was: $OLD_COMMIT)"

# ── Pull pre-built images from ghcr.io ─────────────────────────────────────
echo "[2/3] Pulling Docker images from ghcr.io..."

pull_and_check() {
  local img="$1"
  echo "       Pulling $img..."
  docker pull "$img:latest" || {
    echo "ERROR: Failed to pull $img:latest"
    echo "Rollback: git reset --hard $OLD_COMMIT && docker compose up -d --no-build"
    exit 1
  }
}

pull_and_check ghcr.io/scramble22/gomo6-backend
pull_and_check ghcr.io/scramble22/gomo6-web
pull_and_check ghcr.io/scramble22/gomo6-docs
pull_and_check ghcr.io/scramble22/gomo6-dev-dashboard

# ── Restart containers (--no-build prevents falling back to local build) ────
echo "[3/3] Restarting containers..."
docker compose up -d --remove-orphans --no-build

# Clean old images
docker image prune -f

echo "=== Deploy finished: $GIT_COMMIT ==="
