# Комплексный аудит безопасности gomo6 — август 2026

Дата: 06.08.2026
Область: `apps/backend-go` (Go + Gin + PostgreSQL + Redis + Garage S3) и `apps/web` (React 18 + Vite + Tailwind).
Метод: ручной анализ кода (стат-аудит), проверка маршрутов, миддлварей, RLS-политик, WebSocket-хаба, кэш-слоя и фронтенд-приёмников.

---

## Резюме

| Уровень | Кол-во | Ключевое |
|---|---|---|
| 🔴 Критический | 2 | Бесплатная накрутка валюты drops (подпись DePay не проверяется / ручное подтверждение) |
| 🟠 Высокий | 3 | IDOR в gomosub-управлении; обход 2FA через «доверенное устройство»; настройки приватности стены не применяются |
| 🟡 Средний | 8 | Отключение 2FA без переаутентификации; токены в localStorage; DoS блокировки аккаунта; enum-пользователей; TOTP-брутфорс; и др. |
| 🟢 Низкий | ~13 | Спам, утечки присутствия, CSS-инъекции, мелкие баги |

## Статус исправлений (06.08.2026)

| Находка | Статус | Что сделано |
|---|---|---|
| H2 — обход 2FA через `device_id` | ✅ Исправлено | Сервер выдаёт случайный `device_token` (256 бит), хранится только SHA-256, пароль требуется всегда; `localStorage` — остаток M5 |
| H3 — стена/аватар/статистика для публичных профилей | ✅ Исправлено (стена, аватар, статистика) | Предикаты `private_hide_wall` в REST/WS/медиа/записи + `private_hide_avatar`/`private_hide_stats` в `/profiles`; миграции 082/083 с бэкфиллом дефолтов |
| M1 — 2FA без переаутентификации | ✅ Исправлено | Setup требует текущий пароль; disable требует TOTP/recovery-код; per-account throttle (5 попыток/15 мин) на setup/disable/смену пароля |
| M2 — смена пароля не отзывает сессии | ✅ Исправлено (с оговоркой) | Revoke чужих refresh-токенов + `DELETE user_sessions` + `InvalidateAuthCache`; остаточное окно: stateless access-JWT живёт до 1 ч (jti не трекаются серверно) |
| M3 — DoS блокировки + enum пользователей | ✅ Исправлено | Lockout проверяется только для существующих аккаунтов, ответ 429→401 «Invalid credentials» (неотличим) |
| M7 — `/ws/stats` без роли | ✅ Исправлено | `adminOnlyMiddleware` (роль `admin` из `user_roles`) |
| L7 — вход по email не работал | ✅ Исправлено | `WHERE username = $1 OR email = $1` |
| M4 — брутфорс TOTP | 🟡 Частично | Per-attempt lockout по jti partial-токена (5 неудач → логин заново); partial-токен остаётся переиспользуемым в окне 5 мин |
| H1 — IDOR в gomosub-управлении | ✅ Исправлено | Board-привязка WHERE во всех 4 gomosub-таблицах (PUT/DELETE) + запрет role_id при self-join + валидация role_id по board; 7 тестов |
| M5 — токены в localStorage | ✅ Исправлено | HttpOnly cookies (SameSite=Strict + CSRF double-submit) для браузера; access/refresh только в памяти; WS читает cookie; getSession восстанавливает токен после reload; dev-dashboard на in-memory; device_token остаётся в localStorage (не access/refresh) |
| C1/C2 — накрутка валюты через DePay | ✅ Исправлено | Callback fail-closed (нет ключа/подписи → reject), DropsConfig с auth + привязкой user_id к сессии, ManualVerify только admin; 23 теста |
| L5 — сиротские комментарии стены | ✅ Исправлено | INNER JOIN на пост в чтении (сироты отбрасываются) + fail-closed запись (нет поста/комментария → 404) + блокировка post_id в PUT комментария; 7 тестов |
| L6 — CSS-инъекция через кастомизацию профиля | ✅ Исправлено | Серверный allow-list санитайзер CSS на записи И чтении (url/expression/@-rules/position/z-index/!important вырезаются); badge_text: кап 60 + control-char; 8 тестов |
| M6, L1–L4, L8–L15 | ⬜ Не исправлено | См. секции ниже |

