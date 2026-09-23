<h1 align="center">Gomo6</h1>

<p align="center">
  <strong>Open-source social network: feed, messenger, communities, gamification and a developer platform</strong>
</p>

<p align="center">
  <a href="https://codeberg.org/crazycol/gomo6.2/actions"><img src="https://img.shields.io/badge/CI-passing-44cc11?style=flat-square&logo=forgejo&logoColor=white" alt="CI"></a>
  <a href="https://codeberg.org/crazycol/gomo6.2/actions/workflows/deploy.yml"><img alt="deploy" src="https://codeberg.org/crazycol/gomo6.2/actions/workflows/deploy.yml/badge.svg?style=flat-square" alt="Deploy"></a>
  <a href="https://codeberg.org/crazycol/gomo6.2/src/branch/main/LICENSE.md"><img alt="License" src="https://img.shields.io/badge/license-AGPL--3.0-a42e2b?style=flat-square&color=orange"></a>
  <a href="https://crazycol.codeberg.page/gomo6.2/coverage/"><img src="https://crazycol.codeberg.page/gomo6.2/coverage/coverage-go.svg" alt="Go coverage"></a>
  <a href="https://crazycol.codeberg.page/gomo6.2/coverage/"><img src="https://crazycol.codeberg.page/gomo6.2/coverage/coverage-ts.svg" alt="TypeScript coverage"></a>
  <a href="https://crazycol.codeberg.page/gomo6.2/coverage/"><img src="https://crazycol.codeberg.page/gomo6.2/coverage/coverage-total.svg" alt="Total coverage"></a>
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

<p align="center">
  <a href="https://codeberg.org/crazycol/gomo6.2"><img src="https://img.shields.io/gitea/last-commit/crazycol/gomo6.2?gitea_url=https://codeberg.org&style=for-the-badge&logo=codeberg&logoColor=white" alt="last commit"></a>
</p>

---

## About

**Gomo6** is a full-stack social network: a personalized feed of boards and threads, profile walls with a design studio, a real-time encrypted messenger, Discord-style communities (GomoSubs), achievements and gamification, an in-app economy — and a developer platform on top (OAuth 2.0 / OpenID Connect provider + a TypeScript bot SDK).

The backend is Go (Gin) on PostgreSQL + Redis + Garage (S3-compatible object storage); the frontend is React 18 + TypeScript + Vite + Tailwind. Everything lives in a single Turborepo / npm-workspaces monorepo and deploys as Docker Compose behind a Caddy reverse proxy on one VPS.

## Features

| Area | Highlights |
|---|---|
| Feed & posts | Personalized feed (threads + wall posts, scored per viewer), boards, threads, posts, likes, comments, emoji reactions, attachments (image / video / audio / file), built-in X-style video player, photo editor |
| Profiles | Profile walls with albums, avatar history, profile studio (backgrounds, auto-generated themes), ActiEye activity ring, live online presence, friends, granular privacy controls |
| Messenger | 1:1 chats, group chats, notes to self, AES-256 encryption at rest, real-time message editing and deletion, read receipts, presence, attachments, mobile-first UI |
| GomoSubs | Discord-like communities: forum channels + real-time text chat, roles and permissions, invite codes, mobile sheet UX |
| Gamification | Achievements (cards, levels, secret unlocks) + rarity chests (Common → Eternal) with gem rewards and a dev-dashboard playground |
| Economy | Wallet with GM6 addresses, drops (paid currency, crypto payments via DePay), gems (earned currency), collectible gifts with layered artwork, upgrades and garma |
| Developer platform | OAuth 2.0 + OpenID Connect provider (Authorization Code + PKCE, consent screen, OIDC discovery), TypeScript bot SDK with real-time events, dev dashboard |
| Moderation | User reports, moderator queue, post resolution, admin gift catalog |
| Realtime | WebSocket hub with room-scoped subscriptions and presence rooms across feed, boards, threads, messenger and channel chat |
| i18n | Russian + English UI with community-contributed translations and voting |
| Security | JWT + refresh tokens, TOTP 2FA, WebAuthn passkeys, Cloudflare Turnstile + honeypot anti-bot, CSRF protection, row-level security, per-surface rate limits, encrypted messages |
| Notifications | In-app notifications + Web Push (PWA, VAPID) |
| PWA & performance | Installable PWA with service-worker caching, HTTP/3 (QUIC), edge compression (zstd + gzip), split bundles |
| Observability | Prometheus `/metrics`, Sentry RUM (errors + tracing + Web Vitals), Grafana Cloud via Alloy |

