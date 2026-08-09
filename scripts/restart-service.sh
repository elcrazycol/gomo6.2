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

# --- concurrency guard -----------------------------------------------------
# The 4 matrix jobs invoke this script in parallel over SSH, and their images
# share base layers (e.g. alpine). Concurrent `docker pull`s race inside
# containerd's content store on this small VPS — the classic symptom is
# "failed commit on ref ... rename .../ingest/.../data .../blobs/...: no such
# file or directory". Serialize the pulls with flock (Linux) and retry
# transient failures; by the second attempt the shared blob is usually
# already committed.
LOCK_FILE="/tmp/gomo6-restart.lock"
exec 9>"$LOCK_FILE"
flock 9

# Locate the repo (deploy scripts look for /root/gomo6.2 or /home/*/gomo6.2).
for d in /root/gomo6.2 /home/*/gomo6.2; do
  [ -d "$d" ] && [ -f "$d/docker-compose.yml" ] && { cd "$d"; break; }
done
[ -f docker-compose.yml ] || { echo "gomo6.2 repo not found"; exit 1; }

REGISTRY="${REG:-codeberg.org/crazycol}"            # Codeberg container registry
COMPOSE_NAMESPACE="${COMPOSE_NAMESPACE:-ghcr.io/elcrazycol}" # image: names in docker-compose.yml

echo "[restart-service] $SERVICE: pulling $REGISTRY/gomo6-$SERVICE:latest"
PULLED=0
for attempt in 1 2 3; do
  if docker pull "$REGISTRY/gomo6-$SERVICE:latest"; then PULLED=1; break; fi
  echo "[restart-service] pull failed (attempt $attempt/3) — retrying"
  sleep 3
done
[ "$PULLED" = 1 ] || { echo "[restart-service] pull failed 3 times — giving up"; exit 1; }
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
