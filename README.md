

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

Пошаговое руководство по запуску на VPS / выделенном сервере за 10 минут:

👉 **[DEPLOYMENT.md](DEPLOYMENT.md)** — Docker, Caddy, авто-HTTPS, бэкапы, мониторинг

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
