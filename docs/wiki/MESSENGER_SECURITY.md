# Безопасность мессенджера Gomo6

> 📋 Полный статус плана исправлений и оценка — см. **[SECURITY_AUDIT.md](./SECURITY_AUDIT.md)**.

## Обзор

Мессенджер Gomo6 использует **AES-256-GCM шифрование на стороне сервера** (encryption at rest) для защиты содержимого сообщений в базе данных. Сообщения передаются по HTTPS/WSS (TLS in transit), шифруются перед записью в БД и расшифровываются при чтении.

Сервер владеет ключом и может читать сообщения. Поэтому мессенджер предназначен для обычного общения, а не для передачи информации, требующей защиты от оператора сервера. Модель защищает от: утечки дампа БД, несанкционированного доступа к файлам БД на диске и компрометации бэкапов.

## Архитектура безопасности

### 1. Шифрование сообщений (AES-256-GCM)

**Используемая криптография:**
- Алгоритм: AES-256 в режиме GCM (Galois/Counter Mode)
- Библиотека: стандартная `crypto/aes` + `crypto/cipher` (Go stdlib)
- Размер ключа: 32 байта (256 бит)
- Аутентификация: GCM — AEAD (Authenticated Encryption with Associated Data), защита от подделки
- Nonce: 12 байт, генерируется через `crypto/rand` для каждого сообщения

**Процесс:**
1. Ключ задаётся через переменную окружения `MESSENGER_ENCRYPTION_KEY` (или `ENCRYPTION_KEY` как fallback)
2. Если ключ не задан — шифрование прозрачно отключается (сообщения хранятся как plaintext)
3. При отправке сообщения (`encryptContent`):
   - Генерируется случайный 12-байтовый nonce
   - Контент шифруется через AES-GCM: `nonce || ciphertext || auth_tag`
   - Результат кодируется в base64 (RawStdEncoding)
   - В БД сохраняется зашифрованная base64-строка
4. При чтении сообщения (`decryptContent`):
   - Декодируется base64
   - Извлекается nonce (первые 12 байт)
   - Расшифровывается через AES-GCM
   - При ошибке расшифровки (повреждённый ciphertext, смена ключа) — клиенту возвращается placeholder `crypto.DecryptionFailedPlaceholder` («🔒 Сообщение недоступно»). Шифротекст никогда не возвращается клиенту ни через REST, ни через WebSocket (включая preview диалогов и realtime-бродкасты)
   - Для legacy-сообщений: сначала пробуется per-conversation ключ (HKDF v2), затем HMAC v1, затем master key — до первого успеха

**Важно:** Ключ шифрования должен быть одинаковым на всех инстансах сервера и неизменным между перезапусками.

### 2. Аутентификация (JWT)

**Access токены:**
- Алгоритм: HS256 (HMAC-SHA256)
- Срок жизни: 1 час
- Полезная нагрузка: `user_id`, `username`, `domain`, `exp`, `iat`, `jti`
- Уникальный `jti` (JWT ID) для каждого токена — позволяет точечный отзыв

**Refresh токены:**
- Opaque (случайные 32 байта, hex-encoded)
- Срок жизни: 7 дней
- Хранятся в Redis как SHA-256 хеш (не plaintext)
- Safe rotation: сначала генерируется новая пара, потом удаляется старая — нет окна без валидного токена

**Token blacklist:**
- При logout токен добавляется в Redis blacklist по `jti`
- TTL blacklist-записи = оставшееся время жизни токена
- При каждой валидации проверяется blacklist

**2FA (TOTP):**
- Генерация секрета через `crypto/rand`
- Partial token (5 минут) на время процесса 2FA
- Recovery codes для восстановления доступа
- Device trust (remember device)

**Хранение токенов на клиенте:**
- Access token: `localStorage` (`auth_token`)
- Refresh token: `localStorage` (`auth_refresh_token`)
- ⚠️ `localStorage` уязвим к XSS — рекомендуется добавить Content Security Policy

### 3. WebSocket безопасность

