# Security Audit Report — gomo6.wtf

Дата: 23 августа 2026
Аудитор: Buffy (Codebuff), полный white-box + black-box + инфраструктурный аудит
Scope: репозиторий `gomo6.2` (main, синхронизирован с Codeberg), прод gomo6.wtf, VPS (root@gomo6.wtf)
Методология: full-security-audit skill (white-box исходников, black-box прод-эндпоинтов, аудит VPS/Docker/Caddy, govulncheck, npm audit, gitleaks)

---

## 1. Executive Summary

Кодовая база **чрезвычайно хорошо укреплена**: это проект, прошедший несколько итераций аудита (в коде повсюду комментарии M1–M8, H1–H2, C1–C2, L1, K1 с описанием исправленных атак). Generic CRUD закрыт от mass-assignment и IDOR, загрузка файлов проверяет ownership и стрипает EXIF (JPEG/PNG/GIF), WebSocket-румы проверяют членство в чатах и приватность стен, JWT/refresh/CSRF/2FA/WebAuthn реализованы грамотно, CORS строгий, CSP жёсткий, Caddy admin API изолирован, Docker-сеть не публикует внутренние порты.

**Главные проблемы находятся в инфраструктуре и периферии приложения, а не в core-логике:**

1. **SSH root+пароль открыт в интернет, без файрвола и fail2ban** — в момент аудита шли активные брутфорс-атаки на root. Это самый серьёзный риск: при слабом пароле — полная компрометация VPS, на котором живут БД, секреты и медиа.
2. **PostgreSQL 15 — EOL** (13.11.2025), патчей безопасности больше нет.
3. **Уязвимости Go stdlib/x** (8 штук, включая DoS при декодировании VP8L изображений — достижим через upload).
4. **Публичный endpoint `/api/v1/audio/metadata` без auth, rate-limit и лимита размера** → disk-exhaustion DoS.
5. **BB-code `[url=javascript:...]` не санитизируется** (stored XSS-вектор, в настоящее время митигирован CSP).
6. **WebP сохраняет EXIF/GPS** при загрузке.
7. **Нет удаления аккаунта и нет восстановления пароля** — пользователь не может удалить свои данные (GDPR) и не может восстановить доступ без passkey.
8. Username-энумерация через /auth/register (500 + duplicate key).

---

## 2. Overall Risk

| Severity | Count |
|---|---|
| Critical | 0 (1 условный: SSH-компрометация при слабом пароле) |
| High | 2 |
| Medium | 6 |
| Low | 8 |
| Informational | 7 |

---

## 3. Findings (по severity)

### HIGH-1: SSH root + пароль в интернете, нет файрвола, нет fail2ban (Infrastructure)

**Файлы/компоненты:** VPS `node-26200.nodehost.ru` (gomo6.wtf), `/etc/ssh/sshd_config`

**Наблюдения (подтверждено на проде):**
- `PermitRootLogin yes` + `PasswordAuthentication yes` — root логинится по паролю напрямую.
- `ufw status: inactive`; iptables INPUT policy ACCEPT без правил.
- `fail2ban: inactive` (не установлен).
- В логах `journalctl -u ssh` — **непрерывные атаки прямо сейчас**: `Failed password for root from 85.133.193.72`, `77.239.124.181`, `219.147.14.98` и др. (всего десятки попыток за минуты).
- `X11Forwarding yes` (мелочь).

**Impact:** при слабом/скомпрометированном пароле root — полный контроль над VPS: все секреты (.env: JWT_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD, MESSENGER_ENCRYPTION_KEY), БД со всеми пользователями и приватными сообщениями, медиа, возможность подмены фронтенда (XSS для всех). Даже с сильным паролем — отсутствие rate-limit оставляет окно для credential-атак и является нарушением базового hardening.

**Remediation (0–24h):**
```bash
# 1. Только ключи, запретить пароль и root-логин по паролю
cat >> /etc/ssh/sshd_config <<'EOF'
PasswordAuthentication no
PermitRootLogin prohibit-password
EOF
systemctl restart sshd
# 2. Файрвол
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
# 3. fail2ban
apt install -y fail2ban && systemctl enable --now fail2ban
# 4. (желательно) не-root deploy-пользователь
```

**Regression:** скрипт проверки — `ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password root@gomo6.wtf` должен отклоняться; `ufw status` активен; `fail2ban-client status` активен.

