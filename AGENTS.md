# AGENTS.md

Compact guidance for agents working in this repo.

**gomo6** — a full-stack social network: forum boards/threads, profile walls with a
customization studio, an encrypted messenger, Discord-style GomoSub communities
(forum channels + live text chat), achievements, custom emoji packs, drops/gifts
and Meilisearch-backed search. Monorepo (Turborepo + npm workspaces).

## Architecture

| App | Stack | Dir | Dev port | Workspace |
|-----|-------|-----|----------|-----------|
| Web | React 18 + Vite + Tailwind + TypeScript | `apps/web` | 8081 | `@gomo6/web` |
| Docs | TypeScript + Vite | `apps/docs` | 3001 | `@gomo6/docs` |
| Dev Dashboard | TypeScript + Vite | `apps/dev-dashboard` | 3002 | `@gomo6/dev-dashboard` |
| Backend | Go 1.26 + Gin + PostgreSQL 18 + Redis 7 + Garage S3 + Meilisearch | `apps/backend-go` | 8080 | — |
| Bot SDK | TypeScript library | `packages/bot-sdk` | — | `@gomo6/bot` |

Production: Docker Compose on a single VPS behind Caddy (auto-routes `docs.*`,
`dev.*`). The backend is vendored (offline build, `GOMEMLIMIT=256MiB`). Images are
built in CI and pushed to `ghcr.io/elcrazycol/gomo6-*`; **the VPS never builds**,
it only pulls. The app version lives in `VERSION`.

### Canonical forge

**GitHub is canonical** (`elcrazycol/gomo6.2`): CI, deploy, releases and
code-scanning run there. Codeberg + GitLab are read-only mirrors force-pushed by
`mirror.yml`. The repo variable `PRIMARY_FORGE=github` is the master switch — while
it is unset, the deploy / mirror / release jobs are skipped. **Push to `origin`
(GitHub); never push to the mirrors** — the next mirror run force-overwrites them.

## Quick commands

```bash
# Local dev environment (one command)
make dev                           # infra + backend + 3 frontends (scripts/dev.sh + Procfile.dev, tmux/overmind)
make attach                        # re-attach to the `make dev` tmux session
make dev-stop                      # stop dev processes (infra keeps running)
make doctor                        # check prerequisites / ports / .env
make seed                          # idempotent demo data (backend must be running)
make reset-db                      # DESTRUCTIVE: drop dev Postgres/Redis/Garage volumes
make infra | backend | web | logs | psql | redis-cli | stop | tools

# Tests / lint (repo-wide convenience targets)
make test                          # backend `go test ./...` + web vitest
make lint                          # golangci-lint + `npm run lint`
make typecheck                     # tsc for web, dev-dashboard, docs
make reindex                       # rebuild Meilisearch indexes (needs `make infra`)

# Frontend
npm install                        # install all deps (runs scripts/patch-vaul.mjs)
npm run dev                        # all apps in parallel
npm run dev:web                    # web only
npx tsc --noEmit -p apps/web/tsconfig.app.json
npm run lint --workspace=@gomo6/web
npm run test --workspace=@gomo6/web                # vitest
npm run test:coverage --workspace=@gomo6/web
npm run build --workspace=@gomo6/web

# Backend (from apps/backend-go)
go build ./...                     # build all packages
go vet ./...                       # vet
golangci-lint run --timeout=5m ./...  # lint (v2.12.2)
go test ./...                      # unit tests — no DB needed (sqlmock/miniredis)
go test -race -count=1 ./...       # race detector — needs Postgres + Redis
go run ./cmd/reindex               # rebuild Meilisearch indexes from Postgres

# Local CI (mirrors GitHub Actions) and e2e
./scripts/ci-local.sh quick        # lint + typecheck only
./scripts/ci-local.sh              # full CI including builds
./scripts/e2e-smoke.sh             # requires the docker compose stack running
```

## Local dev & browser testing (operational)

Things that cost time to rediscover. Frontend changes only need the web dev server;
the backend + Docker infra can stay up across restarts.

