# Security Audit — gomo6.wtf — 12.08.2026

**Объект:** https://gomo6.wtf (прод), VPS `root@gomo6.wtf`, монорепо `/root/gomo6.2`
**Методология:** black-box → gray-box → white-box (полный цикл, авторизованный аудит)
**Тестовые данные:** 3 временных аккаунта (`secaudit_a1/b2/c3`), созданы напрямую в БД с подписанными на сервере JWT, **полностью удалены после тестов** (проверено: 0 остатков).
**Предыдущий аудит:** docs/SECURITY_AUDIT_2026.md (06.08.2026) — все его критические/высокие находки (H1 IDOR, H2 mass-assignment, H2.1/H2.2 upload, C1/C2 drops) **подтверждены исправленными на проде**.

---

## 1. Executive summary

| Категория | Итог |
|---|---|
| Критические | 0 |
| Высокие | 0 |
| Средние | 0 (M1 исправлен 12.08.2026) |
| Низкие | 0 (L1/L2 исправлены 12.08.2026) |
| Инфо | 2 (слабый пароль БД, Turnstile 600010); I1 npm audit — исправлен 12.08.2026 |
| Attack chains до takeover/RCE/утечки БД | не обнаружены |
| Заявления о безопасности | соответствуют реальности (messenger = server-side AES-GCM, не E2EE — задокументировано честно) |

**Вердикт: платформа безопасна для текущего масштаба.** Критических и высоких уязвимостей не выявлено. Архитектура защиты зрелая: fail-closed RLS + server-side authorization, строгая валидация на уровне кода, разумный rate limiting, запрет на всё лишнее снаружи (наружу торчат только 22/80/443). Все находки аудита (M1, L1, L2, I1) **исправлены и проверены тестами** в день аудита; остались только Info-пункты (ротация пароля БД, наблюдение по Turnstile).

---

## 2. Black-box

### Recon
- **Поверхность:** `gomo6.wtf`, `docs.gomo6.wtf`, `dev.gomo6.wtf` → один VPS (nginx/Caddy). Наружу из портов: только **22, 80, 443** (ss). Caddy admin (2019/tcp) наружу не опубликован.
- **TLS:** Let's Encrypt, валидный, HSTS `max-age=31536000; includeSubDomains`.
- **Заголовки:** Strict-Transport-Security, CSP (production), X-Content-Type-Options, frame-options — присутствуют. CORS: **без reflection** (allow-origin только свои домены).
- **API-поверхность** извлечена из JS-бандла (деплой без sourcemap — `.js.map` → 404).
- **Доступно анонимно:** `/api/v1/boards`, `threads`, `posts`, `profiles`, `/api/v1/search`, `/api/v1/messenger/conversations` (401 без auth)… Проверено по каждому типу таблиц (gomosub_*, user_roles, profile_customization) — **все 401**.
- **Остальное анонимно:** 401/403 (fail-closed).

### Пробы
- **Turnstile защищает register/login** (403 без токена; в браузере managed-challenge недоступен автоматике — код 600010). Это фича, не баг: автоматическая регистрация массовая невозможна. Но и легитимным пользователям с блокировщиками/нестандартными браузерами вход может быть затруднён.
- **Upload:** `text/html` с `<script>` — отклонено; content-type теперь серверный; EXIF-strip подтверждён на уровне кода (H2.1/H2.2, см. white-box).
- **CSS-инъекция** в `profile_customization.username_css` — опустошена санитайзером.
- **OAuth:** authorize → consent; `redirect_uri` валидируется строго (без open redirect), PKCE S256 обязателен.
- **WS:** без auth соединение закрывается (handshake проходит, но первый же subscribe/ожидание auth завершается закрытием).
- **Service Worker:** кэширует `/storage/v1/object/*` (CacheFirst, 50 записей, 30 дней) и список conversations (NetworkFirst, 5 мин) — см. находку L2.

---

## 3. Gray-box (против прода, авторизованные аккаунты A/B/C)

