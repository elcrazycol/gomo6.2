# Деплой

Как gomo6 попадает в прод. Короткая версия — в [README](../../README.md), здесь детали.

## Схема

```
push в main
  │
  ├─ job `ci`            проверки на GitHub-hosted раннерах (гейт: красный CI = нет деплоя)
  ├─ job `plan`          git diff github.event.before..sha → какие сервисы пересобирать
  └─ job `ship` (matrix) по одному сервису на раннер, параллельно:
                          buildx build --push  →  ghcr.io/elcrazycol/gomo6-<service>
                          ↓
                          ssh на VPS: pull + `docker compose up -d --no-build <service>`
```

Каждый сервис выкатывается сразу, как только собрался, а не ждёт самый медленный. Деплой сериализован
(`concurrency: deploy-main`, `cancel-in-progress: false`), потому что прерванный на середине выкат оставил бы
часть сервисов на новом образе, а часть на старом.

**VPS ничего не собирает.** 1 vCPU / 1 ГБ, только `docker pull` + `docker compose up`. Образы берутся из
`ghcr.io/elcrazycol/gomo6-*` анонимно (пакеты публичные), логин на VPS не нужен.

## Что нужно на VPS

| Что | Зачем |
|---|---|
| Docker + Compose | запуск стека |
| Репозиторий в `/root/gomo6.2` (или `/home/*/gomo6.2`) | `restart-service.sh` синкает его сам; имя каталога обязательное |
| `origin` → `https://github.com/elcrazycol/gomo6.2.git` | публичный HTTPS, креды не нужны |
| `.env` рядом с `docker-compose.yml` | все обязательные переменные (ниже) |
| Свободные ~5 ГБ | образы и слои |

Обязательные переменные `.env` (те, что помечены в `docker-compose.yml` как `${VAR:?…}`): `POSTGRES_PASSWORD`,
`REDIS_PASSWORD`, `JWT_SECRET`, `MESSENGER_ENCRYPTION_KEY`, `MEILI_MASTER_KEY`. Плюс `FEDERATION_KEY` — кодом не
используется, но Compose всё равно требует непустое значение (оставьте прежнее, чтобы не трогать `.env`).

`JWT_SECRET` и `MESSENGER_ENCRYPTION_KEY` **нельзя терять и нельзя менять**: первый инвалидирует все сессии, второй —
все зашифрованные сообщения. Остальные секреты можно добить генератором: `bash scripts/generate-keys.sh --quiet .env`
(он не трогает уже заполненные значения).

## Секреты и переменные GitHub

Settings → Secrets and variables → Actions → **Secrets**:

| Секрет | Обязателен | Откуда |
|---|---|---|
| `VPS_HOST` | да | **IP-адрес сервера**, не домен: домен идёт через Cloudflare, а она не проксирует 22-й порт |
| `VPS_USER` | да | `root` |
| `VPS_SSH_KEY` | да | приватный ключ целиком, с переводом строки (`pbcopy < ~/.ssh/…`) |
| `VPS_PORT` | нет | по умолчанию 22 |
| `VITE_TURNSTILE_SITEKEY` | да | публичный sitekey Turnstile (сборка web) |
| `VITE_SENTRY_DSN` | нет | публичный DSN Sentry; без него SDK — no-op |
| `VITE_DEPAY_INTEGRATION_ID` | нет | сборка web |
| `CODEBERG_TOKEN` | для зеркала | codeberg.org, скоуп `write:repository` |
| `GITLAB_TOKEN` | для зеркала | GitLab, Maintainer + `write_repository` |
| `CODECOV_TOKEN` | нет | покрытие; без него загрузка деградирует, CI не падает |

Та же страница → **Variables**:

| Переменная | Значение |
|---|---|
| `PRIMARY_FORGE` | `github` — рубильник: пока не задана, деплой, зеркало и релизы не запускаются |
| `BUILD_RUNNER` | необязательно; по умолчанию сборка идёт на self-hosted Mac. `["ubuntu-latest"]` переводит её на GitHub-hosted (медленнее: нет персистентного кэша) |

## Что делает `scripts/restart-service.sh` (на VPS)

1. `git fetch origin main && git reset --hard origin/main` — так `Caddyfile`, `docker-compose.yml` и скрипты всегда
   актуальны. `reset --hard` не трогает неотслеживаемые файлы, поэтому `.env` и `.garage.toml` живут.
2. `docker pull <реестр>/gomo6-<service>:latest` с ретраями, под `flock`: параллельные пуллы четырёх сервисов
   гоняются внутри containerd, а на этом VPS это даёт «failed commit on ref … no such file or directory».
3. Ретаг в имя из `docker-compose.yml` (`REG` и `COMPOSE_NAMESPACE` совпадают → шаг вырождается в no-op).
4. `docker compose up -d --no-build <service>` — пересоздаёт только этот контейнер.
5. `docker image prune -f`.