- **The running dev stack does NOT follow you into a worktree.** `make dev` serves
  whatever checkout it was launched from — a session started in the main checkout
  keeps serving `/…/gomo6/apps/web`, so your worktree edits are invisible in the
  browser. Vite serves from the worktree only after you restart `make dev` there.
  Verify which tree a running Vite serves with:
  `lsof -p $(lsof -nP -iTCP:8081 -sTCP:LISTEN -t | head -1) -a -d cwd -Fn | grep '^n'`.
- **`make dev` from a worktree needs two fixes** (dev.sh re-derives everything from
  the repo root; a worktree has no `.env`/`.dev.env` and different compose labels):
  1. Provide the env files — copy the generated ones from the main checkout (they
     are gitignored, and `generate-keys.sh` preserves the existing `POSTGRES_PASSWORD`
     so the already-initialised Postgres volume keeps working):
     ```bash
     WT=$(git rev-parse --show-toplevel)
     cp -p /Users/lesha/codes/gomo6/.env /Users/lesha/codes/gomo6/.dev.env "$WT/"
     ```
  2. Run with a fixed compose project so it **reuses** the existing infra instead of
     starting a second set of containers, and skip the interactive/tmux-agnostic path:
     `COMPOSE_PROJECT_NAME=gomo6 GOMO6_RUNNER=tmux make dev`.
     Without this, `make dev` aborts with *"PostgreSQL volume exists but its password
     is not available"* — its container lookup filters by
     `com.docker.compose.project.working_dir` = the worktree (not the label the
     running container carries), so it fails to find the password.
- **Restart from the worktree** (backend binary is built once and reused; Vite is the
  only thing that has to reload for frontend edits). Kill the old session, then fan
  `Procfile.dev` out yourself from the worktree — this bypasses dev.sh's failing
  compose/env checks:
  ```bash
  tmux kill-session -t gomo6-dev 2>/dev/null
  tmux new-session -d -s gomo6-dev -c "$WT" -n backend \
    "[ -f .dev.env ] && . ./.dev.env; cd apps/backend-go && go run cmd/server/main.go"
  tmux new-window -t gomo6-dev -c "$WT" -n web "npm run dev --workspace @gomo6/web"
  tmux new-window -t gomo6-dev -c "$WT" -n docs "npm run dev --workspace @gomo6/docs"
  tmux new-window -t gomo6-dev -c "$WT" -n dev-dashboard "npm run dev --workspace @gomo6/dev-dashboard"
  ```
  (These tmux commands run on the host via the Terminal panel — the agent's sandbox
  blocks tmux/docker; see the sandbox note below.)
- **Ports**: web `8081`, backend `8080`, docs `3001`, dev-dashboard `3002`; the web
  dev server proxies `/api`, `/ws`, `/storage`, `/oauth`, `/og` → `localhost:8080`.
- **Demo login** (after `make seed`): `demo@gomo6.local` / `gomo6-demo-9f3k2x`
  (also `alice@` / `bob@` with the same password). See `scripts/seed.sh`.
- **Smoke checks before handing off to the browser**:
  ```bash
  curl -s -o /dev/null -w "web:%{http_code}\n"  http://localhost:8081/
  curl -s -o /dev/null -w "api:%{http_code}\n"  "http://localhost:8081/api/v1/feed?limit=1"
  curl -s -o /dev/null -w "health:%{http_code}\n" http://localhost:8080/health
  ```
- **Phone testing (`make dev` + `make mobile`)**: web binds to `::` and proxies
  everything, so a phone on the same Wi-Fi uses the app as-is. Two traps:
  (1) the WebSocket hub validates the request's `Origin` against
  `ALLOWED_ORIGINS` (`internal/websocket/hub.go`), and the phone's origin is not
  localhost — a phone the list does not know loads the app, works over REST and
  **silently never connects realtime** (no messages, no typing). `scripts/dev.sh`
  now writes the LAN origins via `scripts/lan-origins.sh`; for a stack started
  before that, `FIX=1 make mobile` repairs `.dev.env` and respawns the backend
  window. (2) HTTP is not a secure context on a phone: «Заметки» (WebCrypto),
  PWA install and push need HTTPS — `make mobile` says so.
- **Sandbox note**: the agent's Bash sandbox refuses `listen` on any local port
  (EPERM) and denies the Docker/tmux sockets, so it cannot start or restart the dev
  stack itself. Drive those steps through the Terminal panel (runs on the host):
  `run_in_terminal`/`read_terminal`, then `open "http://localhost:8081"` for the user.