## Architecture

**Monorepo** (Turborepo + npm workspaces). Four apps:

| App | Stack | Purpose | Dir | Dev port |
|-----|-------|---------|-----|----------|
| Web | React 18 + Vite + Tailwind + TypeScript | Main social network UI | `apps/web` | 8081 |
| Docs | TypeScript + Vite | Developer documentation (bots + OAuth) | `apps/docs` | 3001 |
| Dev Dashboard | TypeScript + Vite | Developer portal: OAuth apps, bots, gifts catalog, chest playground | `apps/dev-dashboard` | 3002 |
| Backend | Go 1.26 + Gin + PostgreSQL + Redis + Garage S3 | REST API + WebSocket | `apps/backend-go` | 8080 |

### Production stack (Docker Compose)

| Service | Purpose | Technology |
|---|---|---|
| `caddy` | TLS termination (Let's Encrypt), routing, HTTP/3; proxies file reads straight to Garage | Caddy 2 |
| `backend` | REST API + WebSocket | Go + Gin |
| `web` | Main site static files | nginx |
| `docs` | Developer documentation static files | nginx |
| `dev-dashboard` | Developer portal static files | nginx |
| `postgres` | Primary database | PostgreSQL 15 |
| `redis` | Cache, rate limiting, realtime | Redis 7 |
| `garage` | S3-compatible object storage (files, avatars, emoji, gift layers, gamification assets) | Garage 2.3 |
| `garage-init` | One-time setup: layout, S3 keys, buckets | Alpine |
| `alloy` | Observability agent: scrapes backend `/metrics` → Grafana Cloud | Grafana Alloy |

### Storage architecture

```
Reads:   Browser → Caddy → Garage:3902 (direct, no backend)
Writes:  Browser → Caddy → Backend:8080 → Garage:3900 (S3 API)
```

Public buckets (content, post-images, avatars, emojis, gift-layers, gamification) are served directly by Garage's website endpoint through Caddy — file reads never touch the Go backend. Private buckets (`uploads`, `wall`) are served through the backend, which enforces authentication and per-wall privacy before streaming. Uploads and deletes always go through the backend for auth, validation and video/audio processing.

---

## Quick start

### One command: `make dev`

The fastest way to get the whole stack running locally — **no manual setup** (`.env` secrets, `npm install` and the infra containers are handled for you):

```bash
make dev
```

Requirements: **Docker**, **Node 22+**, **npm**, **Go 1.26+**, **openssl** — and `ffmpeg`/`ffprobe` if you want video uploads to work locally (e.g. `brew install ffmpeg`).

What it does:

1. Checks the prerequisites and installs npm dependencies
2. Creates `.env` from `.env.example` and generates all required secrets (existing values are **preserved**)
3. Renders `.garage.toml` and starts **Postgres + Redis + Garage** in Docker (ports published to localhost for the locally-run backend)
4. Waits for the infra to become healthy and pulls the Garage S3 keys out of the `garage_keys` volume — uploads work out of the box
5. Starts the **Go backend** (:8080) and the **frontend dev servers** in parallel:

```
🚀  http://localhost:8081   — main web app
    http://localhost:3001   — docs
    http://localhost:3002   — dev dashboard
```

**Ctrl+C** stops the backend and frontends (the infra containers keep running). To stop everything:

```bash
make stop
```

### Make targets

| Target | What it does |
|---|---|
| `make dev` | Full one-command dev environment (above) |
| `make install` | `npm install` for the whole workspace |
| `make env` | Create `.env` + generate secrets + render `.garage.toml` |
| `make infra` | Start Postgres + Redis + Garage on localhost (dev ports) |
| `make backend` | Run the Go backend on :8080 (needs `make env` + `make infra` first) |
| `make web` | Frontend dev servers (web :8081, docs :3001, dev-dashboard :3002) |
| `make stop` | Stop the dev infra containers (volumes kept) |
| `make test` | Backend (`go test ./...`) + web (vitest) |
| `make lint` | golangci-lint + eslint |
| `make typecheck` | `tsc --noEmit` for web, dev-dashboard and docs |

Run `make help` to see the list with descriptions.

---

## Production deploy

### Auto-deploy (primary)

Push to `main` → Codeberg Actions (`deploy.yml`) → automatic deploy to the VPS:

1. **Detect** — the Codeberg compare API finds which services changed (no full clone; no-op commits finish in ~1s)
2. **Checkout** — incremental `git fetch` into a persistent cache on the runner (`$HOME/gomo6-src`)
3. **Build & push** — `docker buildx build --push` to the Codeberg container registry (`codeberg.org/crazycol/gomo6-*`); layer dedup means only changed layers travel
4. **Restart** — per-service `docker pull` + retag + `docker compose up -d --no-build` on the VPS ([`scripts/restart-service.sh`](scripts/restart-service.sh), flock-serialized)

Codeberg Actions secrets (repo → Settings → Actions → Secrets):

| Secret | Purpose |
|---|---|
| `VPS_HOST` | Server IP |
| `VPS_USER` | SSH user (usually `root`) |
| `VPS_SSH_KEY` | Private SSH key |
| `VPS_PORT` | SSH port (default `22`) |
| `CODEREG_TOKEN` | Codeberg PAT (account `crazycol`) with `read:package` + `write:package` — pushes images to the registry |
| `VITE_TURNSTILE_SITEKEY` | Turnstile public sitekey (web build) |
| `VITE_SENTRY_DSN` | Sentry public DSN (web build) |
| `VITE_DEPAY_INTEGRATION_ID` | DePay integration ID (web build) |

### Manual deploy

```bash
git clone https://codeberg.org/crazycol/gomo6.2.git
cd gomo6.2

cat > .env << 'EOF'
DOMAIN=your-domain.com
JWT_SECRET=<generate: openssl rand -hex 32>
MESSENGER_ENCRYPTION_KEY=<generate: openssl rand -hex 32>
REDIS_PASSWORD=<generate: openssl rand -hex 16>
POSTGRES_PASSWORD=<generate: openssl rand -hex 16>
ENVIRONMENT=production
ALLOWED_ORIGINS=https://your-domain.com,http://your-domain.com
EOF

# Fill remaining secrets (Garage, Turnstile, VAPID, ...)
bash scripts/generate-keys.sh --quiet .env
# Render the runtime Garage config from .env (required by docker-compose)
bash scripts/generate-garage-config.sh .env

docker compose up -d
```

The VPS repo tracks the public Codeberg HTTPS origin — `restart-service.sh` runs `git fetch origin main && git reset --hard origin/main` before every `docker compose up`, so the `Caddyfile`, `docker-compose.yml` and scripts stay current. `reset --hard` never touches untracked files: `.env`, `.garage.toml` and `*.bak` survive deploys. The repo directory must be named `gomo6.2` (deploy scripts search for `/root/gomo6.2` or `/home/*/gomo6.2`).

> **Backups** — before migrating servers, dump Postgres (`docker compose exec postgres pg_dump -U gomo6 gomo6 > gomo6_db_*.sql`) and copy `.env` (it holds `JWT_SECRET` and `MESSENGER_ENCRYPTION_KEY` — losing them invalidates all sessions and encrypted messages).

---

## CI/CD

All workflows run on Codeberg Actions (`.forgejo/workflows/`):

| Workflow | Trigger | What it does |
|---|---|---|
| `deploy.yml` | push to main, manual | Change detection via the Codeberg compare API → incremental checkout → buildx build & push to the Codeberg registry → per-service restart on the VPS |
| `coverage.yml` | PR, push to main, manual | **PRs**: incremental tests only (changed Go packages, `vitest --changed` for TS) + result comment on the PR; docs-only changes run nothing. **main**: full Go + TS coverage → SVG badges + HTML report → coverage gate (`MIN_GO_COVERAGE`, `MIN_TS_COVERAGE`) → deploy to Codeberg Pages |
| `mirror.yml` | any push | Full mirror of the repo to GitHub (`elcrazycol/gomo6.2`) and GitLab (`crazycol/gomo6.2`) |

```bash
# Local CI (mirrors what CI runs)
./scripts/ci-local.sh quick   # lint + typecheck only
./scripts/ci-local.sh         # full CI including builds
```

A pre-commit hook (`.githooks/`) runs gofmt / go vet / go test on changed Go packages and eslint on staged frontend files: `git config core.hooksPath .githooks`.

---

## Environment variables

`.env.example` is the full template. Required secrets:

| Variable | Purpose |
|---|---|
| `DOMAIN` | Main domain (e.g. `gomo6.wtf`) |
| `JWT_SECRET` | JWT signing secret |
| `MESSENGER_ENCRYPTION_KEY` | AES-256 key for server-side message encryption (32 bytes hex) |
| `REDIS_PASSWORD` | Redis authentication password |
| `POSTGRES_PASSWORD` | PostgreSQL authentication password |
| `FEDERATION_KEY` | Legacy — no longer used by any code path, but `docker-compose.yml` still requires a non-empty value (keep the old one to avoid touching `.env`) |
| `GARAGE_RPC_SECRET`, `GARAGE_ADMIN_TOKEN` | Internal Garage credentials — generated by `scripts/generate-keys.sh`, rendered into `.garage.toml`, never committed. S3 keys are created once by `garage-init` and stored in the `garage_keys` volume |

Optional:

| Variable | Purpose |
|---|---|
| `ENVIRONMENT` | `production` or `development` |
| `ALLOWED_ORIGINS` | CORS allowlist (comma-separated) |
| `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` / `VITE_TURNSTILE_SITEKEY` | Cloudflare Turnstile anti-bot on signup/login (disabled locally via `TURNSTILE_DISABLED=1`) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (PWA) — generate with `cd apps/backend-go && go run ./cmd/vapidgen`; without them push is disabled |
| `DEPAY_PUBLIC_KEY` / `DEPAY_PRIVATE_KEY` / `DEPAY_RECEIVER_*` | DePay crypto payments for drops (ETH / Polygon / Base / Solana) |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify now-playing widget on profiles |
| `VITE_SENTRY_DSN` | Sentry RUM — errors + tracing + Web Vitals (SDK is a no-op without it) |
| `METRICS_TOKEN` | Access token for backend `/metrics` (empty = 404); also used by the `alloy` container |
| `GRAFANA_CLOUD_METRICS_URL` / `_USERNAME` / `_PASSWORD` | Hosted Prometheus remote-write (Grafana Cloud) |
| `WEBAUTHN_RP_ID` / `_ORIGIN` / `_NAME` | Passkey relying party settings (defaults derive from `DOMAIN`) |

> Database / Redis URLs, Garage S3 endpoint and most service wiring are configured in `docker-compose.yml` and need no manual setup. Never commit `.env` or `.garage.toml` to version control.

---

## Documentation

- **Developer docs** — the live docs site (built from `apps/docs`): bot quick start, events, API reference and examples for the TypeScript SDK (`@gomo6/bot`), plus the OAuth 2.0 flow guides
- **Wiki guides** (`docs/wiki/`):
  - [DEPLOYMENT.md](docs/wiki/DEPLOYMENT.md) — VPS deployment guide
  - [DOCKER_SETUP.md](docs/wiki/DOCKER_SETUP.md) — Docker deployment with Caddy
  - [SELF_HOSTED_RUNNER.md](docs/wiki/SELF_HOSTED_RUNNER.md) — how to run the Codeberg Actions runner on the project Mac
  - [OAUTH_API.md](docs/wiki/OAUTH_API.md) — OAuth 2.0 API reference
  - [MESSENGER_SECURITY.md](docs/wiki/MESSENGER_SECURITY.md) — messenger security model
  - [REALTIME_WEBSOCKET_PATTERN.md](docs/wiki/REALTIME_WEBSOCKET_PATTERN.md) — WebSocket patterns
  - [PRESENCE_SYSTEM_DESIGN.md](docs/wiki/PRESENCE_SYSTEM_DESIGN.md) — presence system design
  - [THREAD_ATTACHMENTS_GUIDE.md](docs/wiki/THREAD_ATTACHMENTS_GUIDE.md) — attachments guide
  - [SECURITY_AUDIT.md](docs/wiki/SECURITY_AUDIT.md) — security audit
- **Legacy docs** — the older Lua-era bot docs (`docs/wiki/BOT_SYSTEM_ARCHITECTURE.md`, `docs/wiki/BOT_EXAMPLES.md`) are kept for history; the current bot SDK is TypeScript
- **Release history** — [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog + SemVer, version lives in [`VERSION`](VERSION))

---

<p align="center">
  <a href="https://codeberg.org/crazycol/gomo6.2">codeberg.org/crazycol/gomo6.2</a>
</p>