**Аутентификация:**
- WebSocket соединения требуют JWT токен
- Токен передаётся через заголовок `Authorization: Bearer <token>` (или Secure Cookie) — **не** через query string
- `RejectQueryTokenMiddleware` глобально возвращает `400` на любой `?token=...`, чтобы токены никогда не попадали в URL и access-логи reverse proxy
- Проверка токена через `AuthMiddleware` до вызова `HandleWebSocket`
- **Pre-auth лимит:** до аутентификации действует лимит 20 попыток upgrade на IP в минуту (`PreAuthLimiter`), после исчерпания — соединение отклоняется (fails closed)

**CORS защита:**
- `CheckOrigin` проверяет источник WebSocket соединения
- Разрешённые origins настраиваются через `ALLOWED_ORIGINS`
- По умолчанию: `http://localhost:5173,http://localhost:8080,http://localhost:3000`

**Rate Limiting:**
- 60 сообщений в минуту на пользователя (token bucket)
- Применяется ко всем типам сообщений кроме ping
- При превышении лимита клиент получает ошибку `"Rate limit exceeded"`

**Валидация комнат:**
- Подписка только на свои комнаты (формат `chat_<conversationId>`)
- `parseRoomFromData` — принимает строку или объект с `room` полем
- Broadcast по комнате — только авторизованные подписчики получают сообщения

### 4. REST API защита

**Middleware chain (каждый messenger endpoint):**
1. `AuthMiddleware` → проверяет `Authorization: Bearer <token>` → валидирует JWT → кладёт `claims` в контекст
2. `ensureAuth()` в handler → проверяет claims → 401 если нет
3. `isMember()` → проверяет членство в диалоге → 403 если нет
4. Дополнительные проверки:
   - Редактирование: только автор сообщения (`sender_user_id`)
   - Удаление: только автор + участник диалога
   - Pin: любой участник диалога

**Rate Limiting (messenger):**
- Чтение (list/get/receipts): 300 запросов/мин на пользователя
- Запись (send/edit/delete/pin): 60 запросов/мин на пользователя
- Auth (/me): 100 запросов/мин на пользователя

**Обработка ошибок:**
- `serverError()` — логирует реальную ошибку, клиенту возвращает `"Internal server error"`
- Детали ошибок никогда не утекают клиенту

### 5. Защита базы данных

**Row Level Security (RLS):**
Все таблицы мессенджера защищены RLS политиками (`040_clean_messenger.sql`):

| Таблица | SELECT | INSERT | UPDATE |
|---------|--------|--------|--------|
| `chat_conversations` | Только участники | Разрешено (создаётся через API) | Только участники |
| `chat_members` | Только со-участники | Только существующие участники | Только свои записи |
| `chat_messages` | Только участники диалога | Только от своего имени + участник | Только автор |
| `chat_receipts` | Через messages + members | Только на себя + участник | — |

`current_setting('app.current_user_id')` устанавливается Go-сервером перед каждым запросом. Даже при SQL-инъекции RLS не даст прочитать чужие данные.

**SQL Injection защита:**
- Все запросы используют параметризованные запросы (`$1`, `$2`, etc.)
- Валидация UUID перед использованием
- Prepared statements через `database/sql`

### 6. Валидация ввода

**Контент сообщений (`sanitizeContent`):**
- Удаление пробелов по краям
- Запрет пустого контента
- Лимит 4000 символов (руны, не байты)
- **Блокировка HTML** через regex `<[^>]*>` — защита от XSS

**Idempotency:**
- Уникальный `client_id` на каждое сообщение
- `UNIQUE (conversation_id, client_id)` в БД
- При повторной отправке возвращается существующее сообщение

### 7. Защита метаданных

**Сервер видит:**
- Кто с кем общается (conversation_id → members)
- Когда отправлены сообщения (sent_at)
- Статусы доставки/прочтения (read_at, delivered_at)
- unread_count для каждого участника

**Сервер НЕ видит:**
- Пароли пользователей (bcrypt хеш)
- Refresh токены в исходном виде (SHA-256 хеш в Redis)

**Сервер видит (при включённом шифровании):**
- Зашифрованный контент сообщений в БД (AES-256-GCM ciphertext)
- ⚠️ При расшифровке для API — сервер видит plaintext

## Известные ограничения

