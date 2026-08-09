#!/usr/bin/env bash
# =============================================================================
# restart-service.sh — run ON the VPS by .forgejo/workflows/deploy.yml.
#
# Pulls ONE service's image from the Codeberg container registry, retags it to
# the docker-compose image name (ghcr.io/elcrazycol/*), and recreates exactly
# that container. The VPS never builds images and never pulls our old streams.
#
# Usage:  restart-service.sh <service>
# Env:    REG (default codeberg.org/crazycol)   — container registry to pull
#         COMPOSE_NAMESPACE (default ghcr.io/elcrazycol) — docker-compose image:
#              names; the pulled image is retagged to this namespace
#         CADDY_CHANGED=true (only the web job sets it) → also restart caddy
#              so a changed Caddyfile is picked up (it is bind-mounted, so
#              Compose cannot detect the change by itself).
# =============================================================================
set -euo pipefail

SERVICE="${1:?usage: restart-service.sh <service>}"

# Locate the repo (deploy scripts look for /root/gomo6.2 or /home/*/gomo6.2).
for d in /root/gomo6.2 /home/*/gomo6.2; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yml" ] && { cd "$d"; break; }
done
[ -f docker-compose.yml ] || { echo "gomo6.2 repo not found"; exit 1; }

REGISTRY="${REG:-codeberg.org/crazycol}"            # Codeberg container registry
COMPOSE_NAMESPACE="${COMPOSE_NAMESPACE:-ghcr.io/elcrazycol}" # image: names in docker-compose.yml

echo "[restart-service] $SERVICE: pulling $REGISTRY/gomo6-$SERVICE:latest"
docker pull "$REGISTRY/gomo6-$SERVICE:latest"
docker tag "$REGISTRY/gomo6-$SERVICE:latest" "$COMPOSE_NAMESPACE/gomo6-$SERVICE:latest"

# Recreates ONLY this container (image ID changed → new container). No-ops if
# the image is unchanged. Concurrent invocations are serialized by Compose's
# project lock.
docker compose up -d --no-build "$SERVICE"

# Keep the 1 GB VPS disk clean of old dangling layers.
docker image prune -f || true

# Caddyfile is bind-mounted — restart Caddy so routing (CSP, storage buckets)
# always applies. Only the web job passes CADDY_CHANGED=true, and the web job
# always runs whenever the Caddyfile changed (the change-detection rebuilds
# all services for a root Caddyfile edit).
if [ "${CADDY_CHANGED:-false}" = "true" ] && [ "$SERVICE" = "web" ]; then
  echo "[restart-service] Caddyfile changed — restarting caddy"
  docker compose restart caddy || true
fi

echo "[restart-service] $SERVICE done"
