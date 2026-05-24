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

# Auto-locate repo root via git
PROJECT_DIR="$(git rev-parse --show-toplevel 2>/dev/null)"
# Fallback: search for docker-compose.yml if git isn't available
if [ -z "$PROJECT_DIR" ]; then
  PROJECT_DIR=$(find / -maxdepth 4 -name docker-compose.yml -path "*/gomo6.2/*" 2>/dev/null | head -1 | xargs dirname 2>/dev/null)
fi
[ -n "$PROJECT_DIR" ] || { echo "Cannot find gomo6.2 repo"; exit 1; }
cd "$PROJECT_DIR"

echo "=== Deploy started at $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# ── Capture current commit (for rollback if build fails) ────────────────────
OLD_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
echo "[0/4] Current commit: $OLD_COMMIT"

# ── Preserve .env before reset (.gitignore wasn't always in place) ──────
echo "[1/4] Pulling latest changes..."
rm -f .env.deploy-backup
if [ -f .env ]; then cp .env .env.deploy-backup; fi
# Auto-restore .env even if git commands fail (set -e would exit)
trap 'if [ -f .env.deploy-backup ]; then mv .env.deploy-backup .env; fi' EXIT
git fetch origin main
git reset --hard origin/main
# Restore .env — NEVER let git overwrite production secrets
if [ -f .env.deploy-backup ]; then mv .env.deploy-backup .env; fi
trap - EXIT  # restore succeeded, remove trap

# ── Capture new commit hash ─────────────────────────────────────────────────
GIT_COMMIT=$(git rev-parse --short HEAD)
echo "[2/4] Deploying commit: $GIT_COMMIT (was: $OLD_COMMIT)"

# ── Rebuild and restart ─────────────────────────────────────────────────────
echo "[3/4] Rebuilding Docker images (commit: $GIT_COMMIT)..."
echo "       If this fails, rollback: git reset --hard $OLD_COMMIT && docker compose build --build-arg VITE_GIT_COMMIT=$OLD_COMMIT web && docker compose up -d"
# Pass GIT_COMMIT explicitly via --build-arg (bypasses docker-compose.yml interpolation + .env)
docker compose build --build-arg VITE_GIT_COMMIT="$GIT_COMMIT" web
docker compose up -d --remove-orphans

# ── Clean up old images ─────────────────────────────────────────────────────
echo "[4/4] Cleaning up old images..."
docker image prune -f

echo "=== Deploy finished: $GIT_COMMIT ==="
