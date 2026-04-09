# Сводка: Анализ и улучшение безопасности мессенджера Gomo6

## Что было сделано

### 1. Анализ существующей архитектуры ✅

**Найдено:**
- End-to-end шифрование с использованием libsodium (NaCl crypto_box)
- WebSocket для real-time коммуникации
- Приватные ключи хранятся в localStorage браузера
- Публичные ключи в базе данных
- Сообщения шифруются на клиенте перед отправкой

**Архитектура:**
```
Frontend (React) → libsodium E2EE → Backend (Go) → PostgreSQL
                ↓
            WebSocket (real-time)
                ↓
              Redis (pub/sub)
```

### 2. Созданы таблицы базы данных ✅

**Миграция:** `019_messenger_tables.sql`

Созданы таблицы:
- `chat_user_keys` - публичные ключи пользователей
- `chat_conversations` - диалоги
- `chat_conversation_members` - участники диалогов
- `chat_messages` - зашифрованные сообщения
- `chat_receipts` - квитанции доставки/прочтения

**Особенности:**
- Триггеры для автоматического обновления счётчиков непрочитанных
- Индексы для производительности
- Foreign keys для целостности данных

### 3. Улучшена безопасность WebSocket ✅

**До:**
```go
CheckOrigin: func(r *http.Request) bool {
    return true  // ❌ Разрешает все origins!
}
```

**После:**
```go
// Проверка разрешённых origins из конфигурации
func (h *Hub) CheckOrigin(r *http.Request) bool {
    origin := r.Header.Get("Origin")
    for _, allowed := range h.allowedOrigins {
        if origin == allowed {
            return true
        }
    }
    return false
}
```

**Настройка через переменную окружения:**
```bash
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:8080,http://localhost:3000
```

### 4. Добавлен Rate Limiting ✅

**Реализация:**
- Token bucket алгоритм
- Лимит: 60 сообщений в минуту на пользователя
- Автоматическая очистка старых buckets
- Исключение для ping сообщений

**Код:**
```go
if !c.Hub.rateLimiter.Allow(c.UserID) {
    log.Printf("[WebSocket] Rate limit exceeded for user %s", c.UserID)
    // Отправка ошибки клиенту
    continue
}
```

### 5. Добавлены REST API endpoints ✅

**Новые роуты:**
```
POST /rpc/v1/get_or_create_direct_chat
POST /rpc/v1/chat_mark_delivered
POST /rpc/v1/chat_mark_read

ANY /rest/v1/chat_user_keys
ANY /rest/v1/chat_conversations
ANY /rest/v1/chat_conversation_members
ANY /rest/v1/chat_messages
ANY /rest/v1/chat_receipts
```

### 6. Создана документация ✅

**Файлы:**
1. `MESSENGER_SECURITY.md` - полный анализ безопасности
2. `MESSENGER_SETUP.md` - инструкция по запуску и настройке

## Текущее состояние безопасности

### ✅ Что защищено

1. **End-to-End шифрование:**
   - Сервер не может прочитать сообщения
   - Используется проверенная библиотека libsodium
   - Уникальный nonce для каждого сообщения

2. **WebSocket безопасность:**
   - JWT аутентификация
   - CORS/Origin проверка
   - Rate limiting (60 msg/min)

3. **База данных:**
   - Параметризованные запросы (защита от SQL injection)
   - Валидация UUID
   - Триггеры для целостности данных

4. **Изоляция данных:**
   - Пользователи видят только свои диалоги
   - Проверка владения перед операциями

### ⚠️ Известные ограничения

1. **localStorage для приватных ключей**
   - Риск: XSS атака может украсть ключ
   - Митигация: CSP заголовки, аудит кода

2. **Отсутствие Perfect Forward Secrecy**
   - Риск: компрометация ключа = все прошлые сообщения
   - Решение: Double Ratchet (будущая версия)

3. **Нет верификации ключей**
   - Риск: MITM при обмене ключами
   - Решение: Safety numbers, QR-коды (будущая версия)

4. **Метаданные не защищены**
   - Сервер знает кто с кем общается
   - Решение: Sealed Sender (будущая версия)

## Как запустить

### Быстрый старт:

```bash
# 1. Запустить Docker сервисы
cd apps/backend-go
docker-compose up -d

# 2. Проверить что миграция применилась
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "\dt chat_*"

# 3. Запустить фронтенд
cd ../web
npm install
npm run dev

# 4. Открыть http://localhost:5173/messages
```

### Проверка работоспособности:

```bash
# Health check
curl http://localhost:8080/health

# Проверка таблиц
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "\dt chat_*"

# Логи WebSocket
docker-compose logs backend | grep WebSocket
```

## Рекомендации для production

1. **Обязательно HTTPS/WSS:**
   ```nginx
   location /ws {
       proxy_pass http://backend:8080;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
   }
   ```

2. **Сильные секреты:**
   ```bash
   JWT_SECRET=$(openssl rand -base64 32)
   ALLOWED_ORIGINS=https://yourdomain.com
   ```

3. **CSP заголовки:**
   ```nginx
   add_header Content-Security-Policy "default-src 'self';";
   ```

4. **Мониторинг:**
   - Логировать попытки с неразрешённых origins
   - Отслеживать rate limit violations
   - Мониторить аномальную активность

## Файлы изменений

### Новые файлы:
- `apps/backend-go/migrations/019_messenger_tables.sql`
- `apps/backend-go/internal/websocket/rate_limiter.go`
- `MESSENGER_SECURITY.md`
- `MESSENGER_SETUP.md`
- `SUMMARY.md` (этот файл)

### Изменённые файлы:
- `apps/backend-go/internal/config/config.go` - добавлен AllowedOrigins
- `apps/backend-go/internal/websocket/hub.go` - добавлен CheckOrigin и rate limiter
- `apps/backend-go/internal/websocket/client.go` - интегрирован rate limiter
- `apps/backend-go/cmd/server/main.go` - передача allowedOrigins в Hub
- `apps/backend-go/docker-compose.yml` - добавлена ALLOWED_ORIGINS
- `apps/backend-go/internal/api/routes/routes.go` - добавлены messenger endpoints
- `apps/backend-go/internal/api/handlers/rpc.go` - добавлены RPC функции

## Следующие шаги (опционально)

1. **Улучшить хранение ключей:**
   - Web Crypto API с non-extractable ключами
   - Аппаратные токены (WebAuthn)

2. **Добавить Perfect Forward Secrecy:**
   - Реализовать Double Ratchet протокол
   - Периодическая ротация ключей

3. **Верификация ключей:**
   - QR-коды для сравнения
   - Safety numbers (как в Signal)

4. **Multi-device поддержка:**
   - Синхронизация ключей между устройствами
   - Session management

5. **Защита метаданных:**
   - Sealed Sender
   - Onion routing

## Заключение

Мессенджер Gomo6 использует надёжное E2EE шифрование и теперь имеет дополнительные меры безопасности:
- ✅ Проверка origin для WebSocket
- ✅ Rate limiting
- ✅ Полная схема базы данных
- ✅ REST API endpoints
- ✅ Документация по безопасности

Система готова к использованию в development окружении. Для production требуется настройка HTTPS, сильных секретов и мониторинга.
