# Архитектура системы ботов Gomo6

## Обзор

Система ботов на Lua для социальной сети Gomo6. Боты могут взаимодействовать с:
- Постами на стенах пользователей (profile_wall_posts)
- Комментариями к постам (profile_wall_post_comments)
- Тредами в гомосабах (threads)
- Постами в тредах (posts)
- В будущем: личные чаты

## Архитектура

### 1. База данных (PostgreSQL)

```sql
-- Таблица ботов
CREATE TABLE bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url TEXT,
    description TEXT,
    lua_code TEXT NOT NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Логи ботов
CREATE TABLE bot_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    level VARCHAR(20) NOT NULL, -- info, warn, error, debug
    message TEXT NOT NULL,
    context JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Статистика ботов
CREATE TABLE bot_stats (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bot_id UUID NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    commands_processed INTEGER DEFAULT 0,
    errors_count INTEGER DEFAULT 0,
    date DATE DEFAULT CURRENT_DATE,
    UNIQUE(bot_id, date)
);

-- Индексы
CREATE INDEX idx_bots_owner_id ON bots(owner_id);
CREATE INDEX idx_bots_username ON bots(username);
CREATE INDEX idx_bots_token ON bots(token);
CREATE INDEX idx_bot_logs_bot_id ON bot_logs(bot_id);
CREATE INDEX idx_bot_logs_created_at ON bot_logs(created_at);
CREATE INDEX idx_bot_stats_bot_id_date ON bot_stats(bot_id, date);
```

### 2. API Endpoints

#### Управление ботами
- `POST /api/bots` - создать бота
- `GET /api/bots` - список моих ботов
- `GET /api/bots/:id` - информация о боте
- `PUT /api/bots/:id` - обновить бота (код, настройки)
- `DELETE /api/bots/:id` - удалить бота
- `POST /api/bots/:id/toggle` - включить/выключить бота
- `POST /api/bots/:id/test` - протестировать код бота

#### Логи и статистика
- `GET /api/bots/:id/logs` - получить логи (с пагинацией)
- `GET /api/bots/:id/stats` - получить статистику
- `DELETE /api/bots/:id/logs` - очистить логи

### 3. Lua Runtime (Go + gopher-lua)

#### Структура Bot Runtime

```go
type BotRuntime struct {
    Bot       *models.Bot
    VM        *lua.LState
    DB        *sql.DB
    Redis     *redis.Client
    WSHub     *websocket.Hub
    RateLimit *RateLimiter
}

type BotEvent struct {
    Type    string // "wall_post", "wall_comment", "thread", "post", "message"
    Data    interface{}
    User    *models.User
    Context map[string]interface{}
}
```

#### Lua API для ботов

```lua
-- Отправка сообщений
bot.sendWallPost(userId, content, options)
bot.sendWallComment(postId, content)
bot.sendThreadPost(threadId, content, options)
bot.sendThread(boardId, title, content, options)

-- Получение данных
bot.getUser(userId)
bot.getWallPost(postId)
bot.getThread(threadId)

-- Логирование
bot.log(level, message) -- level: "info", "warn", "error", "debug"

-- Утилиты
bot.sleep(milliseconds) -- с ограничением
bot.random(min, max)
bot.match(text, pattern) -- regex matching
```

#### События, которые бот может обрабатывать

```lua
-- Новый пост на стене
function onWallPost(post, author)
    if post.content:match("/hello") then
        bot.sendWallComment(post.id, "Привет, " .. author.username .. "!")
    end
end

-- Новый комментарий на стене
function onWallComment(comment, post, author)
    bot.log("info", "Комментарий от " .. author.username)
end

-- Новый тред в гомосабе
function onThread(thread, board, author)
    if board.slug == "test" then
        bot.sendThreadPost(thread.id, "Добро пожаловать в тред!")
    end
end

-- Новый пост в треде
function onThreadPost(post, thread, author)
    if post.content:match("@bot") then
        bot.sendThreadPost(thread.id, "Вы меня звали?")
    end
end

-- Команды (начинаются с /)
function onCommand(command, args, context)
    if command == "help" then
        return "Доступные команды: /help, /info"
    elseif command == "info" then
        return "Я бот на Lua!"
    end
end
```

