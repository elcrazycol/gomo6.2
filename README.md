<div align="center">

<img src="apps/web/public/gomo6-mark.svg" width="88" alt="gomo6">

# gomo6

**Social network with a forum, boards and threads, an encrypted messenger and Discord-style communities.**

<a href="README.md"><img src="https://img.shields.io/badge/English-2f81f7?style=flat-square" alt="English"></a>
<a href="README.ru.md"><img src="https://img.shields.io/badge/%D0%A0%D1%83%D1%81%D1%81%D0%BA%D0%B8%D0%B9-6e7681?style=flat-square" alt="Русский"></a>

<a href="https://github.com/elcrazycol/gomo6.2/actions/workflows/deploy.yml"><img src="https://github.com/elcrazycol/gomo6.2/actions/workflows/deploy.yml/badge.svg" alt="CI/CD"></a>
<a href="https://github.com/elcrazycol/gomo6.2/releases"><img src="https://img.shields.io/github/v/release/elcrazycol/gomo6.2?style=flat-square" alt="Release"></a>
<a href="LICENSE.md"><img src="https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square" alt="License"></a>
<a href="https://github.com/elcrazycol/gomo6.2"><img src="https://img.shields.io/github/last-commit/elcrazycol/gomo6.2?style=flat-square" alt="Last commit"></a>

<img src="https://img.shields.io/badge/Go-1.26-00ADD8?style=flat-square&logo=go&logoColor=white" alt="Go">
<img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React">
<img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
<img src="https://img.shields.io/badge/PostgreSQL-18-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL">
<img src="https://img.shields.io/badge/Redis-7-DC382D?style=flat-square&logo=redis&logoColor=white" alt="Redis">
<img src="https://img.shields.io/badge/Meilisearch-1.53-FF5CAA?style=flat-square" alt="Meilisearch">
<img src="https://img.shields.io/badge/Garage-2.3-FF6B35?style=flat-square" alt="Garage">
<img src="https://img.shields.io/badge/Caddy-2-0A6ED1?style=flat-square" alt="Caddy">

