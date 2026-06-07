# Работа ботов с мессенджером

## Модель безопасности

Мессенджер использует серверное AES-256-GCM шифрование. Сообщения хранятся в базе в `content_encrypted`. Сервер автоматически дешифрует сообщения перед отправкой ботам — боты получают `content` в открытом виде.

## Как это работает

1. **Пользователь → Сервер**: Клиент отправляет `{ content: "Привет, бот!" }`
2. **Сервер**: Шифрует `content` → `content_encrypted`, сохраняет в БД
3. **Сервер → Бот**: `BotEventPublisher` дешифрует и добавляет `content` в событие
4. **Бот получает**: Событие с полем `content` (уже расшифрованным)

## Использование в Lua

### Базовый пример

```lua
function onChatMessage(message)
    -- Не отвечаем на свои сообщения
    if message.sender_user_id == bot.id then
        return
    end

    -- Получаем текст
    local text = message.content or ""
    bot.log("info", "Получено: " .. text)

    -- Отправляем ответ
    bot.sendChatMessage(
        message.conversation_id,
        "Получил: " .. text
    )
end
```

### Обработка команд

```lua
function onChatMessage(message)
    if message.sender_user_id == bot.id then
        return
    end

    local text = message.content or ""

    if text:find("/help") then
        local help = "Доступные команды:\n"
        help = help .. "/help - справка\n"
        help = help .. "/ping - проверка\n"
        help = help .. "/time - время"
        bot.sendChatMessage(message.conversation_id, help)
        return
    end

    if text:find("/ping") then
        bot.sendChatMessage(message.conversation_id, "Понг! 🏓")
        return
    end

    if text:find("/time") then
        local time = os.date("%H:%M:%S")
        bot.sendChatMessage(message.conversation_id, "Время: " .. time)
        return
    end

    bot.sendChatMessage(
        message.conversation_id,
        "Напишите /help для списка команд"
    )
end
```

### Парсинг аргументов команд

```lua
function onChatMessage(message)
    if message.sender_user_id == bot.id then
        return
    end

    local text = message.content or ""

    if text:find("/echo ") then
        local echoText = text:match("/echo (.+)")
        if echoText then
            bot.sendChatMessage(message.conversation_id, "Эхо: " .. echoText)
        end
        return
    end

    if text:find("/repeat ") then
        local count = text:match("/repeat (%d+)")
        if count then
            local num = tonumber(count)
            local response = ""
            for i = 1, num do
                response = response .. "Повтор " .. i .. "\n"
            end
            bot.sendChatMessage(message.conversation_id, response)
        end
        return
    end
end
```

## Структура события onChatMessage

```lua
message = {
    id = "uuid",                    -- ID сообщения
    conversation_id = "uuid",       -- ID беседы
    sender_user_id = "uuid",        -- ID отправителя
    content = "текст сообщения",    -- Расшифрованный текст
    created_at = "2026-04-08T...",  -- Время создания
}
```

## Безопасность

- ✅ Сообщения хранятся в БД зашифрованными (AES-256-GCM)
- ✅ Сервер дешифрует прозрачно — клиент и боты работают с открытым текстом
- ✅ Ключ шифрования задаётся через `MESSENGER_ENCRYPTION_KEY`
- ✅ Боты изолированы в sandbox

## Лучшие практики

1. **Всегда проверяйте sender_user_id**
   ```lua
   if message.sender_user_id == bot.id then
       return
   end
   ```

2. **Проверяйте наличие content**
   ```lua
   local text = message.content or ""
   if text == "" then
       bot.log("warn", "Empty message")
       return
   end
   ```

3. **Логируйте команды**
   ```lua
   bot.log("info", "Command: " .. text)
   ```

4. **Обрабатывайте ошибки**
   ```lua
   local success, msgId = bot.sendChatMessage(convId, response)
   if not success then
       bot.log("error", "Failed to send: " .. msgId)
   end
   ```

5. **Rate limiting**: боты ограничены 10 действиями в минуту.

## FAQ

**Q: Почему бот не получает сообщения?**
A: Проверьте, что бот добавлен в беседу как участник.

**Q: Может ли бот читать старые сообщения?**
A: Нет, боты получают только новые сообщения через события.

**Q: Безопасно ли это?**
A: Да. Сообщения шифруются на сервере (AES-256-GCM) и дешифруются прозрачно.
