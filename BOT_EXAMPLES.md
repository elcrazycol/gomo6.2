# Примеры ботов на Lua

## Простой бот-приветствие

Этот бот приветствует пользователей, когда они пишут "привет" на стене.

```lua
-- Обработчик новых постов на стене
function onWallPost(post)
    local content = post.content or ""
    content = content:lower()

    if content:match("привет") or content:match("hello") then
        local author = post.author or {}
        local username = author.username or "друг"

        bot.sendWallComment(
            post.id,
            "Привет, " .. username .. "! 👋 Рад тебя видеть!"
        )

        bot.log("info", "Поприветствовал пользователя " .. username)
    end
end
```

## Бот-счётчик слов

Этот бот считает количество слов в посте и отвечает комментарием.

```lua
function onWallPost(post)
    local content = post.content or ""

    -- Считаем слова
    local words = 0
    for word in content:gmatch("%S+") do
        words = words + 1
    end

    if words > 0 then
        bot.sendWallComment(
            post.id,
            "📊 В твоём посте " .. words .. " слов(а)"
        )
    end
end
```

## Бот-модератор

Этот бот проверяет посты на запрещённые слова.

```lua
local banned_words = {"спам", "реклама", "купить"}

function onWallPost(post)
    local content = post.content or ""
    content = content:lower()

    for _, word in ipairs(banned_words) do
        if content:match(word) then
            bot.sendWallComment(
                post.id,
                "⚠️ Внимание! Пост содержит запрещённое слово: " .. word
            )
            bot.log("warn", "Обнаружено запрещённое слово в посте " .. post.id)
            return
        end
    end
end
```

## Бот для тредов

Этот бот приветствует новые треды в определённом гомосабе.

```lua
function onThread(thread)
    local board = thread.board or {}

    -- Реагируем только на треды в гомосабе "test"
    if board.slug == "test" then
        bot.sendThreadPost(
            thread.id,
            "🎉 Добро пожаловать в новый тред! Желаю интересной дискуссии!"
        )

        bot.log("info", "Поприветствовал новый тред: " .. thread.title)
    end
end
```

## Бот-помощник с командами

Этот бот отвечает на упоминания и команды в тредах.

```lua
function onThreadPost(post)
    local content = post.content or ""

    -- Проверяем упоминание бота
    if content:match("@bot") then
        local thread = post.thread or {}

        if content:match("помощь") or content:match("help") then
            bot.sendThreadPost(
                thread.id,
                "🤖 Я бот-помощник!\n\nДоступные команды:\n" ..
                "• @bot помощь - показать это сообщение\n" ..
                "• @bot инфо - информация о боте\n" ..
                "• @bot время - текущее время"
            )
        elseif content:match("инфо") then
            bot.sendThreadPost(
                thread.id,
                "ℹ️ Я работаю на Lua и помогаю пользователям!"
            )
        else
            bot.sendThreadPost(
                thread.id,
                "Вы меня звали? Напишите '@bot помощь' для списка команд."
            )
        end

        bot.log("info", "Обработал команду в треде")
    end
end
```

## Бот-статистика

Этот бот собирает статистику по постам пользователя.

```lua
local user_posts = {}

function onWallPost(post)
    local author = post.author or {}
    local user_id = author.id or "unknown"

    -- Увеличиваем счётчик постов пользователя
    user_posts[user_id] = (user_posts[user_id] or 0) + 1

    local count = user_posts[user_id]

    -- Поздравляем с юбилейными постами
    if count == 10 or count == 50 or count == 100 then
        bot.sendWallComment(
            post.id,
            "🎊 Поздравляю! Это твой " .. count .. "-й пост!"
        )
        bot.log("info", "Пользователь достиг " .. count .. " постов")
    end
end
```

## Бот с задержкой

Этот бот отвечает с небольшой задержкой.

```lua
function onWallPost(post)
    local content = post.content or ""

    if content:match("бот") then
        -- Ждём 2 секунды перед ответом
        bot.sleep(2000)

        bot.sendWallComment(
            post.id,
            "Извините за задержку! Я тут как тут 🤖"
        )
    end
end
```

## API функции бота

### bot.log(level, message)
Записывает сообщение в лог бота.
- `level`: "info", "warn", "error", "debug"
- `message`: текст сообщения

### bot.sendWallComment(postId, content)
Отправляет комментарий к посту на стене.
- Возвращает: `success (bool), id/error (string)`

### bot.sendThreadPost(threadId, content)
Отправляет пост в тред.
- Возвращает: `success (bool), id/error (string)`

### bot.getUser(userId)
Получает информацию о пользователе.
- Возвращает: таблицу с полями `id`, `username`, `domain`, `avatar_url`, `bio`

### bot.sleep(milliseconds)
Приостанавливает выполнение на указанное время (макс. 5000 мс).

## События

### onWallPost(post)
Вызывается при создании нового поста на стене.
- `post.id` - ID поста
- `post.content` - текст поста
- `post.author` - информация об авторе

### onWallComment(comment)
Вызывается при создании нового комментария на стене.
- `comment.id` - ID комментария
- `comment.post_id` - ID поста
- `comment.content` - текст комментария

### onThread(thread)
Вызывается при создании нового треда.
- `thread.id` - ID треда
- `thread.title` - заголовок
- `thread.content` - содержимое
- `thread.board` - информация о гомосабе

### onThreadPost(post)
Вызывается при создании нового поста в треде.
- `post.id` - ID поста
- `post.thread_id` - ID треда
- `post.content` - текст поста

## Ограничения

- Максимум 10 сообщений в минуту
- Максимум 100 сообщений в час
- Максимум 1000 сообщений в день
- Время выполнения: 5 секунд на событие
- Размер кода: 10 KB
- Максимум 5 ботов на пользователя
