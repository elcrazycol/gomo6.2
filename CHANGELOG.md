# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.0] — 2026-08-30

ActiEye — «око, следящее за активностью» — на странице профиля и компактная X-стиль статистика.

### Added
- **ActiEye** — круг на странице профиля, «око, следящее за активностью»:
  - Радиальный градиент без острых углов: цвета мягко перетекают кольцами и напрямую зависят от активности владельца (записи, комментарии, лайки, заходы); каждому цвету гарантирован минимум, чтобы ни один не пропадал
  - **Интенсивность честно отражает активность**: неактивный аккаунт — приглушённый, тусклый круг, живой — сочный и яркий (лог-шкала, чтобы числа не раздувались)
  - Стабильный сид на пользователя (FNV-хеш) задаёт начальный поворот и слегка смещает центр градиента; медленный hue-дрейф переливает палитру — не кручение, только передивание цветами
  - Клик открывает минималистичную панель: текущая и лучшая серия заходов + скроллируемая **«дорога»** дней со дня регистрации — зелёные кружки за посещённые дни, серые за пропущенные, соединённые хаотичными волнообразными линиями
- **Новый эндпоинт** `GET /api/v1/actieye` (авторизованный, вне data-кэша) с новым пакетом `internal/actieye` — всё считается на лету из уже существующих таблиц (счётчики профиля + `user_daily_visits`), без отдельного журнала событий

### Changed
- **Статистика профиля переработана в X-стиль**: вместо пяти плиток-квадратов — одна минималистичная строка «записи/комментарии · лайков · просмотры · гарма» (число + подпись, разделители-точки, ховер — мягкая тень текста), а справа к ней прижат кружок ActiEye
- Звонок/превью студии оформления профиля обновлены под тот же макет

## [2.1.0] — 2026-08-27

Текстовые каналы в GomoSubs: Discord-style чат внутри канала гомосаба.

### Added
- **Текстовые каналы (чат)** — новый вид канала наряду с «Форумом»: живой обмен сообщениями внутри канала гомосаба, отдельно от мессенджера:
  - Виртуализированный список сообщений (рендер только видимых строк, `@tanstack/react-virtual` — тот же узор, что в мессенджере) с подгрузкой более ранних при прокрутке вверх и прилипанием к низу
  - Realtime через WebSocket: новые сообщения, правка и удаление приходят мгновенно; комната канала авторизуется тем же предикатом, что и REST-история (приватные каналы не текут через подписки)
  - Права как договорено: чтение как у форум-каналов; пишут только члены гомосаба (приватные каналы — ещё и роль с `can_write`); удаление чужих — владелец или роль с `can_delete_threads`
  - Свободная правка своих сообщений с меткой «изменено», мягкое удаление, кнопка «вниз» со счётчиком новых при прокрутке вверх
  - Собственный бюджет rate-limit `CHANNELCHAT_RATE_LIMIT_READ`/`WRITE` (300/120 в минуту, настраивается без пересборки)
  - Выбор вида канала при создании в настройках гомосаба; в интерфейсе текстовые каналы помечены 💬

### Fixed
- **История чата не отдавалась из устаревшего кеша**: после отправки сообщений перезагрузка страницы показывала закешированный пустой/частичный снимок (`gomosubchat` теперь исключён из DataCache, как и messenger)
- **Клавиатура на мобильных работает нативно**: чат живёт в обычном document-flow и скроллится по окну, поэтому iOS/Android сами поднимают композер при фокусе — без fixed-рамок, translate и других хаков, из-за которых контент телепортировался и дёргался

## [2.0.0] — 2026-08-27

Второе поколение gomo6: мессенджер и профили переработаны с нуля, добавлены студия оформления, переводы, достижения, анти-бот защита — и, наконец, честное версионирование.

### Added
- **Продукт-версионирование (SemVer)** — первый по-настоящему номерной релиз после `v1.0.0`:
  - `VERSION` файл в корне репо — единственный источник версии (без дублей в package.json); вшивается в бэкенд через ldflags и в web-сборку через build-args на этапе деплоя
  - Версия показывается в футере сайта рядом с commit hash и отдаётся в `/health` на бэкенде
  - Docker-образы тегируются `:latest`, `:vX.Y.Z` и `:sha-<commit>` (последний — для откатов), инструкция по релизу — в `CONTRIBUTING.md`
