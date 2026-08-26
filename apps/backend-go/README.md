# Gomo6 Backend - Go Implementation

Федеративный бэкенд для Gomo6 с поддержкой межсерверного взаимодействия.

## Особенности

- **Федеративная архитектура** - поддержка глобальных g-сабов
- **Custom протокол** - простой REST + WebSocket
- **Совместимость с Supabase** - плавная миграция
- **Высокая производительность** - Go + PostgreSQL + Redis

## Структура проекта

```
apps/backend-go/
├── cmd/server/main.go
├── internal/
│   ├── api/
│   │   ├── handlers/           # HTTP хендлеры (dedicated: posts, threads, boards, …)
│   │   └── routes/             # Роуты, wiring
│   ├── crudengine/             # Generic CRUD engine + wall + registry (ex-god-pakage)
│   ├── crud/                   # Stateless SQL helpers (filters, ordering, emoji)
│   ├── profiles/               # Profile stats + CSS sanitizers
│   ├── backup/                 # Database backup handler
│   ├── auth/                   # JWT / WebAuthn / 2FA
│   ├── middleware/             # Rate limit, auth, CORS, …
│   ├── cache/                  # Redis cache layer
│   ├── models/                 # Shared data models
│   ├── websocket/              # Realtime hub
│   ├── storage/                # S3 storage + storage/handlers
│   ├── oauth/                  # OAuth2 flows
│   ├── achievements/           # Achievement definitions
│   ├── push/                   # Web Push (VAPID)
│   ├── geo/                    # Geocoding
│   ├── media/                  # Image processing / thumbhash
│   ├── crypto/                 # HMAC signing
│   ├── integrations/           # External service adapters
│   ├── config/                 # App configuration
│   ├── metrics/                # Prometheus metrics
│   └── database/               # PostgreSQL + Redis connections
├── migrations/
├── docker-compose.yml
└── Dockerfile
```

### Диаграмма зависимостей (internal packages)

```mermaid
graph TD
    subgraph Entry
        routes["api/routes"]
    end

    subgraph Application
        handlers["api/handlers\n45 files — dedicated CRUD + auth + messenger"]
        crudengine["crudengine\n10 files — generic CRUD, wall, registry, achievements"]
    end

    subgraph Domain
        profiles["profiles\n3 files — stats recomputation, CSS sanitizers, username lookup"]
        backup["backup\n1 file — database backup"]
        notifications["notifications\n1 file — notification insertion subsystem"]
        privacy["privacy\n1 file — profile visibility rules"]
    end

    subgraph Shared helpers
        crud["crud\n3 files — SQL filters, ordering, emoji validation"]
        achievements["achievements\n6 files — event definitions + emit"]
        httpx["httpx\n1 file — HTTP responders, auth context"]
        textutil["textutil\n1 file — string helpers"]
    end

    subgraph Infrastructure
        auth["auth\n1 file — JWT / WebAuthn"]
        middleware["middleware\n20 files — rate limit, auth, CORS"]
        cache["cache\n2 files — Redis"]
        storage["storage\n4 files — S3"]
        storageh["storage/handlers"]
        websocket["websocket\n5 files — hub"]
        oauth["oauth\n5 files"]
        push["push\n1 file"]
        models["models\n2 files"]
        geo["geo"]
        media["media"]
        crypto["crypto"]
        integrations["integrations"]
        config["config"]
        metrics["metrics"]
    end

    %% routes wires everything
    routes --> handlers
    routes --> crudengine
    routes --> backup
    routes --> profiles
    routes --> middleware
    routes --> auth
    routes --> oauth
    routes --> storage
    routes --> storageh
    routes --> websocket
    routes --> achievements
    routes --> push

    %% handlers → domain + shared + infra
    handlers --> auth
    handlers --> cache
    handlers --> crud
    handlers --> crypto
    handlers --> geo
    handlers --> integrations
    handlers --> middleware
    handlers --> models
    handlers --> oauth
    handlers --> profiles
    handlers --> push
    handlers --> storage
    handlers --> storageh
    handlers --> websocket
    handlers --> achievements
    handlers --> notifications
    handlers --> privacy
    handlers --> httpx
    handlers --> textutil

    crudengine --> achievements
    crudengine --> notifications
    crudengine --> privacy
    crudengine --> httpx
    crudengine --> textutil
    crudengine --> auth
    crudengine --> cache
    crudengine --> crud
    crudengine --> middleware
    crudengine --> models
    crudengine --> profiles
    crudengine --> websocket

    profiles --> auth
    profiles --> models

    backup --> auth
    backup --> models
    backup --> storage

    storage --> auth
    storage --> crypto
    storage --> media
    storage --> models

    storageh --> auth
    storageh --> media
    storageh --> models
    storageh --> storage

    middleware --> auth
    middleware --> cache
    middleware --> metrics

    websocket --> auth
    websocket --> crypto
    websocket --> integrations
    websocket --> metrics

    oauth --> auth

    style handlers fill:#f9f,stroke:#333,stroke-width:2px
    style crudengine fill:#bbf,stroke:#333,stroke-width:2px
    style crud fill:#bfb,stroke:#333
    style profiles fill:#bfb,stroke:#333
    style backup fill:#bfb,stroke:#333
```

