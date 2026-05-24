

  <strong>Социальная платформа с мессенджером, OAuth, аудиоподкастами, стримингом и ботами</strong>
</p>

<p align="center">
  <a href="https://github.com/scramble22/gomo6.2/actions/workflows/ci.yml"><img src="https://github.com/scramble22/gomo6.2/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/scramble22/gomo6.2/actions/workflows/deploy.yml"><img src="https://github.com/scramble22/gomo6.2/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a>
  <a href="https://github.com/scramble22/gomo6.2/releases/latest"><img src="https://img.shields.io/github/v/release/scramble22/gomo6.2?include_prereleases&label=release&color=00d4aa" alt="Release"></a>
  <a href="https://github.com/scramble22/gomo6.2/commits/main"><img src="https://img.shields.io/github/last-commit/scramble22/gomo6.2/main?color=blue" alt="Last commit"></a>
  <img src="https://img.shields.io/badge/license-MIT-purple" alt="License">
</p>

<!-- ── Coverage ── -->
<p align="center">
  <strong>📊 Code Coverage</strong><br>
  
  <a href="https://codecov.io/gh/scramble22/gomo6.2">
    <img src="https://codecov.io/gh/scramble22/gomo6.2/branch/main/graph/badge.svg?token=NQ6LEKHYCT&flag=backend" alt="Go coverage">
  </a>
  <a href="https://codecov.io/gh/scramble22/gomo6.2">
    <img src="https://codecov.io/gh/scramble22/gomo6.2/branch/main/graph/badge.svg?flag=frontend&token=NQ6LEKHYCT" alt="Frontend coverage">
  </a>
  <br>
  <sub>Backend (Go) &nbsp;·&nbsp; Frontend (TypeScript)</sub>
</p>

<p align="center">
   <strong>Stack</strong><br>
  <img src="https://img.shields.io/badge/go-00ADD8?style=flat&logo=go&logoColor=white" alt="Go">
  <img src="https://img.shields.io/badge/typescript-%23007ACC?style=flat&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/react-%2320232a?style=flat&logo=react&logoColor=%2361DAFB" alt="React">
  <img src="https://img.shields.io/badge/postgres-%23316192?style=flat&logo=postgresql&logoColor=white" alt="Postgres">
  <img src="https://img.shields.io/badge/redis-%23DD0031?style=flat&logo=redis&logoColor=white" alt="Redis">
  <img src="https://img.shields.io/badge/docker-%230db7ed?style=flat&logo=docker&logoColor=white" alt="Docker">
  <img src="https://img.shields.io/badge/tailwindcss-%2338B2AC?style=flat&logo=tailwind-css&logoColor=white" alt="Tailwind">
  <img src="https://img.shields.io/badge/vite-%23646CFF?style=flat&logo=vite&logoColor=white" alt="Vite">
  <img src="https://img.shields.io/badge/turborepo-%23EF4444?style=flat&logo=turborepo&logoColor=white" alt="Turborepo">
</p>

---

## 📖 О проекте

**Gomo6** — полноценная социальная платформа с лентой, профилями, аудиоподкастами, стримингом, приватным мессенджером, OAuth-авторизацией и системой ботов. Написана на Go (бэкенд) и React + TypeScript (фронтенд).

### 🔑 Ключевые возможности

| Возможность | Описание |
|---|---|
| 📝 **Лента и посты** | Создание, комментирование, голосования, эмодзи-реакции |
| 👤 **Профили** | Кастомные стены, аватары с историей, био в JSON |
| 💬 **Мессенджер** | Приватные диалоги, вложения, WebSocket real-time |
| 🔐 **OAuth 2.0** | Полноценный провайдер (Authorization Code + PKCE, client credentials), dev-дашборд |
| 🎙️ **Аудио** | Подкасты, стриминг, now-playing виджет |
| 🤖 **Боты** | API для ботов, лайки, события, системы логирования |
| 🔒 **Безопасность** | 2FA (TOTP), rate limiting, end-to-end мессенджер |
| 🌍 **Federation** | ActivityPub-совместимая федерация |

---

## 🏗️ Архитектура

Проект — **монорепозиторий** (Turborepo + npm workspaces):

```
gomo6.2/
├── apps/
│   ├── web/              # 🖥️  Основной сайт (React + Vite + Tailwind)
│   ├── docs/             # 📚  Документация по API и ботам
│   ├── dev-dashboard/    # ⚙️  Панель управления OAuth-приложениями
│   └── backend-go/       # 🚀  Go-сервер (REST + WebSocket)
├── docs/                 # 📖  Проектная документация
├── scripts/              # 🔧  CI/CD и утилиты
├── docker-compose.yml    # 🐳  Production-сборка
├── Caddyfile             # 🔒  TLS и роутинг (Caddy)
├── CHANGELOG.md          # 📋  История изменений
└── turbo.json            # ⚡  Конфиг Turborepo
```

