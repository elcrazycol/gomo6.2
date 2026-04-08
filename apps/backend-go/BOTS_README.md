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

### Основные функции

#### Логирование и утилиты
- `bot.log(level, message)` - Логирование ("info", "warn", "error", "debug")
- `bot.sleep(milliseconds)` - Пауза (макс 5 секунд)
- `bot.id` - ID бота
- `bot.username` - Username бота

#### Сообщения и комментарии
- `bot.sendThreadPost(threadId, content)` - Отправить пост в тред
- `bot.replyToThreadPost(threadId, postId, content)` - Ответить на пост
- `bot.sendWallComment(postId, content)` - Комментарий на стену
- `bot.replyToWallComment(wallOwnerId, postId, commentId, content)` - Ответ на комментарий
- `bot.sendChatMessage(conversationId, content)` - Сообщение в чат

#### Треды и посты
- `bot.getThread(threadId)` - Получить информацию о треде
- `bot.getPost(postId)` - Получить информацию о посте
- `bot.getThreadPosts(threadId, limit)` - Получить посты треда (макс 100)
- `bot.createThread(title, content, serverDomain)` - Создать новый тред

#### Пользователи
- `bot.getUser(userId)` - Получить информацию о пользователе

#### Лайки
- `bot.likePost(postId)` - Поставить лайк
- `bot.unlikePost(postId)` - Убрать лайк

#### Чат
- `bot.getChatConversation(conversationId)` - Информация о беседе

#### Хранилище данных
- `bot.setData(key, value)` - Сохранить данные (постоянное хранилище)
- `bot.getData(key)` - Получить данные
- `bot.deleteData(key)` - Удалить данные

#### HTTP запросы
- `bot.httpGet(url)` - GET запрос (только разрешенные домены)
- `bot.httpPost(url, body)` - POST запрос

**Разрешенные домены для HTTP:**
- api.github.com
- jsonplaceholder.typicode.com
- httpbin.org
- api.openweathermap.org

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

#### onChatMessage(message)
Вызывается при получении сообщения в чате (если бот участник беседы)
```lua
function onChatMessage(message)
  bot.log("info", "Сообщение в чате: " .. message.id)
  
  -- Бот может читать зашифрованные сообщения только если он участник
  -- Для ответа используйте bot.sendChatMessage()
  if message.sender_user_id ~= bot.id then
    bot.sendChatMessage(message.conversation_id, "Получил ваше сообщение!")
  end
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

### Бот с хранилищем данных
```lua
function onThreadPost(post)
  local content = post.content or ""
  
  if content:find("@mybot") then
    -- Увеличиваем счетчик упоминаний
    local count = bot.getData("mentions") or "0"
    local num = tonumber(count) + 1
    bot.setData("mentions", tostring(num))
    
    bot.sendThreadPost(post.thread_id, "Меня упомянули " .. num .. " раз!")
  end
end
```

### Бот с HTTP запросами
```lua
function onThreadPost(post)
  local content = post.content or ""
  
  if content:find("/github ") then
    local username = content:match("/github (%S+)")
    local resp, err = bot.httpGet("https://api.github.com/users/" .. username)
    
    if resp and resp.status == 200 then
      bot.sendThreadPost(post.thread_id, "Пользователь найден: " .. resp.body)
    else
      bot.sendThreadPost(post.thread_id, "Ошибка: " .. (err or "не найден"))
    end
  end
end
```

### Бот с лайками
```lua
function onThreadPost(post)
  local content = post.content or ""
  
  -- Не лайкаем свои посты
  if post.user_id == bot.id then
    return
  end
  
  -- Лайкаем посты с ключевыми словами
  if content:find("отлично") or content:find("круто") then
    bot.likePost(post.id)
    bot.log("info", "Лайкнул пост: " .. post.id)
  end
end
```

### Бот-создатель тредов
```lua
function onThreadPost(post)
  local content = post.content or ""
  
  if content:find("/create ") then
    local title = content:match("/create (.+)")
    local success, threadId = bot.createThread(title, "Тред создан ботом")
    
    if success then
      bot.replyToThreadPost(post.thread_id, post.id, "✅ Тред создан: " .. threadId)
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

- [x] Поддержка мессенджера (чтение и отправка сообщений)
- [x] Хранилище данных (bot.setData/getData)
- [x] HTTP запросы (bot.httpGet/httpPost)
- [x] Работа с тредами (создание, получение постов)
- [x] Лайки постов
- [ ] Веб-редактор Lua с подсветкой синтаксиса
- [ ] Marketplace ботов
- [ ] Шаблоны ботов
- [ ] Расширенная статистика
- [ ] Webhook поддержка
- [ ] Больше разрешенных доменов для HTTP
- [ ] Работа с профилями пользователей
- [ ] Модерация (бан, мут)