## Быстрый старт

### 1. С Docker Compose (рекомендуется)

```bash
# Запуск всех сервисов
docker-compose up -d

# Проверка работы
curl http://localhost:8080/health
```

### 2. Локальный запуск

```bash
# Установка зависимостей
brew install postgres redis

# Запуск БД и Redis
postgres -D /usr/local/var/postgres &
redis-server &

# Создание БД
createdb gomo6

# Применение миграций
psql gomo6 < migrations/001_initial_schema.sql

# Запуск сервера
go run cmd/server/main.go
```

## API Эндпоинты

### Аутентификация
```
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
```

### Supabase совместимость
```
GET    /rest/v1/profiles
GET    /rest/v1/boards
GET    /rest/v1/threads
GET    /rest/v1/posts
POST   /rest/v1/boards      (требует auth)
POST   /rest/v1/threads     (требует auth)
POST   /rest/v1/posts       (требует auth)
```

### Федерация
```
GET  /federation/users/:username@:domain
GET  /federation/gomosubs/:slug
GET  /federation/servers
```

## Конфигурация

Переменные окружения:

```bash
SERVER_PORT=8080
DATABASE_URL=postgres://user:password@localhost/gomo6?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
SERVER_DOMAIN=localhost:8080
FEDERATION_KEY=your-federation-key
ENVIRONMENT=development
```

## Разработка

### Сборка
```bash
go build -o bin/server cmd/server/main.go
./bin/server
```

### Тестирование
```bash
go test ./...
```

### Миграции
```bash
# Создание новой миграции
# Добавить файл в migrations/ с номером

# Применение миграций
psql gomo6 < migrations/001_initial_schema.sql
```

## Федеративная архитектура

### Пользователи
- Формат: `username@domain`
- Глобальная уникальность имен
- Поддержка удаленных пользователей

### G-сабы
- Глобальные сообщества
- Владелец на конкретном сервере
- Возможность создания тредов с других серверов

### Межсерверное взаимодействие
- REST API для основных операций
- WebSocket для real-time
- Криптографическая подпись запросов

## Совместимость с frontend

Бэкенд эмулирует Supabase API для плавной миграции:

- Те же форматы ответов
- Поддержка `apikey` заголовка
- Аналогичные эндпоинты `/rest/v1/*`

## Дальнейшее развитие

1. **Полная реализация CRUD** - все эндпоинты
2. **WebSocket real-time** - замена Supabase realtime  
3. **Федерация** - межсерверное взаимодействие
4. **Bot API** - для создания ботов
5. **Админ панель** - управление федерацией

## Производительность

- **Go** для высокой производительности
- **PostgreSQL** с индексами
- **Redis** для кэша и real-time
- **Connection pooling**
- **Асинхронная обработка**
