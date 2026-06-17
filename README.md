<h1 align="center">Gomo6</h1>

<p align="center">
  <strong>Social platform with messenger, OAuth, audio podcasts, streaming and bots</strong>
</p>

<p align="center">
  <a href="https://github.com/scramble22/gomo6.2/actions/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-passing-44cc11?style=flat-square&logo=githubactions&logoColor=white" alt="CI"></a>
  <a href="https://github.com/scramble22/gomo6.2/actions/workflows/deploy.yml"><img src="https://img.shields.io/badge/deploy-autodeploy-0096ff?style=flat-square&logo=docker&logoColor=white" alt="Deploy"></a>
  <a href="https://github.com/scramble22/gomo6.2/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-gray?style=flat-square" alt="License"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/go-1.26-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/node-22-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node">
  <img src="https://img.shields.io/badge/typescript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/react-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
  <img src="https://img.shields.io/badge/postgresql-15-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis">
  <img src="https://img.shields.io/badge/garage-2.3-FF6B35?style=flat-square" alt="Garage">
  <img src="https://img.shields.io/badge/docker-24-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/caddy-2-0A6ED1?style=flat-square" alt="Caddy">
</p>

---

## About

**Gomo6** is a full-stack social platform with a feed, profiles, audio podcasts, streaming, private messenger, OAuth provider, and bot system. Built with Go (backend) and React + TypeScript (frontend), deployed as a monorepo via Docker Compose on a single VPS.

### Features

| Feature | Description |
|---|---|
| Feed & posts | Create, comment, vote, emoji reactions |
| Profiles | Custom walls, avatar history, JSON bio |
| Messenger | Private chats, attachments, WebSocket real-time |
| OAuth 2.0 | Full provider (Authorization Code + PKCE, client credentials), dev dashboard |
| Audio | Podcasts, streaming, now-playing widget |
| Bots | Bot API, likes, events, logging |
| Security | 2FA (TOTP), WebAuthn/Passkeys, rate limiting |
| Federation | ActivityPub-compatible federation |
| GomoSubs | Discord-like servers with channels, roles, permissions |
| Achievements | Gamification system with rarity tiers |
| Gifts | Send collectible gifts to users for garma, admin catalog management |
| Blockchain nicknames | ERC-721 NFT nicknames on Base L2 |

---

## Architecture

**Monorepo** (Turborepo + npm workspaces). Four apps:

| App | Stack | Dir | Dev port |
|-----|-------|-----|----------|
| Web | React 18 + Vite + Tailwind + TypeScript | `apps/web` | 8081 |
| Docs | TypeScript + Vite | `apps/docs` | 3001 |
| Dev Dashboard | TypeScript + Vite | `apps/dev-dashboard` | 3002 |
| Backend | Go 1.26 + Gin + PostgreSQL + Redis + Garage S3 | `apps/backend-go` | 8080 |

### Production (Docker Compose)

| Service | Purpose | Technology |
|---|---|---|
| `caddy` | TLS termination (Let's Encrypt) + routing | Caddy 2 |
| `backend` | REST API + WebSocket | Go + Gin |
| `web` | Main site static files | nginx |
| `docs` | Documentation static files | nginx |
| `dev-dashboard` | OAuth dashboard static files | nginx |
| `postgres` | Primary database | PostgreSQL 15 |
| `redis` | Cache, sessions, rate limiting | Redis 7 |
| `garage` | S3-compatible object storage (files, avatars, audio) | Garage 2.3 |

### Storage architecture

```
Reads:   Browser → Caddy → Garage:3902 (direct, no backend)
Writes:  Browser → Caddy → Backend:8080 → Garage:3900 (S3 API)
```

File reads bypass the Go backend entirely. Caddy proxies GET/HEAD requests directly to Garage's website port. Uploads and deletes still go through the backend for auth and validation.

---

## Quick start

```bash
# Install dependencies
npm install

# Run all apps in dev mode
npm run dev

# Or individually:
npm run dev:web              # main site only
cd apps/docs && npm run dev  # docs only
```

### Local backend

```bash
cd apps/backend-go

# Start Postgres + Redis + Garage
docker compose up -d postgres redis garage

# Run the server
go run cmd/server/main.go
```

---

## Production deploy

### Auto-deploy (primary)

Push to `main` → green CI → automatic deploy to VPS.

GitHub Actions secrets:
- `VPS_HOST` — server IP
- `VPS_USER` — SSH user (usually `root`)
- `VPS_SSH_KEY` — private SSH key
- `VPS_PORT` — SSH port (default `22`)

### Manual deploy

```bash
# On the server:
cd ~ && git clone git@github.com:scramble22/gomo6.2.git
cd gomo6.2
cat > .env << 'EOF'
DOMAIN=your-domain.com
JWT_SECRET=<generate: openssl rand -hex 32>
FEDERATION_KEY=<generate: openssl rand -hex 16>
ENVIRONMENT=production
ALLOWED_ORIGINS=https://your-domain.com,http://your-domain.com
EOF
docker compose up -d
```

---

## CI/CD

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | push, PR | go build + gofmt + go vet + golangci-lint + govulncheck + tsc (3 apps) + eslint + build (3 apps) + gitleaks + hadolint |
| `deploy.yml` | push to main (after green CI) | Build 4 images → push to ghcr.io → SSH to VPS → pull images → docker compose up |
| `full-tests.yml` | daily cron or manual | Postgres + Redis services, go test -race, migrations, e2e smoke |

```bash
# Local CI
./scripts/ci-local.sh quick   # lint + typecheck only
./scripts/ci-local.sh         # full CI including builds
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DOMAIN` | yes (prod) | Main domain (`gomo6.wtf`) |
| `JWT_SECRET` | yes | JWT signing secret |
| `FEDERATION_KEY` | yes | ActivityPub federation key |
| `ENVIRONMENT` | no | `production` or `development` |
| `ALLOWED_ORIGINS` | no | CORS allowed origins (comma-separated) |

> All other variables (`DATABASE_URL`, `REDIS_URL`, `GARAGE_S3_*`, `WEBAUTHN_*`, etc.) are configured in `docker-compose.yml` and do not require manual setup.
>
> Never commit `.env` to version control.

---

## Documentation

- [CHANGELOG.md](CHANGELOG.md) — release history
- [DEPLOYMENT.md](DEPLOYMENT.md) — VPS deployment guide
- [DOCKER_SETUP.md](DOCKER_SETUP.md) — Docker deployment with Caddy
- [OAUTH_API.md](OAUTH_API.md) — OAuth 2.0 API reference
- [BOT_SYSTEM_ARCHITECTURE.md](BOT_SYSTEM_ARCHITECTURE.md) — bot system architecture
- [BOT_EXAMPLES.md](BOT_EXAMPLES.md) — Lua bot examples
- [MESSENGER_SECURITY.md](MESSENGER_SECURITY.md) — messenger security
- [docs/REALTIME_WEBSOCKET_PATTERN.md](docs/REALTIME_WEBSOCKET_PATTERN.md) — WebSocket patterns
- [docs/THREAD_ATTACHMENTS_GUIDE.md](docs/THREAD_ATTACHMENTS_GUIDE.md) — attachments guide

---

<p align="center">
  Made by <a href="https://github.com/scramble22">scramble22</a>
</p>