### 4. Безопасность и ограничения

#### Sandbox Lua
- Отключены опасные модули: `io`, `os`, `debug`, `package`, `dofile`, `loadfile`
- Ограничение времени выполнения: 5 секунд на событие
- Ограничение памяти: 50MB на бота
- Ограничение инструкций: 1 миллион на событие

#### Rate Limiting
- Максимум 10 сообщений в минуту
- Максимум 100 сообщений в час
- Максимум 1000 сообщений в день

#### Квоты
- Максимум 5 ботов на пользователя
- Максимум 10KB Lua кода на бота
- Логи хранятся 7 дней

### 5. Docker контейнер

```dockerfile
FROM golang:1.21-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o bot-server ./cmd/bot-server

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/bot-server .
EXPOSE 8081
CMD ["./bot-server"]
```

```yaml
# docker-compose.yml (добавить)
bot-server:
  build:
    context: ./apps/backend-go
    dockerfile: Dockerfile.bots
  ports:
    - "8081:8081"
  environment:
    DATABASE_URL: postgres://gomo6:gomo6password@postgres:5432/gomo6?sslmode=disable
    REDIS_URL: redis://redis:6379
    BOT_SERVER_PORT: 8081
  depends_on:
    - postgres
    - redis
    - backend
```

### 6. Интеграция с основным backend

#### WebSocket события для ботов
Когда происходит событие (новый пост, комментарий и т.д.), основной backend публикует событие в Redis:

```go
// В handlers для постов/комментариев
func (h *Handler) CreateWallPost(c *gin.Context) {
    // ... создание поста ...

    // Отправить событие ботам
    h.Redis.Publish(ctx, "bot:events", json.Marshal(BotEvent{
        Type: "wall_post",
        Data: post,
        User: author,
    }))
}
```

Bot server подписывается на канал `bot:events` и обрабатывает события.

### 7. Frontend (React)

#### Страницы
- `/bots` - список моих ботов
- `/bots/new` - создать нового бота
- `/bots/:id` - редактор бота с Monaco Editor
- `/bots/:id/logs` - логи бота
- `/bots/:id/stats` - статистика бота

#### Компоненты
- `BotEditor` - Monaco Editor для Lua кода с подсветкой синтаксиса
- `BotList` - список ботов с карточками
- `BotLogs` - просмотр логов в реальном времени
- `BotStats` - графики статистики (recharts)
- `BotTester` - тестирование бота перед сохранением

### 8. Пример простого бота

```lua
-- Бот-приветствие
function onWallPost(post, author)
    local content = post.content:lower()

    if content:match("привет") or content:match("hello") then
        bot.sendWallComment(
            post.id,
            "Привет, " .. author.username .. "! 👋"
        )
        bot.log("info", "Поприветствовал " .. author.username)
    end
end

-- Бот-счётчик слов
function onCommand(command, args, context)
    if command == "count" then
        local text = table.concat(args, " ")
        local words = 0
        for _ in text:gmatch("%S+") do
            words = words + 1
        end
        return "Количество слов: " .. words
    end
end
```

## Этапы реализации

1. ✅ Спроектировать архитектуру
2. Создать миграции БД для ботов
3. Реализовать Bot Runtime (Go + gopher-lua)
4. Создать API handlers для управления ботами
5. Интегрировать с WebSocket/Redis для событий
6. Создать Docker контейнер для bot-server
7. Реализовать frontend для управления ботами
8. Тестирование и документация

## Технологии

- **Backend**: Go 1.21+, Gin, gopher-lua
- **Database**: PostgreSQL 15
- **Cache/PubSub**: Redis 7
- **Frontend**: React 18, TypeScript, Monaco Editor
- **Container**: Docker, docker-compose