Положительные стороны (уже хорошо):
- JWT подписан HS256, проверяется `alg`, blacklist в Redis fail-closed, refresh-токены ротируются.
- CSRF через double-submit cookie + `SameSite=Strict`; HttpOnly cookies для браузера.
- Пароли — bcrypt cost 12; HIBP k-anonymity; honeypot-поля на register/login.
- Messenger: шифрование AES-256-GCM на уровне полей, FORCE RLS с `SET LOCAL` в транзакциях, проверка членства на чтение/запись/подписку, force-unsubscribe при выходе.
- Медиа: private-бакеты проверяют членство/право на стену; ownership-префиксы ключей; `ValidateObjectKey` против path traversal.
- OAuth: `redirect_uri` валидируется против зарегистрированных; PKCE; секреты bcrypt.

---

## 🔴 Критические уязвимости

### C1. Бесплатная накрутка валюты: `/api/v1/drops/callback` не проверяет подпись при её отсутствии

**Файл:** `apps/backend-go/internal/api/handlers/drops.go` → `DropsCallback`

**Проблема.** Webhook DePay проверяет подпись **только если заголовок `x-signature` присутствует**. Если заголовка нет — пишется `WARNING` в лог и обработка **продолжается**:

```go
if h.publicKey != nil {
    sigHeader := c.GetHeader("x-signature")
    if sigHeader == "" {
        log.Printf("[Drops] WARNING: No signature on callback")   // ← не reject!
    } else { ... verify ... }
} else {
    log.Printf("[Drops] WARNING: No public key loaded, skipping callback signature verification")
}
```

Аналогично при `DEPAY_PUBLIC_KEY` не задан в env — проверка пропускается целиком.

**Эксплуатация.** Любой атакующий отправляет:
```json
POST /api/v1/drops/callback
{"transaction": "<уникальный tx_hash>", "blockchain": "ethereum", "payload": {"user_id": "<жертва/я>", "drops_amount": 100000}}
```
Drops начисляются без какой-либо оплаты. Дедупликация только по `tx_hash` (контролируется атакующим). `drops_amount` ≤ 100000 за вызов.

**Влияние:** неограниченная эмиссия внутриигровой валюты; покупка подарков, переводы, экономический коллапс; при накрутке жертве — фрод-риски.

**Фикс:** отсутствие подписи = `401` (fail-closed). Если `DEPAY_PUBLIC_KEY` не сконфигурирован — не принимать webhook вообще. Ограничить max amount, проверять соответствие `drops_pending`.

**Статус: ✅ ИСПРАВЛЕНО.** `DropsCallback` теперь fail-closed: `DEPAY_PUBLIC_KEY` не загружен → `503`; заголовок `x-signature` отсутствует → `401`; подпись не декодируется/не проходит PSS-проверку → `401`. Дедупликация по `tx_hash` дополнительно защищена UNIQUE-constraint (миграция 048): при гонке двух одинаковых callback второй INSERT упадёт → rollback, двойное начисление невозможно. Тесты: `TestDropsCallback_RejectsMissingSignature`, `TestDropsCallback_RejectsBadSignature`, `TestDropsCallback_RejectsWhenKeyMissing`, `TestDropsCallback_ValidSignature_CreditsDrops` (позитивный флоу не сломан), `TestDropsCallback_ValidSignature_RejectsDuplicateTx`.

---

### C2. Бесплатная накрутка валюты через `/api/v1/drops/config` + `/api/v1/drops/manual-verify`

**Файл:** `apps/backend-go/internal/api/handlers/drops.go` → `DropsConfig`, `ManualVerify`

**Проблема.** `DropsConfig` (публичный, без аутентификации и без обязательной подписи) создаёт запись `drops_pending` для **любого** `user_id`:

```go
INSERT INTO drops_pending (user_id, drops_amount, price_usd) VALUES ($1, $2, $3)
```

А `ManualVerify` (любой аутентифицированный пользователь) начисляет drops по **своей** pending-записи, **не проверяя** ни подпись, ни платёж, ни наличие верифицированной транзакции:

```go
UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2   // pendingAmount
```

**Эксплуатация (полная цепочка без единой подписи):**
1. `POST /drops/config` `{drops_amount: 100000, user_id: <мой id>}` → создаётся pending.
2. `POST /drops/manual-verify` `{tx_hash: "fake123", blockchain: "ethereum"}` → начисление drops.

**Влияние:** то же, что C1 — свободная эмиссия валюты. Также `DropsConfig` позволяет создавать pending на чужого пользователя.

