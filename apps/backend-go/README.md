# Gomo6 Backend

REST + realtime-бэкенд социальной сети Gomo6: Go 1.26 + Gin + PostgreSQL + Redis + Garage (S3).

[![Go](https://img.shields.io/badge/go-1.26-00ADD8?style=flat-square&logo=go&logoColor=white)](https://go.dev)
[![License](https://img.shields.io/badge/license-AGPL--3.0-orange?style=flat-square)](../LICENSE.md)

## Обзор

Бэкенд отдаёт весь API платформы: аутентификацию (JWT + refresh, TOTP 2FA, WebAuthn/passkeys), ленты и доски, профильные стены, мессенджер с шифрованием, GomoSubs (включая текстовые каналы с realtime-чатом), экономику (кошелёк, drops, подарки), геймификацию (достижения, сундуки), модерацию, уведомления и Web Push. Поверх этого живёт developer-платформа: OAuth 2.0 / OpenID Connect провайдер и API для ботов.

Архитектурно — один Go-бинарник: HTTP (Gin) + WebSocket-хаб + generic CRUD-движок с декларативным реестром таблиц. Хранилище файлов — Garage (S3): публичные бакеты читаются напрямую браузером через Caddy, приватные — через авторизованный прокси бэкенда.

## Стек

| Компонент | Технология |
|---|---|
| Язык | Go 1.26, зависимости завендорены (`vendor/`), `CGO_ENABLED=0` |
| HTTP | Gin |
| База данных | PostgreSQL (`lib/pq`) |
| Кеш / rate limit / realtime | Redis (`go-redis/v9`) |
| Объектное хранилище | Garage S3 (`aws-sdk-go-v2`) |
| WebSocket | `gorilla/websocket` |
| Auth | `golang-jwt/jwt/v5`, `go-webauthn` (passkeys), `pquerna/otp` (TOTP) |
| Web Push | `SherClockHolmes/webpush-go` (VAPID) |
| Медиа | обработка изображений, thumbhash, `ffmpeg` (видео/аудио) |
| OpenAPI | `swaggo/swag` (спека генерируется при сборке в `docs/`) |

## Структура

```
apps/backend-go/
├── cmd/
│   ├── server/            # точка входа: /health до тяжёлого init, Gin подменяется атомарно
│   ├── vapidgen/          # генератор VAPID-ключей для Web Push
│   └── migrate-encrypt/   # одноразовое шифрование существующих сообщений мессенджера
├── internal/              # все пакеты (таблица ниже)
├── migrations/            # 119 SQL-миграций (001_initial_schema.sql … 112_*.sql)
├── docs/                  # сгенерированная swagger-спека (docs/swagger.json)
├── scripts/               # вспомогательные скрипты
├── vendor/                # завендоренные зависимости (сборка без сети)
├── Dockerfile             # multi-arch сборка, GOMEMLIMIT=256MiB, ffmpeg в runtime-образе
├── run-local.sh           # локальный запуск (подкладывает Homebrew ffmpeg в PATH)
└── go.mod / go.sum
```

## Пакеты `internal`

| Пакет | Файлы (src / test) | Роль |
|---|---|---|
| `api/routes` | 1 / 1 | Регистрация всех роутов и wiring зависимостей (единственная точка входа) |
| `api/handlers` | 31 / 30 | Dedicated HTTP-хендлеры: auth, boards, threads, posts, profiles, search, feed, moderation, emoji, notifications, push, actieye, gamification, audio, integrations, dev/bots |
| `crudengine` | 9 / 9 | Generic CRUD-движок + реестр таблиц (32 таблицы), стены, диспетчеризация достижений |
| `crud` | 4 / 3 | Stateless SQL-хелперы: фильтры, сортировка, emoji-валидация |
| `wall` | 7 / 2 | Профильные стены: чтение, запись, альбомы, инвалидация кеша, приватность |
| `messenger` | 5 / 7 | Мессенджер: диалоги, группы, заметки, шифрование AES-256, receipts, realtime |
| `gomosubchat` | 2 / 1 | Текстовые каналы GomoSub: keyset-пагинация, send/edit/delete, realtime |
| `channelaccess` | 1 / 1 | Предикаты read/write/moderate для каналов гомосабов (общие для REST и WS) |
| `drops` | 1 / 1 | Кошелёк и валюта drops: DePay-колбэки, баланс, история, переводы |
| `gifts` | 3 / 3 | Подарки: каталог, отправка, слои, апгрейды + админ-каталог |
| `gamification` | 9 / 2 | Движок сундуков: редкости (Common → Eternal), награды, каталог |
| `achievements` | 6 / 2 | Каталог достижений + движок (сид, рекомпут, backfill) |
| `actieye` | 1 / 1 | Персональная статистика активности (кольцо ActiEye) |
| `moderation` | 2 / 1 | Жалобы пользователей, очередь и triage модерации |
| `translations` | 1 / 1 | Комьюнити-переводы интерфейса с голосованием |
| `rpc` | 5 / 3 | RPC-хендлеры: лайки (batch/counts), эмодзи, аватары, стены, гомосабы |
| `profiles` | 5 / 3 | Пересчёт статистики профиля, CSS/фон-санитайзеры, поиск по username |
| `privacy` | 1 / 1 | Правила видимости профиля (private profile, mutual friends, гейты контента) |
| `notifications` | 1 / 1 | Сервис уведомлений: insert + инвалидация кеша + WS + push (без глобалов) |
| `push` | 1 / 1 | Web Push (VAPID): подписки, preferences, доставка |
| `oauth` | 5 / 2 | OAuth 2.0 / OIDC: authorize/token/revoke/introspect/userinfo, discovery, JWKS |
| `auth` | 1 / 1 | JWT + refresh-токены, lockout, recovery codes |
| `middleware` | 20 / 14 | Rate limit (много поверхностных бюджетов), auth, CORS, CSRF, RLS, data cache, metrics, presence |
| `cache` | 2 / 2 | Redis-кеш-слой |
| `storage` + `storage/handlers` | 4 / 2 | S3-клиент, загрузка/выдача объектов, content-security (MIME allowlist), orphan cleanup |
| `media` | 3 / 3 | Обработка изображений, thumbhash, видео-варианты (ffmpeg) |
| `websocket` | 5 / 9 | Realtime-хаб: Redis pub/sub, presence-комнаты, room-scoped подписки |
| `metrics` | 1 / 1 | Prometheus-метрики (`/metrics`, доступ по `METRICS_TOKEN`) |
| `database` | 4 / 2 | Подключения PostgreSQL + Redis, миграционный раннер |
| `config` | 1 / 1 | Конфигурация из env |
| `crypto` | 1 / 1 | HMAC-подписи, AES-256 шифрование сообщений |
| `geo` | 1 / 1 | Геокодинг |
| `socialpreview` | 1 / 1 | Open Graph страницы для краулеров (NoRoute-фолбэк) |
| `models` | 2 / 1 | Общие структуры данных |
| `httpx` / `textutil` | 1 / 1 | HTTP-хелперы / строковые хелперы |
| `testutil` | 1 / 0 | Тестовые утилиты |

**Направление зависимостей**: `routes → {handlers, crudengine, wall, messenger, …}`, `handlers → {auth, cache, crud, middleware, …}`, `crudengine → {achievements, crud, models, notifications, privacy, profiles, …}` — всё листовое, хендлеры никуда не импортируются.

## Ключевые архитектурные решения

- **Без package-глобалов.** `notifications.Service` и `wall.Service` создаются в `routes` и инжектятся в хендлеры/движок (`SetNotifier`, `SetWall`, `SetPushService`). Nil-значение молча отключает путь доставки — ничего не надо сбрасывать в тестах.
- **Health до тяжёлого init.** `/health` отвечает сразу (версия + коммит из ldflags), Gin-роутер подменяется атомарно через `atomic.Value` после инициализации БД/Redis/WS.
- **Generic CRUD через реестр.** Таблица регистрируется в `crudengine.GenericTables` — маршруты, allow-list, read/write группы и скоупы владения генерируются автоматически. Новая таблица = одна строка реестра (без 8 ручных регистраций).
- **Viewer-scoped data cache.** GET-ответы кешируются в Redis (TTL 2 мин), ключ привязан к идентичности зрителя — приватные данные не утекают между пользователями через кеш.
- **Rate limit по поверхностям.** Отдельные Redis-бюджеты: auth (register 5/мин, login 10/мин), generic REST (900 user / 300 IP), RPC (900 / 120), мессенджер (300 read / 120 write), текстовые каналы, аудио-метаданные, жалобы, загрузки (quota в байтах/час), OG-превью. Почти всё тюнится env-переменными без пересборки.
- **Шифрование сообщений.** Тело сообщений шифруется AES-256 (`MESSENGER_ENCRYPTION_KEY`); Redis и WS-броадкасты видят только ciphertext. Для существующих данных — `cmd/migrate-encrypt`.
- **RLS.** Messenger-запросы идут через транзакции с `set_config` контекстом; эмодзи-таблицы — через RLS middleware.
- **Хранилище.** Публичные бакеты отдаёт напрямую Garage (через Caddy), приватные (`uploads`, `wall`) — авторизованный прокси с проверкой приватности стены. Фоновая задача чистит осиротевшие объекты.
- **Достижения.** Каталог живёт в Go-коде, таблица БД — синхронизированное зеркало; при старте сверяется хеш и рекомпутаются изменённые группы, один раз за время жизни Redis — полный backfill.
- **Social previews.** Краулеры (Telegram, Discord, …) получают полноценные OG-страницы через `NoRoute`-фолбэк + прокси `og:image` для стен, с отдельными rate-лимитами.

## API

Swagger-спека: `GET /api/v1/docs/json` (генерируется из godoc-комментариев).

| Группа | Примеры |
|---|---|
| Health | `GET /health` (до init), `GET /ready` (полный стек) |
| Auth | `POST /api/v1/auth/register` (Turnstile + honeypot), `POST /login`, `POST /refresh`, `POST /logout`, `GET /me`, 2FA TOTP (`/2fa/*`), passkeys (`/webauthn/*`), сессии |
| Ленты и контент | `GET /api/v1/feed` (персонализированная), `GET /search` (полнотекстовый), `GET /profiles|boards|threads|posts`, CRUD (авторизованный) |
| Generic CRUD | `GET/POST/PUT/DELETE /api/v1/{table}` — 32 таблицы из реестра (emoji, гомосабы, голосования, подписки, достижения пользователей, …) |
| Стены | профильные стены, комментарии, лайки, репосты, альбомы — через generic CRUD + RPC |
| Мессенджер | `GET /messenger/conversations`, `POST /messenger/conversations/:id/messages`, группы, заметки, receipts, pin, leave |
| GomoSub chat | `GET|POST /api/v1/gomosubchat/channels/:id/messages` + edit/delete (realtime) |
| Экономика | `GET /drops/wallet`, `POST /drops/transfer`, `POST /drops/callback` (DePay), `POST /gifts/send`, `GET /gift_catalog`, админ `/admin/gifts` |
| Геймификация | `GET /api/v1/gamification/catalog`, `POST /chests/start`, `POST /chests/tap` (stateless playground) |
| Модерация | `POST /moderation/reports` (любой user), `GET /moderation/reports` (moderator/admin), `POST /moderation/posts/:postId/resolve` |
| Уведомления | `GET /notifications`, `PUT /notifications/:id/read`, unread-count; Web Push: `POST /push/subscribe`, `GET /push/vapid-public-key` |
| OAuth / OIDC | `GET /oauth/authorize`, `POST /oauth/token` (PKCE), `/introspect`, `/userinfo`, `GET /.well-known/openid-configuration`, `/.well-known/jwks.json` |
| Developer | `GET|POST /api/v1/developer/apps`, `GET|POST /api/v1/bots`, regenerate-secret/token |
| Integrations | `GET /api/v1/integrations/spotify/now-playing/:user_id` (публичный), Spotify OAuth: auth-url / callback / status / disconnect |
| RPC | `GET /api/rpc/get_post_likes_batch`, `get_recent_*_likers`, `POST /resolve_emojis`, avatar history, record wall views, pin toggle |
| Storage | `GET /storage/v1/object/:bucket/*key` (public/private), `POST /storage/v1/upload`, `DELETE /storage/v1/object/...` |
| Прочее | `GET /api/v1/audio/metadata` (auth + rate limit), `GET /api/v1/actieye`, `GET /users/:id/status`, `GET /users/online`, translations, client-errors, `GET /api/v1/metrics` (admin, JSON), `GET /metrics` (Prometheus, `METRICS_TOKEN`), `/og/wall/*` |
| WebSocket | `GET /ws` (auth первой фрейм-сообщением; room-scoped подписки, presence-комнаты) |

> `/federation/*` — легаси-стабы, возвращают `501 Not Implemented`; кодовая база не использует федерацию.

## Конфигурация

Полный шаблон — `.env.example` в корне репозитория. Ключевые переменные:

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN |
| `REDIS_URL` | Redis DSN |
| `JWT_SECRET` | Секрет подписи JWT |
| `MESSENGER_ENCRYPTION_KEY` | AES-256 ключ шифрования сообщений (32 байта hex) |
| `SERVER_PORT` | Порт HTTP (по умолчанию `8080`) |
| `DOMAIN` / `SERVER_DOMAIN` | Домен платформы |
| `ENVIRONMENT` | `production` / `development` |
| `ALLOWED_ORIGINS` | CORS-разрешённые origin (через запятую) |
| `FEDERATION_KEY` | Легаси — не используется кодом, но требуется docker-compose |
| `TURNSTILE_SECRET` / `TURNSTILE_HOSTNAMES` | Cloudflare Turnstile (siteverify). `TURNSTILE_DISABLED=1` — выключить локально |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push (сгенерировать: `go run ./cmd/vapidgen`) |
| `METRICS_TOKEN` | Доступ к `/metrics` (пусто = 404) |
| `MIGRATIONS_DIR` | Каталог миграций (по умолчанию `./migrations`) |
| `RATE_LIMIT_PER_USER` / `RATE_LIMIT_PER_IP` | Бюджеты generic REST (900/300 в минуту) |
| `RPC_RATE_LIMIT_PER_USER` / `RPC_RATE_LIMIT_PER_IP` | Бюджеты `/api/rpc` (900/120) |
| `CHANNELCHAT_RATE_LIMIT_READ` / `WRITE` | Бюджеты текстовых каналов (300/120) |
| `MODERATION_REPORT_RATE_LIMIT_PER_MIN` | Бюджет жалоб (10) |
| `AUDIO_RATE_LIMIT_PER_MIN` | Бюджет audio-метаданных (30) |
| `OG_RATE_LIMIT_PER_MIN` / `OG_IMAGE_RATE_LIMIT_PER_MIN` | Бюджеты social previews (120/240) |
| `DEPAY_*` / `SPOTIFY_*` / `WEBAUTHN_RP_*` | Внешние интеграции и passkeys |

## Быстрый старт

### Локально (Postgres + Redis)

```bash
# Инфраструктура из корня репозитория (или свои Postgres/Redis):
cp .env.example .env && bash scripts/generate-keys.sh --quiet .env
docker compose up -d postgres redis

# Бэкенд (миграции применяются автоматически при старте):
cd apps/backend-go
TURNSTILE_DISABLED=1 go run cmd/server/main.go
```

Либо через `run-local.sh` (подкладывает Homebrew ffmpeg/ffprobe в PATH — нужно для видео-загрузок):

```bash
./run-local.sh
```

Проверка: `curl http://localhost:8080/health` → `{"status":"ok","version":"<версия из VERSION/ldflags, локально dev>","commit":"<sha>"}`.

### Docker (из корня репозитория)

```bash
bash scripts/generate-keys.sh --quiet .env
bash scripts/generate-garage-config.sh .env   # рендерит .garage.toml
docker compose up -d backend
```

## Тестирование

```bash
go test ./...                        # unit-тесты: sqlmock + miniredis, БД не нужна
go test -race -count=1 ./...         # с race-детектором (нужны Postgres + Redis)
go vet ./...
golangci-lint run --timeout=5m ./... # линт
govulncheck ./...                    # проверка уязвимостей зависимостей
```

`go test -race` требует рабочие `DATABASE_URL_TEST` и `REDIS_URL` (полный стек поднимается в CI, см. `.forgejo/workflows/coverage.yml`).

## Миграции

`migrations/` — 119 файлов, именованных по порядку (`001_initial_schema.sql` …). Применяются **Go-раннером** при старте (`internal/database/migrations.go`): сортировка по имени, каждый файл в транзакции, учёт в таблице `schema_migrations`. Файлы с явным `BEGIN/COMMIT` оборачиваются повторно — runner срезает обёртки. Идемпотентно: уже применённые пропускаются, duplicate-object ошибки (таблица создана ранее вручную) помечаются применёнными.

## Docker-сборка

`Dockerfile` — двухстадийная multi-arch сборка:

- **Builder** (`--platform=$BUILDPLATFORM`, натив для раннера): `swag init` (регенерация спеки) + кросс-компиляция `CGO_ENABLED=0` c `-trimpath -ldflags="-s -w"`; версия и коммит вшиваются из build-args (`VERSION`, `GIT_COMMIT`) и отдаются в `/health`. Сборка использует только `vendor/` (без сети) и лимитируется `GOMEMLIMIT=256MiB`.
- **Runtime** (alpine:3.23): бинарник + `.env` + `docs/` + `migrations/` + `ffmpeg` (видео-транскодинг). Healthcheck — `curl /health`.

Публикация и деплой: push образа в Codeberg registry и рестарт сервиса на VPS делает `.forgejo/workflows/deploy.yml` (см. корневой [README](../README.md)).