# CI/CD на GitHub — что настроить и в каком порядке переезжать

Новые воркфлоу лежат в `.github/workflows/`. Папка `.forgejo/` **не тронута** —
старый Codeberg-пайплайн продолжает работать как есть, пока вы не решите иначе.

## Что где

| Файл | Триггер | Что делает |
|---|---|---|
| `ci.yml` | PR, `workflow_call`, вручную | Быстрые проверки: Go (build/vet/fmt/tidy/тесты+coverage), Go (lint/vuln), Frontend (tsc/eslint/vitest/build), gitleaks, hadolint. Плюс `docker-build` — сборка образов **без push**, только если менялись Dockerfile/compose. Этот же файл вызывается из deploy как гейт |
| `deploy.yml` | push в `main`, вручную | CI → план (что изменилось) → matrix по сервисам: buildx build --push в ghcr.io → pull+restart на VPS |
| `tests-full.yml` | ночью 06:00 UTC, вручную | race + настоящие Postgres/Redis, e2e smoke, e2e privacy wall |
| `security.yml` | Пн 03:00 UTC, вручную | CodeQL + Trivy → SARIF в Security. **Issue не создаются** |
| `mirror.yml` | любой push | Полное зеркало GitHub → Codeberg + GitLab |
| `release.yml` | тег `v*.*.*` | CHANGELOG.md + GitHub Release |

## Ключевая идея: один рубильник

Всё, что **пишет** (деплой, зеркало, релиз), выключено, пока не задана переменная
репозитория `PRIMARY_FORGE=github`. Это позволяет спокойно закоммитить воркфлоу,
пока каноном ещё остаётся Codeberg: проверки на PR заработают сразу, а прод и
зеркала никто не тронет.

## One-time setup

### 1. Secrets (Settings → Secrets and variables → Actions → Secrets)