| Тест | Результат |
|---|---|
| `/auth/me` с валидным JWT | OK |
| Admin-гейты (metrics, dev-эндпоинты) | 403/401 у не-админа |
| Удаление чужих постов/тредов (H1) | **403** (фикс задеплоен) |
| Messenger: чтение/подписка на чужой conversation | **403 "Not a member"** |
| Wall privacy: private profile + hidden wall для не-друга | закрыто |
| Self-join в чужой gomosub | 404 (маршрут не зарегистрирован) |
| Drops: unsigned callback / config | **503 / 401** (fail-closed, C1/C2 задеплоены) |
| WS: подписка на чужой `chat_<id>` | отклонено |
| WS: подписка на чужой `notifications_<uid>` | отклонено |
| WS: подписка на `profile_wall_<uid>` (private) | отклонено |
| WS: подписка на `profile_now_playing_<uid>` (private) | **разрешена** → находка M1 |
| HTML-загрузка с обманным content-type | отклонено |
| CSS-инъекция | заблокировано |

---

## 4. White-box (код)

Проверено: `routes.go`, `universal_crud.go`, `posts/threads/drops` handlers, `auth/jwt.go`, `auth_cookies.go`, `query_token.go`, `rls.go`, `turnstile.go`, `upload.go`, `content_security.go`, `strip_metadata.go`, `messenger.go` (crypto), `websocket/{hub,client,handler,spotify_poller}.go`, `oauth_flows.go`, `data_cache.go`, `global_rate_limit.go`, `auth_register_login.go`.

### Что подтверждено как защищённое
- **Generic CRUD:** whitelist колонок (anti mass-assignment), блокировка SQL-инъекций через имена колонок, cache-invalidation.
- **RLS:** принудительный (migration 071_force_rls_messenger), серверная авторизация дублируется в коде (не полагается только на PostgREST).
- **Upload pipeline:** magic-bytes + server-side content-type, EXIF/GPS strip, лимиты, upload rate limiter.
- **Messenger:** AES-256-GCM server-side (ключ хранится серверно; НЕ E2EE — честно задокументировано в wiki/MESSENGER_SECURITY.md), RLS + membership check + ownership вложений, HKDF v2 для ключей, muted/event-id.
- **WS-хаб:** `canAccessRoom` привязывает `notifications_*`, `chat_*`, `profile_wall_*` к идентичности; public-комнаты — только фиксированный whitelist (`isPublicRoom`). Один пробел — M1.
- **OAuth:** строгая валидация redirect_uri, PKCE обязателен, consent обязателен, rate limiting (20/мин token).
- **Rate limiting (Redis):** login 10/мин/IP, register 5/мин/IP, 2FA 20/мин, auth/me 100/мин, глобальный 300/мин/IP, upload отдельный.
- **Зависимости Go (govulncheck):** 0 вызываемых уязвимостей (7 — только в импортируемых, не вызываемых пакетах).

---

## 5. Найденные уязвимости

### M1 — WebSocket-комната `profile_now_playing_<user_id>` игнорирует `private_profile` (Medium, privacy) — ✅ ИСПРАВЛЕНО 12.08.2026
- **Где:** `websocket/hub.go` → `canAccessRoom`: `case strings.HasPrefix(room, "profile_now_playing_"): return true` — **любой авторизованный** пользователь подписывался на комнату любого другого.
- **Эффект:** реальное время прослушивания музыки (Spotify) + трек пользователя, **включая владельцев private-профилей**. Плюс: подписка делала жертву «релевантной» для `SpotifyPoller` (getRelevantUserIDs учитывает зрителей комнаты), т.е. данные тянулись активнее. Деанонимизация паттерна активности в реальном времени.
- **Подтверждено:** в проде (WS-тест, подписка на чужую комнату прошла) и в коде.
- **Remediation (выполнен):** `canAccessRoom` → `canViewNowPlayingRoom`: владелец всегда, публичный профиль — всем авторизованным, private — только друзьям (зеркалит `canViewWallRoom`), nil-DB и DB-error → fail-closed. Общий хелпер `areFriends` (DRY). Добавлен `ForceUnsubscribeFromNowPlayingRooms`, вызывается из `RemoveFriend` в обе стороны (экс-друг перестаёт получать события). Тесты: 7 на доступ + 4 на `areFriends` + 2 на teardown (все проходят, `go test ./...` зелёный).
- **Остаточный edge-case (закрыт 12.08.2026):** перевод `private_profile`/`private_hide_wall` на приватный при уже живой подписке постороннего рвёт её через `RevokeProfileRoomSubscriptionsFromNonFriends` (владелец/друзья остаются), вызываемый из `handlePost`/`handlePut` universal CRUD (`revokeSubscriptionsAfterPrivacyChange`). Трёхфазная реализация (снапшот под RLock → проверка дружбы вне лока → удаление под Lock), nil-DB → fail-closed. Тесты: 5 в `hub_db_test.go` + 3 в `handlers/privacy_ws_test.go`.

