# 🚀 Gomo6 — Развёртывание на выделенном сервере

> Полное руководство по запуску Gomo6 на VPS / выделенном сервере с нуля за 10 минут.
> Всё, что нужно — Docker, домен и 3 команды в терминале.

---

## 📋 Оглавление

- [Требования к серверу](#-требования-к-серверу)
- [Архитектура](#-архитектура)
- [Быстрый старт (3 команды)](#-быстрый-старт-3-команды)
- [Пошаговая установка](#-пошаговая-установка)
  - [1. Подготовка сервера](#1-подготовка-сервера)
  - [2. Клонирование проекта](#2-клонирование-проекта)
  - [3. Настройка окружения](#3-настройка-окружения)
  - [4. Настройка домена и HTTPS](#4-настройка-домена-и-https)
  - [5. Запуск](#5-запуск)
  - [6. Проверка](#6-проверка)
- [Переменные окружения](#-переменные-окружения)
- [Файрвол](#-файрвол)
- [Резервное копирование](#-резервное-копирование)
- [Обновление приложения](#-обновление-приложения)
- [Мониторинг и логи](#-мониторинг-и-логи)
- [Troubleshooting](#-troubleshooting)
- [Полезные команды](#-полезные-команды)

---

## 💻 Требования к серверу

| Ресурс | Минимум | Рекомендуется |
|--------|---------|---------------|
| **ОС** | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 LTS |
| **CPU** | 2 vCPU | 4 vCPU |
| **RAM** | 4 GB | 8 GB |
| **Диск** | 30 GB SSD | 60 GB SSD |
| **Docker** | 24+ | 27+ |
| **Docker Compose** | v2+ | v2.30+ |

> 💡 **Где купить сервер?** Hetzner, DigitalOcean, VDSina, FirstVDS — любой VPS с Ubuntu подойдёт.

---

## 🏗️ Архитектура

```
                           ┌──────────────────────────────────┐
                           │          Caddy (:80 / :443)       │
                           │     Авто-HTTPS (Let's Encrypt)    │
                           │     Маршрутизация + S3 CORS       │
                           └──────┬───────┬───────┬────────────┘
                                  │       │       │
                  ┌───────────────┘       │       └───────────────┐
                  ▼                       ▼                       ▼
        ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐
        │   web (nginx)   │   │  docs (nginx)   │   │ dev-dashboard (nginx)│
        │  Основной сайт  │   │   /docs/*       │   │     /dev/*          │
        └─────────────────┘   └─────────────────┘   └─────────────────────┘
                  │
                  ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                    backend:8080 (Go API)                        │
        │     /api  /oauth  /ws  /rest  /rpc  /.well-known  /health      │
        └──────────────┬──────────────────────┬───────────────────────────┘
                       │                      │
                       ▼                      ▼
              ┌──────────────┐       ┌──────────────┐
              │ PostgreSQL 15│       │   Redis 7    │
              └──────────────┘       └──────────────┘
                       │
                       ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │  Garage S3 (:3900)  ←  объектное хранилище (аватары, файлы)    │
        └─────────────────────────────────────────────────────────────────┘
```

**Маршрутизация запросов:**

| Путь | Назначение |
|------|-----------|
| `/` | Основной сайт (web SPA) |
| `/docs/*` | Документация API и ботов |
| `/dev/*` | Dev Dashboard (управление OAuth-приложениями) |
| `/api/*` | REST API |
| `/oauth/*` | OAuth 2.0 эндпоинты |
| `/ws` | WebSocket (чат, realtime) |
| `/health` | Health-check бекенда |

---

## ⚡ Быстрый старт (3 команды)

Если у вас уже настроен сервер (Docker, домен) — просто выполните:

```bash
git clone https://github.com/scramble22/gomo6.2.git && cd gomo6.2
echo 'DOMAIN=ваш-домен.ru' > .env
docker compose up -d
```

Через пару минут сайт будет доступен по `https://ваш-домен.ru` 🎉

---

## 📦 Пошаговая установка

### 1. Подготовка сервера

Подключитесь к серверу по SSH и установите Docker:

```bash
# Установка Docker (официальный скрипт)
curl -fsSL https://get.docker.com | sh

# Добавляем пользователя в группу docker (чтобы не писать sudo)
sudo usermod -aG docker $USER

# Перезаходим в сессию или выполняем:
newgrp docker

# Проверяем установку
docker --version       # Docker version 27+
docker compose version  # Docker Compose version v2+
```

### 2. Клонирование проекта

```bash
git clone https://github.com/scramble22/gomo6.2.git
cd gomo6.2
```

### 3. Настройка окружения

Создайте файл `.env` в корне проекта:

```bash
nano .env
```

**Минимальная конфигурация:**

```bash
# Домен (обязательно для HTTPS)
DOMAIN=your-domain.ru

# JWT-секрет (сгенерируйте уникальный ключ)
JWT_SECRET=$(openssl rand -hex 32)

# Ключ федерации (для ActivityPub)
FEDERATION_KEY=$(openssl rand -hex 32)

# Окружение
ENVIRONMENT=production
```

> ⚠️ **Важно:** Замените `your-domain.ru` на ваш реальный домен. Без домена Caddy не сможет получить HTTPS-сертификат.

Сохраните и закройте (`Ctrl+O`, `Enter`, `Ctrl+X`).

### 4. Настройка домена и HTTPS

Убедитесь, что DNS A-запись вашего домена указывает на IP-адрес сервера:

```
Тип: A
Имя: @  (или ваш-домен.ru)
Значение: <IP-адрес сервера>
TTL: 3600
```

Проверить DNS можно командой:

```bash
dig +short your-domain.ru
# или если dig не установлен:
nslookup your-domain.ru
# Должен вернуть IP вашего сервера
```

#### Включаем HTTPS в Caddyfile

По умолчанию HTTPS отключён (для локальной разработки). Для production откройте `Caddyfile` и **удалите или закомментируйте** блок:

```caddy
# Удалите эти 3 строки для production:
{
    auto_https off
}
```

А также **уберите `http://`** в начале основной директивы — Caddy сам добавит HTTPS:

```caddy
# Было:
http://{$DOMAIN:localhost} {

# Стало (для production с авто-HTTPS):
{$DOMAIN:localhost} {
```

> 💡 Caddy автоматически получит и будет обновлять SSL-сертификат от Let's Encrypt.

### 5. Запуск

```bash
# Сборка и запуск всех сервисов в фоне
docker compose up -d --build

# Первая сборка займёт 3-5 минут (загрузка образов + компиляция)
```

Наблюдайте за процессом:

```bash
# Логи всех сервисов
docker compose logs -f

# Только бекенд
docker compose logs -f backend
```

### 6. Проверка

```bash
# Health-check бекенда
curl http://localhost:8080/health

# Проверка сайта (должен вернуть HTML)
curl -I https://your-domain.ru

# Проверка HTTPS-сертификата
curl -I https://your-domain.ru 2>&1 | grep -i "HTTP/2\|SSL"
```

---

## 🔧 Переменные окружения

Полный список переменных в `.env`:

| Переменная | По умолчанию | Описание |
|-----------|-------------|----------|
| `DOMAIN` | `localhost` | Домен сайта (нужен для HTTPS) |
| `JWT_SECRET` | — | Секретный ключ для JWT-токенов |
| `FEDERATION_KEY` | — | Ключ для ActivityPub-федерации |
| `ENVIRONMENT` | `production` | Окружение (`production` / `development`) |
| `ALLOWED_ORIGINS` | auto | CORS origins (через запятую) |
| `DATABASE_URL` | auto | Строка подключения к PostgreSQL |
| `REDIS_URL` | auto | Строка подключения к Redis |

Большинство переменных имеют разумные значения по умолчанию в `docker-compose.yml`. Обязательно задать нужно только **`DOMAIN`**.

---

## 🔥 Файрвол

Откройте только нужные порты:

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Проверить статус
sudo ufw status verbose
```

> ⚠️ **Никогда не открывайте порты** PostgreSQL (5432), Redis (6379) или Garage (3900) наружу — они доступны только внутри Docker-сети.

---

## 💾 Резервное копирование

### База данных PostgreSQL

```bash
# Создать дамп
docker compose exec postgres pg_dump -U gomo6 gomo6 > backup_$(date +%Y%m%d).sql

# Восстановить из дампа
docker compose exec -T postgres psql -U gomo6 gomo6 < backup_20250101.sql
```

### Автоматический бэкап (cron)

```bash
# Создайте папку для бэкапов
mkdir -p /opt/backups
```

Добавьте в crontab (`crontab -e`):

```cron
# Ежедневный бэкап в 3:00 ночи
0 3 * * * cd /opt/gomo6.2 && docker compose exec -T postgres pg_dump -U gomo6 gomo6 > /opt/backups/gomo6_$(date +\%Y\%m\%d).sql

# Хранить только последние 7 дней
0 4 * * * find /opt/backups -name "gomo6_*.sql" -mtime +7 -delete
```

### Docker volumes

```bash
# Список volumes
docker volume ls | grep gomo6

# Полный бэкап всех данных
sudo tar -czf gomo6_data_$(date +%Y%m%d).tar.gz /var/lib/docker/volumes/gomo6*
```

---

## 🔄 Обновление приложения

```bash
cd /opt/gomo6.2

# Получить последние изменения
git pull

# Пересобрать и перезапустить (с нулевым простоем)
docker compose up -d --build

# Удалить старые образы (освободить место)
docker image prune -f
```

> 💡 Caddy и база данных не перезапускаются, если их конфигурация не изменилась — downtime минимальный.

---

## 📊 Мониторинг и логи

```bash
# Статус всех контейнеров
docker compose ps

# Использование ресурсов
docker stats

# Логи всех сервисов (live)
docker compose logs -f --tail=50

# Логи конкретного сервиса
docker compose logs -f backend
docker compose logs -f caddy
docker compose logs -f postgres

# Логи за последний час
docker compose logs --since 1h backend
```

---

## 🐛 Troubleshooting

### Сайт не открывается

```bash
# 1. Проверить, что все контейнеры запущены
docker compose ps
# Все должны быть "Up" (garage-init отработает и выйдет — это нормально)

# 2. Проверить логи Caddy
docker compose logs caddy | tail -30

# 3. Проверить DNS
dig +short your-domain.ru
```

### Caddy не получает сертификат

```bash
# Проверить, что порты 80 и 443 открыты
sudo ufw status

# Проверить логи Caddy на ошибки ACME
docker compose logs caddy | grep -i "acme\|tls\|certificate\|error"

# Проверить, что блок auto_https off удалён из Caddyfile
grep "auto_https" Caddyfile
```

### Бекенд не подключается к БД

```bash
# Проверить готовность PostgreSQL
docker compose exec postgres pg_isready -U gomo6 -d gomo6

# Посмотреть логи бекенда
docker compose logs backend | tail -50

# Перезапустить бекенд (после готовности БД)
docker compose restart backend
```

### Фронтенд — белый экран

```bash
# Пересобрать фронтенд
docker compose build web --no-cache
docker compose up -d web

# Проверить nginx внутри контейнера
docker compose exec web wget -qO- http://localhost/
```

### Очистка места на диске

```bash
# Удалить неиспользуемые образы, контейнеры, volumes
docker system prune -a --volumes -f

# Посмотреть, что занимает место
docker system df
```

---

## 🛠️ Полезные команды

```bash
# Полный перезапуск
docker compose down && docker compose up -d --build

# Перезапуск только одного сервиса
docker compose restart backend
docker compose restart web

# Посмотреть переменные окружения в контейнере
docker compose exec backend env

# Зайти внутрь контейнера
docker compose exec backend sh
docker compose exec postgres psql -U gomo6 gomo6

# Остановить всё (данные сохранятся)
docker compose down

# Остановить всё и удалить данные (⚠️ необратимо)
docker compose down -v
```

---

## 📁 Структура файлов Docker

```
gomo6.2/
├── docker-compose.yml          # Основной compose-файл (все сервисы)
├── Caddyfile                   # Конфигурация Caddy reverse proxy
├── .env                        # Переменные окружения (создаётся вручную)
├── DEPLOYMENT.md               # Этот файл
├── apps/
│   ├── web/                    # Основной сайт
│   │   ├── Dockerfile          # Vite → nginx
│   │   └── nginx.conf          # SPA-конфиг для nginx
│   ├── docs/                   # Документация
│   │   ├── Dockerfile
│   │   └── nginx.conf
│   ├── dev-dashboard/          # Dev Dashboard
│   │   ├── Dockerfile
│   │   └── nginx.conf
│   └── backend-go/             # Go API сервер
│       ├── Dockerfile
│       ├── migrations/         # SQL-миграции
│       └── garage.toml         # Конфиг Garage S3
```

---

## ✅ Production Checklist

Перед запуском в production убедитесь:

- [ ] Сгенерирован уникальный `JWT_SECRET` (`openssl rand -hex 32`)
- [ ] Сгенерирован уникальный `FEDERATION_KEY`
- [ ] Указан `DOMAIN=ваш-домен.ru` в `.env`
- [ ] DNS A-запись указывает на IP сервера
- [ ] Удалён блок `auto_https off` из `Caddyfile`
- [ ] Открыты порты 80 и 443 в файрволе
- [ ] Настроен ежедневный бэкап базы данных (cron)
- [ ] Проверен health-check: `curl https://ваш-домен.ru/health`

---

> 💬 **Вопросы?** Откройте Issue на GitHub: [github.com/scramble22/gomo6.2](https://github.com/scramble22/gomo6.2)
