# syntax=docker/dockerfile:1
# =============================================================================
# Dev Dashboard — fast multi-arch build.
#
# The builder runs on the runner's NATIVE arch (arm64 on the M1 Mac): npm ci
# and vite run at full speed, never emulated. The final nginx stage is built
# for the VPS arch (amd64) but only COPYs static files, so the emulation cost
# is zero after the base image is cached.
#
# Caches that survive between builds on the runner's disk:
#   - /root/.npm        — npm download cache (warm `npm ci`)
#   - /app/node_modules — installed deps, reused when the lockfile matches
# =============================================================================

# ---- Build stage: native arch on the runner --------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder

WORKDIR /app

# Root workspace + ALL workspace manifests — npm needs the full workspace set.
COPY package.json package-lock.json turbo.json ./
COPY apps/dev-dashboard/package.json ./apps/dev-dashboard/
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/

ENV NODE_OPTIONS="--max-old-space-size=1024"
# npm download cache persists on the runner disk. This RUN layer is cached by
# BuildKit: it re-executes only when a package file changes, i.e. exactly when
# a fresh install is needed.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# App source last — the expensive layers above stay cached across commits.
COPY apps/dev-dashboard/ ./apps/dev-dashboard/

RUN npm run build --workspace=@gomo6/dev-dashboard

# ---- Runtime stage: VPS arch (COPY only) ------------------------------------
FROM --platform=$TARGETPLATFORM nginx:1.27-alpine

COPY --from=builder /app/apps/dev-dashboard/dist /usr/share/nginx/html
COPY apps/dev-dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
