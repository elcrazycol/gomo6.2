# Инструкция по запуску мессенджера Gomo6

## Требования

- Docker и Docker Compose
- Node.js 18+ (для фронтенда)
- Go 1.21+ (если запускаете бэкенд локально без Docker)

## Быстрый старт (Docker)

### 1. Запустите все сервисы

```bash
cd apps/backend-go
docker-compose up -d
```

Это запустит:
- PostgreSQL (порт 5432)
- Redis (порт 6379)
- Garage S3 (порт 3900)
- Backend Go (порт 8080)

### 2. Проверьте что миграции применились

```bash
docker-compose logs backend | grep "migration"
```

Должна быть применена миграция `019_messenger_tables.sql` с таблицами мессенджера.

### 3. Запустите фронтенд

```bash
cd ../../apps/web
npm install
npm run dev
```

Фронтенд будет доступен на `http://localhost:5173`

### 4. Откройте мессенджер

1. Зарегистрируйтесь или войдите в систему
2. Перейдите на страницу `/messages`
3. Начните диалог с другим пользователем

## Настройка переменных окружения

### Backend (docker-compose.yml)

```yaml
environment:
  # База данных
  DATABASE_URL: postgres://gomo6:gomo6password@postgres:5432/gomo6?sslmode=disable
  
  # Redis для WebSocket pub/sub
  REDIS_URL: redis://redis:6379
  
  # JWT секрет (ИЗМЕНИТЕ В PRODUCTION!)
  JWT_SECRET: your-secret-key-change-in-production
  
  # WebSocket CORS - разрешённые origins
  ALLOWED_ORIGINS: http://localhost:5173,http://localhost:8080,http://localhost:3000
  
  # Окружение
  ENVIRONMENT: development
```

### Frontend (.env)

```bash
# WebSocket URL
VITE_WS_URL=ws://localhost:8080/ws

# API URL
VITE_API_URL=http://localhost:8080
```

## Проверка работоспособности

### 1. Проверьте здоровье бэкенда

```bash
curl http://localhost:8080/health
```

Ответ должен быть:
```json
{
  "status": "ok",
  "websocket": true
}
```

### 2. Проверьте WebSocket соединение

Откройте DevTools в браузере → Network → WS и проверьте:
- Соединение установлено с `ws://localhost:8080/ws?token=...`
- Получено сообщение `{"type":"connected",...}`

### 3. Проверьте таблицы в БД

```bash
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "\dt chat_*"
```

Должны быть таблицы:
- `chat_user_keys`
- `chat_conversations`
- `chat_conversation_members`
- `chat_messages`
- `chat_receipts`

## Отладка

### WebSocket не подключается

**Проблема:** `WebSocket connection failed`

**Решение:**
1. Проверьте что бэкенд запущен: `curl http://localhost:8080/health`
2. Проверьте логи: `docker-compose logs backend`
3. Проверьте что токен валидный (не истёк)
4. Проверьте ALLOWED_ORIGINS в docker-compose.yml

### Ошибка "404 page not found" при обращении к chat_user_keys

**Проблема:** REST API не находит таблицы мессенджера

**Решение:**
1. Проверьте что миграция применилась: `docker-compose logs backend | grep "019_messenger"`
2. Перезапустите бэкенд: `docker-compose restart backend`
3. Проверьте что таблицы существуют в БД (см. выше)

### Сообщения не шифруются

**Проблема:** Ошибка при шифровании или `[Не удалось расшифровать сообщение]`

**Решение:**
1. Очистите localStorage: `localStorage.clear()` в DevTools Console
2. Перезагрузите страницу
3. Проверьте что libsodium загружается: DevTools → Network → ищите `libsodium`

### Rate limit exceeded

**Проблема:** `Rate limit exceeded. Please slow down.`

**Решение:**
- Это нормально если отправляете больше 60 сообщений в минуту
- Подождите минуту и попробуйте снова
- Для тестирования можете увеличить лимит в `hub.go`:
  ```go
  rateLimiter: NewRateLimiter(120, time.Minute), // 120 вместо 60
  ```

## Архитектура