---

### HIGH-2: Уязвимости Go stdlib и x/* (govulncheck: 8 достижимых)

**Компоненты:** `apps/backend-go` — go 1.26.5 (фикс 1.26.6), `golang.org/x/image v0.43.0` (фикс v0.45.0), `golang.org/x/net v0.54.0` (фикс v0.55.0).

| ID | Уязвимость | Трасса |
|---|---|---|
| GO-2026-6222 | Excessive memory during VP8L decode (x/image) | `media/strip_metadata.go` `ValidateImageShape` → **достижимо через upload изображений** (DoS) |
| GO-2026-6091 | html/template regexp context tracking | `social_preview.go` `Render` (OG-страницы) |
| GO-2026-6090 | crypto/tls post-handshake limit | все TLS-соединения |
| GO-2026-6089 | net/http ReadHeaderTimeout | `main.go` сервер |
| GO-2026-6088 | encoding/xml recursion | OAuth authorize, S3 client |
| GO-2026-5972 | asn1 recursion | `drops.go` x509 |
| GO-2026-6218 | net/url quadratic | http clients |
| GO-2026-5026 | x/net idna punycode | http clients |

**Impact:** в основном DoS/robustness; **GO-2026-6222 реально достижим через публичный upload изображений** (загрузка злонамеренного WebP → аномальное потребление памяти в бекенде). html/template — риск некорректного экранирования в OG-рендере.

**Remediation:** `go get golang.org/x/image@v0.45.0 golang.org/x/net@v0.55.0`, поднять `go 1.26.6` в go.mod, пересобрать образ (база `golang:1.26-alpine` подтянет свежий патч при пересборке).

**Regression:** CI уже содержит govulncheck — просто убедиться, что он гоняется на пересобранном образе и зелёный.

---

### MED-1: `/api/v1/audio/metadata` — публично, без rate-limit, без лимита размера → disk-exhaustion DoS

**Файл:** `apps/backend-go/internal/api/handlers/audio.go`, маршрут `api.POST("/audio/metadata", ...)` в `routes.go`.

- Группа `api` (`/api/v1`) **не имеет** ни auth, ни GlobalRateLimitMiddleware (он только на группе `rest`).
- `io.Copy(tempFile, file)` — **нет ограничения размера**; multipart-парсинг Gin скидывает большие файлы на диск (`/tmp`).
- Конкурентные запросы → заполнение диска → падение бекенда (а бекенд = весь сайт: Caddy отдаёт 502, когда backend не healthy).
- Дополнительно: `tag.ReadFrom` парсит произвольные байты без ограничения (вход для parser-багов).

**Remediation:** добавить auth (или хотя бы IP-rate-limit + лимит размера `io.LimitReader(file, 10<<20)` + проверку magic bytes), либо выпилить endpoint.

**Regression test:** unit-тест, что файл > N байт отклоняется; тест middleware, что endpoint покрыт rate-limiter'ом.

---

### MED-2: Stored XSS-вектор через BB-code `[url=...]` без санитизации (сейчас митигирован CSP)

**Файлы:** `apps/web/src/utils/bbcodePlugins.tsx` → `@bbob/preset-html5` `renderUrl` (`node_modules/@bbob/preset-html5/lib/defaultTags.js`).

**Подтверждено:** `render('[url=javascript:alert(1)]click[/url]')` → `<a href="javascript:alert(1)">`. Никакой валидации схемы (в отличие от мессенджера, где есть `sanitizeMessengerHref`). Вектор применяется ко всему пользовательскому контенту: посты на стене, комментарии, треды, bio.

**Почему сейчас не критично:** прод- CSP `script-src 'self' blob: https://integrate.depay.com https://challenges.cloudflare.com` **без 'unsafe-inline'** — браузеры блокируют выполнение `javascript:` URL. **Но** это единственный барьер: любое ослабление CSP (другое окружение, будущее изменение) превращает это в полный stored XSS → account takeover (JS читает CSRF-куку, вызывает /auth/refresh и получает access token).

**Дополнительно:** `[url=data:text/html,...]` → клик уводит на data: документ (phishing-вектор, не перехват сессии). `[url=https://evil]` — клик раскрывает IP зрителя (см. Privacy).