### 1. Серверное шифрование
**Риск:** Сервер владеет ключом шифрования и может читать все сообщения. Администратор сервера или злоумышленник с доступом к `MESSENGER_ENCRYPTION_KEY` имеет полный доступ к содержимому переписки.

**Митигация:**
- Минимизировать доступ к production-окружению
- Хранить `MESSENGER_ENCRYPTION_KEY` в защищённом secret manager (не в коде)
- Регулярная ротация ключа (требует перешифрования всех сообщений)

**Важно:** текущая реализация не предоставляет защиты от оператора сервера и не должна рекламироваться как приватный мессенджер уровня Signal. Полноценный протокол с клиентскими ключами и forward secrecy не является частью текущей системы.

### 2. Хранение токенов в localStorage
**Риск:** При XSS-атаке злоумышленник может украсть access + refresh токены и получить полный доступ к аккаунту.

**Митигация:**
- Content Security Policy (CSP) для предотвращения inline-скриптов
- Регулярное обновление зависимостей
- Аудит кода на XSS-уязвимости

**Альтернативы:**
- httpOnly cookie для токенов (требует SameSite + CSRF защиту)
- BFF (Backend-for-Frontend) паттерн

### 3. Токен в WebSocket URL
**Риск:** JWT токен в query string может быть записан в access-логи Caddy (edge reverse proxy) и логи браузера.

**Митигация:**
- Настроить reverse proxy на исключение query string из логов
- Использовать WSS (TLS) — URL шифруется при передаче

**Альтернатива:**
- Передавать токен в первом WebSocket фрейме после установки соединения

### 4. Отсутствие Perfect Forward Secrecy (PFS)
**Риск:** При компрометации `MESSENGER_ENCRYPTION_KEY` все прошлые сообщения могут быть расшифрованы (если злоумышленник имеет доступ к дампу БД).

**Ограничение:** серверное шифрование не обеспечивает forward secrecy. Ротация ключа требует отдельной процедуры перешифрования всех сообщений.

### 5. Отсутствие CSP заголовков
**Риск:** Без Content Security Policy браузер не ограничен в выполнении скриптов — XSS-уязвимость в одной библиотеке может скомпрометировать всё приложение.

**Решение:** Добавить CSP заголовки в Caddyfile (источник истины — edge reverse proxy; актуальная политика — в разделе «Production настройки» ниже).

### 6. Нерасшифровываемые сообщения
**Риск:** Сообщения, зашифрованные до ротации ключа (или повреждённые), не могут быть расшифрованы текущим ключом. Ранее клиенту возвращался сырой ciphertext; теперь вместо него отдаётся placeholder `crypto.DecryptionFailedPlaceholder`, чтобы зашифрованный blob не покидал сервер.

**Следствие:** в редком случае хранения legacy-сообщений в plaintext (эпоха до обязательного шифрования) такие строки тоже будут показаны как placeholder, т.к. plaintext не является валидным ciphertext. Шифрование обязательно в production (`crypto.Init` падает без ключа), поэтому на практике это не встречается.

### 7. Отсутствие CSRF защиты на REST API
**Риск:** State-changing операции (отправка/редактирование/удаление сообщений) могут быть выполнены с другого сайта, если пользователь авторизован.

**Митигация:** WebSocket-операции не подвержены CSRF. REST API для messenger используется внутри SPA — браузер автоматически отправляет заголовок `Origin`.

**Для будущих версий:** Добавить CSRF токены или SameSite cookie для REST API.

## Рекомендации по развёртыванию

### Production настройки

1. **HTTPS обязателен:**
```bash
# WSS требует HTTPS
# Никогда не используйте ws:// в production, только wss://
```

2. **Задайте ключ шифрования:**
```bash
MESSENGER_ENCRYPTION_KEY=$(openssl rand -base64 32)
# Ключ должен быть одинаковым на всех инстансах и неизменным между перезапусками
```

3. **Задайте JWT секрет:**
```bash
JWT_SECRET=$(openssl rand -base64 32)
```

4. **Настройте ALLOWED_ORIGINS:**
```bash
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
```