**Фикс:** `ManualVerify` — только для админов или только с проверенной подписью/ончейн-верификацией; `DropsConfig` — требовать валидную подпись либо аутентификацию и привязку `user_id` к сессии.

**Статус: ✅ ИСПРАВЛЕНО.** `DropsConfig` принимает запросы только аутентифицированными путями (dual-mode): (а) валидная подпись DePay (`x-signature`, server-to-server прокси от платформы DePay — у неё нет браузерных cookie) или (б) браузерная сессия (`OptionalAuthMiddleware` читает HttpOnly cookie/Bearer) с привязкой `user_id` к `claims` — чужой `user_id` → `403`. Анонимный unsigned запрос → `401`. `ManualVerify` проверяет роль `admin` через `user_roles` (`403` для обычных пользователей). Тесты: `TestDropsConfig_RequiresAuth`, `TestDropsConfig_AuthenticatedOwnUser_Allowed` (позитивный браузерный флоу), `TestDropsConfig_RejectsForeignUserID`, `TestDropsConfig_UnsignedWithoutAuth_Rejected`, `TestDropsConfig_SignedForeignUser_Allowed`, `TestDropsConfig_BadSignature_RejectedWithoutAuth`, `TestManualVerify_RequiresAdmin`. **Остаток:** `ManualVerify` не требует подписи/ончейн-верификации (admin может начислить вручную) — осознанно, это операция доверенного админа.

---

## 🟠 Высокие уязвимости

### H1. IDOR в управлении gomosub: контекст разрешений оторван от целевой строки

**Файл:** `apps/backend-go/internal/api/handlers/universal.go` → `checkGomosubWritePermission` + `universal_crud.go` → `handlePut`/`handleDelete`

**Проблема.** Разрешение проверяется по `board_id` из query/body, но сам UPDATE/DELETE **не проверяет**, что целевая запись (`id` из URL) принадлежит этому `board_id`. Любой модератор своего gomosub (права `can_manage_channels`/`can_manage_roles`/`can_manage_members`) может модифицировать/удалять **любые** строки платформы:

```
PUT /api/v1/channels/<чужой-channel-id>?board_id=<своя-доска>  { ... }
DELETE /api/v1/gomosub_roles/<чужой-role-id>?board_id=<своя-доска>
```

`checkGomosubWritePermission` подтвердит право на **свою** доску, а `handlePut` выполнит `UPDATE channels SET ... WHERE id = <чужой>`.

**Влияние:** порча/удаление чужих каналов, ролей, прав, участников в любом сообществе.

**Фикс:** в WHERE добавить `board_id = <board из контекста разрешения>` (или проверять принадлежность записи до изменения).

**Статус: ✅ ИСПРАВЛЕНО.** В `handlePut`/`handleDelete` добавлена обязательная board-привязка для всех 4 gomosub-таблиц (`channels`, `gomosub_roles`, `gomosub_memberships` — `board_id = $n`; `channel_permissions` — `channel_id IN (SELECT id FROM channels WHERE board_id = $n)`, т.к. колонки `board_id` там нет). Cross-board UPDATE/DELETE теперь не находит строк (404). Дополнительно: self-join `gomosub_memberships` с `role_id` отклоняется (403) — нельзя самоповыситься до привилегированной роли; `role_id` при назначении роли обязан принадлежать board мембершипа. Фронтенд (`GomoSubSettings.tsx`) теперь передаёт `board_id` во все management-вызовы. Тесты: 7 новых кейсов в `universal_test.go`. **Остаток (вне H1, пре-существующий):** универсальный self-join POST в `gomosub_memberships` позволяет вступить в любую доску, включая приватные, без приглашения — проверка видимости живёт во фронтенде и invite-хендлере `boards.go`, а не в generic-хендлере; рекомендуется закрыть отдельно.

---

### H2. Обход 2FA через «доверенное устройство» с контролируемым клиентом `device_id`

**Файлы:** `apps/backend-go/internal/api/handlers/auth_register_login.go` → `Login`; `auth_2fa.go` → `Verify2FA`, `trustDevice`

**Проблема.** 2FA пропускается, если в теле запроса приходит `device_id`, присутствующий в `trusted_devices` пользователя. Но `device_id` — **произвольная строка, выбираемая клиентом** (`localStorage` фронтенда, никакой криптографии/серверного токена):

```go
if req.DeviceID != "" && trustedDevicesJSON != nil && *trustedDevicesJSON != "" {
    if expiresAt, ok := trustedDevices[req.DeviceID]; ok {
        if time.Now().Unix() < expiresAt { /* 2FA пропущен */ }
    }
}
```

