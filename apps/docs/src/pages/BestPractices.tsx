import { CodeBlock } from '../components/CodeBlock'

interface Practice {
  id: string
  category: string
  title: string
  description: string
  good?: string
  bad?: string
  code?: string
}

const practices: Practice[] = [
  // Производительность
  {
    id: 'no-infinite-loops',
    category: 'Производительность',
    title: 'Избегайте бесконечных циклов',
    description: 'Бот имеет таймаут 5 секунд. Всегда используйте ограниченные циклы.',
    bad: `while true do
  -- может зависнуть
end`,
    good: `for i = 1, 10 do
  -- ограниченный цикл
end`,
  },
  {
    id: 'rate-limiting',
    category: 'Производительность',
    title: 'Соблюдайте rate limiting',
    description: 'Лимит: 10 сообщений в минуту. Объединяйте сообщения вместо спама.',
    bad: `for i = 1, 100 do
  bot.sendThreadPost(threadId, "Сообщение " .. i)
end`,
    good: `local message = ""
for i = 1, 10 do
  message = message .. i .. ". Пункт\\n"
end
bot.sendThreadPost(threadId, message)`,
  },
  {
    id: 'cache-data',
    category: 'Производительность',
    title: 'Кэшируйте данные',
    description: 'Используйте bot.getData/setData для кэширования.',
    code: `local cache = bot.getData("user_cache")
if not cache then
  local user = bot.getUser(userId)
  bot.setData("user_cache", user.username)
end`,
  },

  // Безопасность
  {
    id: 'validate-input',
    category: 'Безопасность',
    title: 'Валидация входных данных',
    description: 'Всегда проверяйте данные перед использованием.',
    code: `function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  if not threadId or threadId == "" then
    bot.log("error", "Invalid thread ID")
    return
  end

  -- Продолжаем работу
end`,
  },
  {
    id: 'no-self-reply',
    category: 'Безопасность',
    title: 'Не отвечайте на свои сообщения',
    description: 'Избегайте бесконечных циклов ответов.',
    code: `function onThreadPost(post)
  if post.user_id == bot.id then
    return
  end

  -- Обрабатываем сообщение
end`,
  },
  {
    id: 'admin-check',
    category: 'Безопасность',
    title: 'Проверяйте права доступа',
    description: 'Для административных команд проверяйте пользователя.',
    code: `local admins = {
  ["admin-id-1"] = true,
  ["admin-id-2"] = true
}

function onThreadPost(post)
  if post.content:find("/admin") then
    if not admins[post.user_id] then
      bot.replyToThreadPost(
        post.thread_id,
        post.id,
        "❌ Нет прав"
      )
      return
    end
    -- Выполняем команду
  end
end`,
  },

  // Отладка
  {
    id: 'use-logging',
    category: 'Отладка',
    title: 'Используйте логирование',
    description: 'Логируйте важные события для отладки.',
    code: `function onThreadPost(post)
  bot.log("info", "Получен пост: " .. post.id)
  bot.log("debug", "Контент: " .. (post.content or ""))

  if post.content:find("error") then
    bot.log("error", "Обнаружена ошибка")
  end
end`,
  },
  {
    id: 'check-results',
    category: 'Отладка',
    title: 'Проверяйте результаты операций',
    description: 'Всегда проверяйте успешность выполнения.',
    code: `local success, postId = bot.sendThreadPost(threadId, "Привет!")

if success then
  bot.log("info", "Отправлено: " .. postId)
else
  bot.log("error", "Ошибка: " .. postId)
end`,
  },

  // Архитектура
  {
    id: 'use-functions',
    category: 'Архитектура',
    title: 'Разделяйте логику на функции',
    description: 'Создавайте вспомогательные функции для переиспользования.',
    code: `function isAdmin(userId)
  local admins = {"admin-1", "admin-2"}
  for _, id in ipairs(admins) do
    if userId == id then return true end
  end
  return false
end

function onThreadPost(post)
  if post.content:find("/admin") then
    if isAdmin(post.user_id) then
      -- Выполняем команду
    end
  end
end`,
  },
  {
    id: 'use-config',
    category: 'Архитектура',
    title: 'Используйте таблицы для конфигурации',
    description: 'Храните настройки в таблицах.',
    code: `local config = {
  maxMessages = 10,
  timeout = 5000,
  admins = {"admin-1", "admin-2"},
  keywords = {"привет", "hello", "hi"}
}

function onThreadPost(post)
  for _, keyword in ipairs(config.keywords) do
    if post.content:find(keyword) then
      bot.sendThreadPost(post.thread_id, "Привет!")
      break
    end
  end
end`,
  },

  // Хранилище
  {
    id: 'key-prefixes',
    category: 'Хранилище',
    title: 'Используйте префиксы для ключей',
    description: 'Организуйте данные с помощью префиксов.',
    code: `-- Структурированные ключи
bot.setData("user:count", "42")
bot.setData("thread:last_id", "thread-123")
bot.setData("config:enabled", "true")

-- Получение
local userCount = bot.getData("user:count")`,
  },
  {
    id: 'serialize-data',
    category: 'Хранилище',
    title: 'Сериализуйте сложные данные',
    description: 'Для хранения списков используйте простую сериализацию.',
    code: `function saveList(key, list)
  local str = table.concat(list, ",")
  bot.setData(key, str)
end

function loadList(key)
  local str = bot.getData(key)
  if not str then return {} end

  local list = {}
  for item in str:gmatch("[^,]+") do
    table.insert(list, item)
  end
  return list
end`,
  },

  // HTTP
  {
    id: 'check-http-response',
    category: 'HTTP',
    title: 'Проверяйте HTTP ответы',
    description: 'Всегда проверяйте статус и наличие данных.',
    code: `local resp, err = bot.httpGet("https://api.github.com/users/octocat")

if not resp then
  bot.log("error", "HTTP error: " .. (err or "unknown"))
  return
end

if resp.status ~= 200 then
  bot.log("error", "Bad status: " .. resp.status)
  return
end

-- Обрабатываем ответ
bot.log("info", "Response: " .. resp.body)`,
  },
  {
    id: 'cache-http',
    category: 'HTTP',
    title: 'Кэшируйте HTTP результаты',
    description: 'Не делайте одинаковые запросы повторно.',
    code: `function getGitHubUser(username)
  local cached = bot.getData("github:" .. username)
  if cached then
    return cached
  end

  local resp, err = bot.httpGet(
    "https://api.github.com/users/" .. username
  )

  if resp and resp.status == 200 then
    bot.setData("github:" .. username, resp.body)
    return resp.body
  end

  return nil
end`,
  },
]

