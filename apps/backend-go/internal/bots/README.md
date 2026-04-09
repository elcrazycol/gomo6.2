# Система ботов Gomo6

Система ботов на Lua для социальной сети Gomo6.

## Быстрый старт

### 1. Применить миграции

```bash
cd apps/backend-go
# Миграции применяются автоматически при запуске docker-compose
```

### 2. Запустить backend

```bash
cd apps/backend-go
docker-compose up -d
```

Backend автоматически загрузит все активные боты при старте.

### 3. Создать бота через API

```bash
# Получить JWT токен
TOKEN="your-jwt-token"

# Создать бота
curl -X POST http://localhost:8080/api/v1/bots \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "mybot",
    "display_name": "My First Bot",
    "description": "Мой первый бот на Lua",
    "lua_code": "function onWallPost(post)\n  bot.log(\"info\", \"Получен пост: \" .. post.id)\nend"
  }'
```

## API Endpoints

### Управление ботами

- `POST /api/v1/bots` - создать бота
- `GET /api/v1/bots` - список моих ботов
- `GET /api/v1/bots/:id` - информация о боте
- `PUT /api/v1/bots/:id` - обновить бота
- `DELETE /api/v1/bots/:id` - удалить бота
- `POST /api/v1/bots/:id/toggle` - включить/выключить бота

### Логи и статистика

- `GET /api/v1/bots/:id/logs` - получить логи (последние 100)
- `GET /api/v1/bots/:id/stats` - получить статистику (последние 30 дней)
- `DELETE /api/v1/bots/:id/logs` - очистить логи

## Структура бота

```json
{
  "id": "uuid",
  "owner_id": "uuid",
  "username": "mybot",
  "display_name": "My Bot",
  "avatar_url": "https://...",
  "description": "Описание бота",
  "lua_code": "function onWallPost(post) ... end",
  "token": "secret-token",
  "is_active": true,
  "created_at": "2026-04-07T00:00:00Z",
  "updated_at": "2026-04-07T00:00:00Z"
}
```

## Lua API

### Функции

```lua
-- Логирование
bot.log(level, message)

-- Отправка сообщений
bot.sendWallComment(postId, content)
bot.sendThreadPost(threadId, content)

-- Получение данных
bot.getUser(userId)

-- Утилиты
bot.sleep(milliseconds)
```

### События

```lua
-- Новый пост на стене
function onWallPost(post)
  -- post.id, post.content, post.author
end

-- Новый комментарий на стене
function onWallComment(comment)
  -- comment.id, comment.post_id, comment.content
end

-- Новый тред
function onThread(thread)
  -- thread.id, thread.title, thread.content, thread.board
end

-- Новый пост в треде
function onThreadPost(post)
  -- post.id, post.thread_id, post.content
end
```

## Примеры

См. [BOT_EXAMPLES.md](./BOT_EXAMPLES.md) для примеров ботов.

## Архитектура

```
┌─────────────────┐
│   Frontend      │
│   (React)       │
└────────┬────────┘
         │ HTTP API
         ▼
┌─────────────────┐      ┌──────────────┐
│   Backend       │◄────►│   Redis      │
│   (Go + Gin)    │      │   (PubSub)   │
└────────┬────────┘      └──────────────┘
         │
         ▼
┌─────────────────┐
│  Bot Manager    │
│  (gopher-lua)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Bot Runtimes   │
│  (Lua VMs)      │
└─────────────────┘
```

### Поток событий

1. Пользователь создаёт пост/комментарий
2. Handler сохраняет в БД
3. Handler публикует событие в Redis (`bot:events`)
4. Bot Manager получает событие
5. Bot Manager вызывает соответствующую функцию в каждом активном боте
6. Бот выполняет свой Lua код
7. Бот может отправить ответ через API функции

## Безопасность

### Sandbox

- Отключены модули: `io`, `os`, `debug`, `package`
- Отключены функции: `dofile`, `loadfile`, `load`
- Timeout: 5 секунд на событие
- Memory limit: 50MB на бота

### Rate Limiting

- 10 сообщений в минуту
- 100 сообщений в час
- 1000 сообщений в день

### Квоты

- Максимум 5 ботов на пользователя
- Максимум 10KB Lua кода
- Логи хранятся 7 дней

## Мониторинг

### Логи бота

```bash
curl http://localhost:8080/api/v1/bots/:id/logs \
  -H "Authorization: Bearer $TOKEN"
```

### Статистика

```bash
curl http://localhost:8080/api/v1/bots/:id/stats \
  -H "Authorization: Bearer $TOKEN"
```

## Разработка

### Тестирование бота локально

```lua
-- test_bot.lua
function onWallPost(post)
    bot.log("info", "Test: " .. post.content)
    bot.sendWallComment(post.id, "Test response")
end
```

### Отладка

Используйте `bot.log()` для отладки:

```lua
function onWallPost(post)
    bot.log("debug", "Post ID: " .. post.id)
    bot.log("debug", "Content: " .. (post.content or "empty"))

    -- Ваш код
end
```

## Troubleshooting

### Бот не отвечает

1. Проверьте, что бот активен: `is_active = true`
2. Проверьте логи бота на ошибки
3. Проверьте rate limit
4. Убедитесь, что функция-обработчик определена

### Ошибки в Lua коде

```bash
# Проверить логи
curl http://localhost:8080/api/v1/bots/:id/logs \
  -H "Authorization: Bearer $TOKEN" | jq '.[] | select(.level == "error")'
```

### Бот превышает rate limit

Уменьшите частоту отправки сообщений или добавьте задержки:

```lua
function onWallPost(post)
    bot.sleep(1000) -- Ждём 1 секунду
    bot.sendWallComment(post.id, "Response")
end
```

## TODO

- [ ] Webhook API для продвинутых пользователей
- [ ] Визуальный конструктор ботов
- [ ] Marketplace ботов
- [ ] Поддержка личных сообщений
- [ ] Inline-кнопки и меню
- [ ] Scheduled tasks (крон-задачи)
- [ ] Хранилище данных для ботов (key-value store)

## Лицензия

MIT
