# CI / CD — GitHub Actions

Проект использует три GitHub Actions workflow для разделения быстрых проверок, полных тестов и релизов.

---

## 1. `ci.yml` — Быстрый CI

**Триггер:** каждый push или PR в ветку `main`.

**Время выполнения:** ~2–3 мин

**Что проверяет:**

| Компонент | Шаги |
|-----------|------|
| **Go backend** | `go build ./cmd/server/` + `go build ./...`, `go vet ./...`, `golangci-lint`, `govulncheck`, `go mod tidy` |
| **Secrets** | `gitleaks` — поиск утекших секретов в репозитории |
| **Dockerfile** | `hadolint` — линтинг Dockerfile'ов |
| **Frontend (3 apps)** | TypeScript typecheck (`tsc --noEmit`), eslint (только `@gomo6/web`), `vite build` |

**Цель:** быстро отсечь очевидные проблемы — синтаксические ошибки, несоответствие типов, проблемы безопасности.

---

## 2. `full-tests.yml` — Полный набор тестов

**Триггеры:**
- Вручную (`workflow_dispatch`) — можно выбрать любую ветку/тег/коммит
- По расписанию — каждый день в **06:00 UTC** (≈09:00 MSK)

**Время выполнения:** ~8–10 мин

### Как запустить вручную

1. Зайти в репозиторий на GitHub → **Actions** → **Full Tests**
2. Нажать **Run workflow**
3. Опционально указать `ref` (ветка, тег или SHA) — по умолчанию `main`
4. Нажать **Run workflow**

Или через `gh` CLI (требуется `gh auth login`):

```bash
gh workflow run full-tests.yml --ref main
```

Указать конкретную ветку:

```bash
gh workflow run full-tests.yml --ref feature/my-branch
```

### Что проверяет:

**Backend (Go) — с реальной БД и Redis:**

| Шаг | Описание |
|-----|----------|
| Build + Vet + Lint | Аналогично `ci.yml` |
| govulncheck | Поиск известных уязвимостей в зависимостях |
| go mod tidy | Проверка что `go.mod`/`go.sum` чисты |
| Миграции | Накат всех `.sql` миграций на тестовый PostgreSQL |
| Race-тесты | `go test -race -count=1 ./...` |
| Coverage | `go test -coverprofile=coverage.out ./...` + отчёт |
| Артефакты | Загрузка `coverage.out` (хранится 7 дней) |

**Frontend:**

| Шаг | Описание |
|-----|----------|
| TypeScript typecheck | `tsc --noEmit` для всех 3 приложений |
| Lint | eslint для `@gomo6/web` |
| Unit-тесты | `vitest run` для `@gomo6/web` |
| Audit | `npm audit --audit-level=critical` |
| Build | `vite build` для всех 3 приложений |

**Smoke-тест (e2e):**
- Стартует `docker-compose up -d`
- Ждёт 10 секунд
- Проверяет `/health` endpoint (curl)
- При падении — выводит логи контейнеров
- Останавливает контейнеры

---

## 3. `release.yml` — Релиз

**Триггер:** push тега вида `v*` (например `v1.2.3`, `v1.2.3-rc1`).

**Необходимые permissions:** `contents: write`, `packages: write`

**Время выполнения:** ~5–7 мин

### Как сделать релиз

```bash
# Создать тег
git tag -a v1.2.3 -m "v1.2.3: краткое описание"

# Запушить тег
git push origin v1.2.3
```

Или через GitHub UI:
1. **Releases** → **Create a new release**
2. Ввести тег (например `v1.2.3`)
3. Нажать **Publish release** — это автоматически запустит `release.yml`

### Jobs:

```
check ──→ docker ──→ release
                ↑
          frontend (parallel)
```

**`check`** — пре-релизные проверки:
- `go build`, `go vet`, `golangci-lint`
- Накат миграций на PostgreSQL
- `go test -race -count=1 ./...` с реальной БД + Redis

**`frontend`** (параллельно с docker):
- TypeScript typecheck для всех 3 приложений
- eslint для `@gomo6/web`

**`docker`** (после `check`):
- Docker Buildx
- Логин в `ghcr.io`
- Сборка образа с semver-тегами:
  - `ghcr.io/<repo>:1.2.3`
  - `ghcr.io/<repo>:1.2`
  - `ghcr.io/<repo>:<commit-sha>`
- Кеширование через GitHub Actions cache (`type=gha`)
- Публикация в GitHub Container Registry

**`release`** (после docker + frontend):
- Генерация changelog из коммитов с прошлого тега
- Создание GitHub Release с описанием

---

## Сравнение workflow

| | `ci.yml` | `full-tests.yml` | `release.yml` |
|---|---|---|---|
| **Триггер** | push/PR → main | workflow_dispatch / cron | tag v* |
| **Время** | ~2–3 мин | ~8–10 мин | ~5–7 мин |
| **Go build** | ✅ | ✅ | ✅ |
| **Go test** | ❌ | ✅ + race + real DB | ✅ + race + real DB |
| **Coverage** | ❌ | ✅ | ❌ |
| **Lint (Go)** | ✅ | ✅ | ✅ |
| **Lint (Frontend)** | ✅ (web) | ✅ (web) | ✅ (web) |
| **TS typecheck** | ✅ (3 apps) | ✅ (3 apps) | ✅ (3 apps) |
| **Frontend build** | ✅ (3 apps) | ✅ (3 apps) | ❌ |
| **Frontend test** | ❌ | ✅ (vitest) | ❌ |
| **npm audit** | ❌ | ✅ | ❌ |
| **gitleaks** | ✅ | ❌ | ❌ |
| **hadolint** | ✅ | ❌ | ❌ |
| **Docker image** | ❌ | ❌ | ✅ → ghcr.io |
| **Smoke test** | ❌ | ✅ (docker-compose) | ❌ |
| **GitHub Release** | ❌ | ❌ | ✅ |

---

## Локальное воспроизведение

### Go (как в CI)

```bash
cd apps/backend-go

# Build
go build -o /dev/null ./cmd/server/
go build ./...

# Vet
go vet ./...

# Lint (требуется golangci-lint)
golangci-lint run --timeout=5m ./...

# Vulnerability check (требуется govulncheck)
govulncheck ./...

# Vendoring
go mod tidy && git diff --exit-code go.mod go.sum

# Тесты с БД
DATABASE_URL_TEST=postgres://gomo6@localhost:5432/gomo6?sslmode=disable \
  REDIS_URL=redis://localhost:6379/0 \
  go test -race -count=1 ./...

# Coverage
go test -coverprofile=coverage.out -count=1 ./...
go tool cover -func=coverage.out
```

### Frontend

```bash
# Typecheck
npx tsc --noEmit -p apps/web/tsconfig.app.json
npx tsc --noEmit -p apps/dev-dashboard/tsconfig.json
npx tsc --noEmit -p apps/docs/tsconfig.json

# Lint
npm run lint --workspace=@gomo6/web

# Test
npm run test --workspace=@gomo6/web

# Build
npm run build --workspace=@gomo6/web
npm run build --workspace=@gomo6/dev-dashboard
npm run build --workspace=@gomo6/docs

# Audit
npm audit --audit-level=critical
```
