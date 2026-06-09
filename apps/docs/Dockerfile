# =============================================================================
# Docs Frontend — Multi-stage Docker build (monorepo-aware)
# =============================================================================
# Stage 1: Build the Vite React app
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace config and ALL workspace package.json files for npm ci
COPY package.json package-lock.json turbo.json ./
COPY apps/docs/package.json ./apps/docs/
COPY apps/web/package.json ./apps/web/
COPY apps/dev-dashboard/package.json ./apps/dev-dashboard/

# Install ALL workspace dependencies at root
# BuildKit cache mount persists /root/.npm across builds
ENV NODE_OPTIONS="--max-old-space-size=1024"
RUN --mount=type=cache,target=/root/.npm \
    for i in 1 2 3; do npm ci && exit 0; sleep 10; done; exit 1

# Copy the docs app source
COPY apps/docs/ ./apps/docs/

# Build for production
RUN npm run build --workspace=@gomo6/docs

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine

# Copy built assets
COPY --from=builder /app/apps/docs/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
