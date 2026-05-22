import { useState } from 'react'
import { FunctionSignature } from '../components/FunctionSignature'

interface APISection {
  id: string
  title: string
  items: APIItem[]
}

interface APIItem {
  id: string
  name: string
  description: string
  params: { name: string; type: string; description: string }[]
  returns?: string
  example: string
}

const apiSections: APISection[] = [
  {
    id: 'messages',
    title: 'Сообщения и комментарии',
    items: [
      {
        id: 'sendThreadPost',
        name: 'bot.sendThreadPost(threadId, content)',
        description: 'Отправляет новое сообщение в тред',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
          { name: 'content', type: 'string', description: 'Текст сообщения' },
        ],
        returns: '(success: boolean, postId: string)',
        example: `local success, postId = bot.sendThreadPost(
  "thread-uuid-here",
  "Привет всем!"
)

if success then
  bot.log("info", "Сообщение отправлено: " .. postId)
else
  bot.log("error", "Ошибка: " .. postId)
end`,
      },
      {
        id: 'replyToThreadPost',
        name: 'bot.replyToThreadPost(threadId, postId, content)',
        description: 'Отвечает на конкретное сообщение в треде',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
          { name: 'postId', type: 'string', description: 'ID сообщения, на которое отвечаем' },
          { name: 'content', type: 'string', description: 'Текст ответа' },
        ],
        returns: '(success: boolean, replyId: string)',
        example: `local success, replyId = bot.replyToThreadPost(
  post.thread_id,
  post.id,
  "Отличная мысль!"
)`,
      },
      {
        id: 'sendWallComment',
        name: 'bot.sendWallComment(wallOwnerId, postId, content)',
        description: 'Отправляет комментарий на стену',
        params: [
          { name: 'wallOwnerId', type: 'string', description: 'ID владельца стены' },
          { name: 'postId', type: 'string', description: 'ID поста на стене' },
          { name: 'content', type: 'string', description: 'Текст комментария' },
        ],
        returns: '(success: boolean, commentId: string)',
        example: `local success, commentId = bot.sendWallComment(
  "user-uuid",
  "post-uuid",
  "Интересный пост!"
)`,
      },
      {
        id: 'replyToWallComment',
        name: 'bot.replyToWallComment(wallOwnerId, postId, commentId, content)',
        description: 'Отвечает на комментарий на стене',
        params: [
          { name: 'wallOwnerId', type: 'string', description: 'ID владельца стены' },
          { name: 'postId', type: 'string', description: 'ID поста' },
          { name: 'commentId', type: 'string', description: 'ID комментария' },
          { name: 'content', type: 'string', description: 'Текст ответа' },
        ],
        returns: '(success: boolean, replyId: string)',
        example: `local success, replyId = bot.replyToWallComment(
  wallOwnerId,
  postId,
  commentId,
  "Согласен!"
)`,
      },
    ],
  },
  {
    id: 'threads',
    title: 'Треды и посты',
    items: [
      {
        id: 'getThread',
        name: 'bot.getThread(threadId)',
        description: 'Получает информацию о треде',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
        ],
        returns: 'thread object или nil',
        example: `local thread = bot.getThread("thread-uuid")

if thread then
  bot.log("info", "Тред: " .. thread.title)
  bot.log("info", "Постов: " .. thread.post_count)
end`,
      },
      {
        id: 'getPost',
        name: 'bot.getPost(postId)',
        description: 'Получает информацию о посте',
        params: [
          { name: 'postId', type: 'string', description: 'ID поста' },
        ],
        returns: 'post object или nil',
        example: `local post = bot.getPost("post-uuid")

if post then
  bot.log("info", "Автор: " .. post.user_id)
  bot.log("info", "Контент: " .. post.content)
end`,
      },
      {
        id: 'getThreadPosts',
        name: 'bot.getThreadPosts(threadId, limit)',
        description: 'Получает список постов в треде',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
          { name: 'limit', type: 'number', description: 'Максимум постов (по умолчанию 20, макс 100)' },
        ],
        returns: 'массив постов',
        example: `local posts = bot.getThreadPosts("thread-uuid", 10)

if posts then
  for i = 1, #posts do
    local post = posts[i]
    bot.log("info", "Пост " .. i .. ": " .. post.content)
  end
end`,
      },
      {
        id: 'createThread',
        name: 'bot.createThread(title, content, serverDomain)',
        description: 'Создает новый тред',
        params: [
          { name: 'title', type: 'string', description: 'Заголовок треда' },
          { name: 'content', type: 'string', description: 'Первый пост' },
          { name: 'serverDomain', type: 'string', description: 'Домен сервера (опционально)' },
        ],
        returns: '(success: boolean, threadId: string)',
        example: `local success, threadId = bot.createThread(
  "Новая тема от бота",
  "Привет! Это автоматически созданный тред"
)

if success then
  bot.log("info", "Тред создан: " .. threadId)
end`,
      },
    ],
  },
  {
    id: 'likes',
    title: 'Лайки и реакции',
    items: [
      {
        id: 'likePost',
        name: 'bot.likePost(postId)',
        description: 'Ставит лайк посту',
        params: [
          { name: 'postId', type: 'string', description: 'ID поста' },
        ],
        returns: '(success: boolean, likeId: string)',
        example: `local success, likeId = bot.likePost(post.id)

if success then
  bot.log("info", "Лайк поставлен: " .. likeId)
else
  bot.log("error", "Ошибка: " .. likeId)
end`,
      },
      {
        id: 'unlikePost',
        name: 'bot.unlikePost(postId)',
        description: 'Убирает лайк с поста',
        params: [
          { name: 'postId', type: 'string', description: 'ID поста' },
        ],
        returns: '(success: boolean, error?: string)',
        example: `local success, error = bot.unlikePost(post.id)

if success then
  bot.log("info", "Лайк убран")
else
  bot.log("error", "Ошибка: " .. error)
end`,
      },
      {
        id: 'likeThread',
        name: 'bot.likeThread(threadId)',
        description: 'Ставит лайк треду',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
        ],
        returns: '(success: boolean, likeId: string)',
        example: `local success, likeId = bot.likeThread(thread.id)

if success then
  bot.log("info", "Тред лайкнут: " .. likeId)
else
  bot.log("error", "Ошибка: " .. likeId)
end`,
      },
      {
        id: 'unlikeThread',
        name: 'bot.unlikeThread(threadId)',
        description: 'Убирает лайк с треда',
        params: [
          { name: 'threadId', type: 'string', description: 'ID треда' },
        ],
        returns: '(success: boolean, error?: string)',
        example: `local success, error = bot.unlikeThread(thread.id)

if success then
  bot.log("info", "Лайк с треда убран")
end`,
      },
    ],
  },
  {
    id: 'storage',
    title: 'Хранилище данных',
    items: [
      {
        id: 'setData',
        name: 'bot.setData(key, value)',
        description: 'Сохраняет данные в постоянное хранилище бота',
        params: [
          { name: 'key', type: 'string', description: 'Ключ' },
          { name: 'value', type: 'string', description: 'Значение' },
        ],
        returns: 'success: boolean',
        example: `-- Сохранить счетчик
bot.setData("message_count", "42")

-- Сохранить JSON
local data = '{"users": ["user1", "user2"]}'
bot.setData("user_list", data)`,
      },
      {
        id: 'getData',
        name: 'bot.getData(key)',
        description: 'Получает данные из хранилища',
        params: [
          { name: 'key', type: 'string', description: 'Ключ' },
        ],
        returns: 'value: string или nil',
        example: `local count = bot.getData("message_count")

if count then
  local num = tonumber(count)
  bot.log("info", "Сообщений: " .. num)
  bot.setData("message_count", tostring(num + 1))
end`,
      },
      {
        id: 'deleteData',
        name: 'bot.deleteData(key)',
        description: 'Удаляет данные из хранилища',
        params: [
          { name: 'key', type: 'string', description: 'Ключ' },
        ],
        returns: 'success: boolean',
        example: `bot.deleteData("old_data")`,
      },
    ],
  },
  {
    id: 'http',
    title: 'HTTP запросы',
    items: [
      {
        id: 'httpGet',
        name: 'bot.httpGet(url)',
        description: 'Выполняет HTTP GET запрос (только разрешенные домены)',
        params: [
          { name: 'url', type: 'string', description: 'URL для запроса' },
        ],
        returns: '(response: table, error: string)',
        example: `local resp, err = bot.httpGet(
  "https://api.github.com/users/octocat"
)

if resp then
  bot.log("info", "Статус: " .. resp.status)
  bot.log("info", "Тело: " .. resp.body)
else
  bot.log("error", "Ошибка: " .. err)
end`,
      },
      {
        id: 'httpPost',
        name: 'bot.httpPost(url, body)',
        description: 'Выполняет HTTP POST запрос',
        params: [
          { name: 'url', type: 'string', description: 'URL для запроса' },
          { name: 'body', type: 'string', description: 'Тело запроса (JSON)' },
        ],
        returns: '(response: table, error: string)',
        example: `local body = '{"title": "Test", "body": "Content"}'
local resp, err = bot.httpPost(
  "https://jsonplaceholder.typicode.com/posts",
  body
)

if resp then
  bot.log("info", "Создано: " .. resp.body)
end`,
      },
    ],
  },
  {
    id: 'chat',
    title: 'Чат и мессенджер',
    items: [
      {
        id: 'sendChatMessage',
        name: 'bot.sendChatMessage(conversationId, content)',
        description: 'Отправляет сообщение в чат (бот должен быть участником беседы)',
        params: [
          { name: 'conversationId', type: 'string', description: 'ID беседы' },
          { name: 'content', type: 'string', description: 'Текст сообщения' },
        ],
        returns: '(success: boolean, messageId: string)',
        example: `local success, msgId = bot.sendChatMessage(
  message.conversation_id,
  "Привет из чата! 👋"
)

if success then
  bot.log("info", "Сообщение отправлено: " .. msgId)
end`,
      },
      {
        id: 'getChatConversation',
        name: 'bot.getChatConversation(conversationId)',
        description: 'Получает информацию о беседе',
        params: [
          { name: 'conversationId', type: 'string', description: 'ID беседы' },
        ],
        returns: 'conversation object или nil',
        example: `local conv = bot.getChatConversation(message.conversation_id)

if conv then
  bot.log("info", "Беседа создана: " .. conv.created_at)

  -- Получаем количество участников
  local memberCount = 0
  for _ in pairs(conv.members) do
    memberCount = memberCount + 1
  end

  bot.log("info", "Участников: " .. memberCount)
end`,
      },
    ],
  },
  {
    id: 'users',
    title: 'Работа с пользователями',
    items: [
      {
        id: 'getUser',
        name: 'bot.getUser(userId)',
        description: 'Получает информацию о пользователе',
        params: [
          { name: 'userId', type: 'string', description: 'ID пользователя' },
        ],
        returns: 'user object или nil',
        example: `local user = bot.getUser(post.user_id)

if user then
  bot.log("info", "Пользователь: " .. user.username)
  bot.sendThreadPost(
    post.thread_id,
    "Привет, " .. user.username .. "!"
  )
end`,
      },
    ],
  },
  {
    id: 'utility',
    title: 'Утилиты и информация',
    items: [
      {
        id: 'log',
        name: 'bot.log(level, message)',
        description: 'Записывает сообщение в лог бота',
        params: [
          { name: 'level', type: 'string', description: '"info", "warn", "error" или "debug"' },
          { name: 'message', type: 'string', description: 'Текст сообщения' },
        ],
        example: `bot.log("info", "Бот запущен")
bot.log("warn", "Подозрительная активность")
bot.log("error", "Ошибка обработки")
bot.log("debug", "Отладочная информация")`,
      },
      {
        id: 'sleep',
        name: 'bot.sleep(milliseconds)',
        description: 'Приостанавливает выполнение на указанное время (макс 5 секунд)',
        params: [
          { name: 'milliseconds', type: 'number', description: 'Время в миллисекундах' },
        ],
        example: `bot.log("info", "Начало")
bot.sleep(1000)  -- Пауза 1 секунда
bot.log("info", "Продолжение")`,
      },
      {
        id: 'botInfo',
        name: 'bot.id, bot.username',
        description: 'Информация о самом боте',
        params: [],
        example: `bot.log("info", "Мой ID: " .. bot.id)
bot.log("info", "Мой username: " .. bot.username)

-- Проверка, не отвечаем на свои сообщения
if post.user_id == bot.id then
  return
end`,
      },
    ],
  },
]

