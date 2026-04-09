# Работа ботов с мессенджером

## Проблема

Мессенджер использует end-to-end шифрование (E2EE). Сообщения зашифрованы на клиенте и хранятся в базе как `ciphertext`. Боты не могут расшифровать сообщения, так как:
- У ботов нет приватных ключей (они намеренно не сохраняются)
- Боты работают на сервере, а расшифровка должна быть на клиенте

## Решение

Для сообщений, отправленных ботам, используется специальный формат `BOT_PLAINTEXT:`:

### Как это работает

1. **Пользователь → Бот**: Клиент отправляет сообщение с префиксом `BOT_PLAINTEXT:`
   ```
   ciphertext: "BOT_PLAINTEXT:Привет, бот!"
   ```

2. **Сервер → Бот**: `BotEventPublisher` извлекает plaintext и добавляет в событие
   ```go
   if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
       plaintext = strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
       message["plaintext"] = plaintext
   }
   ```

3. **Бот получает**: Событие с полем `plaintext`
   ```lua
   function onChatMessage(message)
       local text = message.plaintext or ""
       -- Теперь можно читать текст!
   end
   ```

## Использование в Lua

### Базовый пример

```lua
function onChatMessage(message)
    -- Не отвечаем на свои сообщения
    if message.sender_user_id == bot.id then
        return
    end

    -- Получаем текст
    local text = message.plaintext or ""
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

    local text = message.plaintext or ""

    -- Команда /help
    if text:find("/help") then
        local help = "Доступные команды:\n"
        help = help .. "/help - справка\n"
        help = help .. "/ping - проверка\n"
        help = help .. "/time - время"
        bot.sendChatMessage(message.conversation_id, help)
        return
    end

    -- Команда /ping
    if text:find("/ping") then
        bot.sendChatMessage(message.conversation_id, "Понг! 🏓")
        return
    end

    -- Команда /time
    if text:find("/time") then
        local time = os.date("%H:%M:%S")
        bot.sendChatMessage(message.conversation_id, "Время: " .. time)
        return
    end

    -- Обычный ответ
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

    local text = message.plaintext or ""

    -- Команда с аргументом: /echo текст
    if text:find("/echo ") then
        local echoText = text:match("/echo (.+)")
        if echoText then
            bot.sendChatMessage(message.conversation_id, "Эхо: " .. echoText)
        end
        return
    end

    -- Команда с числом: /repeat 5
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

### Сохранение контекста беседы

```lua
-- Хранилище для контекста (упрощенно)
function onChatMessage(message)
    if message.sender_user_id == bot.id then
        return
    end

    local text = message.plaintext or ""
    local convId = message.conversation_id

    -- Сохранить последнее сообщение
    bot.setData("last_msg_" .. convId, text)

    -- Команда /last - показать последнее сообщение
    if text:find("/last") then
        local lastMsg = bot.getData("last_msg_" .. convId)
        if lastMsg then
            bot.sendChatMessage(convId, "Последнее: " .. lastMsg)
        else
            bot.sendChatMessage(convId, "Нет сохраненных сообщений")
        end
        return
    end

    -- Обычный ответ
    bot.sendChatMessage(convId, "Сообщение сохранено!")
end
```

## Структура события onChatMessage

```lua
message = {
    id = "uuid",                    -- ID сообщения
    conversation_id = "uuid",       -- ID беседы
    sender_user_id = "uuid",        -- ID отправителя
    plaintext = "текст сообщения",  -- Расшифрованный текст (только для ботов)
    ciphertext = "BOT_PLAINTEXT:...", -- Оригинальный ciphertext
    created_at = "2026-04-08T...",  -- Время создания
}
```

## Безопасность

### Что безопасно:
- ✅ Пользователь → Пользователь: полное E2EE шифрование
- ✅ Plaintext доступен только ботам на сервере
- ✅ Plaintext не отправляется клиентам
- ✅ Боты изолированы в sandbox

### Ограничения:
- ⚠️ Боты видят plaintext сообщений, отправленных им
- ⚠️ Боты не могут расшифровать старые сообщения пользователей
- ⚠️ Сообщения ботов отправляются с префиксом `BOT_PLAINTEXT:`

## Лучшие практики

1. **Всегда проверяйте sender_user_id**
   ```lua
   if message.sender_user_id == bot.id then
       return  -- Не отвечаем на свои сообщения
   end
   ```

2. **Проверяйте наличие plaintext**
   ```lua
   local text = message.plaintext or ""
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

5. **Используйте rate limiting**
   - Боты ограничены 10 действиями в минуту
   - Не отправляйте слишком много сообщений подряд

## Примеры использования

### Эхо-бот
```lua
function onChatMessage(message)
    if message.sender_user_id == bot.id then return end
    local text = message.plaintext or ""
    bot.sendChatMessage(message.conversation_id, "Эхо: " .. text)
end
```

### Бот-помощник
```lua
function onChatMessage(message)
    if message.sender_user_id == bot.id then return end
    
    local text = message.plaintext or ""
    local convId = message.conversation_id
    
    if text:find("привет") or text:find("hello") then
        bot.sendChatMessage(convId, "Привет! Чем могу помочь?")
    elseif text:find("пока") or text:find("bye") then
        bot.sendChatMessage(convId, "До свидания! 👋")
    else
        bot.sendChatMessage(convId, "Я вас слушаю...")
    end
end
```

### Бот-модератор
```lua
local bannedWords = {"спам", "реклама"}

function onChatMessage(message)
    if message.sender_user_id == bot.id then return end
    
    local text = message.plaintext or ""
    local convId = message.conversation_id
    
    for _, word in ipairs(bannedWords) do
        if text:lower():find(word) then
            bot.sendChatMessage(
                convId,
                "⚠️ Обнаружено запрещенное слово: " .. word
            )
            bot.log("warn", "Banned word detected: " .. word)
            return
        end
    end
end
```

## Отладка

### Проверка получения сообщений
```lua
function onChatMessage(message)
    bot.log("info", "=== Message received ===")
    bot.log("info", "ID: " .. (message.id or "nil"))
    bot.log("info", "Conversation: " .. (message.conversation_id or "nil"))
    bot.log("info", "Sender: " .. (message.sender_user_id or "nil"))
    bot.log("info", "Plaintext: " .. (message.plaintext or "nil"))
    bot.log("info", "=======================")
end
```

### Проверка отправки
```lua
local success, result = bot.sendChatMessage(convId, "Test")
if success then
    bot.log("info", "Message sent: " .. result)
else
    bot.log("error", "Failed: " .. result)
end
```

## FAQ

**Q: Почему бот не получает сообщения?**
A: Проверьте, что бот добавлен в беседу как участник.

**Q: Почему plaintext пустой?**
A: Убедитесь, что сообщение отправлено с префиксом `BOT_PLAINTEXT:`.

**Q: Может ли бот читать старые сообщения?**
A: Нет, боты получают только новые сообщения через события.

**Q: Безопасно ли это?**
A: Да, plaintext доступен только ботам на сервере, не клиентам.

**Q: Можно ли отправлять зашифрованные сообщения ботам?**
A: Технически да, но бот не сможет их расшифровать.
