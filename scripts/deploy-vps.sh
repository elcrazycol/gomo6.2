#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — Fast local build + restart
# =============================================================================
# Builds all containers with Docker layer cache on the VPS (no registry needed).
# Subsequent builds only rebuild changed layers — much faster than CI builds.
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$PROJECT_DIR" ] || { echo "Cannot find repo root"; exit 1; }
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u +%T) ==="

OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "[1/3] Pulling latest code (was: $OLD_COMMIT)..."
git fetch origin main
git reset --hard origin/main
NEW_COMMIT=$(git rev-parse --short HEAD)
echo "       Now at: $NEW_COMMIT"

echo "[2/3] Building containers (Docker layer cache)..."
export GIT_COMMIT=$(git rev-parse --short HEAD)
docker compose build --parallel 2>&1

echo "[3/3] Restarting..."
docker compose up -d --remove-orphans

# Cleanup old images and stale build cache
docker image prune -f
docker builder prune --filter until=48h -f

echo "=== Deploy finished: $NEW_COMMIT ==="