- **Manage the stack**: `tmux attach -t gomo6-dev` (windows: backend/web/docs/
  dev-dashboard; `Ctrl-b d` detaches), `tmux kill-session -t gomo6-dev` stops it
  (Docker infra keeps running).

## CI/CD (GitHub Actions)

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR, `workflow_call`, dispatch | The gate. Jobs: `Changes` (path filter — heavy jobs run only when their area is touched), `Go · build · vet · fmt · test` (+coverage→Codecov), `Go · lint · vuln` (golangci-lint + govulncheck), `Frontend · checks` (tsc ×3 · eslint · turbo build), `Frontend · tests` (3 shards + coverage), `PR title` (conventional commits), `Secrets scan` (gitleaks), `Dockerfile lint` (hadolint), `Images` (PR-only, only when Docker files changed), and **`ci-ok` — the single required check** (aggregates the rest; `skipped` counts as success so path filters never block a merge). |
| `deploy.yml` | push to `main` (tags ignored), dispatch | `plan` (git-diff which services to rebuild) → `build` matrix (`buildx build --push` to ghcr) **in parallel with the `ci` gate** → `deploy` matrix (SSH pull + restart on the VPS, only after the gate is green). Manual dispatch can pick `services` and a `reindex` flag. |
| `tests-full.yml` | daily 06:00 UTC, dispatch | `backend-race` (real Postgres/Redis), `smoke` (register → upload → board → thread → post → like), `privacy`. |
| `security.yml` | Mon 03:00 UTC, dispatch | CodeQL (`go` + `javascript-typescript`, suite `security-and-quality`) and Trivy fs scan → Security / code-scanning (SARIF). No auto-issues. |
| `mirror.yml` | push (any branch/tag) | Force-mirror GitHub → Codeberg + GitLab. |
| `release-please.yml` | push to `main`, dispatch | Version + `CHANGELOG.md` + tag + GitHub Release, no manual ritual. After a squash-merge it opens a `chore: release vX.Y.Z` PR (computed from conventional commits), and on that PR's merge it tags `vX.Y.Z` and creates the Release. Config: `release-please-config.json` (`version-file: VERSION`), baseline: `.release-please-manifest.json`. Needs the `RELEASE_PLEASE_TOKEN` secret — a `GITHUB_TOKEN`-created PR does not trigger CI, so its required check would never appear. |

Deploy pipeline details, secrets/variables, rollback and VPS setup live in
[docs/wiki/DEPLOYMENT.md](docs/wiki/DEPLOYMENT.md). Required deploy secrets:
`VPS_HOST` / `VPS_USER` / `VPS_SSH_KEY` (+ optional `VPS_PORT`), and web build args
`VITE_TURNSTILE_SITEKEY` / `VITE_SENTRY_DSN` / `VITE_DEPAY_INTEGRATION_ID`.

**Deploy only ships after the `ci` gate is green.** The image build starts as soon
as `plan` is done (parallel with the gate), but the VPS restart job `needs` both the
build and `ci` — so red CI never reaches the VPS. Never merge/deploy on red CI.

## Self-hosted build runner (this Mac)

Image builds run on the project Mac (warm BuildKit cache), not on GitHub-hosted
runners — everything else (PR checks, scheduled tests, scanners) is GitHub-hosted.
Full guide: [docs/wiki/SELF_HOSTED_RUNNER.md](docs/wiki/SELF_HOSTED_RUNNER.md).

```bash
# Docker Desktop must be running (the image build uses buildx)
docker info >/dev/null && echo "docker: UP"
# runners live in ~/github-runner/runner-{1..4}, managed by launchd (svc.sh)
gh api repos/elcrazycol/gomo6.2/actions/runners --jq '.runners[] | "\(.name)\t\(.status)"'
```

Runner labels: base `self-hosted` / `macOS` / `ARM64` + `gomo6-build`; the `build`
matrix runs on `fromJSON(vars.BUILD_RUNNER || '["self-hosted","macOS","ARM64"]')`
(the `deploy` matrix needs only SSH, so it runs on `ubuntu-latest` and does not
occupy a Mac slot). BuildKit cache: `$HOME/gomo6-buildx-cache/<service>`. **Never**
attach a self-hosted runner to a `pull_request` job. The old `forgejo-runner`
(Codeberg) is retired.

