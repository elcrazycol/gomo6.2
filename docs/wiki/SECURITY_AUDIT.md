# Аудит безопасности Gomo6 — итоговый отчёт

> **Статус:** живой документ. Обновляется по мере закрытия пунктов плана.
> Последнее обновление: 12.08.2026.

## Оценка

| Зона | Оценка | Комментарий |
|---|---|---|
| **Мессенджер (общение)** | **8.5 / 10** | RLS forced, membership-проверки на каждый объект, шифрование at-rest, Redis-лимитеры, HttpOnly-куки, origin-check WS |
| **Платформа в целом** | **7 / 10** | Критические IDOR/XSS закрыты; остались только низкие пункты |

**Методология:** повторный аудит после первой волны фиксов. Проверены: auth/сессии, RLS-покрытие, universal CRUD, storage/upload, WebSocket, OAuth/PKCE, боты, шифрование сообщений, rate limiting, XSS-векторы фронтенда, закрытые ранее пункты.

---

## Статус пунктов плана исправлений

### Критические

| ID | Пункт | Статус | Коммит |
|---|---|---|---|
| **C1** | Токены не хранятся в localStorage; HttpOnly+Secure+SameSite=Strict куки, CSRF-токен отдельной кукой | ✅ Закрыт | `fb95703` |
| **K1** | IDOR в universal CRUD на стенах: POST/PUT/DELETE принудительно используют `author_id`/`user_id` из claims; запись на чужую стену только с `allow_wall_posts_from_others`; репосты только на свою стену; PUT не может сменить стену поста | ✅ Закрыт | `e4355af` |
| **K2** | Stored XSS через `username_icon_svg` — SVG-иконки полностью удалены (миграция 082 DROP COLUMN, удалены IconEditor/imageToSvg, все `dangerouslySetInnerHTML` с SVG убраны) | ✅ Закрыт | `e4355af` |

### Высокие

| ID | Пункт | Статус | Коммит |
|---|---|---|---|
| **H1** | Redis-backed rate limiting + квоты на `POST /storage/v1/upload` (count/мин + hourly byte quota через Lua, защита от обхода Content-Length) | ✅ Закрыт | `fb95703` |
| **H2** | Группы: только подтверждённые друзья + лимит 100 участников (CreateGroupConversation / AddGroupMembers) | ✅ Закрыт | `fb95703` |

### Средние

| ID | Пункт | Статус | Коммит |
|---|---|---|---|
| **M9** | Ciphertext не возвращается при ошибке дешифровки (placeholder вместо blob) | ✅ Закрыт | `fb95703` |
| **M10** | Messenger/WS-лимитеры на Redis; `set_config` в реальной транзакции (SET LOCAL, scoped) | ✅ Закрыт | `fb95703` |
| **M11** | Сырые `err.Error()` → `serverError` по всему backend (21 файл; 0 осталось утечек 500-ошибок, включая SQL-детали) | ✅ Закрыт | *не закоммичен* |
| **M12** | Лимитер на `/auth/login` (10/мин/IP) + `/auth/register` (5/мин/IP) + `/auth/verify-2fa` (20/мин/IP); per-account lockout (5 попыток → 15 мин) уже был | ✅ Закрыт | *не закоммичен* |

### Низкие / техдолг (осталось)

| ID | Пункт | Статус |
|---|---|---|
| **L1** | `DownloadFile` / `GetPresignedURL` — мёртвый код без ownership-проверок (не зарегистрированы в роутере, но при регистрации = обход приватного бакета) | ✅ Закрыт — удалён весь пресайн-код: оба хендлера, `GetPresignedURL`/`GetPresignedPutURL` (0 вызовов), presigner-инфраструктура, типы `PresignedURLResponse`/`PresignUploadRequest`/`PresignUploadResponse` и мёртвый `UploadRequest`; `GARAGE_S3_PUBLIC_ENDPOINT` оставлен в oauth.go (buildAvatarURL) |
| **L2** | Legacy `UploadFile` для публичных бакетов — контент-адресуемый MD5-ключ, не user-scoped | ⏳ Открыт |
| **L3** | Rate limiters fail-open при Redis-сбое (кроме WS pre-auth) — осознанный выбор; добавить лог/метрики fail-open | ⏳ Открыт |
| **L4** | Bot-токены: sha256 без соли (приемлемо при 32 байтах энтропии) | ⏳ Опционально |
| **L5** | `Access-Control-Allow-Origin: *` на публичных объектах — ок, т.к. приватный бакет идёт через авторизованный путь | ⏳ Контролировать |

---

## Что уже сделано (хронология)

| Коммит | Содержимое |
|---|---|
| `fb95703` | `feat(security): harden messenger — C1/H1/H2/M9/M10 fixes` (29 файлов) |
| `372cd34` | `chore(hooks): auto-set MESSENGER_ENCRYPTION_KEY for go test in pre-commit` |
| `e4355af` | `fix(security): enforce ownership on wall CRUD (K1) and remove SVG icon customization (K2)` (17 файлов, 6 новых IDOR-тестов) |
| *(не закоммичен)* | `fix(security): serverError вместо err.Error + per-IP лимитеры на auth endpoints` (21 файл) |
| *(не закоммичен)* | `fix(security): remove dead presign/download code — DownloadFile, GetPresignedURL, GetPresignedPutURL, presigner infra (L1)` |
| *(не закоммичен)* | `fix(dev-dashboard auth): CSP-исключение connect-src для dev.* (Caddyfile, матчер @devCsp) + consent-страница читает username из обёртки {success, data} (/api/v1/auth/me)` |

---

## Решения и примечания

1. **RLS на `profile_customization` / wall-таблицы не добавлен** — выбрана кодовая принудительная проверка `user_id = claims`. Причина: universal CRUD работает без транзакции с `set_config`, поэтому RLS-политики на `current_setting('app.current_user_id')` заблокировали бы все записи. Кодовая защита даёт ту же гарантию (IDOR закрыт тестами).
2. **Оценка мессенджера 8.5/10** — не 9-10, потому что: шифрование — server-side (оператор может читать), лимитеры fail-open, per-account lockout привязан к логину (не к 2FA-попыткам).
3. **Pre-existing падения тестов** (не связаны с фиксами): `useAuth.test.tsx`, `auth.test.ts` — 3 теста падают и на чистой ветке.
4. **Прочее хорошее, подтверждённое аудитом:** обязательный OAuth PKCE S256, 2FA TOTP + recovery-коды + WebAuthn, honeypot-поля на login/register, ValidateObjectKey режет path traversal, userID = UUID (prefix-ownership безопасен), membership-проверка на скачивание вложений мессенджера, WS origin-allowlist, WS pre-auth лимитер fail-closed.
5. **CSP и вход в dev-панель (12.08.2026):** строгий `connect-src 'self' wss: ...` (добавлен вместе с Turnstile-хардненингом) блокировал кросс-доменный OAuth-обмен dev-панели — `dev.*` → `https://{$DOMAIN}/oauth/token` и `/oauth/userinfo`. Вход падал с `NetworkError when attempting to fetch resource` (в консоли — CSP violation). Куки-миграция (M5) ни при чём: dev-панель держит OAuth-токены in-memory и куки не использует. Фикс: для dev.* добавлен отдельный CSP (матчер `@devCsp` в Caddyfile) с `http/https://{$DOMAIN}` в `connect-src`; основной сайт и docs не ослаблены. Попутно исправлена consent-страница: `/api/v1/auth/me` отдаёт профиль в обёртке `{success, data}`, а код читал `username` на верхнем уровне и показывал фолбэк «User» вместо реального ника.
