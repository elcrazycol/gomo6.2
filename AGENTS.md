# AGENTS.md

Compact guidance for agents working in this repo.

## Architecture

Monorepo (Turborepo + npm workspaces). Four apps:

| App | Stack | Dir | Dev port |
|-----|-------|-----|----------|
| Web | React 18 + Vite + Tailwind + TypeScript | `apps/web` | 8081 |
| Docs | TypeScript + Vite | `apps/docs` | 3001 |
| Dev Dashboard | TypeScript + Vite | `apps/dev-dashboard` | 3002 |
| Backend | Go 1.26.4 + Gin + PostgreSQL + Redis + Garage S3 | `apps/backend-go` | 8080 |

Production: Docker Compose on single VPS. Caddy reverse proxy auto-routes subdomains (`docs.*`, `dev.*`). Backend vendored (no network at build time, `GOMEMLIMIT=256MiB`).

## Quick commands

```bash
# Frontend
npm install                        # install all deps
npm run dev                        # all apps in parallel
npm run dev:web                    # web only
npx tsc --noEmit -p apps/web/tsconfig.app.json   # typecheck web
npm run lint --workspace=@gomo6/web               # lint web
npm run test --workspace=@gomo6/web               # test web (vitest)
npm run build --workspace=@gomo6/web              # build web

# Backend
cd apps/backend-go
go build ./...                     # build all packages
go vet ./...                       # vet
golangci-lint run --timeout=5m ./...  # lint (v2.12.2)
go test ./...                      # test (no DB needed for unit tests)
go test -race -count=1 ./...       # test with race detector (needs Postgres+Redis)

# Local CI (mirrors GitHub Actions)
./scripts/ci-local.sh quick        # lint + typecheck only
./scripts/ci-local.sh              # full CI including builds

# E2E smoke (requires docker compose stack running)
./scripts/e2e-smoke.sh
```

## CI pipeline

**`ci.yml`** (every push/PR): go build → gofmt → go vet → golangci-lint → govulncheck → go mod tidy check → tsc (3 apps) → eslint → build (3 apps) → gitleaks → hadolint.

**`full-tests.yml`** (daily cron or manual): adds Postgres/Redis services, runs `go test -race`, applies migrations, runs e2e smoke (register → upload → board → thread → post → like).

**`coverage.yml`** (push to main, PR, manual): on PRs runs **incremental tests only** (changed Go packages; vitest `--changed` for TS) and posts the result as a PR comment — a docs-only change runs nothing. On main it runs full Go + TS coverage, builds flat-square SVG badges + a minimal HTML dashboard via `scripts/coverage-report.py`, gates on `MIN_GO_COVERAGE` / `MIN_TS_COVERAGE` (set to 0 to disable), and deploys to Codeberg Pages (`crazycol.codeberg.page/gomo6.2/coverage/`) with the official `git-pages/action` (no pushes to repo branches). Toolchain setup steps are skipped — the self-hosted runner has Go/Node system-wide; Go caches persist under `/Users/lesha/.cache/gomo6-ci/` (adjust if the runner user differs).

Deploy to production only after CI passes on `main`.

## Pre-commit hook

Runs on staged files only:
- Go: gofmt → go mod tidy → go vet → go build → go test (changed packages only)
- Frontend: eslint (staged files in web/dev-dashboard/docs)

Enable: `git config core.hooksPath .githooks`

## Production server setup (new VPS)

### Step 1: SSH key on the server