export function APIReference() {
  const [activeSection, setActiveSection] = useState<string>('messages')
  const [activeItem, setActiveItem] = useState<string>('sendThreadPost')

  const currentSection = apiSections.find(s => s.id === activeSection)
  const currentItem = currentSection?.items.find(i => i.id === activeItem)

  return (
    <div className="flex gap-8 -mx-16">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 pl-16">
        <div className="sticky top-8">
          <h2 className="text-lg font-semibold mb-4">API Reference</h2>
          <div className="space-y-6">
            {apiSections.map(section => (
              <div key={section.id}>
                <button
                  onClick={() => {
                    setActiveSection(section.id)
                    setActiveItem(section.items[0].id)
                  }}
                  className={`text-sm font-medium mb-2 block w-full text-left px-3 py-1.5 rounded transition-colors ${
                    activeSection === section.id
                      ? 'bg-gray-100 dark:bg-gray-800 text-black dark:text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:text-black dark:hover:text-white'
                  }`}
                >
                  {section.title}
                </button>
                {activeSection === section.id && (
                  <div className="ml-3 space-y-1 border-l border-gray-200 dark:border-gray-700 pl-3">
                    {section.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setActiveItem(item.id)}
                        className={`text-xs block w-full text-left px-2 py-1 rounded transition-colors ${
                          activeItem === item.id
                            ? 'bg-gray-100 dark:bg-gray-800 text-black dark:text-white font-medium'
                            : 'text-gray-500 dark:text-gray-500 hover:text-black dark:hover:text-white'
                        }`}
                      >
                        {item.name.split('(')[0]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl prose pr-16">
        {currentItem && (
          <div>
            <FunctionSignature name={currentItem.name} params={currentItem.params} />
            <p className="text-xl text-gray-600 dark:text-gray-400 mb-8">
              {currentItem.description}
            </p>

            <h2>Параметры</h2>
            <table>
              <thead>
                <tr>
                  <th>Параметр</th>
                  <th>Тип</th>
                  <th>Описание</th>
                </tr>
              </thead>
              <tbody>
                {currentItem.params.map(param => (
                  <tr key={param.name}>
                    <td><code>{param.name}</code></td>
                    <td>{param.type}</td>
                    <td>{param.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {currentItem.returns && (
              <>
                <h2>Возвращает</h2>
                <p><code>{currentItem.returns}</code></p>
              </>
            )}

            <h2>Пример</h2>
            <pre><code className="language-lua">{currentItem.example}</code></pre>
          </div>
        )}
      </div>
    </div>
  )
}