**Remediation:** санитизировать href в кастомном пресете по образцу `messengerRichTextUtils.sanitizeMessengerHref` (только http/https, отбрасывать javascript:/data:/vbscript:). Дублировать серверную проверку не требуется (контент хранится как plain text, рендер клиентский), но желательно.

**Regression test:** по образцу `messengerRichTextUtils.test.ts` — `expect(renderBbCode('[url=javascript:alert(1)]x[/url]')).not.toContain('javascript:')`.

---

### MED-3: PostgreSQL 15 — EOL

`postgres:15` (в проде 15.18). PostgreSQL 15 достиг EOL 13.11.2025 — **патчей безопасности больше не выходит**. БД не публична (внутри docker-сети), но это фундамент всего сервиса.

**Remediation:** миграция на postgres:16/17/18 (план: pg_dump → новый контейнер → restore; проверить совместимость миграций). В docker-compose заменить `postgres:15` → `postgres:16`.

---

### MED-4: WebP сохраняет EXIF/GPS при загрузке

**Файлы:** `apps/backend-go/internal/media/strip_metadata.go` (`stripOriginalImage` — default: `return data, nil`), `image_variants.go`.

JPEG/PNG/GIF пере-кодируются и теряют метаданные. **WebP (нет pure-Go энкодера) сохраняет оригинальные байты вместе с EXIF/GPS/XMP.** WebP-фото с GPS — метаданные уходят зрителям (и в CDN). Пути: аватары (`StripImageMetadata`) и все загрузки изображений (`GenerateImageVariants`).

**Remediation:** варианты: (а) принимать WebP только через пере-кодирование в JPEG/PNG (preview уже JPEG), (б) вырезать EXIF из WebP вручную (chunk "EXIF" в RIFF), (в) отклонять WebP с EXIF.

**Regression test:** загрузка WebP с GPS-EXIF → проверка, что сохранённые байты не содержат "Exif"/"GPS".

---

### MED-5: Username-энумерация через /auth/register (500 + duplicate key)

**Файл:** `auth_register_login.go` `Register`: `c.JSON(500, models.ErrorResponse("Failed to create user: "+err.Error()))` — при занятом username клиент получает текст ошибки Postgres (`duplicate key value violates unique constraint "users_username_key"`). Это (а) раскрывает внутренности БД, (б) подтверждает существование аккаунта (обход Turnstile не нужен — достаточно пары запросов; Turnstile лишь замедляет). Аналогичная утечка структуры в `CreateBot` (обрабатывается аккуратнее, но тоже `err.Error()`).

**Remediation:** обработать `pgconn.PgError` с кодом `23505` → 409 + общее сообщение «Username already taken»; не включать `err.Error()` в ответы (только в логи).

**Regression test:** тест Register с занятым username → 409 без упоминания "duplicate key".

---

### MED-6: Нет удаления аккаунта и нет восстановления пароля (Data deletion / GDPR)

- **Нет endpoint'а удаления аккаунта** (только боты удаляются, `bots_handler.go`). Пользователь не может удалить свои данные — противоречит праву на забвение и заявлению о «свободе слова без последствий» (данные хранятся вечно).
- **Нет password reset** («забыли пароль»): email не верифицируется, сброса нет. Потеря пароля = потеря аккаунта (если нет passkey/2FA recovery). При 2FA — есть recovery codes (миграция 029/035), но при их потере — всё.

**Remediation:** добавить flow удаления аккаунта (с подтверждением пароля/2FA, каскадное удаление: профиль, посты, стена, сообщения, сессии, медиа — по образцу `DeleteBot`, но глобально), либо документировать отсутствие. Добавить password reset через email-код (с учётом того, что email сейчас не верифицируется — сначала верификация).

---

### LOW-находки

