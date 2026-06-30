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

### Step 2: Add public key to GitHub

```bash
cat ~/.ssh/id_ed25519.pub
```

Copy output → GitHub → `scramble22/gomo6.2` → Settings → Deploy keys → Add deploy key → paste → check "Allow read access" → Add key.

### Step 3: Clone the repo

```bash
cd ~ && git clone git@github.com:scramble22/gomo6.2.git
```

### Step 4: Create .env

```bash
cd ~/gomo6.2
cat > .env << 'EOF'
DOMAIN=gomo6.wtf
JWT_SECRET=<взять из старого .env или сгенерировать: openssl rand -hex 32>
FEDERATION_KEY=<взять из старого .env или сгенерировать: openssl rand -hex 16>
ENVIRONMENT=production
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

### Step 6: Update GitHub Actions secrets

GitHub → Settings → Secrets and variables → Actions:

| Secret | Значение |
|--------|----------|
| `VPS_HOST` | IP нового сервера |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | Приватный ключ сервера (весь вывод `cat ~/.ssh/id_ed25519`) |
| `VPS_PORT` | `22` (если стандартный) |

### Step 7: Update DNS

A-записи для:
- `gomo6.wtf` → новый IP
- `docs.gomo6.wtf` → новый IP
- `dev.gomo6.wtf` → новый IP
- `mcaptcha.gomo6.wtf` → новый IP

### How CI/CD works

Push to `main` → `ci.yml` (lint, typecheck, build) → on success → `deploy.yml` (builds 4 images in parallel → pushes to `ghcr.io/scramble22/` → SSH to VPS → pulls images → `docker compose up -d`).

The deploy script in `.github/workflows/deploy.yml` looks for the repo at `/root/gomo6.2` or `/home/*/gomo6.2`. The directory MUST be named `gomo6.2`.

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
- **Cache invalidation for new tables**: `universal_crud.go` handles generic CRUD. Adding a new table to the frontend requires adding a cache invalidation case in the `invalidateCacheForTableResult` switch. Missing this = stale data.
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

`apps/backend-go/internal/`: `api/handlers`, `api/routes`, `auth`, `bots`, `cache`, `config`, `database`, `middleware`, `models`, `oauth`, `storage`, `websocket`. Migrations in `migrations/` (44+ files, auto-applied via docker-entrypoint-initdb.d).

## Frontend conventions

- API client: `@/integrations/api/client_simple` (Supabase-compatible layer)
- State: Zustand stores in `src/stores/`
- Path alias: `@` → `src/` (configured in vite.config.ts and tsconfig)
- UI: Radix UI primitives + Tailwind + class-variance-authority