| Секрет | Обязателен | Откуда |
|---|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY` | да | как в Codeberg-секретах; `VPS_SSH_KEY` — приватный ключ целиком, с переводом строки |
| `VPS_PORT` | нет | по умолчанию 22 |
| `VITE_TURNSTILE_SITEKEY` | да | публичный sitekey Turnstile (нужен только сборке web) |
| `VITE_SENTRY_DSN` | нет | публичный DSN Sentry |
| `VITE_DEPAY_INTEGRATION_ID` | нет | ID интеграции Depay |
| `CODECOV_TOKEN` | нет | app.codecov.io → репозиторий → Settings. Без токена upload уходит в tokenless-режим; падение загрузки CI не ломает |
| `CODEBERG_TOKEN` | для зеркала | codeberg.org → Settings → Applications → токен со скоупом `write:repository` |
| `GITLAB_TOKEN` | для зеркала | GitLab → Access Tokens → Maintainer + `write_repository` |

`GHCR_*` больше не нужен: образы идут в ghcr.io по встроенному `GITHUB_TOKEN`
(`permissions: packages: write`), это уже проставлено в `deploy.yml`.

### 2. Variables (Settings → Secrets and variables → Actions → Variables)

| Переменная | Значение | Зачем |
|---|---|---|
| `PRIMARY_FORGE` | `github` | **рубильник переезда** |
| `BUILD_RUNNER` | `["ubuntu-latest"]` | необязательно. Меняет раннер сборки. По умолчанию `["self-hosted","macOS","ARM64"]` — Mac с тёплым кешем |
| `CODEBERG_REPO`, `CODEBERG_USER`, `GITLAB_REPO` | — | необязательны, если зеркала переименованы |

### 3. Раннер сборки (Mac)

Сборка идёт на self-hosted Mac, потому что там между запусками живут тёплый
BuildKit-кеш (`$HOME/gomo6-buildx-cache/<service>`) и cache-mounts из
Dockerfile'ов. Это то, что даёт ~60 секунд на web-only коммит.

- Нужен **отдельный** агент `actions-runner` от GitHub. `forgejo-runner` не
  подходит — это другой протокол.
- Метки, которые ожидает `deploy.yml`: `self-hosted`, `macOS`, `ARM64`
  (GitHub проставляет их сам для macOS-ARM агента).
- **Один агент = один job за раз.** Чтобы 4 сервиса собирались параллельно,
  зарегистрируйте 4 инстанса (`actions-runner`, `actions-runner2`, …), каждый
  со своим каталогом и именем. С одним агентом matrix отработает
  последовательно — корректно, просто дольше.
- Docker Desktop на Mac должен быть запущен: сборка использует локальный
  демон и `buildx`.
- Форки: `deploy.yml` срабатывает только на push/руками, PR-проверки идут на
  GitHub-hosted, поэтому код форков на Mac не попадает.

Если не хочется держать агент — поставьте `BUILD_RUNNER=["ubuntu-latest"]`.
Всё соберётся на GitHub-hosted, но каждый билд будет холодным: персистентных
cache-mounts там нет, `go build` поедет заново.

### 4. Пакеты ghcr.io — публичные

`docker-compose.yml` уже ссылается на `ghcr.io/elcrazycol/gomo6-*`, но VPS
тянет образы **анонимно**, поэтому пакеты должны быть публичными. После первой
сборки: профиль `elcrazycol` → Packages → каждый `gomo6-*` → Package settings →
Change visibility → Public.

### 5. Права Actions и защита ветки

- Settings → Actions → General → Workflow permissions: **Read and write**
  (нужно `release.yml` для пуша CHANGELOG).
- Settings → Branches → правило для `main` → обязательные чеки (в UI выбираются
  **отображаемые имена** джобов):
  `Go · build · vet · fmt · test`, `Go · lint · vuln`,
  `Frontend · tsc · eslint · vitest · build`, `Secrets scan`, `Dockerfile lint`.
  **`Images · … (build only)` обязательным не делайте** — он скипается, когда
  docker-файлы не менялись, а скипнутый обязательный чек блокирует merge.
- Форки: включите «Require approval for all outside collaborators», если
  начнёте принимать внешние PR.

### 6. Codecov (опционально)

Поставьте Codecov GitHub App на репозиторий; `codecov.yml` в корне уже
настроен на флаги `backend` / `frontend`. Если покрытие приедет с путями
`src/...` вместо `apps/web/src/...` — поправьте `fixes:` в `codecov.yml`,
это известная возня с путями у Vitest.

## Порядок переезда

1. Закоммитить `.github/` (можно сразу — `ship`, `mirror`, `release` выключены:
   `PRIMARY_FORGE` не равна `github`). Проверки на PR начнут работать.
2. Прогнать CI на PR и посмотреть, что он честно скажет. В репо есть
   **предсуществующие** ошибки TS и Go-линта — новый CI их покажет, потому что
   мы ничего не глушим. Их придётся либо починить, либо явно исключить.
3. Создать секреты и переменные из п. 1–2, поднять `actions-runner`,
   сделать пакеты ghcr публичными.
4. Проверить сборку вручную: `deploy.yml` → Run workflow → `services: web`.
   Убедиться, что образ появился в ghcr.io и сервис поднялся на VPS.
5. Поставить `PRIMARY_FORGE=github`.
6. Сделать GitHub каноном:
   - на VPS в `/root/gomo6.2`: `git remote set-url origin https://github.com/elcrazycol/gomo6.2.git`;
   - **выключить или удалить `.forgejo/workflows/mirror.yml`**, иначе два
     зеркала с `--force` начнут гонять refs по кругу;
   - выключить `.forgejo/workflows/deploy.yml` и `coverage.yml`, чтобы не было
     двойного деплоя;
   - локально: `git remote set-url origin git@github.com:elcrazycol/gomo6.2.git`.
7. Обновить README/AGENTS.md/CONTRIBUTING.md/docs/wiki (там сейчас ~50
   упоминаний Codeberg, бейджи и ссылки на реестр).

## Что важно не сломать

- **Не тащите авто-issue из `.github(old)`.** `codeql-issues.yml` и `trivy.yml`
  за неделю наделали 481 issue (455 ботовых). `security.yml` запускает те же
  сканеры, но пишет только SARIF в Security.
- **PAT, которым зеркало пушит на GitHub, должен иметь скоуп `workflow`** —
  иначе первый же push файлов из `.github/workflows/` отклонится с
  `refusing to allow a Personal Access Token to create or update workflow`.
  Локальный токен аккаунта `elcrazycol` этого скоупа сейчас не имеет.
- **`restart-service.sh` не менялся.** Новый деплой зовёт его с
  `REG=ghcr.io/<owner>`, совпадающим с `COMPOSE_NAMESPACE`, поэтому внутренний
  `docker tag` вырождается в no-op. Так старый и новый пайплайны сосуществуют
  без правок общего скрипта.
- **README/AGENTS.md** в репозитории всё ещё описывают Codeberg-пайплайн — они
  станут неверными сразу после переключения `PRIMARY_FORGE`.

## Откат

```bash
# один сервис на предыдущий снимок
ssh root@VPS "REG=ghcr.io/elcrazycol COMPOSE_NAMESPACE=ghcr.io/elcrazycol \
  TAG=sha-<commit> bash /tmp/gomo6-restart-service.sh web"

# полностью вернуться на Codeberg-пайплайн
#   Variables → PRIMARY_FORGE = (пусто) (или удалить)
#   в /root/gomo6.2 вернуть origin на codeberg.org и включить .forgejo-воркфлоу
```