Атакующий, узнавший/подобравший `device_id` (простые значения вроде `"device1"`, утечка через логи, захардкоженные значения в старых клиентах), вводит логин+пароль жертвы и **обходит 2FA**.

**Влияние:** угон аккаунта с включённой 2FA.

**Фикс:** сервер должен выдавать случайный непредсказуемый токен устройства (аналог Apple trusted devices), хранить его хэш, привязывать к сессии; при login требовать его в запросе и сверять серверно.

**Статус: ✅ ИСПРАВЛЕНО.** `trustDevice()` генерирует `randomHex(32)` (≈256 бит), в БД хранится только SHA-256, карта ограничена 20 устройствами, TTL 30 дней; на login сверяется `hashDeviceID(req.Device_token)`; токен отзывается при отключении 2FA; пароль при логине требуется всегда, так что кража токена даёт лишь пропуск 2FA, не доступ. Фронтенд хранит device-токен в `localStorage` — не access/refresh, без пароля бесполезен (см. M5, остатки).

---

### H3. Настройки приватности стены/аватара/статистики не применяются для публичных профилей

**Файлы:** `apps/backend-go/internal/api/handlers/profile_wall.go` → `profileWallFinishSelectQuery`; `profiles.go` → `GetProfile/GetProfiles`; `routes.go` → `canViewUserWall`

**Проблема.** Тумблеры `private_hide_wall`, `private_hide_avatar`, `private_hide_stats` учитываются **только** когда `private_profile = true`. Для публичного профиля:

- Стена (`profile_wall_posts`), включая фото из бакета `wall`, видна **всем аутентифицированным** (предикат: `private_profile = false` ⇒ видима; `private_hide_wall` вообще не участвует в предикате).
- Аватар/статистика (garma, post_count, thread_count) не скрываются: в `GetProfile` они стираются только в ветке `shouldFilter` (т.е. для приватного профиля).

Т.е. пользователь, который в настройках «спрятал стену», фактически не спрятал её. (Сравните: `private_hide_gifts`/`private_hide_achievements` работают и для публичных профилей — поведение непоследовательно.)

**Влияние:** ложное чувство приватности; приватный контент стены и метаданные доступны незнакомцам вопреки настройкам.

**Фикс:** включить `private_hide_wall` (и `private_hide_avatar`/`private_hide_stats`) в предикаты чтения стены/медиа/профиля независимо от `private_profile`.

**Статус: ✅ ИСПРАВЛЕНО.** Единый предикат (владелец ИЛИ [публичный И не скрыт] ИЛИ взаимный друг) применён в 4 каналах: чтение REST (`profileWallFinishSelectQuery`), запись (`enforcePostOwnership`), WebSocket-комнаты (`canViewWallRoom`), медиа-бакет `wall` (`canViewUserWall`). `private_hide_avatar`/`private_hide_stats` учтены в `GetProfile`/`GetProfiles` (друзья и владелец видят всегда). Миграции 082/083 меняют дефолты на FALSE и бэкфиллят существующие публичные строки (применяются раннером `RunMigrations`/`schema_migrations` при старте, в т.ч. на проде). Фронтенд-дефолты приведены в соответствие. **Вне скоупа:** `private_hide_threads`/`private_hide_friends` для публичных профилей остаются no-op (в UI активны только при приватном профиле); аватар-изображения отдаются из публичного бакета `post-images` без per-profile проверки — закрыть при переходе на приватные бакеты (см. M5, остатки).

---

## 🟡 Средние уязвимости

### M1. Отключение/переустановка 2FA без повторной аутентификации

**Файл:** `apps/backend-go/internal/api/handlers/auth_2fa.go` → `DisableTOTP`, `SetupTOTP`

`POST /auth/2fa/disable` и `POST /auth/2fa/setup` требуют только валидного access-токена. Скомпрометированная сессия позволяет **тихо отключить 2FA** или **подменить TOTP-секрет на свой**, после чего жертва теряет 2FA, а атакующий получает восстановленные коды. Требование текущего пароля или TOTP-кода для этих операций отсутствует.

**Статус: ✅ ИСПРАВЛЕНО.** `SetupTOTP` требует текущий пароль (bcrypt) и не заменяет включённую 2FA без disable; `VerifyAndEnableTOTP` подтверждает код перед включением; `DisableTOTP` требует TOTP- или recovery-код. Все три операции + `UpdatePassword` получили per-account throttle (`auth_action_lock:<userID>`, 5 неудач/15 мин), чтобы эндпоинты не стали парольными оракулами для держателя украденной сессии.

