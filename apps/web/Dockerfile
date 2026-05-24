# =============================================================================
# Web Frontend — Multi-stage Docker build (monorepo-aware)
# =============================================================================
# Stage 1: Build the Vite React app
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root workspace config and ALL workspace package.json files for npm ci
COPY package.json package-lock.json turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY apps/docs/package.json ./apps/docs/
COPY apps/dev-dashboard/package.json ./apps/dev-dashboard/

# Install ALL workspace dependencies at root
RUN npm ci

# Copy the web app source
COPY apps/web/ ./apps/web/

# Build for production (disable Vercel SpeedInsights in Docker)
ARG VITE_DOCKER=true
ARG VITE_GIT_COMMIT=unknown
ENV VITE_DOCKER=$VITE_DOCKER
ENV VITE_GIT_COMMIT=$VITE_GIT_COMMIT
RUN npm run build --workspace=@gomo6/web

# Stage 2: Serve with nginx
FROM nginx:1.27-alpine

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