- **Студия профиля** — всё оформление профиля в одном месте: фоны, авто-тема из фона/аватара, генерация темы по доминантному цвету (5 вариантов палитры)
- **Мессенджер v2** — полная переделка на уровне Discord/Telegram: шифрование диалогов, real-time редактирование сообщений, Telegram-style UI, пагинация истории, мобильные sheet-взаимодействия
- **Авторизация**: passkeys (WebAuthn), TOTP 2FA, refresh-токены, блокировка входа, recovery codes
- **Анти-бот**: mCAPTCHA (Proof-of-Work) + HoneyPot на входе и регистрации
- **Достижения**: новая система — карточки, автораскрытие, уровни, секретные достижения, SVG-иконки
- **OpenAPI спецификация** + автогенерация TS-типов — `client.ts` собран на типах из спеки вместо рукописных интерфейсов
- **Эмодзи**: паки, создание/редактирование через UI, модерация, кастомные бейджи
- **GomoSubs «g»**: комьюнити-доски с каналами, создание через Go-бэкенд, приглашения по коду, mobile-first sheet UX
- **Фоторедактор v2**: кадрирование с пресетами, размытие, ретушь, экспорт и загрузка до публикации поста
- WebSocket real-time синхронизация постов в тредах

### Changed
- **Бэкенд**: большой монолитный файл (20k+ строк) разбит на десятки пакетов (`internal/*`); миграционный раннер вместо хардкод-DDL; единый формат ответов `{success, data}`
- **Страница профиля и стена** переработаны
- **Интернационализация**: UI переведён с хардкода на i18n (i18next), community-переводы хранятся и отдаются с бэкенда, добавлена страница перевода; «Threads» переименованы в «Записи» по всему интерфейсу
- **Деплой** переехал с GitHub Actions на **Codeberg Actions + Codeberg container registry**:
  - Change detection через Codeberg compare API — no-op коммиты завершаются за ~1s
  - Инкрементальный checkout в персистентный кэш раннера (~47s → ~2-10s)
  - `docker buildx build --push` с дедупликацией слоёв — по сети едут только изменённые слои
  - Per-service рестарт на VPS через `scripts/restart-service.sh` (pull → retag → `compose up -d --no-build`; flock-сериализация + ретраи)
  - Полное время деплоя: ~4 мин → ~1 мин
- Бэкенд-бинарник сжат (`-ldflags="-s -w"`): 30 MB → 16 MB

### Fixed
- Ошибки сети в RPC больше не вызывают необработанные promise rejections (единый try/catch)
- PUT/DELETE `/table/:id` корректно применяет ID из пути как WHERE-фильтр
- Mobile: композер над клавиатурой, swipe-жесты, iOS-кейсы
- Кэш-инвалидация при смене каналов и профилей (stale-данные)

### Security
- RLS на messenger-таблицах + транзакции с `set_config` контекстом
- Шифрование сообщений (`MESSENGER_ENCRYPTION_KEY`)
- JWT hardening, refresh-токены, lockout, recovery codes
- Rate limiting на `/oauth/token` и `/oauth/revoke`; PKCE S256 обязателен
- mCAPTCHA (PoW) + HoneyPot для защиты от ботов

### Removed
- Supabase-интеграция окончательно выпилена (прямой Postgres + Garage S3)

---

[2.0.0]: https://codeberg.org/crazycol/gomo6.2/releases/tag/v2.0.0
[1.0.0]: https://github.com/scramble22/gomo6.2/releases/tag/v1.0.0

## [1.0.0] — 2026-05-24

### Added
- Auto-deploy to VPS via GitHub Actions on green CI (`deploy.yml` + `deploy-vps.sh`)
- Commit hash displayed in site footer (hover for full SHA)
- `.env` preservation during deploy (backup/restore + trap on failure)
- Self-locating repo path in deploy scripts (no hardcoded directories)
- Pre-commit CI script: `./scripts/ci-local.sh [quick|full]`
- CI and Deploy status badges in README
- `corsOrigins()` function for S3 CORS configuration

### Changed
- All OAuth redirect URLs now use `https://` (ISSUER_URL, FRONTEND_URL, DEV_DASHBOARD_URL)
- Stats page migrated to Go backend with `user_id` filter
- Refactored `client_simple.ts` → `auth.ts` + `dataApi.ts` + `supabaseCompat.ts`
- Refactored `dataApi.ts` → `query-builder.ts` + `rpc.ts` + `storage.ts`

### Fixed
- RPC network errors no longer cause unhandled promise rejections (unified try/catch)
- PUT/DELETE `/table/:id` correctly uses path ID as WHERE filter
- `BoardRouter.tsx`: `profilesResponse` → `profileResponse` (TS2552)
- `Board.tsx`: empty `catch {}` blocks now properly commented (ESLint `no-empty`)
- `upload.go`: all error strings lowercase (Go convention ST1005)
- `rpc.go`: `optionEntry` struct literal → type conversion (S1016)
- `corsOrigins` undefined (missing function referenced in tests)

### Security
- `.env` removed from git tracking (was committed with Supabase keys)
- OAuth mixed content blocked by browser — all redirects now HTTPS
- Caddy auto-provisions Let's Encrypt TLS certificates in production

### Removed
- Supabase integration (replaced by direct Postgres + Garage S3)

---