| # | Finding | Файл/компонент |
|---|---|---|
| L1 | Нет host-файрвола вообще (только 22/80/443 слушают — повезло) | VPS |
| L2 | INTEGRATION_ENCRYPTION_KEY не задан → Spotify-токены в БД plaintext (лог в проде: «tokens stored as plaintext») | `integrations/` |
| L3 | npm audit: 28 (2 critical, 3 high) — vitest <3.2.6 (dev, RCE на UI-сервере), vite ≤6.4.1 (dev, path traversal), nanoid (high, через @solana/web3.js в DePay-виджете), ws/elliptic/uuid/jayson (web3-стек в рантайм-бандле) | package-lock |
| L4 | Lockout-DoS: 5 неудачных попыток по известному username замораживает аккаунт на 15 минут (ответ неотличим от неверного пароля — энумерации нет, но DoS есть) | `auth_register_login.go` |
| L5 | Register: ошибка 500 вместо 409 при дубликате; утечка текста ошибки БД | `auth_register_login.go` |
| L6 | Wallet-адреса GM6-XXXX-XXXX — 32 бита энтропии (~4.3 млрд): коллизии возможны при ~65k+ пользователей; перевод drops по адресу может уйти не тому | `auth_register_login.go` `randomHex(4)` |
| L7 | `/api/v1/docs/json` и `/api/v1/dev-dashboard/config` публичны (раскрытие API-поверхности; config — by design) | routes |
| L8 | X11Forwarding yes в sshd | VPS |
| L9 | `/ws/stats` (admin-эндпоинт) не роутится Caddy → мёртвый маршрут (не утечка, но и функционал недоступен) | Caddyfile |
| L10 | `device_token` (2FA-доверенное устройство) и OAuth-токены сторонних приложений — в localStorage (XSS → кража; митигировано CSP) | `integrations/api/auth.ts`, `oauth.ts` |

---

## 4. Account Takeover Assessment

**Вердикт: LOW** (при текущем CSP) / **уязвим к регрессии CSP**.

Пути атаки и статус:

| Путь | Статус |
|---|---|
| Брутфорс пароля | Заблокирован: bcrypt cost 12, lockout 5/15мин на идентификатор, rate-limit 10/мин/IP, Turnstile |
| Credential stuffing | Turnstile + lockout + HIBP-проверка паролей при регистрации |
| XSS → session theft | Митигирован CSP (см. MED-2); при регрессе CSP — критично |
| CSRF | Double-submit (кука + заголовок X-CSRF-Token), SameSite=Strict на всех куках |
| Кража refresh-токена | 256-бит случайный, HttpOnly, хранится в Redis как SHA-256, 3 дня TTL |
| Кража access-токена | HttpOnly, 1 час, jti-блоклист, ревокация при смене пароля |
| 2FA bypass | TOTP + WebAuthn + trusted devices (SHA-256 хеш токена на сервере); trusted-device токен в localStorage (CSP-компенсация) |
| Session fixation | Новая сессия при каждом логине; refresh не ротирует refresh-токен, но ротирует access+jti (осознанный компромисс ради параллельных refresh) |
| Password reset | **Нет** (см. MED-6) — атакующему нечего эксплуатировать, но и пользователю не восстановиться |
| OAuth account linking | PKCE S256 обязателен, redirect_uri точное совпадение, consent=true обязателен, коды одноразовые, refresh-токены ротируются |

**Как пользователь может защититься:** сильный уникальный пароль + password manager; включить 2FA (TOTP) или passkey; следить за «Devices & sessions»; не кликать ссылки в подозрительных постах.

**Residual risk:** единственный реалистичный путь — XSS при регрессе CSP; компрометация VPS через SSH (HIGH-1) = полный takeover всех аккаунтов (JWT_SECRET в .env). Пока пароль root сильный — риск низкий, но он **не задокументирован и не контролируется**.

---

## 5. Privacy & Deanonymization Assessment

**Вердикт: MEDIUM** (для обычного пользователя), HIGH при компрометации инфраструктуры/админ-доступа.

| Данные | Кто видит | Где хранится |
|---|---|---|
| IP пользователя | **Админы/оператор** — `user_sessions.ip_address`, oauth audit log | Postgres |
| last_seen_at / is_online | Публично для не-приватных профилей (есть toggle hide_stats) | Postgres, Redis presence |
| Email | Только владелец профиля (стрипается для всех остальных) | Postgres |
| EXIF/GPS | JPEG/PNG/GIF — стрипается; **WebP — утекает** (MED-4) | Garage |
| Username/профиль | Публично (by design) | — |
| Приватные сообщения | Только участники чата (RLS + проверки членства в WS) | Postgres (зашифровано at-rest ключом сервера — сервер читает) |
| Заметки (notes) | **Только владелец** — настоящий E2E (AES-256-GCM, ключ в localStorage) | Postgres (ciphertext) |
| Приватные стены/медиа | Только владелец/друзья (проверки на чтении медиа и в OG-прокси) | Garage |
| Ссылки [url] | Клик раскрывает IP зрителя хосту ссылки (стандартное поведение; referrer = origin) | — |

