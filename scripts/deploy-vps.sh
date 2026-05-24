#!/usr/bin/env bash
# =============================================================================
# deploy-vps.sh — Production auto-deploy called by GitHub Actions via SSH
# =============================================================================
# PREREQUISITES (set up once by initial deploy.sh):
#   1. Repo cloned at /opt/gomo6 with SSH key configured for GitLab
#   2. Docker + Docker Compose v2 installed
#   3. .env file with JWT_SECRET, FEDERATION_KEY, DOMAIN etc.
#
# This script is invoked by GitHub Actions after CI passes on main.
# DO NOT run locally — it assumes it's inside /opt/gomo6 on the VPS.
# =============================================================================
set -euo pipefail

PROJECT_DIR="/opt/gomo6"
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ── Capture current commit (for rollback if build fails) ────────────────────
OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "[0/4] Current commit: $OLD_COMMIT"

# ── Pull latest code ────────────────────────────────────────────────────────
echo "[1/4] Pulling latest changes..."
git fetch origin main
git reset --hard origin/main

# ── Capture new commit hash ─────────────────────────────────────────────────
GIT_COMMIT=$(git rev-parse --short HEAD)
echo "[2/4] Deploying commit: $GIT_COMMIT (was: $OLD_COMMIT)"

# ── Rebuild and restart ─────────────────────────────────────────────────────
echo "[3/4] Rebuilding Docker images..."
echo "       If this fails, rollback: git reset --hard $OLD_COMMIT && GIT_COMMIT=$OLD_COMMIT docker compose up -d --build"
export GIT_COMMIT
docker compose up -d --build --remove-orphans

# ── Clean up old images ─────────────────────────────────────────────────────
echo "[4/4] Cleaning up old images..."
docker image prune -f

echo "=== Deploy finished: $GIT_COMMIT ==="
