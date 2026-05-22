# 🚀 Gomo6 — Docker Deployment with Caddy

## 📦 Что входит

- **Caddy** — reverse proxy с автоматическим HTTPS (Let's Encrypt)
- **Backend (Go)** — API сервер на порту 8080
- **PostgreSQL 15** — база данных
- **Redis 7** — кеширование
- **Garage S3** — объектное хранилище
- **Frontends** — три SPA (web, docs, dev-dashboard), каждый в nginx

```
                       ┌──────────────────────────────┐
                       │     Caddy (:80 / :443)        │
                       │   Auto HTTPS (Let's Encrypt)  │
                       │   + S3 CORS proxy (/s3/*)    │
                       └──────┬───────┬───────┬────────┘
                              │       │       │
              ┌───────────────┘       │       └───────────────┐
              ▼                       ▼                       ▼
    ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
    │   web (nginx)   │   │  docs (nginx)   │   │ dev-dashboard (nginx)│
    │    main app     │   │   /docs/*       │   │     /dev/*          │
    └─────────────────┘   └─────────────────┘   └─────────────────────┘
              │
              ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                    backend:8080 (Go API)                        │
    │         /api  /oauth  /ws  /rest  /rpc  /.well-known           │
    └──────────────┬──────────────────────┬───────────────────────────┘
                   │                      │
                   ▼                      ▼
          ┌──────────────┐       ┌──────────────┐
          │ PostgreSQL   │       │    Redis     │
          └──────────────┘       └──────────────┘
                   │
                   ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │  Garage S3 (:3900)  ←  Caddy /s3/*  (CORS, prefix stripped)    │
    └─────────────────────────────────────────────────────────────────┘
```

## 🐳 Быстрый старт

### 1. Настройка

```bash
# Скопируй пример .env и заполни значения
cp .env.docker .env
```

Минимальные настройки в `.env`:

```bash
# Для production — укажи домен (Caddy автоматически получит HTTPS-сертификат)
DOMAIN=example.com

# JWT секрет (сгенерируй: openssl rand -hex 32)
JWT_SECRET=your-64-char-random-hex-string
```

### 2. Запуск

```bash
# Production (с HTTPS если указан DOMAIN)
docker compose up -d

# Посмотреть логи всех сервисов
docker compose logs -f

# Посмотреть логи конкретного сервиса
docker compose logs -f caddy
docker compose logs -f backend
```

### 3. Локальная разработка (без домена)

Без `DOMAIN` Caddy работает на `http://localhost`:

```bash
# Просто запускаем
docker compose up -d

# Доступно:
# http://localhost          → основной сайт (web)
# http://localhost/docs/    → документация
# http://localhost/dev/     → dev dashboard
# http://localhost/api/...  → API бекенда
```

## 🌐 Маршрутизация Caddy

| Путь               | Назначение                                |
|---------------------|-------------------------------------------|
| `/`                 | Основной сайт (web SPA)                   |
| `/docs/*`           | Документация (docs SPA)                   |
| `/dev/*`            | Dev Dashboard (dev-dashboard SPA)         |
| `/api/*`            | REST API                                  |
| `/oauth/*`          | OAuth 2.0 эндпоинты                       |
| `/rest/*`, `/rpc/*` | JSON-RPC / REST                           |
| `/ws/*`             | WebSocket (авто-upgrade)                  |
| `/.well-known/*`    | Federation / ActivityPub                  |
| `/storage/*`        | Хранилище (внутренний API)                |
| `/s3/*`             | S3 presigned URLs (CORS proxy к Garage)    |

## 🛠️ Полезные команды

### Проверка статуса

```bash
# Статус всех контейнеров
docker compose ps

# Health checks
curl http://localhost:8080/health          # бекенд
curl http://localhost/s3/                   # Garage S3 через Caddy
curl http://localhost/docs/                # документация
```

### Логи

```bash
# Все сервисы
docker compose logs -f --tail=100

# Caddy (запросы, ошибки TLS)
docker compose logs -f caddy

# Бекенд
docker compose logs -f backend
```

### Перезапуск / обновление

```bash
# Пересобрать и перезапустить всё
docker compose up -d --build

# Перезапустить только один сервис
docker compose up -d --build web
docker compose restart backend
```

### Полная остановка

```bash
# Остановить и удалить контейнеры (данные в volume сохраняются)
docker compose down

# Удалить контейнеры + volumes (⚠️ все данные будут удалены)
docker compose down -v
```

## 📁 Структура файлов Docker

```
gomo6/
├── docker-compose.yml          # Основной compose-файл
├── Caddyfile                   # Конфиг Caddy reverse proxy
├── .env                        # Переменные окружения (создать из .env.docker)
├── .env.docker                 # Пример .env
├── .dockerignore               # Исключения из Docker контекста
├── apps/
│   ├── web/
│   │   ├── Dockerfile          # Сборка web (Vite → nginx)
│   │   └── nginx.conf          # SPA-конфиг nginx
│   ├── docs/
│   │   ├── Dockerfile          # Сборка docs (Vite → nginx)
│   │   └── nginx.conf          # SPA-конфиг nginx
│   ├── dev-dashboard/
│   │   ├── Dockerfile          # Сборка dev-dashboard (Vite → nginx)
│   │   └── nginx.conf          # SPA-конфиг nginx
│   └── backend-go/
│       ├── Dockerfile          # Сборка Go backend
│       └── docker-compose.yml  # Легковесный compose для бекенд-разработки
```

## 🔧 Production checklist

- [ ] Сгенерировать `JWT_SECRET`: `openssl rand -hex 32`
- [ ] Указать `DOMAIN=example.com` в `.env`
- [ ] Указать `FEDERATION_KEY` (уникальный ключ для ActivityPub)
- [ ] Проверить, что DNS A-запись указывает на сервер
- [ ] Открыть порты 80 и 443 в файрволе
- [ ] Настроить бэкапы PostgreSQL: `docker compose exec postgres pg_dump -U gomo6 gomo6 > backup.sql`

## 🐛 Troubleshooting

### Caddy не получает HTTPS-сертификат

```bash
# Проверить, что порты 80 и 443 доступны извне
curl -I http://example.com

# Посмотреть логи Caddy
docker compose logs caddy | grep -i "acme\|tls\|certificate"
```

### Бекенд не подключается к БД

```bash
# Проверить, что postgres готов
docker compose exec postgres pg_isready -U gomo6 -d gomo6

# Посмотреть логи бекенда
docker compose logs backend | tail -50
```

### Фронтенд не грузится (белый экран)

```bash
# Проверить, что сбилдилось
docker compose build web --no-cache
docker compose up -d web

# Проверить nginx в контейнере
docker compose exec web wget -qO- http://localhost/
```