**Сценарии:**

- **Сценарий A (обычный пользователь):** может видеть last_seen/online публичных профилей; не может получить IP, email, приватные данные. WebP-EXIF — единственная «дыра» для случайной утечки своих GPS.
- **Сценарий B (мотивированный):** username-энумерация ограничена (search скрывает приватные профили; register 500-duplicate — быстрая проверка существования). Связывание аккаунтов — через поведенческие данные (ничего специфичного не найдено).
- **Сценарий C (модератор/админ):** admin role видит `/api/v1/metrics`, `/ws/stats` (мёртв). В БД — IP и user_agent всех сессий. **Оператор технически может деанонимизировать любого пользователя.**
- **Инфраструктура:** компрометация VPS = полная деанонимизация (IP, email, переписка, notes-шифротекст без ключа, но всё остальное читается).

---

## 6. Attack Chains

**Chain 1 — SSH → полная компрометация (самый реальный):**
```
Брутфорс root (активен прямо сейчас)
→ пароль root угадан/подобран
→ чтение /root/gomo6.2/.env (JWT_SECRET, POSTGRES_PASSWORD, MESSENGER_ENCRYPTION_KEY)
→ подделка JWT любого пользователя (включая админа)
→ чтение БД: все сообщения, IP, email
→ подмена фронтенда: XSS для всех пользователей
```
Impact: CRITICAL. Автоматизируемо: да. Обнаруживаемость: низкая.

**Chain 2 — CSP-регресс → stored XSS → account takeover:**
```
Пост на стене с [url=javascript:...]
→ (если CSP ослаблен) клик жертвы
→ JS читает CSRF-куку, вызывает POST /api/v1/auth/refresh
→ получает access token
→ полный доступ к аккаунту жертвы (включая личные сообщения)
```
Impact: HIGH. Сейчас заблокировано CSP (MED-2).

**Chain 3 — Disk DoS через /audio/metadata:**
```
Множество POST /api/v1/audio/metadata с большими файлами (без auth/rate-limit)
→ заполнение /tmp
→ бекенд падает (не может писать, DB WAL и т.д.)
→ Caddy: весь сайт 502
```
Impact: MEDIUM (availability).

**Chain 4 — WebP GPS-утечка:**
```
Пользователь загружает WebP-фото с GPS (с телефона)
→ сервер хранит оригинал с EXIF
→ любой зритель скачивает и читает GPS
```
Impact: LOW-MEDIUM (privacy).

---

## 7. Statement Verification

> «Пользуясь данным проектом пользователь может быть уверен в своей безопасности и в свободе слова, за которую ничего не будет.»

| Составляющая | Оценка |
|---|---|
| A. Confidentiality (чужие читают данные?) | В основном нет: E2E notes, шифрование at-rest мессенджера, RLS, приватные стены. Сервер (оператор) читает обычные сообщения (не E2E) — это нормально для дизайна, но нужно понимать. |
| B. Account security | Сильная: 2FA, WebAuthn, lockout, HttpOnly, CSRF. Слабое место — отсутствие password reset и зависимость от CSP. |
| C. Anonymity | **Нет гарантии**: сервер хранит IP и user-agent всех сессий; админ может деанонимизировать. |
| D. Metadata privacy | Частично: EXIF стрипается кроме WebP. |
| E. Infrastructure privacy | Оператор и (при компрометации) атакующий видят IP/email. |
| F. Legal exposure | Данные (IP, email, переписка) физически существуют на VPS у оператора — юридический запрос технически исполни́м. |
| G. Data deletion | **Нет удаления аккаунта** — данные хранятся вечно. |
| H. Freedom of speech | Технически автор устанавливается (IP в сессиях) — «за это ничего не будет» не гарантировано самой системой. |

**Verdict: PARTIALLY SUPPORTED / UNSUPPORTED по анонимности.** Техническая безопасность аккаунтов сильная, но заявления об анонимности и «свободе слова без последствий» не подтверждаются архитектурой: оператор (и любой, кто получит доступ к серверу) может установить автора и прочитать переписку.

---

## 8. Remediation Plan

### Immediate — 0–24 hours
1. **SSH hardening** (HIGH-1): отключить парольную аутентификацию, root по ключу, включить ufw + fail2ban.
2. Пересобрать backend с `go 1.26.6` + `x/image v0.45.0` + `x/net v0.55.0` (HIGH-2).
3. Закрыть `/api/v1/audio/metadata` (auth или rate-limit + лимит размера) (MED-1).