## Pre-commit hook

Runs on staged files only (`.githooks/pre-commit`):
- Go: gofmt → go mod tidy → go vet → go build → go test (changed packages only)
- Frontend: eslint (staged files in web/dev-dashboard/docs)

Enable: `git config core.hooksPath .githooks`

## Backend structure

`apps/backend-go/`:

- `cmd/` — `server` (the API), `reindex` (rebuild Meilisearch), `vapidgen` (VAPID
  keys), `migrate-encrypt`, `wall-doc-audit`.
- `internal/api/handlers` (42 src) — dedicated HTTP handlers; `internal/api/routes`
  (one file) — all route registration + wiring.

| Package | Role |
|---------|------|
| `crudengine` | Generic CRUD engine, entity registry, wall + achievements dispatch. Per-table hooks in `table_hooks.go`; cache invalidation in `crud.go` |
| `crud` | Stateless SQL helpers: filters, ordering, emoji validation |
| `profiles` | Profile stats recomputation, CSS/background sanitizers, username lookup |
| `notifications` | Notification Service (`New(db, redis, hub, push)` + `CreateParams`). **No package globals** — `routes` builds one and injects it via `SetNotifier` |
| `privacy` | Profile-visibility rules (private profile, mutual friends, per-content gates) |
| `channelaccess` | Shared read/write/moderate predicates for GomoSub text channels (REST handlers **and** the WS hub room gate) |
| `gomosubchat` | GomoSub live text channels: keyset-paginated history, send/edit/delete REST, own rate-limit namespace, fan-out via `realtime:channel_chat` |
| `messenger` | Encrypted personal messenger (E2E), bounded best-effort fan-out |
| `wall` | Profile-wall domain + wall-post achievements |
| `activity` | Append-only best-effort action log (moderation + honest time-series) |
| `actieye` | Activity-summary widget (gradient circle + 30-day streak "дорога") |
| `moderation` | Moderation queue / reports |
| `sanctions` | Platform-sanction model (warn / mute / ban) + shared lookups |
| `authz` | Centralized platform-role lookups against `user_roles` |
| `gamification` | Small pure engine for game mechanics (chests, rarity ladders) |
| `drops` | Drops payment domain (packages, callbacks, wallet, transfers) |
| `gifts` | User gifts |
| `rpc` | Public `/api/rpc` surface (likes batch/counts, recent likers, emoji resolve, avatar history, wall views, gomosub RPC) |
| `search` | Meilisearch: stdlib client, schemas, privacy rules, `Service`, `Indexer`, `ReindexAll`. Optional — empty `MEILISEARCH_URL` disables it |
| `linkpreview` | OpenGraph/Twitter-card fetch for link cards. SSRF-hardened: `safeDialContext` blocks private/loopback/link-local + an http(s) allow-list guard |
| `socialpreview` | OG/Twitter Card pages rendered for link-preview crawlers |
| `publicid` | Parses the human-readable public numbers («цифорки»); routes accept UUID **and** public id |
| `translations` | Community translation proposals + votes |
| `storage` | S3 (Garage) storage + `storage/handlers` |
| `media` | Image processing / thumbhash |
| `push` | Web Push (VAPID); nil-safe (disabled without keys) |
| `websocket` | Realtime hub (`/ws`) |
| `auth` | JWT, WebAuthn, 2FA; `oauth` — OAuth2 flows; `integrations` — external adapters |
| `middleware` (21 src) | Rate limiting, auth, CORS, uploads |
| `cache` / `database` / `config` / `metrics` / `crypto` / `geo` / `bg` | Redis cache, PG+Redis connections, config, Prometheus metrics, HMAC signing, geocoding, bounded background worker pool |
| `httpx` / `textutil` / `models` / `backup` / `testutil` | Shared HTTP helpers, string helpers, data models, DB backup handler, test helpers |

Dependency direction: `routes → {handlers, crudengine, backup, profiles, notifications, rpc, …}`,
`handlers → {auth, cache, crud, …}`, `crudengine → {achievements, crud, middleware, models, notifications, privacy, profiles, httpx, textutil, …}`.
Leaf-ish packages (no inbound handlers imports): `crud`, `profiles`, `backup`,
`notifications`, `privacy`, `httpx`, `textutil`.