```
┌─────────────┐         WebSocket (wss://)         ┌──────────────┐
│   Browser   │◄──────────────────────────────────►│  Go Backend  │
│  (React)    │                                     │   (Gin)      │
│             │         REST API (https://)         │              │
│  libsodium  │◄──────────────────────────────────►│              │
│  E2EE       │                                     │              │
└─────────────┘                                     └──────┬───────┘
                                                           │
                                                           │
                                    ┌──────────────────────┼──────────────┐
                                    │                      │              │
                                    ▼                      ▼              ▼
                              ┌──────────┐          ┌─────────┐    ┌─────────┐
                              │PostgreSQL│          │  Redis  │    │ Garage  │
                              │   (DB)   │          │(Pub/Sub)│    │  (S3)   │
                              └──────────┘          └─────────┘    └─────────┘
```

### Поток сообщения

1. **Отправка:**
   - Пользователь A вводит текст
   - Фронтенд шифрует текст с помощью libsodium (публичный ключ B + приватный ключ A)
   - POST запрос на `/rest/v1/chat_messages` с зашифрованным текстом
   - Бэкенд сохраняет в PostgreSQL
   - Триггер обновляет `last_message_at` и `unread_count_cache`
   - Supabase Realtime отправляет уведомление через WebSocket

2. **Получение:**
   - Пользователь B получает уведомление через WebSocket
   - Фронтенд загружает сообщение через REST API
   - Фронтенд расшифровывает текст (публичный ключ A + приватный ключ B)
   - Отображает сообщение
   - Отправляет квитанцию о доставке/прочтении

## Production развёртывание

### 1. Используйте HTTPS/WSS

```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # WebSocket
    location /ws {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # REST API
    location / {
        proxy_pass http://backend:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 2. Обновите переменные окружения

```bash
# Production secrets
JWT_SECRET=$(openssl rand -base64 32)
FEDERATION_KEY=$(openssl rand -base64 32)

# Production origins
ALLOWED_ORIGINS=https://yourdomain.com,https://www.yourdomain.com

# Environment
ENVIRONMENT=production
```

### 3. Настройте мониторинг

```bash
# Логи WebSocket
docker-compose logs -f backend | grep WebSocket

# Метрики Redis
docker-compose exec redis redis-cli INFO stats

# Метрики PostgreSQL
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "SELECT * FROM pg_stat_activity WHERE datname = 'gomo6';"
```

## Тестирование

### Ручное тестирование

1. Откройте два браузера (или два окна в режиме инкогнито)
2. Войдите под разными пользователями
3. Начните диалог
4. Отправьте сообщения в обе стороны
5. Проверьте:
   - Сообщения доставляются в реальном времени
   - Статусы доставки/прочтения обновляются
   - Счётчик непрочитанных работает
   - Шифрование работает (проверьте в БД что ciphertext не читаем)

### Проверка безопасности

```bash
# Проверьте что приватные ключи не в БД
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "SELECT * FROM chat_user_keys LIMIT 1;"
# Должен быть только public_key, НЕ private_key

# Проверьте что сообщения зашифрованы
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "SELECT ciphertext FROM chat_messages LIMIT 1;"
# Должна быть нечитаемая строка в base64

# Проверьте RLS
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "SELECT tablename, policyname FROM pg_policies WHERE tablename LIKE 'chat_%';"
# Должны быть политики для всех таблиц
```

## Часто задаваемые вопросы

**Q: Можно ли восстановить сообщения если потерял приватный ключ?**
A: Нет. Это особенность E2EE - без приватного ключа сообщения невозможно расшифровать.

**Q: Видит ли сервер содержимое сообщений?**
A: Нет. Сервер хранит только зашифрованный текст (ciphertext) и не имеет приватных ключей для расшифровки.

**Q: Можно ли использовать мессенджер на нескольких устройствах?**
A: Сейчас нет - приватный ключ хранится в localStorage конкретного браузера. Для multi-device нужна синхронизация ключей (будущая функция).

**Q: Безопасно ли хранить ключи в localStorage?**
A: Это компромисс между удобством и безопасностью. Для максимальной безопасности рекомендуется использовать аппаратные токены (будущая функция).

## Поддержка

Если возникли проблемы:
1. Проверьте логи: `docker-compose logs backend`
2. Проверьте DevTools Console в браузере
3. Создайте issue на GitHub с описанием проблемы и логами
