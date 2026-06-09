#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — Pull pre-built images from ghcr.io and restart containers
# =============================================================================
# Images are built on GitHub Actions runners (fast, HTTPS works) and pushed to
# GitHub Container Registry (ghcr.io). This script just pulls and restarts.
#
# IMPORTANT: git pull is done by deploy.yml BEFORE running this script,
# so this script always runs the latest version of itself.
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

GIT_COMMIT=$(git rev-parse --short HEAD)
echo "=== Deploy started: $GIT_COMMIT ==="

# ── Login to ghcr.io ───────────────────────────────────────────────────────
if [ -n "${GHCR_PAT:-}" ]; then
  echo "[1/3] Logging in to ghcr.io..."
  echo "$GHCR_PAT" | docker login ghcr.io -u scramble22 --password-stdin
else
  echo "[1/3] GHCR_PAT not set, assuming already logged in"
fi

# ── Pull pre-built images from ghcr.io ─────────────────────────────────────
echo "[2/3] Pulling Docker images from ghcr.io..."

pull_and_check() {
  local img="$1"
  echo "       Pulling $img..."
  docker pull "$img:latest" || {
    echo "ERROR: Failed to pull $img:latest"
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
