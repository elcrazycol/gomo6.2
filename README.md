

# Gomo6

Социальная платформа с мессенджером, OAuth, подкастами, стримингом и ботами.

## Архитектура

Проект — монорепозиторий (npm workspaces + Turbo):

| Приложение | Пакет | Поддомен | Порт (dev) | Назначение |
|---|---|---|---|---|
| `apps/web` | `@gomo6/web` | `DOMAIN` | 8081 | Основной сайт |
| `apps/docs` | `@gomo6/docs` | `docs.DOMAIN` | 3001 | Документация (боты + OAuth API) |
| `apps/dev-dashboard` | `@gomo6/dev-dashboard` | `dev.DOMAIN` | 3002 | Dev dashboard для OAuth приложений |
| `apps/backend-go` | — | — | 8080 | Go-сервер (REST + WebSocket) |

> **Поддомены:** локально — `docs.localhost`, `dev.localhost`; на сервере — `docs.ваш-домен.ru`, `dev.ваш-домен.ru`.
> Настраиваются автоматически через переменную `DOMAIN` в `.env`.

## 🚀 Развёртывание на сервере

### Одна команда (Ubuntu 22.04+)

Скопируйте репозиторий и запустите скрипт — он сам установит Docker, настроит домен/HTTPS, сгенерирует секреты и запустит проект:

```bash
git clone https://github.com/scramble22/gomo6.2.git && cd gomo6.2
chmod +x deploy.sh && sudo ./deploy.sh
```

Скрипт сделает всё автоматически:
- ✅ Проверит систему и порты
- ✅ Установит Docker и Docker Compose (если не установлены)
- ✅ Запросит домен (Enter = localhost для dev) и email для Let's Encrypt
- ✅ Сгенерирует JWT_SECRET и FEDERATION_KEY
- ✅ Создаст `.env` с защитой `chmod 600`
- ✅ Настроит Caddy для авто-HTTPS (при наличии email)
- ✅ Соберёт и запустит все 8 контейнеров
- ✅ Дождётся healthcheck'ов и покажет URL

> **Для продакшна** потребуются DNS A-записи для `@`, `docs`, `dev` → IP сервера.
> **Для разработки** просто нажмите Enter на вопросе о домене — всё будет на `localhost`.

Пошаговое руководство с деталями: **[DEPLOYMENT.md](DEPLOYMENT.md)**

## CI / CD

Подробное описание всех GitHub Actions workflow: [`.github/CI_README.md`](.github/CI_README.md)

Кратко:
- **`ci.yml`** — быстрая проверка на каждый push/PR (build + lint + typecheck)
- **`full-tests.yml`** — полные тесты (с БД, race, coverage, smoke) вручную или по cron
- **`release.yml`** — релиз по тегу `v*` (Docker → ghcr.io + GitHub Release)

## Быстрый старт

```bash
npm install
npm run dev       # Запуск всех приложений
```

### Очистка кеша браузера

- **Chrome/Edge**: Ctrl+Shift+R (hard refresh) или Ctrl+Shift+Delete → Clear browsing data
- **Firefox**: Ctrl+F5 или Ctrl+Shift+R
