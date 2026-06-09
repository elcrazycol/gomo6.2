#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — Pull pre-built images from ghcr.io + restart
# =============================================================================
# Images are built on GitHub Actions (reliable npmjs network) and pushed to
# ghcr.io. VPS only pulls and restarts — no local npm ci, no network flakes.
# =============================================================================
set -euo pipefail

PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$PROJECT_DIR" ] || { echo "Cannot find repo root"; exit 1; }
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u +%T) ==="

echo "[1/3] Pulling latest code..."
git fetch origin main
git reset --hard origin/main
NEW_COMMIT=$(git rev-parse --short HEAD)
echo "       Now at: $NEW_COMMIT"

echo "[2/3] Pulling latest images from ghcr.io..."
echo "${GHCR_PAT:-}" | docker login ghcr.io -u scramble22 --password-stdin 2>/dev/null || true
docker compose pull 2>&1
docker logout ghcr.io 2>/dev/null || true

echo "[3/3] Restarting containers..."
docker compose up -d --remove-orphans

# Cleanup old images and stale build cache
docker image prune -f

echo "=== Deploy finished ==="