### M2. Смена пароля не отзывает сессии

**Файл:** `apps/backend-go/internal/api/handlers/auth_password.go` → `UpdatePassword`

После смены пароля старые refresh-токены и access-токены остаются валидными (нет `RevokeAllRefreshTokens`, blacklist, `InvalidateAuthCache`, `DELETE FROM user_sessions`). Если пароль сменён из-за компрометации, сессии атакующего продолжают жить.

**Статус: ✅ ИСПРАВЛЕНО (с оговоркой).** При cookie-сессии удаляются чужие строки `user_sessions` и чужие `refresh:<uid>:*`/`current:<uid>:*` ключи; без cookie (Bearer/API) — `RevokeAllRefreshTokens` + полный `DELETE`. Плюс `InvalidateAuthCache` (bump версии). Требуется `current_password`. **Оговорка:** access-токены — stateless JWT; при предъявлении мимо кэша они валидны по подписи до истечения (≤1 ч). Для полного закрытия нужно серверно трекать jti выданных access-токенов.

### M3. Блокировка аккаунта — DoS + перечисление пользователей

**Файлы:** `auth_register_login.go` → `Login`; `auth.go` → `recordFailedAttempt`

- Ключ блокировки `lockout:<loginIdentifier>` инкрементится только при неверном пароле; 5 неудач → 429 «Account temporarily locked» на 15 минут. Атакующий может **заблокировать аккаунт жертвы** (DoS), просто перебирая неверные пароли.
- Ответ 429 (аккаунт существует и заблокирован) против 401 «Invalid credentials» — **перечисление пользователей** по username.
- Лимит 10 req/min на IP снижает, но не устраняет атаку (IP-пулы).

**Статус: ✅ ИСПРАВЛЕНО.** Lockout проверяется только после успешного поиска пользователя (нельзя заблокировать несуществующий идентификатор), при заблокированном аккаунте возвращается 401 «Invalid credentials» вместо 429 — ответ неотличим от неверного пароля, перечисление по 429/401 закрыто. Счётчик сбрасывается при успешном пароле.

### M4. Брутфорс TOTP: нет per-account блокировки на `/auth/verify-2fa`

**Файл:** `auth_2fa.go` → `Verify2FA`

Rate limit только 20/min на IP. Нет счётчика неудач по аккаунту, нет задержки, partial-токен не single-use (его можно использовать повторно в течение 5 минут). Перебор 6-значного кода на практике трудоёмок, но политика защиты должна быть строже (например, 5 неудач → требовать логин заново).

### M5. Токены (включая 7-дневный refresh) хранятся в localStorage

**Файлы:** `apps/web/src/integrations/api/client.ts` (ключи `auth_token`, `auth_refresh_token`), `apps/web/src/integrations/api/oauth.ts` (`gomo6_oauth_tokens`), dev-dashboard `src/lib/oauth.ts`

SPA дублирует access + refresh токены в localStorage для Bearer-режима. Любой XSS на домене (или расширение/инъекция) крадёт **весь комплект сессии**, включая 7-дневный refresh с ротацией.

**Статус: ✅ ИСПРАВЛЕНО.** Браузерная сессия теперь целиком на HttpOnly cookies: `SetAuthCookies` ставит access (Path=/, 1 ч), refresh + refresh_user (Path=/api/v1/auth, 7 дней) и CSRF (`gomo6_csrf`, не HttpOnly — для JS) с `SameSite=Strict`; `AuthMiddleware`/`OptionalAuth` читают access-cookie; `/auth/refresh` и `/auth/logout` работают по HttpOnly refresh-cookie; WS-хендшейк берёт access из cookie (`ServeWs` → `cookieToken`). Фронтенд: `client.ts` ходит с `credentials:'include'`, шлёт `X-CSRF-Token` на не-GET, `removeLegacyStoredTokens()` чистит старые ключи, токены держит только в памяти; `getSession()`/`useSession()` после reload восстанавливают токен через `tryRefreshToken()` (иначе raw `fetch` с `Bearer null` давал бы 401 при валидной cookie-сессии); `oauth.ts` по умолчанию in-memory (`persistTokens:false`, opt-in с предупреждением); dev-dashboard `src/lib/oauth.ts` переведён на in-memory с очисткой legacy localStorage. **CSRF-cookie живёт 7 дней (как refresh)** — это единственный JS-читаемый hint сессии; при MaxAge=1 ч пользователь после простоя >1 ч выглядел бы разлогиненным, хотя refresh cookie ещё валиден. Bearer-режим сохранён только для не-браузерных API-клиентов и ботов.

