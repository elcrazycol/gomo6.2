import { useState } from 'react'
import { CodeBlock } from '../components/CodeBlock'

interface Example {
  id: string
  title: string
  description: string
  code: string
  tags: string[]
}

const examples: Example[] = [
  {
    id: 'echo',
    title: 'Эхо-бот',
    description: 'Простой бот, который повторяет ваши сообщения',
    tags: ['Базовый', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  -- Извлекаем текст после упоминания бота
  local botMention = "@" .. bot.username
  local message = content:gsub(botMention, ""):gsub("^%s+", "")

  if message ~= "" then
    bot.sendThreadPost(threadId, "Эхо: " .. message)
    bot.log("info", "Отправлено эхо")
  end
end`,
  },
  {
    id: 'greeter',
    title: 'Приветственный бот',
    description: 'Приветствует пользователей по имени',
    tags: ['Базовый', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  if content:find("привет") or content:find("hello") or content:find("hi") then
    local user = bot.getUser(post.user_id)

    if user then
      local greeting = "Привет, " .. user.username .. "! 👋\\n"
      greeting = greeting .. "Я бот-помощник. Чем могу помочь?"
      bot.sendThreadPost(threadId, greeting)
    end
  end
end`,
  },
  {
    id: 'commands',
    title: 'Бот с командами',
    description: 'Обрабатывает несколько команд со справкой',
    tags: ['Команды', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  if content:find("/help") then
    local help = "🤖 Доступные команды:\\n"
    help = help .. "/help - показать справку\\n"
    help = help .. "/time - текущее время\\n"
    help = help .. "/ping - проверить бота"
    bot.sendThreadPost(threadId, help)
    return
  end

  if content:find("/time") then
    local time = os.date("%H:%M:%S")
    bot.sendThreadPost(threadId, "🕐 Время: " .. time)
    return
  end

  if content:find("/ping") then
    bot.sendThreadPost(threadId, "🏓 Понг! Бот работает.")
    return
  end
end`,
  },
  {
    id: 'storage',
    title: 'Бот с хранилищем',
    description: 'Использует постоянное хранилище для счетчика',
    tags: ['Хранилище', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""

  if content:find("@" .. bot.username) then
    -- Получаем счетчик
    local count = bot.getData("mentions") or "0"
    local num = tonumber(count) + 1

    -- Сохраняем новое значение
    bot.setData("mentions", tostring(num))

    bot.sendThreadPost(
      post.thread_id,
      "Меня упомянули " .. num .. " раз!"
    )
  end

  if content:find("/reset") then
    bot.setData("mentions", "0")
    bot.sendThreadPost(post.thread_id, "Счетчик сброшен!")
  end
end`,
  },
  {
    id: 'http',
    title: 'Бот с HTTP запросами',
    description: 'Получает данные из GitHub API',
    tags: ['HTTP', 'API', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""

  if content:find("/github ") then
    local username = content:match("/github (%S+)")

    if username then
      local url = "https://api.github.com/users/" .. username
      local resp, err = bot.httpGet(url)

      if resp and resp.status == 200 then
        -- Простой парсинг JSON
        local name = resp.body:match('"name":"([^"]+)"')
        local repos = resp.body:match('"public_repos":(%d+)')

        local msg = "👤 GitHub: " .. username .. "\\n"
        if name then msg = msg .. "Имя: " .. name .. "\\n" end
        if repos then msg = msg .. "Репозиториев: " .. repos end

        bot.sendThreadPost(post.thread_id, msg)
      else
        bot.sendThreadPost(post.thread_id, "Пользователь не найден")
      end
    end
  end
end`,
  },
  {
    id: 'likes',
    title: 'Бот с лайками',
    description: 'Автоматически лайкает интересные посты',
    tags: ['Лайки', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""

  -- Не лайкаем свои посты
  if post.user_id == bot.id then
    return
  end

  -- Лайкаем посты с ключевыми словами
  local keywords = {"отлично", "круто", "супер", "amazing", "awesome"}

  for _, keyword in ipairs(keywords) do
    if content:lower():find(keyword) then
      bot.likePost(post.id)
      bot.log("info", "Лайкнул пост: " .. post.id)
      break
    end
  end
end`,
  },
  {
    id: 'moderator',
    title: 'Бот-модератор',
    description: 'Предупреждает о нежелательных словах',
    tags: ['Модерация', 'Треды'],
    code: `local bannedWords = {"спам", "реклама", "продам"}

function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  for _, word in ipairs(bannedWords) do
    if content:lower():find(word) then
      local warning = "⚠️ Обнаружено нежелательное слово: " .. word
      warning = warning .. "\\nПожалуйста, соблюдайте правила."

      bot.replyToThreadPost(threadId, post.id, warning)
      bot.log("warn", "Запрещенное слово: " .. word)
      return
    end
  end
end`,
  },
  {
    id: 'thread-creator',
    title: 'Бот-создатель тредов',
    description: 'Создает новые треды по команде',
    tags: ['Треды', 'Команды'],
    code: `function onThreadPost(post)
  local content = post.content or ""

  if content:find("/create ") then
    local title = content:match("/create (.+)")

    if title then
      local firstPost = "Этот тред создан ботом по запросу"
      local success, threadId = bot.createThread(title, firstPost)

      if success then
        bot.replyToThreadPost(
          post.thread_id,
          post.id,
          "✅ Тред создан! ID: " .. threadId
        )
      else
        bot.replyToThreadPost(
          post.thread_id,
          post.id,
          "❌ Не удалось создать тред"
        )
      end
    end
  end
end`,
  },
  {
    id: 'chat-bot',
    title: 'Чат-бот помощник',
    description: 'Отвечает на сообщения в чате',
    tags: ['Чат', 'Мессенджер'],
    code: `function onChatMessage(message)
  -- Не отвечаем на свои сообщения
  if message.sender_user_id == bot.id then
    return
  end

  bot.log("info", "Сообщение от " .. message.sender_user_id)

  -- Автоматический ответ
  local responses = {
    "Спасибо за сообщение! 👋",
    "Я бот-помощник, чем могу помочь?",
    "Получил ваше сообщение!",
  }

  local response = responses[math.random(#responses)]
  bot.sendChatMessage(message.conversation_id, response)
end`,
  },
  {
    id: 'analytics',
    title: 'Бот-аналитик',
    description: 'Анализирует активность в треде',
    tags: ['Аналитика', 'Треды'],
    code: `function onThreadPost(post)
  local content = post.content or ""

  if content:find("/stats") then
    local posts = bot.getThreadPosts(post.thread_id, 100)

    if posts then
      local totalPosts = #posts
      local users = {}

      for i = 1, totalPosts do
        users[posts[i].user_id] = true
      end

      local uniqueUsers = 0
      for _ in pairs(users) do
        uniqueUsers = uniqueUsers + 1
      end

      local stats = "📊 Статистика треда:\\n"
      stats = stats .. "Постов: " .. totalPosts .. "\\n"
      stats = stats .. "Участников: " .. uniqueUsers

      bot.sendThreadPost(post.thread_id, stats)
    end
  end
end`,
  },
]

export function Examples() {
  const [selectedTag, setSelectedTag] = useState<string>('Все')

  const allTags = ['Все', ...Array.from(new Set(examples.flatMap(e => e.tags)))]

  const filteredExamples = selectedTag === 'Все'
    ? examples
    : examples.filter(e => e.tags.includes(selectedTag))

  return (
    <div className="prose max-w-none">
      <h1>Примеры ботов</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
        Готовые примеры для быстрого старта
      </p>

      {/* Фильтры */}
      <div className="flex flex-wrap gap-2 mb-8 not-prose">
        {allTags.map(tag => (
          <button
            key={tag}
            onClick={() => setSelectedTag(tag)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              selectedTag === tag
                ? 'bg-black dark:bg-white text-white dark:text-black'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            {tag}
          </button>
        ))}
      </div>

      {/* Примеры */}
      <div className="space-y-6">
        {filteredExamples.map(example => (
          <div
            key={example.id}
            className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-lg p-6 not-prose"
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                  {example.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mb-3">
                  {example.description}
                </p>
                <div className="flex gap-2">
                  {example.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-2 py-1 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 text-xs rounded"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <CodeBlock code={example.code} />
          </div>
        ))}
      </div>

      <div className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-lg p-6 my-8">
        <h3 className="text-lg font-semibold mb-2">💡 Совет</h3>
        <p className="text-gray-600 dark:text-gray-400">
          Комбинируйте эти примеры для создания более сложных ботов.
          Используйте кнопку "Копировать" чтобы быстро скопировать код!
        </p>
      </div>
    </div>
  )
}
