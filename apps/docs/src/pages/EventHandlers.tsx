import { useState } from 'react'
import { FunctionSignature } from '../components/FunctionSignature'

interface EventSection {
  id: string
  title: string
  items: EventItem[]
}

interface EventItem {
  id: string
  name: string
  description: string
  params: { name: string; type: string; description: string }[]
  example: string
}

const eventSections: EventSection[] = [
  {
    id: 'thread',
    title: 'События тредов',
    items: [
      {
        id: 'onThreadPost',
        name: 'onThreadPost(post)',
        description: 'Вызывается при новом сообщении в треде',
        params: [
          { name: 'post.id', type: 'string', description: 'ID сообщения' },
          { name: 'post.thread_id', type: 'string', description: 'ID треда' },
          { name: 'post.user_id', type: 'string', description: 'ID автора' },
          { name: 'post.content', type: 'string', description: 'Текст сообщения' },
          { name: 'post.created_at', type: 'string', description: 'Время создания' },
        ],
        example: `function onThreadPost(post)
  local content = post.content or ""

  if content:find("привет") then
    bot.log("info", "Получено приветствие")
    bot.sendThreadPost(post.thread_id, "Привет!")
  end
end`,
      },
      {
        id: 'onThread',
        name: 'onThread(thread)',
        description: 'Вызывается при создании нового треда',
        params: [
          { name: 'thread.id', type: 'string', description: 'ID треда' },
          { name: 'thread.title', type: 'string', description: 'Название треда' },
          { name: 'thread.user_id', type: 'string', description: 'ID создателя' },
          { name: 'thread.created_at', type: 'string', description: 'Время создания' },
        ],
        example: `function onThread(thread)
  bot.log("info", "Новый тред: " .. thread.title)
  bot.sendThreadPost(
    thread.id,
    "Добро пожаловать в новый тред!"
  )
end`,
      },
    ],
  },
  {
    id: 'wall',
    title: 'События стены',
    items: [
      {
        id: 'onWallPost',
        name: 'onWallPost(post)',
        description: 'Вызывается при новом посте на стене',
        params: [
          { name: 'post.id', type: 'string', description: 'ID поста' },
          { name: 'post.user_id', type: 'string', description: 'ID владельца стены' },
          { name: 'post.author_id', type: 'string', description: 'ID автора поста' },
          { name: 'post.content', type: 'string', description: 'Текст поста' },
          { name: 'post.title', type: 'string', description: 'Заголовок поста' },
          { name: 'post.created_at', type: 'string', description: 'Время создания' },
        ],
        example: `function onWallPost(post)
  local content = post.content or ""

  if content:find("помощь") then
    bot.sendWallComment(
      post.id,
      "Чем могу помочь?"
    )
  end
end`,
      },
      {
        id: 'onWallComment',
        name: 'onWallComment(comment)',
        description: 'Вызывается при новом комментарии на стене',
        params: [
          { name: 'comment.id', type: 'string', description: 'ID комментария' },
          { name: 'comment.post_id', type: 'string', description: 'ID поста' },
          { name: 'comment.user_id', type: 'string', description: 'ID автора' },
          { name: 'comment.content', type: 'string', description: 'Текст комментария' },
          { name: 'comment.created_at', type: 'string', description: 'Время создания' },
        ],
        example: `function onWallComment(comment)
  bot.log("info", "Новый комментарий: " .. comment.content)
end`,
      },
    ],
  },
  {
    id: 'chat',
    title: 'События чата',
    items: [
      {
        id: 'onChatMessage',
        name: 'onChatMessage(message)',
        description: 'Вызывается при новом сообщении в чате (только если бот участник беседы)',
        params: [
          { name: 'message.id', type: 'string', description: 'ID сообщения' },
          { name: 'message.conversation_id', type: 'string', description: 'ID беседы' },
          { name: 'message.sender_user_id', type: 'string', description: 'ID отправителя' },
          { name: 'message.plaintext', type: 'string', description: 'Расшифрованный текст (доступен только ботам)' },
          { name: 'message.created_at', type: 'string', description: 'Время создания' },
        ],
        example: `function onChatMessage(message)
  -- Не отвечаем на свои сообщения
  if message.sender_user_id == bot.id then
    return
  end

  -- Получаем текст сообщения
  local text = message.plaintext or ""
  bot.log("info", "Получено: " .. text)

  -- Обработка команд
  if text:find("/help") then
    bot.sendChatMessage(
      message.conversation_id,
      "Доступные команды:\\n/help - справка\\n/ping - проверка"
    )
  elseif text:find("/ping") then
    bot.sendChatMessage(
      message.conversation_id,
      "Понг! 🏓"
    )
  else
    -- Обычный ответ
    bot.sendChatMessage(
      message.conversation_id,
      "Получил ваше сообщение! 👋"
    )
  end
end`,
      },
    ],
  },
  {
    id: 'likes',
    title: 'События лайков',
    items: [
      {
        id: 'onPostLike',
        name: 'onPostLike(data)',
        description: 'Вызывается когда кто-то лайкает пост бота',
        params: [
          { name: 'data.post_id', type: 'string', description: 'ID поста' },
          { name: 'data.user_id', type: 'string', description: 'ID пользователя' },
          { name: 'data.like_id', type: 'string', description: 'ID лайка' },
        ],
        example: `function onPostLike(data)
  bot.log("info", "Пользователь " .. data.user_id .. " лайкнул мой пост!")

  -- Получить информацию о пользователе
  local user = bot.getUser(data.user_id)
  if user then
    bot.log("info", "Лайк от: " .. user.username)
  end
end`,
      },
      {
        id: 'onPostUnlike',
        name: 'onPostUnlike(data)',
        description: 'Вызывается когда кто-то убирает лайк с поста бота',
        params: [
          { name: 'data.post_id', type: 'string', description: 'ID поста' },
          { name: 'data.user_id', type: 'string', description: 'ID пользователя' },
        ],
        example: `function onPostUnlike(data)
  bot.log("info", "Пользователь " .. data.user_id .. " убрал лайк")
end`,
      },
      {
        id: 'onThreadLike',
        name: 'onThreadLike(data)',
        description: 'Вызывается когда кто-то лайкает тред бота',
        params: [
          { name: 'data.thread_id', type: 'string', description: 'ID треда' },
          { name: 'data.user_id', type: 'string', description: 'ID пользователя' },
          { name: 'data.like_id', type: 'string', description: 'ID лайка' },
        ],
        example: `function onThreadLike(data)
  bot.log("info", "Пользователь " .. data.user_id .. " лайкнул мой тред!")

  -- Получить информацию о треде
  local thread = bot.getThread(data.thread_id)
  if thread then
    bot.log("info", "Тред: " .. thread.title)
  end
end`,
      },
      {
        id: 'onThreadUnlike',
        name: 'onThreadUnlike(data)',
        description: 'Вызывается когда кто-то убирает лайк с треда бота',
        params: [
          { name: 'data.thread_id', type: 'string', description: 'ID треда' },
          { name: 'data.user_id', type: 'string', description: 'ID пользователя' },
        ],
        example: `function onThreadUnlike(data)
  bot.log("info", "Пользователь " .. data.user_id .. " убрал лайк с треда")
end`,
      },
    ],
  },
]

export function EventHandlers() {
  const [activeSection, setActiveSection] = useState<string>('thread')
  const [activeItem, setActiveItem] = useState<string>('onThreadPost')

  const currentSection = eventSections.find(s => s.id === activeSection)
  const currentItem = currentSection?.items.find(i => i.id === activeItem)

  return (
    <div className="flex gap-8 -mx-16">
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 pl-16">
        <div className="sticky top-8">
          <h2 className="text-lg font-semibold mb-4">События</h2>
          <div className="space-y-6">
            {eventSections.map(section => (
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

            <h2>Пример</h2>
            <pre><code className="language-lua">{currentItem.example}</code></pre>
          </div>
        )}
      </div>
    </div>
  )
}