### 🌐 Роутинг поддоменов

| Приложение | Пакет | Поддомен | Порт (dev) |
|---|---|---|---|
| Web | `@gomo6/web` | `DOMAIN` | 8081 |
| Docs | `@gomo6/docs` | `docs.DOMAIN` | 3001 |
| Dev Dashboard | `@gomo6/dev-dashboard` | `dev.DOMAIN` | 3002 |
| Backend | — | — | 8080 |

### 🐳 Docker-сервисы (production)

| Сервис | Назначение | Технология |
|---|---|---|
| `caddy` | TLS-терминация (Let's Encrypt) + роутинг | Caddy 2 |
| `backend` | REST API + WebSocket | Go + Gin |
| `web` | Статика основного сайта | nginx |
| `docs` | Статика документации | nginx |
| `dev-dashboard` | Статика OAuth-дашборда | nginx |
| `postgres` | Основная БД | PostgreSQL 15 |
| `redis` | Кеш, сессии, rate limit | Redis 7 |
| `garage` | S3-совместимое хранилище | Garage |

---

## 🚀 Быстрый старт (локально)

```bash
# 1. Установка зависимостей
npm install

# 2. Запуск всех приложений в dev-режиме
npm run dev

# Или по отдельности:
npm run dev:web              # только основной сайт
cd apps/docs && npm run dev  # только документация
```

### Локальный backend

```bash
cd apps/backend-go

# Поднять Postgres + Redis (если нужны)
docker compose up -d postgres redis garage

# Запустить сервер
go run main.go
```

---

## 🚢 Production-деплой

### Авто-деплой (основной способ)

Пуш в `main` → зелёный CI → автоматический деплой на VPS.

Настройка секретов в GitHub Actions:
- `VPS_HOST` — IP-адрес сервера
- `VPS_USERNAME` — пользователь SSH (обычно `root`)
- `VPS_SSH_KEY` — **приватный** SSH-ключ (начинается с `-----BEGIN ... PRIVATE KEY-----`)

> Публичный ключ должен быть в `~/.ssh/authorized_keys` на сервере.

### Ручной деплой

```bash
# На сервере:
git clone git@github.com:scramble22/gomo6.2.git && cd gomo6.2
echo 'DOMAIN=your-domain.com' >> .env
docker compose up -d
```

---

## 🧪 CI/CD

| Workflow | Триггер | Что делает |
|---|---|---|
| `ci.yml` | push, PR | go vet + golangci-lint + tsc + eslint + build |
| `deploy.yml` | push в main (после зелёного CI) | Деплой на VPS: pull, build, restart |
| `changelog.yml` | push тега `v*.*.*` | Авто-обновляет `CHANGELOG.md` |

Локально перед коммитом:
```bash
./scripts/ci-local.sh quick   # только lint + typecheck
./scripts/ci-local.sh         # полный CI
```

---

## 📁 Переменные окружения (`.env`)

| Переменная | Обязательно | Назначение |
|---|---|---|
| `DOMAIN` | ✅ для прода | Основной домен (`gomo6.wtf`) |
| `JWT_SECRET` | ✅ | Секрет для подписи JWT-токенов |
| `FEDERATION_KEY` | ✅ | Ключ федерации ActivityPub |
| `SHARED_COOKIE_DOMAIN` | ⬜ | Для кросс-поддоменных cookie |
| `APP_BASE_URL` | ⬜ | URL основного сайта |
| `MESSENGER_BASE_URL` | ⬜ | URL мессенджера |

> **Остальные переменные** (`DATABASE_URL`, `REDIS_URL`, `GARAGE_S3_*`, `ALLOWED_ORIGINS` и др.) уже прописаны в `docker-compose.yml` и **не требуют** ручной настройки.
>
> Никогда не коммить `.env` — он уже в `.gitignore` и исключён из трекинга гита.

---

## 📚 Документация

- **[CHANGELOG.md](CHANGELOG.md)** — история всех релизов
- **[docs/REALTIME_WEBSOCKET_PATTERN.md](docs/REALTIME_WEBSOCKET_PATTERN.md)** — паттерны WebSocket
- **[docs/THREAD_ATTACHMENTS_GUIDE.md](docs/THREAD_ATTACHMENTS_GUIDE.md)** — работа с вложениями
- **[OAUTH_API.md](OAUTH_API.md)** — OAuth 2.0 API reference
- **[BOT_DOCS_UPDATE_SUMMARY.md](BOT_DOCS_UPDATE_SUMMARY.md)** — документация по ботам
- **[QUICK_START.md](QUICK_START.md)** — быстрый старт для разработчиков

---
<p align="center">
  Made with ❤️ by <a href="https://github.com/scramble22">scramble22</a>
</p>