Флаг `CADDY_CHANGED=true` (его ставит только web-нога) дополнительно перезапускает Caddy: `Caddyfile`
примонтирован, и Compose не замечает правку содержимого.

## Пакеты ghcr

VPS тянет образы **анонимно**, поэтому пакеты должны быть публичными: профиль `elcrazycol` → Packages → каждый
`gomo6-*` → Package settings → Change visibility → **Public**. Новые пакеты создаются приватными.

Если в `/root/.docker/config.json` остался старый `auths.ghcr.io` (например, от прежнего пайплайна), Docker будет
слать устаревшие креды вместо анонимного запроса и получит `denied`, даже когда пакет публичный. Лечится одной
командой:

```bash
ssh root@VPS 'docker logout ghcr.io'
```

## Первый деплой после смены схемы

`MEILI_MASTER_KEY` обязателен для Compose, а `.env` на сервере мог его не иметь. Если его нет, интерполяция Compose
падает и **ни один** сервис не перезапустится (и откат по тегу не поможет — compose всё равно не соберётся).
Поэтому перед первым выкатом с Meilisearch:

```bash
ssh root@VPS 'cd /root/gomo6.2 && grep -q "^MEILI_MASTER_KEY=." .env || echo "MEILI_MASTER_KEY=$(openssl rand -hex 32)" >> .env'
ssh root@VPS 'cd /root/gomo6.2 && docker compose config >/dev/null && echo "compose OK"'
```

## Индексы поиска

Индекс объявлен расходным: он живёт в Meilisearch и пересобирается из Postgres. Пересобирать нужно после смены
схемы/настроек индекса или после восстановления БД:

```bash
ssh root@VPS 'cd /root/gomo6.2 && docker compose run --rm -T backend ./reindex'
```

Готовность движка видна в `/ready`: `{"search":true|false}`. В деплой-воркфлоу есть ручной запуск с галочкой
`reindex` (Actions → Deploy → Run workflow).

## Откат

```bash
# один сервис на точный снимок прошлого деплоя
ssh root@VPS "REG=ghcr.io/elcrazycol COMPOSE_NAMESPACE=ghcr.io/elcrazycol \
  TAG=sha-<commit> bash /tmp/gomo6-restart-service.sh web"

# весь стек: тот же пуш, но с нужной версией кода
git revert <commit> && git push        # VERSION входит в список «пересобрать всё»
```

Каждый деплой вешает на образ три тега: `:latest`, `:v<версия из VERSION>` и `:sha-<commit>`.

## Ручной деплой с нуля

```bash
git clone https://github.com/elcrazycol/gomo6.2.git && cd gomo6.2
cat > .env <<'EOF'
DOMAIN=your-domain.com
JWT_SECRET=<openssl rand -hex 32>
MESSENGER_ENCRYPTION_KEY=<openssl rand -hex 32>
REDIS_PASSWORD=<openssl rand -hex 16>
POSTGRES_PASSWORD=<openssl rand -hex 16>
ENVIRONMENT=production
ALLOWED_ORIGINS=https://your-domain.com,http://your-domain.com
EOF
bash scripts/generate-keys.sh --quiet .env       # добивает VAPID, METRICS_TOKEN, MEILI_MASTER_KEY…
bash scripts/generate-garage-config.sh .env      # рендерит .garage.toml из .env
docker compose up -d
```

## Бэкапы перед переездом сервера

```bash
cd /root/gomo6.2
docker compose exec postgres pg_dump -U gomo6 gomo6 > gomo6_db_$(date +%Y%m%d).sql
cp .env .env.backup            # внутри JWT_SECRET и MESSENGER_ENCRYPTION_KEY
```

Восстановление: `docker compose up -d postgres`, затем `psql < dump.sql`, затем `docker compose up -d` и `reindex`.

## Типичные грабли

| Симптом | Причина и лечение |
|---|---|
| `error from registry: denied` при pull | пакет приватный **или** на VPS остались старые креды → Change visibility → Public и `docker logout ghcr.io` |
| Compose не интерполируется, деплой не применяется | нет обязательной переменной в `.env` (обычно `MEILI_MASTER_KEY`) → `docker compose config` покажет какая |
| «База для diff недоступна» в `plan` | force push или первый push в ветку → пересобираются все сервисы, это ожидаемо |
| Тег не деплоит | так и задумано: `tags-ignore: ['**']`, версия в образе берётся из файла `VERSION` |
| Правка только документации не деплоит | тоже задумано: `plan` видит, что ни один сервис не изменился |
| Битый образ на VPS, старый контейнер жив | `restart-service.sh` выходит на шаге pull до любых манипуляций с контейнерами — прод продолжает работать |