Composition note: `notifications` has **no package-level state**. `routes.setupRoutes`
builds one `notifications.Service` and injects it into
`LikesHandler`/`FriendsHandler`/`RPCHandler`/`crudengine.Engine` via `SetNotifier`;
`MessengerHandler` gets the `*push.Service` via `SetPushService`. A nil
notifier/push service silently disables that delivery path — no panic, no global to
reset in tests.

**Migrations** (`migrations/`, 140+ files) are applied by the backend at startup
(`database.RunMigrations`, tracked in `schema_migrations` with checksums — strict
mode fails if an applied migration changed). Not `docker-entrypoint-initdb.d`.

## Frontend conventions

- **Theming**: single OKLCH registry at `src/theme/`. Token values in the generated
  `src/theme/registry.data.ts` + `src/theme/theme.css`; catalogue + **surface
  profiles + character** live in `scripts/gen-theme-registry.mts`; derivation/AA-tuning
  (shared with the in-app constructor) in `src/theme/derive.ts`. Never declare theme
  tokens in `index.css` or hardcode theme names/colours — add a theme in the catalogue
  and regenerate (`cd apps/web && npx vite-node scripts/gen-theme-registry.mts`).
  Surfaces (header, cards, dialogs/popovers, page background) read the per-theme
  `--surface-*` / `--bg-*` tokens; `.bg-surface` and `.surface-panel` in `index.css`
  are the shared hooks. Preferences: `color-theme` (id) + `theme-mode`
  (`light|dark|system`) in localStorage; custom themes and favourites live in
  `theme-custom` / `theme-favorites`. Pre-boot script in `index.html` paints the theme
  (ids + single-mode map guarded by `src/theme/theme.test.ts`). WCAG AA is enforced by
  a test across the whole registry.
- API client: `@/integrations/api/client` (PostgREST-compatible REST layer:
  `api.from(...)` query builder + raw `apiClient` for custom routes; auth via HttpOnly
  cookies)
- State: Zustand stores in `src/stores/`
- Path alias: `@` → `src/` (configured in vite.config.ts and tsconfig)
- UI: Radix UI primitives + Tailwind + class-variance-authority

## Testing

- Frontend: vitest with jsdom. Config at `apps/web/vitest.config.ts`. Coverage:
  `npm run test:coverage --workspace=@gomo6/web` (CI shards the file set 3 ways and
  uploads to Codecov).
- Backend: `go test ./...` — unit tests use sqlmock/miniredis, no real DB. Full tests
  need `DATABASE_URL_TEST` and `REDIS_URL` env vars (see `tests-full.yml`).
- E2E: `./scripts/e2e-smoke.sh` (full compose stack, auth → upload → CRUD), plus
  `scripts/e2e-privacy-wall.sh` and `scripts/public-id-acceptance.sh`.

## TypeScript check commands (exact, from CI)

```bash
npx tsc --noEmit -p apps/web/tsconfig.app.json
npx tsc --noEmit -p apps/dev-dashboard/tsconfig.json
npx tsc --noEmit -p apps/docs/tsconfig.json
```

## Key gotchas

- **Repo is named `gomo6.2`** (not `gomo6`). `restart-service.sh` searches
  `/root/gomo6.2` or `/home/*/gomo6.2`. Wrong directory name = deploy fails.
- **Local dev stack**: `make dev` writes `.dev.env` (gitignored — full backend env)
  which `Procfile.dev` sources; dev infra ports are published to `127.0.0.1` only
  (5432/6379/3900/7700, so a Homebrew Postgres on IPv6 `[::1]:5432` coexists).
  `garage-init` must be named explicitly in `docker compose up` — Compose starts
  dependencies, not dependents.
- **Cache invalidation for new tables**: the generic engine lives in
  `crudengine/crud.go`; add a case to the `invalidateCacheForTableResult` switch.
  Missing this = stale data.
- **Rate-limit budgets are per-surface**: the generic REST surface uses
  `RATE_LIMIT_PER_USER` / `RATE_LIMIT_PER_IP` (900/300 per minute); the public
  `/api/rpc` surface (reachable by guests) has stricter `RPC_RATE_LIMIT_PER_USER` /
  `RPC_RATE_LIMIT_PER_IP` (900/120) namespaced under the `rpc` Redis prefix;
  gomosubchat has its own. All tunable via env, no rebuild.
