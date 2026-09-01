# syntax=docker/dockerfile:1
# =============================================================================
# Web — fast multi-arch build.
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
# The root postinstall (scripts/patch-vaul.mjs) runs inside npm ci below, so
# scripts/ must be present before the install step.
COPY scripts/ ./scripts/
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/
COPY apps/dev-dashboard/package.json ./apps/dev-dashboard/

ENV NODE_OPTIONS="--max-old-space-size=2048"
# npm download cache persists on the runner disk. This RUN layer is cached by
# BuildKit: it re-executes only when a package file changes, i.e. exactly when
# a fresh install is needed.
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# App source last — the expensive layers above stay cached across commits.
COPY apps/web/ ./apps/web/

ARG VITE_DOCKER=true
ARG VITE_GIT_COMMIT=unknown
ARG VITE_APP_VERSION=unknown
ARG VITE_DEPAY_INTEGRATION_ID=""
ARG VITE_TURNSTILE_SITEKEY=""
ARG VITE_SENTRY_DSN=""
ENV VITE_DOCKER=$VITE_DOCKER
ENV VITE_GIT_COMMIT=$VITE_GIT_COMMIT
ENV VITE_APP_VERSION=$VITE_APP_VERSION
ENV VITE_DEPAY_INTEGRATION_ID=$VITE_DEPAY_INTEGRATION_ID
ENV VITE_TURNSTILE_SITEKEY=$VITE_TURNSTILE_SITEKEY
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN

RUN npm run build --workspace=@gomo6/web

# ---- Runtime stage: VPS arch (COPY only) ------------------------------------
FROM --platform=$TARGETPLATFORM nginx:1.27-alpine

COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