```bash
ssh-keygen -t ed25519 -C "deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

### Step 2: (not needed) GitHub deploy key

The GitHub mirror is dead — the repo is deployed from Codeberg. The VPS repo
clones the public HTTPS URL, so no git credentials are needed on the server.

### Step 3: Clone the repo

```bash
cd ~ && git clone https://codeberg.org/crazycol/gomo6.2.git
```

### Step 4: Create .env

```bash
cd ~/gomo6.2
cat > .env << 'EOF'
DOMAIN=gomo6.wtf
JWT_SECRET=<взять из старого .env или сгенерировать: openssl rand -hex 32>
FEDERATION_KEY=<взять из старого .env или сгенерировать: openssl rand -hex 16>
ENVIRONMENT=production
# Cloudflare Turnstile (CAPTCHA) — secret из dash.cloudflare.com → Turnstile → виджет.
# В продакшене hostnames БЕЗ localhost/127.0.0.1!
TURNSTILE_SECRET=<секрет виджета Turnstile>
TURNSTILE_HOSTNAMES=gomo6.wtf
# Публичный sitekey — для локальной сборки web (в CI передаётся секретом
# VITE_TURNSTILE_SITEKEY в .forgejo/workflows/deploy.yml).
VITE_TURNSTILE_SITEKEY=0x4AAAAAAEMbiZqJKU7PLzRG
# Sentry public DSN (RUM: ошибки + трейсинг запросов) — для локальной сборки
# web; в CI передаётся секретом VITE_SENTRY_DSN в .forgejo/workflows/deploy.yml.
# Без него SDK — no-op. Проект: Sentry → Create project → React → Client Keys.
VITE_SENTRY_DSN=
# Grafana Cloud observability (backend /metrics → hosted Prometheus).
# METRICS_TOKEN открывает /metrics на бэкенде (пусто = 404); остальные три —
# стек Grafana Cloud: Connections → Hosted Prometheus → Send metrics.
# Без них контейнер alloy просто не шлёт метрики.
METRICS_TOKEN=
GRAFANA_CLOUD_METRICS_URL=
GRAFANA_CLOUD_METRICS_USERNAME=
GRAFANA_CLOUD_METRICS_PASSWORD=
# Web Push (PWA): сгенерировать `cd apps/backend-go && go run ./cmd/vapidgen` и
# вставить пару ключей. БЕЗ них push просто отключён (логируем предупреждение),
# остальное работает. Ключи должны быть стабильны — существующие подписки
# привязаны к публичному ключу, с которым были созданы.
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@gomo6.wtf
ALLOWED_ORIGINS=https://gomo6.wtf,http://gomo6.wtf,https://docs.gomo6.wtf,http://docs.gomo6.wtf,https://dev.gomo6.wtf,http://dev.gomo6.wtf
EOF
chmod 600 .env
```

**ВАЖНО**: JWT_SECRET и FEDERATION_KEY должны совпадать со старым сервером. Иначе все JWT-токены пользователей сломаются.

### Step 5: Start services

```bash
cd ~/gomo6.2
docker compose up -d
```

### Step 6: Update Codeberg Actions secrets

Codeberg → Settings → Actions → Secrets:

| Secret | Значение |
|--------|----------|
| `VPS_HOST` | IP нового сервера |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Приватный ключ сервера (весь вывод `cat ~/.ssh/id_ed25519`) |
| `VPS_PORT` | `22` (если стандартный) |
| `CODEREG_TOKEN` | Codeberg PAT аккаунта `crazycol` со скоупами `read:package` + `write:package` (пуш образов в реестр) |

### Step 7: Update DNS

A-записи для:
- `gomo6.wtf` → новый IP
- `docs.gomo6.wtf` → новый IP
- `dev.gomo6.wtf` → новый IP

### How CI/CD works

Active deployment is `.forgejo/workflows/deploy.yml` (Codeberg): change detection via the Codeberg compare API → incremental checkout into a persistent repo cache on the runner (`$HOME/gomo6-src`) → `docker buildx build --push` to the Codeberg container registry (`codeberg.org/crazycol/gomo6-*`, layer dedup — only changed layers upload) → per-service `docker pull` + retag + `docker compose up -d --no-build` on the VPS (`scripts/restart-service.sh`). Secret `CODEREG_TOKEN` (codeberg PAT, `read:package`+`write:package`) is required; the VPS pulls anonymously from public packages.

**VPS repo syncs via git pull**: the repo at `/root/gomo6.2` tracks the PUBLIC `https://codeberg.org/crazycol/gomo6.2.git` origin (HTTPS, no credentials). `restart-service.sh` runs `git fetch origin main && git reset --hard origin/main` before every `docker compose up`, so `Caddyfile` (bind-mounted into caddy), `docker-compose.yml` (env for `--no-build` recreations) and scripts are always current. `reset --hard` never touches untracked files — `.env`, `.garage.toml` and `*.bak` survive. Caddy is restarted by the web job when the Caddyfile changed.

The deploy script looks for the repo at `/root/gomo6.2` or `/home/*/gomo6.2`. The directory MUST be named `gomo6.2`.

### Backup old server before migration

```bash
# Stop containers
cd ~/gomo6.2 && docker compose down

# Backup PostgreSQL
docker compose exec postgres pg_dump -U gomo6 gomo6 > gomo6_db_$(date +%Y%m%d).sql

# Backup .env (contains JWT_SECRET!)
cp .env .env.backup

# Copy to new server
scp gomo6_db_*.sql root@NEW_IP:~/gomo6.2/
scp .env.backup root@NEW_IP:~/gomo6.2/.env
```

### Restore on new server

```bash
cd ~/gomo6.2
docker compose up -d postgres
docker compose exec -T postgres psql -U gomo6 gomo6 < gomo6_db_*.sql
docker compose up -d
```

## Key gotchas

- **Repo is named `gomo6.2`** (not `gomo6`). Deploy scripts search for `/root/gomo6.2` or `/home/*/gomo6.2`. Wrong directory name = deploy fails.
- **Cache invalidation for new tables**: `crud.go` handles generic CRUD. Adding a new table to the frontend requires adding a cache invalidation case in the `invalidateCacheForTableResult` switch. Missing this = stale data.
- **Rate limit budgets are per-surface**: the generic REST surface uses `RATE_LIMIT_PER_USER` / `RATE_LIMIT_PER_IP` (900/300 per minute); the public `/api/rpc` surface (likes batch, recent likers, emoji resolve, avatar history — reachable by guests) has its own stricter budgets `RPC_RATE_LIMIT_PER_USER` / `RPC_RATE_LIMIT_PER_IP` (900/120 per minute) namespaced under the `rpc` Redis prefix. Tune via env without a rebuild.
- **Caddy depends on all services**: backend crash = entire site 502s. Healthcheck at `/health` registered before heavy init.
- **Garage S3 init can be slow**: `garage-init` retries up to 180 times waiting for RPC.
- **Pre-existing CI errors**: some TS errors (UserMentions, ThreadCard, etc.) and Go lint issues exist in CI even with clean changes.
- **React infinite loops**: circular useEffect dependencies cause error #310. Use refs or pass values as params to break cycles.
- **Channel switching**: `channelSlug` must be in `loadBoard` effect deps in Board.tsx. Missing it = stale threads on channel nav.
- **CI billing**: GitHub Actions billing failure blocks ALL CI jobs.