**Live instance → [gomo6.wtf](https://gomo6.wtf)**

</div>

---

## About

gomo6 is a full-stack social network: a personalized feed of boards and threads, profile walls with a customization studio, an encrypted messenger, Discord-style communities (GomoSubs) with both forum channels and live text chat, achievements, custom emoji packs — plus search built on a dedicated engine rather than SQL `LIKE`.

Backend — **Go (Gin)** on PostgreSQL, Redis, Garage (S3-compatible storage) and Meilisearch. Frontend — **React 18 + TypeScript + Vite**. Everything is a single Turborepo / npm-workspaces monorepo and ships as Docker Compose behind Caddy on one VPS. Deploys go through GitHub Actions to `ghcr.io`, and the VPS only pulls finished images — it never builds.

## Screenshots

Every screenshot below is a real instance running the [demo dataset](scripts/seed.sh) locally.

**Feed** — boards, threads and wall posts in one stream, with the section sidebar and subscriptions.

![Feed, ash theme](docs/assets/readme/feed-dark.png)

**Themes** — 18 built-in themes, light and dark, applied instantly across the whole app.

![Switching themes on the appearance page](docs/assets/readme/themes.gif)

**Profile** — wall with guest posts, stats (posts / likes / views / garma) and tabs for achievements, posts, gifts and friends.

![Profile](docs/assets/readme/profile-dark.png)

**Messenger** — 1:1 and group chats, notes to self encrypted in the browser, read receipts and presence.

![Messenger](docs/assets/readme/messenger-dark.png)

**Settings → appearance** — themes with live preview and the light / dark / system mode switch.

![Settings, appearance section](docs/assets/readme/settings-appearance-light.png)

**Moderation** — report queue, appeals, staff and the action log. Available to instance admins and moderators.

![Moderation](docs/assets/readme/moderation-dark.png)

## Features

| Area | What's there |
|---|---|
| **Feed & boards** | Personalized feed of threads and wall posts, boards and sections, threads, posts, comments, likes, reposts, emoji reactions, attachments (image / video / audio / file), built-in video player, photo editor |
| **Profiles** | Wall with public and guest posts, profile studio (backgrounds, gradients, shadows, nickname CSS, badges), avatar history, garma (karma awarded for activity), profile stats, online presence, friends and subscriptions |
| **Messenger** | 1:1 and group chats, notes to self encrypted in the browser, message encryption at rest on the server, editing and deleting, read receipts, presence, attachments, mobile-first UI |
| **GomoSubs** | Discord-style communities: forum channels and real-time text chat in the same community, roles and permissions, invite codes |
| **Search** | Meilisearch-backed search over users, boards, threads, posts and wall posts, with filters by type, author and date. If the engine is not configured or fails, the API degrades to the PostgreSQL full-text path |
| **Achievements** | Achievement cards with levels, secret unlocks, rarity tiers (common → mythic) and rewards in garma |
| **Emoji packs** | Custom emoji packs — any user can create one, upload emoji and share the pack |
| **Gifts** | Collectible gifts with layered artwork |
| **Privacy** | Private profiles, private and hidden walls, mutual-friends gates, per-content visibility; private content is never indexed into search |
| **Moderation** | Reports queue, appeals, staff management and an append-only action log (for instance admins and moderators) |
| **Notifications** | In-app notifications and Web Push (PWA, VAPID) |
| **Security** | JWT with refresh tokens, TOTP 2FA, WebAuthn passkeys, CSRF protection, per-surface rate limits, message encryption, Cloudflare Turnstile anti-bot. Security audits are run regularly |
| **i18n** | Russian and English UI with community translation proposals and voting |
| **PWA & delivery** | Installable PWA with service-worker caching, HTTP/3, zstd/gzip compression, split bundles |
| **Observability** | Self-hosted VictoriaMetrics stack (vmagent → VictoriaMetrics → vmalert → Alertmanager/Telegram, Perses dashboards), Prometheus metrics, Sentry RUM |
| **Developer platform** | OAuth 2.0 / OpenID Connect provider with a consent flow and a developer dashboard for apps and bots; the bot SDK lives in this repo and is still early-stage |

## Tech stack

| Layer | Technology |
|---|---|
| API & realtime | Go 1.26, Gin, WebSocket hub with room-scoped subscriptions |
| Data | PostgreSQL 18, Redis 7, Meilisearch 1.53, Garage 2.3 (S3-compatible) |
| Web | React 18, TypeScript 5, Vite, Tailwind, Radix UI, Zustand, TanStack Query |
| Delivery | nginx (static), Caddy 2 (TLS, HTTP/3, compression) |
| Build & deploy | Turborepo + npm workspaces, Docker Compose, GitHub Actions, `ghcr.io` |
| Quality | golangci-lint, gofmt/go vet, ESLint, `tsc`, Vitest, gitleaks, hadolint, govulncheck, CodeQL/Trivy on a schedule, Codecov |

## Quick start

```bash
make dev
```

One command brings up the whole stack — Docker infra, secrets, dependencies and every dev server:

```
http://localhost:8081        web app
http://localhost:3001        developer docs
http://localhost:3002        developer dashboard
http://localhost:8080/health backend
```

Requirements: **Docker**, **Node 22+**, **npm**, **Go 1.26+**, **openssl**, and **tmux** or **overmind** (installed by `make tools`) for the process manager; **ffmpeg** if you want local video uploads to work. `make doctor` checks every prerequisite, the Docker daemon, `.env` and the dev ports.

Fill the UI with content in one more command:

```bash
make seed        # idempotent demo dataset: profile, wall, friends, feed, chat
```

Demo sign-in: `demo@gomo6.local` / `gomo6-demo-9f3k2x` (also `alice@` and `bob@`, same password).

<details>
<summary><b>Make targets</b></summary>

| Target | What it does |
|---|---|
| `make dev` | Full one-command dev environment |
| `make attach` | Re-attach to the `make dev` tmux session |
| `make dev-stop` | Stop the dev processes (infra keeps running) |
| `make seed` | Populate the local DB with demo data |
| `make doctor` | Check prerequisites, Docker, `.env` and ports |
| `make infra` | Postgres + Redis + Meilisearch + Garage on localhost |
| `make backend` | Run the Go backend on :8080 |
| `make web` | Frontend dev servers (web, docs, dev-dashboard) |
| `make test` / `make lint` / `make typecheck` | Tests, linters, `tsc --noEmit` |
| `make psql` / `make redis-cli` / `make logs` | Inspect the local infra |
| `make reset-db` | **Destructive** — drop the dev volumes |

`make help` lists everything with descriptions.

</details>

## Project layout

| App | Stack | What it is |
|---|---|---|
| [`apps/web`](apps/web) | React 18 + Vite + Tailwind | The social network UI |
| [`apps/backend-go`](apps/backend-go) | Go + Gin + Postgres + Redis + Meilisearch + Garage | REST API and WebSocket hub |
| [`apps/docs`](apps/docs) | TypeScript + Vite | Developer documentation |
| [`apps/dev-dashboard`](apps/dev-dashboard) | TypeScript + Vite | Developer portal: OAuth apps, bots, gifts |
| [`packages/bot-sdk`](packages/bot-sdk) | TypeScript | Bot SDK (early stage) |

## Deployment

Push to `main` → GitHub Actions runs the checks, builds changed services on a self-hosted runner, pushes images to `ghcr.io` and restarts exactly those services on the VPS:

```
CI gate → plan (which services changed) → buildx build --push → pull + compose up on the VPS
```

The VPS is small (1 vCPU / 1 GB) and never builds anything — it only pulls images and restarts containers. Full guide, secrets and manual deployment: **[docs/wiki/DEPLOYMENT.md](docs/wiki/DEPLOYMENT.md)**.

## Documentation

- **Developer docs** — the live docs site ([`apps/docs`](apps/docs)): bot quick start, events, API and OAuth 2.0 flow guides
- **Wiki** ([`docs/wiki`](docs/wiki)) — deployment, Docker setup, OAuth API, messenger security model, realtime WebSocket patterns, presence design, attachments
- **Changelog** — [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog + SemVer; the version lives in [`VERSION`](VERSION))

## Contributing

Issues and pull requests are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md); the release ritual and versioning rules live there too. Before pushing, `./scripts/ci-local.sh quick` runs the same lint and type checks CI does, and the pre-commit hook (`git config core.hooksPath .githooks`) checks changed packages on every commit.

## License

[AGPL-3.0](LICENSE.md) — you can use, study, modify and self-host gomo6; derivative network services must stay open.
