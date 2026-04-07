# Система ботов Gomo6

## Описание
Полнофункциональная система ботов на Lua для социальной сети Gomo6. Боты могут реагировать на события (посты, треды, комментарии) и взаимодействовать с платформой.

## Возможности

### Backend (Go)
- ✅ CRUD API для управления ботами
- ✅ Lua runtime с песочницей (sandbox)
- ✅ Динамическая загрузка/перезагрузка ботов
- ✅ Публикация событий через Redis
- ✅ Обработка событий в реальном времени
- ✅ Логирование и статистика ботов
- ✅ Лимит 5 ботов на пользователя

### Frontend (React)
- ✅ Страница управления ботами `/bots`
- ✅ Создание ботов с Lua кодом
- ✅ Редактирование кода ботов
- ✅ Включение/выключение ботов
- ✅ Удаление ботов
- ✅ Интеграция в настройки

## API Endpoints

### Боты
- `POST /api/v1/bots` - Создать бота
- `GET /api/v1/bots` - Получить список ботов
- `GET /api/v1/bots/:id` - Получить бота
- `PUT /api/v1/bots/:id` - Обновить бота
- `DELETE /api/v1/bots/:id` - Удалить бота
- `POST /api/v1/bots/:id/toggle` - Включить/выключить бота
- `GET /api/v1/bots/:id/logs` - Получить логи бота
- `GET /api/v1/bots/:id/stats` - Получить статистику бота
- `DELETE /api/v1/bots/:id/logs` - Очистить логи бота

## Lua API для ботов

### Функции

#### bot.log(level, message)
Логирование сообщений
```lua
bot.log("info", "Бот запущен")
bot.log("error", "Произошла ошибка")
```

#### bot.sendThreadPost(thread_id, content)
Отправить пост в тред
```lua
bot.sendThreadPost(post.thread_id, "Привет! Я бот 🤖")
```

#### bot.sendWallComment(post_id, content)
Отправить комментарий на стену
```lua
bot.sendWallComment(post.id, "Отличный пост!")
```

#### bot.getUser(user_id)
Получить информацию о пользователе
```lua
local user = bot.getUser(post.user_id)
if user then
  bot.log("info", "Пользователь: " .. user.username)
end
```

#### bot.sleep(milliseconds)
Задержка выполнения
```lua
bot.sleep(1000) -- 1 секунда
```

### События

#### onThreadPost(post)
Вызывается при создании поста в треде
```lua
function onThreadPost(post)
  bot.log("info", "Новый пост: " .. post.id)

  local content = post.content or ""
  if content:match("привет") then
    bot.sendThreadPost(post.thread_id, "Привет! 👋")
  end
end
```

#### onThread(thread)
Вызывается при создании треда
```lua
function onThread(thread)
  bot.log("info", "Новый тред: " .. thread.title)
end
```

#### onWallPost(post)
Вызывается при создании поста на стене
```lua
function onWallPost(post)
  bot.log("info", "Пост на стене: " .. post.id)
end
```

#### onWallComment(comment)
Вызывается при создании комментария на стене
```lua
function onWallComment(comment)
  bot.log("info", "Комментарий: " .. comment.id)
end
```

## Примеры ботов

### Приветственный бот
```lua
function onThreadPost(post)
  local content = post.content or ""

  if content:match("привет") or content:match("hello") then
    bot.sendThreadPost(post.thread_id, "Привет! Я бот 🤖")
  end
end
```

### Бот-помощник
```lua
function onThreadPost(post)
  local content = post.content or ""

  if content:match("помощь") or content:match("help") then
    local help_text = [[
Доступные команды:
- /help - показать эту справку
- /info - информация о боте
]]
    bot.sendThreadPost(post.thread_id, help_text)
  end

  if content:match("/info") then
    bot.sendThreadPost(post.thread_id, "Я бот-помощник версии 1.0")
  end
end
```

### Бот-модератор
```lua
function onThreadPost(post)
  local content = post.content or ""

  -- Проверка на запрещённые слова
  local bad_words = {"спам", "реклама"}

  for _, word in ipairs(bad_words) do
    if content:lower():match(word) then
      bot.log("warning", "Обнаружено запрещённое слово: " .. word)
      bot.sendThreadPost(post.thread_id, "⚠️ Пожалуйста, соблюдайте правила форума")
      break
    end
  end
end
```

## Использование

### Создание бота через UI
1. Перейти в Настройки → Основные → Боты
2. Нажать "Создать бота"
3. Заполнить поля:
   - Username (латиница)
   - Отображаемое имя
   - Описание
   - Lua код
4. Нажать "Создать"

### Редактирование бота
1. Открыть страницу ботов `/bots`
2. Нажать кнопку редактирования (карандаш)
3. Изменить код или настройки
4. Нажать "Сохранить"
5. Бот автоматически перезагрузится

### Включение/выключение бота
1. Открыть страницу ботов `/bots`
2. Нажать кнопку питания
3. Бот будет включён или выключен

## Архитектура

### Backend
```
cmd/server/main.go          - Точка входа, инициализация BotManager
internal/bots/
  ├── runtime.go            - BotManager и BotRuntime
  └── lua_api.go            - Lua API функции
internal/api/handlers/
  ├── bot_handler.go        - CRUD операции с ботами
  └── bot_events.go         - Публикация событий в Redis
```

### Frontend
```
src/pages/Bots.tsx          - Страница управления ботами
src/pages/Settings.tsx      - Ссылка на ботов в настройках
```

### Поток данных
1. Пользователь создаёт пост → PostsHandler
2. PostsHandler публикует событие в Redis канал `bot:events`
3. BotManager получает событие
4. BotManager вызывает Lua функцию у всех активных ботов
5. Бот обрабатывает событие и может ответить через API

## Безопасность

### Песочница Lua
- Отключены модули: `io`, `os`, `debug`, `package`
- Ограничение на размер кода: 10KB
- Rate limiting: 10 запросов в секунду на бота
- Изоляция между ботами

### Ограничения
- Максимум 5 ботов на пользователя
- Только владелец может управлять ботом
- Боты не могут выполнять системные команды

## Тестирование

### Запуск тестов
```bash
# Backend тесты
cd apps/backend-go
bash test_bot_integration.sh

# Проверка событий
bash test_bot_events.sh
```

### Ручное тестирование
1. Создать бота через UI
2. Создать тред
3. Написать пост с триггерным словом (например, "привет")
4. Проверить, что бот ответил

## Мониторинг

### Логи
```bash
# Логи backend
docker logs backend-go-backend-1 -f | grep -i bot

# Логи конкретного бота
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/bots/$BOT_ID/logs
```

### Статистика
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/bots/$BOT_ID/stats
```

## Troubleshooting

### Бот не отвечает
1. Проверить, что бот активен (is_active = true)
2. Проверить логи бота через API
3. Проверить логи backend: `docker logs backend-go-backend-1`
4. Убедиться, что события публикуются: `grep "BotEvents" logs`

### Ошибки Lua
- Проверить синтаксис Lua кода
- Убедиться, что используются только разрешённые функции
- Проверить логи бота

### Бот не загружается
- Проверить, что не превышен лимит (5 ботов)
- Убедиться, что username уникален
- Проверить размер Lua кода (макс 10KB)

## Roadmap

- [ ] Больше Lua API функций (отправка сообщений, работа с профилями)
- [ ] Веб-редактор Lua с подсветкой синтаксиса
- [ ] Marketplace ботов
- [ ] Шаблоны ботов
- [ ] Расширенная статистика
- [ ] Webhook поддержка
