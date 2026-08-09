#!/usr/bin/env bash
# =============================================================================
# Gomo6 — remote deploy script.
# Executed ON the VPS by .forgejo/workflows/deploy.yml (after the Mac already
# streamed fresh images into the local docker daemon via `docker load`).
# The VPS never builds images and never pulls ours.
# =============================================================================
set -euo pipefail

# Locate the repo (deploy scripts look for /root/gomo6.2 or /home/*/gomo6.2).
for d in /root/gomo6.2 /home/*/gomo6.2; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yml" ] && { cd "$d"; break; }
done
[ -f docker-compose.yml ] || { echo "gomo6.2 repo not found"; exit 1; }

# Validate compose config (all required env vars present) before touching anything.
docker compose config >/dev/null

# Recreates ONLY containers whose image ID changed; no-ops otherwise.
docker compose up -d --no-build --remove-orphans

# Caddyfile is bind-mounted, so Compose can't see it changed — restart Caddy
# so routing (CSP, storage buckets) always applies.
docker compose restart caddy || true

docker image prune -f || true

echo "=== Deploy done ==="