### Short term — 1–7 days
4. Санитизация BB-code URL по образцу мессенджера (MED-2) + regression-тест.
5. Fix username-энумерации в register (409 + generic message) (MED-5).
6. WebP: стрипать EXIF или отклонять WebP с метаданными (MED-4).

### Medium term — 1–4 weeks
7. Миграция PostgreSQL 15 → 16/17/18 (MED-3).
8. INTEGRATION_ENCRYPTION_KEY для интеграционных токенов (L2).
9. План удаления аккаунта (MED-6): endpoint + каскадное удаление данных + очистка кэшей/медиа.

### Long term
10. Password reset + верификация email.
11. Обновить dev-зависимости (vitest ≥3.2.6, vite ≥6.4.x) (L3).
12. Увеличить энтропию wallet-адресов (L6).
13. Не-root deploy-пользователь на VPS; мониторинг SSH-атак; `apt upgrade` регулярно.

---

## 9. Regression Tests (предлагаемые)

1. `ssh` без ключа/с паролем → отказ (инфраструктурный скрипт, не unit).
2. `TestRegisterDuplicateUsername_Returns409_NoDBLeak` — 409, в теле нет "duplicate key".
3. `TestAudioMetadataRejectsOversizedFile` — файл > лимита → 4xx.
4. `TestBbCodeUrlSchemeSanitized` — `[url=javascript:...]` не рендерится в href.
5. `TestWebPUploadStripsExif` — WebP с GPS после загрузки не содержит "Exif".
6. `TestMessageAttachmentAccess_NonMemberDenied` (уже есть — сохранить).
7. govulncheck в CI — уже есть; добавить `go-version` gate ≥1.26.6.

---

## 10. Residual Risk (после исправлений)

- E2E-шифрование обычного мессенджера отсутствует (сервер читает) — by design, но это ограничение надо декларировать.
- Пароль root сильный — пока так, SSH-риск низкий; но это незадокументированное допущение.
- CSP — единственный барьер для BB-code XSS; любое изменение CSP требует повторной проверки.
- DePay/web3-стек в рантайм-бандле несёт moderate/low CVE — мониторить.
- Отсутствие удаления аккаунта остаётся, пока не реализовано.

---

## 11. Итоговый executive verdict

### Account takeover
`LOW` (уязвим к регрессии CSP; SSH-компрометация = полный обход)

### Deanonymization
`MEDIUM` (админ/оператор видит IP; обычный пользователь — только last_seen/online и WebP-EXIF)

### IP exposure
`LOW-MEDIUM` (IP виден только админам; клики по внешним ссылкам — стандартное поведение)

### PII exposure
`LOW` (email стрипается, приватные профили скрыты, EXIF в основном стрипается)

### Metadata privacy
`MEDIUM` (WebP-дыра; наличие IP/user-agent всех сессий)

### Overall security
`MEDIUM` (сильный код + слабая периферия: SSH, EOL PostgreSQL, DoS-эндпоинт)

### Claim «пользователь гарантированно защищён и свободен»
`PARTIALLY SUPPORTED` — безопасность аккаунтов сильная; анонимность и свобода слова без последствий НЕ гарантированы (оператор технически может установить автора).

**5–10 фактов, приведших к вердикту:**
1. SSH root+пароль в интернете без fail2ban и файрвола, с активным брутфорсом в логах.
2. PostgreSQL 15 EOL (нет патчей безопасности).
3. 8 достижимых уязвимостей Go stdlib/x (включая DoS через upload WebP).
4. Публичный /audio/metadata без rate-limit и лимита размера → disk DoS.
5. BB-code [url] без санитизации схемы — stored XSS за CSP-барьером.
6. WebP сохраняет GPS/EXIF.
7. Нет удаления аккаунта и нет восстановления пароля.
8. Настоящий E2E для заметок, грамотный auth (2FA/WebAuthn/CSRF/lockout), строгий CORS и CSP.
9. Upload-пайплайн: EXIF-стрип (кроме WebP), серверные Content-Type, ownership-проверки, шифрование мессенджер-аттачей at-rest.
10. IP всех пользователей хранятся в БД — деанонимизация оператором технически тривиальна.