- **Caddy depends on all services**: a backend crash = the whole site 502s.
  `/health` is registered before heavy init (Docker healthcheck + deploy
  verification); `/ready` reports readiness incl. `search: true|false`.
- **Garage S3 init can be slow**: `garage-init` retries up to 180 times (×2s) waiting
  for RPC.
- **Migrations are strict**: applied files are checksum-tracked; editing an
  already-applied migration fails startup. Add a new file instead.
- **Search is optional and rebuildable**: Meilisearch is disabled when
  `MEILISEARCH_URL` is unset (Postgres FTS fallback stays in charge). Index-time
  privacy: private profiles and private-board content are *never* indexed (no query
  can leak them); `is_private` posts and wall posts on private/hidden walls too. The
  owner/mutual-friend view of their own private profile, and visible private-wall
  posts, are merged back by a small SQL fallback in the handler. Categories: users,
  boards, threads, posts, wall_posts. The index is disposable — `make reindex`
  (`go run ./cmd/reindex`) rebuilds it, so **schema/settings changes need a reindex**.
  Write-path sync is best-effort (`search.Indexer`, nil-safe, on `bg.Pool`), called at
  the users/boards/threads/posts write sites + the `privacy_settings` /
  `profile_wall_posts` generic-engine hooks. Because those tables bypass the generic
  CRUD engine, a NEW write path must call the matching `Sync*` method. On the VPS:
  `docker compose run --rm -T backend ./reindex`. Watch
  `app_search_engine_fallback_total` (engine errors → SQL fallback) and
  `bg_dropped_total{pool="search"}`.
- **Link preview is SSRF-sensitive**: `linkpreview` refuses non-http(s) and
  whitespace URLs, caps redirects/size/time, and `safeDialContext` never dials
  private/loopback/link-local/CGNAT. CodeQL `go/request-forgery` only recognises a
  barrier guard on the URL value itself, so the http(s) allow-list in `Fetch` must
  stay inline (it dominates `client.Do`) — don't move it into a helper.
- **React infinite loops**: circular `useEffect` dependencies cause error #310. Use
  refs or pass values as params to break cycles.
- **Messenger «Заметки» (Notes) are a normal self-chat, not a special store.**
  `chat_conversations.is_notes=true` + one `chat_members` row (owner). Content is
  **client-side E2E** (`e2enote1:` + AES-256-GCM, device key in localStorage
  `gomo6:notes:key:v1`, never sent to the server); the server only checks the prefix
  and caps (content 24000 / meta 4096) and stores blobs verbatim. Folders/tags/pin
  are NOT tables — they live in each message's encrypted `notes_meta`
  (`{pinned,folder,tags}`), so there is no folder list/rename API. Files:
  `apps/web/src/utils/notesCrypto.ts`, `stores/messengerStore.ts`,
  `services/messengerApi.ts`; backend `internal/messenger/messenger_messages.go`.
- **Rich post/thread cards inside messages already exist.** A message whose content
  is a share token `__SHARE__:thread:<uuid>` / `__SHARE__:wall:<uuid>`
  (`components/share/share.ts`, `buildShareToken`) renders as an X-style card via
  `MessageContent` → `ShareCard` (fetches the entity, RLS-guarded). This is how you
  embed a post preview in a chat without new UI or backend work.