**Осознанные остатки:** (1) `device_token` (пропуск 2FA на доверенном устройстве) хранится в localStorage — это не access/refresh, без пароля бесполезен; при желании перевести в cookie. (2) Бэкенд продолжает возвращать `token`/`refresh_token` в теле ответов login/refresh для не-браузерных клиентов (мобильные/боты/тесты); браузер их игнорирует, сессия держится на cookie.

### M6. Нет подтверждения email и нет восстановления пароля

**Файлы:** `auth_register_login.go` → `Register`; отсутствует forgot/reset-password

Регистрация сразу выдаёт полные токены; email не верифицируется и не используется для восстановления. Функции сброса пароля нет вообще. Последствия: (а) нельзя восстановить аккаунт при потере пароля (безвозвратная потеря/DoS аккаунта); (б) невозможна защита «подтверди email при входе с нового устройства»; (в) email-адреса не уникальны и не проверяются.

### M7. `/ws/stats` отдаёт список всех онлайн-пользователей любому аутентифицированному

**Файлы:** `routes.go` (комментарий «admin only in production»), `websocket/handler.go` → `GetOnlineUsers`

Эндпоинт под `AuthCacheMiddleware`, но **без проверки роли admin**. Любой залогиненный видит полный список онлайн user_id. Плюс отдельно: глобальная рассылка `user_online/user_offline` (user_id+username) всем подключённым WS-клиентам (подавляются только приватные профили) — постоянный поток присутствия всех пользователей платформы.

**Статус: ✅ ИСПРАВЛЕНО (эндпоинт).** `/ws/stats` за `adminOnlyMiddleware` (роль `admin` из `user_roles`). Остаток: глобальная WS-рассылка присутствия не-приватных профилей всем клиентам — осознанный компромисс для статусов «онлайн» (см. L4).

---

## 🟢 Низкие уязвимости и замечания

| # | Файл | Проблема |
|---|---|---|
| L1 | `rpc.go` → `AwardAchievement` | Любой пользователь награждает **сам себя** любой ачивкой (`claims.UserID == req.UserID`). Обесценивает систему достижений. |
| L2 | `friends.go`, `messenger_conversations.go`, `gifts.go` | Нет блокировок: спам заявок в друзья, сообщения любому пользователю, подарок автоматически создаёт 1:1 диалог с вложенным сообщением. Rate limit только 200 req/min/IP. |
| L3 | `messenger_conversations.go` → `ListConversations` | Групповой чат дублируется в списке N-1 раз (LEFT JOIN `cm2` по всем остальным участникам при `is_group=true`). Функциональный баг. |
| L4 | `hub.go` → `canAccessRoom` | Комнаты `profile_now_playing_*` доступны любому аутентифицированному — публичный «сейчас играет» жертвы (присутствие). |
| L5 | `profile_wall.go`, `universal_crud.go` | ~~Сиротские комментарии (post_id не существует/удалён) читаются всеми аутентифицированными: в предикате `wp.user_id` NULL ⇒ `COALESCE(ps.private_profile,false)=false` ⇒ видимо. Создание такого комментария проходит проверку приватности (пост не найден ⇒ «ok»).~~ **✅ Исправлено**: чтение — `INNER JOIN profile_wall_posts` (сироты отбрасываются); запись — `enforceWallTargetPrivacy` fail-closed: пост/комментарий обязан существовать, иначе `404` (комментарий/лайк/репост), отсутствие `post_id`/`comment_id` → `400`. 5 новых тестов. |
| L6 | `profile_customization` + `Profile.tsx`/`HeaderUsername.tsx` | ~~`username_css`/`profile_badge_css` — произвольный CSS пользователя, применяется инлайн. Не санитизируется сервером. Риск UI-redressing/фишинговых оверлеев и CSS-эксфильтрации (ограничено inline-style).~~ **✅ Исправлено**: серверный санитайзер `sanitizeProfileCSS` (allow-list свойств + запрет `url(`/`expression(`/`behavior`/`-moz-binding`/`attr(`/`@`-правил/`!important`/`{}`/кавычек; CSS-escape декодируются) применяется на записи (upsert) и на чтении (legacy-строки). `profile_badge_text` — кап 60 символов + вырез control-char. 8 тестов. |
| L7 | `auth_register_login.go` → `Login` | ~~Комментарий «backward compat: email», но запрос `WHERE username = $1` — вход по email всегда падает~~ **✅ Исправлено**: `WHERE username = $1 OR email = $1`; lockout-ключ привязан к введённому идентификатору. |
| L8 | `auth.go` → `isPwned` | Внешний вызов HIBP на register/смене пароля; fail-open (документировано). При недоступности HIBP слабые пароли проходят. Наблюдение, не баг. |
| L9 | `backup.go` → Export | Экспорт гомосаба владельцем включает email участников (PII) — приемлемо по ролям, но стоит минимизировать/маскировать. |
| L10 | `bots_handler.go` → `CreateBot` | В `password_hash` бот-аккаунта кладётся `hex(randBytes)` — не хэш пароля, а случайная строка. Безвредно, но неряшливо. |
| L11 | `auth_session.go` | `/auth/refresh` и `/auth/logout` без per-IP лимитов (auth-группа не под глобальным 200/min). Брутфорс refresh нереалистичен (256 бит), но лучше добавить троттлинг. |
| L12 | `messenger_messages.go` → `GetMessages` | Курсор `before` использует `sent_at` из подзапроса по message id без проверки принадлежности сообщения к диалогу — если id не из этого диалога, вернётся страница по времени. Очень низкий риск, но стоит скоуп. |
| L13 | auth UX | Нет уведомлений о входе с нового устройства/IP; logout убивает ВСЕ сессии (нельзя выйти из одного устройства). |
| L14 | `upload.go` | Content-Type берётся из заголовка клиента (serve отдаёт его как есть) — желательно переопределять по magic bytes. |
| L15 | WebSocket origin | `CheckOrigin` пропускает соединения без заголовка Origin (non-browser клиенты) — приемлемо, но сужает защиту от DNS-rebinding на WS. |

