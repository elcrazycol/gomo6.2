# Обновление Bot API и документации

## Дата: 2026-04-08

### Новые функции API

#### Треды и посты
- `bot.getThread(threadId)` - получить информацию о треде
- `bot.getPost(postId)` - получить пост
- `bot.getThreadPosts(threadId, limit)` - список постов (до 100)
- `bot.createThread(title, content, serverDomain)` - создать новый тред

#### Лайки
- `bot.likePost(postId)` - поставить лайк
- `bot.unlikePost(postId)` - убрать лайк

#### Хранилище данных (постоянное, Redis)
- `bot.setData(key, value)` - сохранить данные
- `bot.getData(key)` - получить данные
- `bot.deleteData(key)` - удалить данные

#### HTTP запросы
- `bot.httpGet(url)` - GET запрос
- `bot.httpPost(url, body)` - POST запрос
- Разрешенные домены: api.github.com, jsonplaceholder.typicode.com, httpbin.org, api.openweathermap.org

#### Информация о боте
- `bot.id` - ID бота
- `bot.username` - username бота

### Обновления документации

#### apps/bot-docs
- ✅ Добавлена секция "Чат и мессенджер" в API Reference
- ✅ Добавлено событие `onChatMessage` в Events
- ✅ Полностью переработана страница Examples с фильтрацией по тегам
- ✅ Полностью переработана страница Best Practices с категориями
- ✅ Добавлен компонент CodeBlock с кнопкой копирования
- ✅ 10 готовых примеров ботов (эхо, команды, HTTP, хранилище, лайки, чат и др.)
- ✅ 13 best practices по категориям (производительность, безопасность, отладка, архитектура, хранилище, HTTP)

#### apps/backend-go
- ✅ Создан файл `internal/bots/lua_api_extended.go` с новыми функциями
- ✅ Обновлен `internal/bots/runtime.go` - регистрация новых функций
- ✅ Обновлен `BOTS_README.md` с полным списком API и примерами

### Улучшения UX

1. **Кнопки копирования** - при наведении на блоки кода появляется кнопка "Копировать"
2. **Фильтрация примеров** - можно фильтровать по тегам (Базовый, Команды, HTTP, Чат и т.д.)
3. **Категоризация Best Practices** - разделены по категориям для удобной навигации
4. **Минималистичный дизайн** - чистый и удобный интерфейс
5. **Темная тема** - поддержка темной темы во всех компонентах

### Файлы изменены

Backend:
- `apps/backend-go/internal/bots/lua_api_extended.go` (новый)
- `apps/backend-go/internal/bots/runtime.go`
- `apps/backend-go/BOTS_README.md`

Frontend (bot-docs):
- `apps/bot-docs/src/pages/APIReference.tsx`
- `apps/bot-docs/src/pages/EventHandlers.tsx`
- `apps/bot-docs/src/pages/Examples.tsx` (полностью переписан)
- `apps/bot-docs/src/pages/BestPractices.tsx` (полностью переписан)
- `apps/bot-docs/src/pages/Introduction.tsx`
- `apps/bot-docs/src/App.tsx`
- `apps/bot-docs/src/components/CodeBlock.tsx` (новый)
- `apps/bot-docs/README.md` (новый)

### Следующие шаги

1. Перезапустить backend для загрузки новых функций API
2. Опционально: развернуть bot-docs на отдельном домене
3. Добавить больше разрешенных доменов для HTTP по мере необходимости
4. Рассмотреть добавление веб-редактора Lua с подсветкой синтаксиса

### Тестирование

Для тестирования новых функций создайте бота с кодом:

```lua
function onThreadPost(post)
  -- Тест хранилища
  local count = bot.getData("test_count") or "0"
  local num = tonumber(count) + 1
  bot.setData("test_count", tostring(num))
  
  -- Тест HTTP
  if post.content:find("/test") then
    local resp, err = bot.httpGet("https://api.github.com/users/octocat")
    if resp then
      bot.sendThreadPost(post.thread_id, "HTTP работает! Статус: " .. resp.status)
    end
  end
  
  -- Тест лайков
  if post.user_id ~= bot.id then
    bot.likePost(post.id)
  end
  
  bot.log("info", "Счетчик: " .. num)
end
```