### L1 — Анонимный username-enumeration через `/api/v1/search?type=users` (Low) — ✅ ИСПРАВЛЕНО 12.08.2026
- **Где:** public search; анонимно возвращал `id`, `username`, `display_name`, `avatar_url` по любому запросу (`q=admin` → данные). Не уважал `private_profile`.
- **Эффект:** лёгкий enumeration пользователей и UUID. На соцсети username — публичные данные, поэтому Low.
- **Remediation (выполнен):** users-запрос в `search.go` теперь исключает `private_profile=true` для анонимов и не-друзей (владелец/взаимные друзья видят); добавлен IP-лимитер `IPRateLimitMiddleware` на `/api/v1/search` (120/мин, Redis-префикс `search` — не пересекается с auth-бюджетами). Тесты: `search_test.go` (аноним + авторизованный), `ip_rate_limit.go`.

### L2 — PWA Service Worker кэширует приватные storage-объекты (Low, privacy/retention) — ✅ ИСПРАВЛЕНО 12.08.2026
- **Где:** `apps/web/vite.config.ts` → `runtimeCaching`: `/storage/v1/object/*` — CacheFirst, 50 записей, **30 дней**; `messenger/conversations` — NetworkFirst, 5 мин.
- **Эффект:** приватные изображения (wall/uploads, которые серверно гейтятся privacy-слоем) оставались в браузерном Cache Storage **после логаута и после отзыва доступа**; на общем устройстве видны следующему пользователю. Превью переписок кэшируются 5 минут.
- **Remediation (выполнен):** urlPattern кэша storage исключает приватные бакеты `uploads`/`wall` (negative lookahead; кэшируются только публичные: avatars/post-images/content/emojis/gift-layers); имя кэша бампнуто в `storage-objects-v2`, чтобы старые записи не пережили деплой; `logout()` в `client.ts` purg'ит `storage-objects`, `storage-objects-v2` и `messenger-conversations`. Тест: `client.auth.test.ts` (purge на logout).

### I1 — npm audit: уязвимости в prod-зависимостях web (Info) — ✅ ИСПРАВЛЕНО 12.08.2026
- **Remediation (выполнен):**
  - `npm audit fix` — убраны critical/high (brace-expansion, fast-uri, nanoid, postcss и др.).
  - `react-router-dom` обновлён **6.30.4 → 7.18.2** (>= 7.17.1) во всех трёх приложениях (web/dev-dashboard/docs): v7-брейкинг исправлен (`future`-проп убран из `BrowserRouter`, `prefetch` в `PrefetchLink` переименован в `prefetchRoute` из-за нового `LinkProps.prefetch: PrefetchBehavior`). Валидация: tsc 3/3, vitest 1577/1577, сборки 3/3.
  - **`@monaco-editor/react` удалён** из dependencies — не использовался ни в одном `src` (проверено по всем 3 приложениям), но тянул транзитивный `dompurify` 3.4.8 (4 XSS-advisories). Вместе с ним исчез и monaco-editor.
  - `vite-plugin-pwa` перенесён в devDependencies (build-time tool; Docker build использует полный `npm ci`, поэтому сборка не затронута).