---

### L5 — сиротские комментарии стены читаются всеми

**Статус: ✅ ИСПРАВЛЕНО.** Чтение комментариев (`handleProfileWallPostCommentsGet`) переведено с `LEFT JOIN` на `INNER JOIN profile_wall_posts wp ON wp.id = c.post_id` — комментарий, чей пост удалён/не существует, больше не попадает в выборку. Раньше `LEFT JOIN` давал `wp.user_id = NULL`, и предикат приватности `COALESCE(ps.private_profile,false)=false` пропускал сироту любому аутентифицированному. Запись (`enforceWallTargetPrivacy`) теперь fail-closed: для `profile_wall_post_comments`/`profile_wall_post_likes`/`profile_wall_post_reposts` пост обязан существовать (`404` при отсутствии), для `profile_wall_comment_likes` — комментарий с живым постом (`404` для сироты), пустой `post_id`/`comment_id` → `400`. Раньше ошибка lookup игнорировалась (`_ =`), `wallOwner` оставался пустым и проверка «`wallOwner == ""` ⇒ разрешить» пропускала создание сирот. Тесты: `TestHandleProfileWallCommentsGet_UsesInnerJoin` (guard на SQL), `TestUniversalPost_ProfileWallComment_PostNotFound`, `TestUniversalPost_ProfileWallComment_MissingPostID`, `TestUniversalPost_ProfileWallPostLike_PostNotFound`, `TestUniversalPost_CommentLike_CommentNotFound`, `TestUniversalPost_Repost_PostNotFound`, `TestUniversalPut_ProfileWallComment_CannotMovePost`. **Остаток:** существующие сироты в БД остаются невидимыми (INNER JOIN), чистка не требуется; FK/`INNER JOIN` защищают чтение при любом пути записи.

---

### L6 — CSS-инъекция через кастомизацию профиля

