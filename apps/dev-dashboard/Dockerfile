# =============================================================================
# Dev Dashboard Frontend — Multi-stage Docker build (monorepo-aware)
# =============================================================================
# Stage 1: Build the Vite React app
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace config and ALL workspace package.json files for npm ci
COPY package.json package-lock.json turbo.json ./
COPY apps/dev-dashboard/package.json ./apps/dev-dashboard/
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/

# Install ALL workspace dependencies at root
# BuildKit cache mount persists /root/.npm across builds
ENV NODE_OPTIONS="--max-old-space-size=512"
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# Copy the dev-dashboard app source
COPY apps/dev-dashboard/ ./apps/dev-dashboard/

# Build for production
RUN npm run build --workspace=@gomo6/dev-dashboard

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine

# Copy built assets
COPY --from=builder /app/apps/dev-dashboard/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/dev-dashboard/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