5. **CSP и HSTS заголовки** — конфигурация отслеживается в `Caddyfile` (matcher `@production`, применяется только для реальных доменов, не для localhost). Источник истины — `Caddyfile`; ниже приведена актуальная версия:
```
@production not host localhost docs.localhost dev.localhost
header @production Strict-Transport-Security "max-age=31536000; includeSubDomains"
header {
    X-Content-Type-Options "nosniff"
    X-Frame-Options "DENY"
    Referrer-Policy "strict-origin-when-cross-origin"
    Content-Security-Policy "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; frame-src 'self' https://challenges.cloudflare.com; script-src 'self' blob: https://integrate.depay.com https://challenges.cloudflare.com; worker-src 'self' blob: https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; img-src 'self' data: blob: https:; connect-src 'self' wss: https://integrate.depay.com https://api.depay.com https://challenges.cloudflare.com; font-src 'self'; media-src 'self' blob:;"
}
```
CSP задаётся **без** `unsafe-eval`; `connect-src` ограничен собственным доменом, `wss:` и платёжными доменами depay; `frame-src` разрешает self + challenges.cloudflare.com (Turnstile).

**Исключение для dev-панели (dev.*):** dev-панель логинится как OAuth-клиент основного сайта — после consent её callback обменивает код кросс-доменно (`dev.*` → `https://{$DOMAIN}/oauth/token`, `/oauth/userinfo`). Строгий `connect-src 'self' wss: ...` без `{$DOMAIN}` блокировал этот обмен (в консоли браузера: CSP violation + `NetworkError when attempting to fetch resource` → «Ошибка входа» на dev-панели). В Caddyfile для dev.* задан отдельный CSP (матчер `@devCsp`, применяется только к `dev.{$DOMAIN}`) — та же политика плюс `http://{$DOMAIN}` и `https://{$DOMAIN}` в `connect-src`. Основной сайт и docs сохраняют строгую политику. При изменении общей политики синхронизируйте dev-версию (в Caddyfile есть комментарий-предупреждение).

6. **Включите rate limiting:**
Rate limiting уже реализован на уровне Go-бэкенда (auth, messenger 300/60 req/min, PreAuthLimiter для WebSocket upgrade). Дополнительно можно ограничить на edge — директива Caddy `rate_limit`:
```caddy
rate_limit {
    zone api {
        key {remote_host}
        events 30
        window 1s
    }
}
```

7. **Мониторинг:**
- Логируйте попытки подключения с неразрешённых origins
- Отслеживайте rate limit violations
- Мониторьте аномальную активность (частые 401/403)

## Аудит безопасности

### Что проверять:

1. **Шифрование:**
   - ✅ AES-256-GCM (проверенный стандарт)
   - ✅ Уникальный nonce через crypto/rand
   - ✅ AEAD — защита от tampering
   - ⚠️ Ключ на сервере — админ видит сообщения

2. **Аутентификация:**
   - ✅ JWT access + refresh токены
   - ✅ Token blacklist в Redis
   - ✅ Safe refresh token rotation
   - ✅ 2FA (TOTP) с recovery codes
   - ✅ Middleware на всех endpoint'ах

3. **Авторизация:**
   - ✅ RLS на всех таблицах
   - ✅ Проверка членства в диалоге (isMember)
   - ✅ Проверка авторства для edit/delete
   - ✅ Изоляция данных между пользователями

4. **Защита от атак:**
   - ✅ Rate limiting (token bucket)
   - ✅ CORS/Origin проверка
   - ✅ SQL injection защита (параметризованные запросы)
   - ✅ HTML blocking в сообщениях (XSS защита контента)
   - ⚠️ XSS через localStorage токенов (требует CSP)
   - ⚠️ CSRF защита (SPA — частично защищено Same-Origin Policy)

## Отчёт об уязвимостях

Если вы обнаружили уязвимость безопасности, пожалуйста:
1. НЕ создавайте публичный issue
2. Свяжитесь с разработчиками напрямую
3. Дайте время на исправление перед публичным раскрытием

## Дополнительные ресурсы

- [AES-GCM спецификация (NIST SP 800-38D)](https://csrc.nist.gov/publications/detail/sp/800-38d/final)
- [OWASP JWT Security Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [OWASP WebSocket Security](https://owasp.org/www-community/vulnerabilities/WebSocket_security)
- [PostgreSQL Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