- **Итог:** `npm audit --omit=dev` → **0 vulnerabilities** (prod-дерево чистое). Остаток — только dev-цепочка `esbuild` (GHSA-67mh-4wv8-2f99, dev-server only): фикс = мажорный апгрейд vite@8, не влияет на прод (статический сайт за nginx).

### I2 — Слабый пароль PostgreSQL (13 символов) в docker-compose/.env (Info)
- Postgres **не проброшен** на host (наружу только 22/80/443) — эксплуатация возможна только с самого VPS. Рекомендуется ротация на сильный random (openssl rand -hex 32) + обновление в .env и пересоздание контейнера.

### I3 — Turnstile managed-challenge недоступен автоматике (600010) (Info)
- Защита работает (это цель), но легитимным нестандартным клиентам вход может быть закрыт. Наблюдение, не уязвимость.

---

## 6. Проверенные заявления о безопасности

| Заявление | Проверка |
|---|---|
| EXIF/GPS-метаданные удаляются при загрузке (H2.2) | ✅ в коде (`media/strip_metadata.go`) |
| Content-type определяется серверно (H2.1) | ✅ прод: HTML-загрузка отклонена |
| Messenger шифруется | ✅ AES-256-GCM серверно, **НЕ E2EE** — честно описано в wiki |
| RLS принудительный | ✅ migration 071, дублирование в коде |
| Приватные профили/стены | ✅ REST + WS wall-room + now_playing-room закрыты (M1, L1 фиксы задеплоены) |
| CORS не отражает origin | ✅ |
| JWT/сессии (HttpOnly cookies, 2FA, recovery codes) | ✅ в коде (migrations 026/029/042) |
| Секреты не в git | ✅ .env в .gitignore; в истории нет реальных ключей (только placeholder'ы DEPAY в plan-файлах и имя env-переменной в docker-compose — значение не коммитилось) |

---

## 7. Attack chains

Попытки построить цепочки «регистрация → privilege escalation → takeover/утечка»:
- Mass-assignment через generic CRUD → **блокирован** (whitelist).
- Подделка drops (добавление валюты) → **блокирована** (fail-closed без подписи).
- Чтение чужих переписок через REST/WS → **блокировано** (RLS + membership).
- Загрузка HTML/SVG-XSS на storage → **блокирована** (magic-bytes + server content-type).
- OAuth-цепочка (open redirect / code injection) → **блокирована** (redirect_uri whitelist, PKCE).
- **Итог: критических цепочек не обнаружено.**

---

## 8. Remdiation plan (по приоритету)

1. ~~[M1] Закрыть `profile_now_playing_*` для private-профилей~~ — **выполнено 12.08.2026** (коммит 80646d11: canAccessRoom + teardown на unfriend/privacy-toggle).
2. ~~[L1] Исключить private-профили из анонимного поиска + rate limit~~ — **выполнено 12.08.2026** (коммит f28f3016).
3. ~~[L2] Убрать runtime-кэш приватных бакетов из SW; purge при logout~~ — **выполнено 12.08.2026** (коммит f28f3016).
4. ~~[I1] `npm audit fix` + react-router → 7.17.1+~~ — **выполнено 12.08.2026**: react-router-dom 7.18.2, `npm audit --omit=dev` → 0, неиспользуемый monaco-editor удалён. Периодический `govulncheck` в CI уже есть (`trivy.yml`).
5. **[I2] Ротация пароля PostgreSQL** *(15 мин)* — единственный открытый пункт.
6. **Открыто:** `npm audit` dev-дерево — esbuild-адвайзори GHSA-67mh-4wv8-2f99 (dev-server only) требует мажорного vite@8; не влияет на прод.

---

*Аудит проведён авторизованно, владельцем платформы. Тестовые аккаунты и данные удалены. Разрушающих воздействий на прод не производилось.*