## Testing

- Frontend: vitest with jsdom. Config at `apps/web/vitest.config.ts`. Coverage: `npm run test:coverage --workspace=@gomo6/web`.
- Backend: `go test ./...` (unit tests use sqlmock/miniredis, no real DB). Full tests need `DATABASE_URL_TEST` and `REDIS_URL` env vars.
- E2E: `./scripts/e2e-smoke.sh` — full docker compose stack, tests auth → upload → CRUD flow.

## TypeScript check commands (exact, from CI)

```bash
npx tsc --noEmit -p apps/web/tsconfig.app.json
npx tsc --noEmit -p apps/dev-dashboard/tsconfig.json
npx tsc --noEmit -p apps/docs/tsconfig.json
```

## Backend structure

`apps/backend-go/internal/`:

| Package | Files | Role |
|---------|-------|------|
| `api/handlers` | 45 src | Dedicated HTTP handlers (posts, threads, boards, messenger, auth, …) |
| `api/routes` | 1 | Route registration + wiring |
| `crudengine` | 10 | Generic CRUD engine, entity registry, wall, achievements dispatch (ex-god-pakage) |
| `crud` | 3 | Stateless SQL helpers: filters, ordering, emoji validation |
| `profiles` | 3 | Profile stats recomputation, CSS/background sanitizers, username lookup |
| `backup` | 1 | Database backup handler |
| `notifications` | 1 | Notification Service: `notifications.New(db, redis, hub, push)` + `CreateParams`-based `CreateNotification`/`CreateWallNotification` (insert + cache invalidation + WS + push). No package globals — routes builds one instance and injects it into handlers/crudengine via `SetNotifier` |
| `privacy` | 1 | Profile-visibility rules (private profile, mutual friends, per-content gates) |
| `channelaccess` | 1 | Shared read/write/moderate predicates for gomosub text channels — used by both the REST handlers and the WS hub room gate |
| `gomosubchat` | 2 | GomoSub text channels (Discord-style chat): keyset-paginated history, send/edit/delete REST (`/api/v1/gomosubchat/channels/:id/messages`) with own rate-limit namespace, realtime fan-out via `realtime:channel_chat` |
| `httpx` | 1 | Shared HTTP helpers: `ServerError`, `AuthenticatedUserID` |
| `textutil` | 1 | Shared string helpers: `TruncateRunes` |
| `auth` | 1 | JWT, WebAuthn, 2FA |
| `middleware` | 20 | Rate limiting, auth, CORS, uploads |
| `cache` | 2 | Redis cache layer |
| `storage` | 4 | S3 storage + `storage/handlers` sub-pkg |
| `websocket` | 5 | Realtime hub |
| `models` | 2 | Shared data models |
| `achievements` | 5 | Achievement event definitions |
| `oauth` | 5 | OAuth2 flows |
| `integrations` | 3 | External service adapters |
| `media` | 3 | Image processing / thumbhash |
| `push` | 1 | Web Push (VAPID) |
| `crypto` | 1 | HMAC signing |
| `geo` | 1 | Geocoding |
| `config` | 1 | App configuration |
| `metrics` | 1 | Prometheus metrics |
| `database` | 2 | PostgreSQL + Redis connections |

Dependency direction: `routes → {handlers, crudengine, backup, profiles, notifications, …}`, `handlers → {auth, cache, crud, …}`, `crudengine → {achievements, crud, middleware, models, notifications, privacy, profiles, httpx, textutil, …}` — all leaf packages, no handlers import. `crud`, `profiles`, `backup`, `notifications`, `privacy`, `httpx`, `textutil` are leaf-ish packages with minimal inbound deps.

Composition note: `notifications` has **no package-level state**. `routes.setupRoutes` builds one `notifications.Service` (`New(db, redis, wsHub, pushService)`) and injects it into `LikesHandler`/`FriendsHandler`/`RPCHandler`/`crudengine.Engine` via `SetNotifier`; `MessengerHandler` receives the `*push.Service` directly via `SetPushService`. A nil notifier/push service silently disables that delivery path — no panic, no global to reset in tests.

Migrations in `migrations/` (44+ files, auto-applied via docker-entrypoint-initdb.d).

## Frontend conventions

- API client: `@/integrations/api/client` (PostgREST-compatible REST layer: `api.from(...)` query builder + raw `apiClient` for custom routes; auth via HttpOnly cookies)
- State: Zustand stores in `src/stores/`
- Path alias: `@` → `src/` (configured in vite.config.ts and tsconfig)
- UI: Radix UI primitives + Tailwind + class-variance-authority