**Статус: ✅ ИСПРАВЛЕНО.** `username_css`/`profile_badge_css` больше не хранятся как произвольный CSS. Новый серверный санитайзер `sanitizeProfileCSS` (`profile_css.go`) пропускает только allow-list из ~45 безопасных свойств (цвета, градиенты, тени, шрифты, `background-clip`-градиентный текст, анимации по site-`@keyframes` — атрибуты, которые генерируют встроенные редакторы и пресеты) и вырезает: `url(`/`url (` (эксфильтрация), `expression(`/`behavior`/`-moz-binding`/`attr(` (скрипты), любые `@`-правила (`@import`/`@keyframes`/`@media`), `!important`, `{}` и кавычки в значениях, а также свойства `position`/`z-index`/`transform`/`display`/`content`/`font-family` (UI-redressing/подмена контента). CSS-escape (`u\72l(`→`url(`, `\70 osition`→`position`) декодируются до проверок. Применяется на **записи** (`upsertInsertQuery` → `profile_customization`) и на **чтении** (`handleGet` → `sanitizeProfileCustomizationRow`, обезвреживает legacy-строки без миграции). `profile_badge_text`: кап 60 символов + вырез control-char (рендер через React-esc — текст и так безопасен). **Остаток:** фронтенд-превью в настройках применяет сырой CSS до сохранения (self-XSS на своём экране, не хранится); CSP `style-src` содержит `unsafe-inline` (необходим для style-атрибутов) — при желании можно ужесточить позже. Тесты: `TestSanitizeProfileCSS_KeepsPresetStyles`, `TestSanitizeProfileCSS_StripsAttacks`, `TestSanitizeProfileCSS_Idempotent`, `TestSanitizeProfileCSS_LengthCap`, `TestSanitizeProfileBadgeText`, `TestSanitizeProfileCustomizationRow`, `TestUniversalPost_ProfileCustomization_SanitizesCSS`, `TestUniversalGet_ProfileCustomization_SanitizesLegacyRows`.

---

## Приложение: что проверено и признано безопасным

- **JWT-цепочка**: HS256, принудительная проверка `alg`, blacklist по `jti` в Redis (fail-closed), refresh-ротация с удалением старого токена, «theft-detection» (сбой генерации после находки токена ⇒ revoke all), `InvalidateAuthCache` по версии.
- **CSRF**: double-submit cookie+header, `SameSite=Strict`, только для cookie-auth не-GET запросов; Bearer не подлежит CSRF.
- **Rate limiting**: login 10/min/IP, register 5/min/IP, verify-2fa 20/min/IP, глобальный 200/min/IP, WS pre-auth 20/min/IP (fail-closed), upload quota; `SetTrustedProxies` ограничен приватными подсетями (нет спуфинга X-Forwarded-For).
- **Стена профиля**: приватный профиль = стена видна только владельцу и взаимным друзьям (REST+WS+медиа-бакет `wall` единый предикат); force-unsubscribe при удалении из друзей; кэш привязан к зрителю; ownership принудительно на записи (`enforcePostOwnership`), включая репосты.
- **Мессенджер**: AES-256-GCM + HKDF per-conversation ключи; FORCE RLS в транзакциях; проверка членства везде; ciphertext никогда не уходит клиенту (плейсхолдер при ошибке дешифровки); вложения привязаны к sender и существованию объекта; private-бакет `uploads` отдаётся только участникам диалога.
- **Медиа**: ownership-префиксы ключей, `ValidateObjectKey`, проверка владельца на DELETE, шифрование at-rest для messenger.
- **OAuth**: `redirect_uri` сверяется с зарегистрированными, PKCE, секреты bcrypt (SHA-256 pre-hash), rate limit на token/revoke.
- **Инфраструктура**: CSP/HSTS/X-Frame-Options/nosniff в Caddyfile; боты по токенам `gomo6_bot_` с SHA-256 хэшем в БД.

## Рекомендуемый порядок исправлений

1. **C1 + C2** (денежный ущерб, чинится за часы): fail-closed подпись, запрет unsigned callbacks, `ManualVerify` только для админов. ✅ исправлено (см. секции C1/C2).
2. **H1** (IDOR): привязать WHERE к board_id контекста. ⬜ не исправлено.
3. **H2** (2FA bypass): серверные токены устройств. ✅ исправлено.
4. **H3** (приватность стены): учесть `private_hide_wall/avatar/stats` в предикатах. ✅ исправлено.
5. **M1–M4** (жёсткость 2FA/пароля): переаутентификация, revoke сессий, per-account lockout TOTP. ✅ M1/M2/M3, 🟡 M4 (partial-токен не single-use); уведомления о новых устройствах ⬜ (см. L13).
6. **M5** (localStorage): только HttpOnly cookies для браузера. ✅ исправлено (HttpOnly + CSRF + in-memory; см. секцию M5).
7. **M6** (email/reset): верификация email + восстановление пароля. ⬜ не исправлено.