const categories = Array.from(new Set(practices.map(p => p.category)))

export function BestPractices() {
  return (
    <div className="prose max-w-none">
      <h1>Best Practices</h1>
      <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
        Рекомендации по созданию эффективных и безопасных ботов
      </p>

      {categories.map(category => (
        <div key={category} className="mb-12">
          <h2 className="text-2xl font-bold mb-6 text-gray-900 dark:text-white">
            {category}
          </h2>

          <div className="space-y-6">
            {practices
              .filter(p => p.category === category)
              .map(practice => (
                <div
                  key={practice.id}
                  className="bg-white dark:bg-[#1a1a1a] border border-gray-200 dark:border-gray-800 rounded-lg p-6 not-prose"
                >
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    {practice.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    {practice.description}
                  </p>

                  {practice.bad && practice.good && (
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <div className="text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                          ❌ Плохо
                        </div>
                        <CodeBlock code={practice.bad} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-green-600 dark:text-green-400 mb-2">
                          ✅ Хорошо
                        </div>
                        <CodeBlock code={practice.good} />
                      </div>
                    </div>
                  )}

                  {practice.code && !practice.bad && (
                    <CodeBlock code={practice.code} />
                  )}
                </div>
              ))}
          </div>
        </div>
      ))}

      {/* Важные ограничения */}
      <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6 my-8 not-prose">
        <h3 className="text-lg font-semibold mb-3 text-yellow-900 dark:text-yellow-100">
          ⚠️ Важные ограничения
        </h3>
        <ul className="space-y-2 text-yellow-800 dark:text-yellow-200">
          <li>• Таймаут выполнения: 5 секунд на событие</li>
          <li>• Rate limit: 10 сообщений в минуту</li>
          <li>• HTTP запросы: только разрешенные домены</li>
          <li>• Размер кода: максимум 10KB</li>
          <li>• Логи: максимум 1000 записей</li>
        </ul>
      </div>

      {/* Совет */}
      <div className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-lg p-6 my-8 not-prose">
        <h3 className="text-lg font-semibold mb-2 text-gray-900 dark:text-white">
          💡 Совет
        </h3>
        <p className="text-gray-600 dark:text-gray-400">
          Начинайте с простых ботов и постепенно добавляйте функциональность.
          Используйте логи для отладки и мониторинга работы бота.
        </p>
      </div>
    </div>
  )
}