- **Never automate a background chat message through `sendMessage`.** It optimistically
  inserts into `s.messages` (the *selected* chat) regardless of the `conversationId`
  override and uses `get().me!` — so a background write pollutes the open chat, and
  crashes if the messenger store is uninitialized. Add a dedicated store action that
  targets an explicit `conversationId` and touches `s.messages` only when that chat is
  open (pattern: `messengerStore.createFavoriteNote`, issue #509).
- **Chat scrolling is Telegram Web's model — no virtualization library.** The
  messenger `MessageList` (`apps/web/src/components/messenger/`) keeps the DOM
  unvirtualized and instead owns one thing: a single `useLayoutEffect` writer that
  decides the position in a commit and writes it once inside
  `core/fasterdom.ts` (measure batch → mutate batch → forced reflow). The tree is:
  first placement → jump glide → arrival glide while following → bottom sentinel
  pin → anchor compensation. `scrollTop` is NEVER written on scroll, and rows must
  never get `content-visibility` (an unlaid-out row's estimate moves everything
  below it; WebKit has no scroll anchoring to absorb it — that was the iOS
  stutter). "At the bottom" is native scroll-snap (`with-bottom-snap` +
  `.fab-trigger`), the mounted window is keyed (`core/slicing.ts`, keys =
  `messageKey`, never indices, `INITIAL_WINDOW`/`WINDOW_STEP`/`MAX_DOM_MESSAGES`),
  and mounting rows ABOVE the viewport waits for a *position-verified* rest on
  engines without anchoring (`lib/scrollAnchoring.ts`, detected behaviourally;
  never trust `CSS.supports("overflow-anchor", …)`). Rows are memoized on
  `(message, prev, quoted, peerReceipt, renderVersion)` — a NEW ambient render
  input must be added to `renderVersion` in `ChatView.tsx`, otherwise mounted rows
  will not re-render. GomoSub `ChannelChat` still runs the previous mechanics.
  See [docs/wiki/MESSENGER_CHAT_SCROLL.md](docs/wiki/MESSENGER_CHAT_SCROLL.md).
- **Messenger outbox**: a sent message is queued in its own IndexedDB
  (`core/outbox.ts`, key `owner:chat:clientId`) before the request, shown at once
  with a clock, retried by itself (`online` / visibility / `init` / backoff timer,
  6 attempts) and re-attached to the chat by `loadMessages` after a reload. `s.messages`
  is the OPEN chat only — never `cacheCurrentMessages`/`rememberLatestEventId` for a
  different `conversationId` (it overwrites that chat's cache). Retry goes through
  `sendMessage(content, client_id)` so the bubble is replaced, not duplicated; deleting
  a queued message must drop its outbox entry.
  See [docs/wiki/MESSENGER_OUTBOX.md](docs/wiki/MESSENGER_OUTBOX.md).
- **Channel switching**: `channelSlug` must be in the `loadBoard` effect deps in
  `apps/web/src/pages/Board.tsx`. Missing it = stale threads on channel nav.
- **Releases**: do NOT bump `VERSION`, edit `CHANGELOG.md` or tag by hand — release-please
  does all of it (`release-please.yml`). Merges are **squash-only** (repo setting + ruleset),
  so one PR = one conventional commit on `main`; that commit subject decides the next version
  (`feat` → minor, `fix`/`perf` → patch, `!` → major; `ci`/`docs`/`chore`/`test`/`style` → no
  bump). The bot opens `chore: release vX.Y.Z`; rewrite its CHANGELOG section in Russian before
  merging. Deploy reads the version from `VERSION`, not from the tag.

## Docs map

`docs/wiki/`: [DEPLOYMENT](docs/wiki/DEPLOYMENT.md) · [SELF_HOSTED_RUNNER](docs/wiki/SELF_HOSTED_RUNNER.md) ·
[DOCKER_SETUP](docs/wiki/DOCKER_SETUP.md) · [SECURITY_AUDIT](docs/wiki/SECURITY_AUDIT.md) ·
[MESSENGER_SECURITY](docs/wiki/MESSENGER_SECURITY.md) · [OAUTH_API](docs/wiki/OAUTH_API.md) ·
[PUBLIC_IDS](docs/wiki/PUBLIC_IDS.md) · [BOT_SYSTEM_ARCHITECTURE](docs/wiki/BOT_SYSTEM_ARCHITECTURE.md) ·
[MESSENGER_CHAT_SCROLL](docs/wiki/MESSENGER_CHAT_SCROLL.md) ·
[MESSENGER_OUTBOX](docs/wiki/MESSENGER_OUTBOX.md) ·
[REALTIME_WEBSOCKET_PATTERN](docs/wiki/REALTIME_WEBSOCKET_PATTERN.md) ·
[PRESENCE_SYSTEM_DESIGN](docs/wiki/PRESENCE_SYSTEM_DESIGN.md) ·
[THREAD_ATTACHMENTS_GUIDE](docs/wiki/THREAD_ATTACHMENTS_GUIDE.md).
Observability stack (VictoriaMetrics + Perses + Alertmanager): `observability/README.md`.
