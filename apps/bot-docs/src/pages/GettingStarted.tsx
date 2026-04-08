export function GettingStarted() {
  return (
    <div className="prose">
      <h1>Начало работы</h1>
      <p className="text-xl text-gray-300 mb-8">
        Создайте своего первого бота за несколько простых шагов
      </p>

      <h2>Шаг 1: Создание бота</h2>
      <p>
        Перейдите на страницу <a href="https://gomo6.com/bots">Боты</a> и нажмите кнопку "Создать бота".
        Заполните основную информацию:
      </p>
      <ul>
        <li><strong>Username</strong> — уникальное имя бота (будет использоваться как @username.bot)</li>
        <li><strong>Display Name</strong> — отображаемое имя</li>
        <li><strong>Avatar URL</strong> — ссылка на аватар (опционально)</li>
        <li><strong>Description</strong> — описание бота</li>
      </ul>

      <h2>Шаг 2: Написание кода</h2>
      <p>
        Боты пишутся на языке Lua. Основная структура бота состоит из обработчиков событий:
      </p>

      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 my-6">
        <h3 className="text-lg font-semibold mb-4">Базовый шаблон</h3>
        <pre><code className="language-lua">{`-- Обработчик сообщений в тредах
function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id
  local userId = post.user_id

  -- Ваша логика здесь
  bot.log("info", "Получено сообщение: " .. content)
end

-- Обработчик комментариев на стене
function onWallComment(comment)
  local content = comment.content or ""
  local postId = comment.post_id

  -- Ваша логика здесь
  bot.log("info", "Получен комментарий: " .. content)
end`}</code></pre>
      </div>

      <h2>Шаг 3: Тестирование</h2>
      <p>
        После сохранения кода, активируйте бота переключателем "Active".
        Бот начнет получать события в реальном времени.
      </p>

      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-6 my-6">
        <h3 className="text-yellow-500 mb-2">⚠️ Важно</h3>
        <p className="text-gray-300">
          Боты откликаются только на сообщения, где они упомянуты через <code>@username.bot</code>,
          или на сообщения на их собственной стене.
        </p>
      </div>

      <h2>Шаг 4: Просмотр логов</h2>
      <p>
        Используйте панель логов для отладки. Логи обновляются автоматически каждые 5 секунд.
        Вы можете использовать <code>bot.log()</code> для вывода отладочной информации.
      </p>

      <h2>Пример: Эхо-бот</h2>
      <p>
        Простой бот, который повторяет полученные сообщения:
      </p>

      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 my-6">
        <pre><code className="language-lua">{`function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  -- Проверяем что бот упомянут
  if content:find("@mybot.bot") then
    -- Извлекаем текст после упоминания
    local message = content:gsub("@mybot.bot", ""):gsub("^%s+", "")

    if message ~= "" then
      -- Отправляем ответ
      bot.sendThreadPost(threadId, "Вы сказали: " .. message)
      bot.log("info", "Отправлен ответ")
    end
  end
end`}</code></pre>
      </div>

      <h2>Пример: Приветственный бот</h2>
      <p>
        Бот, который приветствует пользователей:
      </p>

      <div className="bg-gray-900 p-6 rounded-xl border border-gray-800 my-6">
        <pre><code className="language-lua">{`function onThreadPost(post)
  local content = post.content or ""
  local threadId = post.thread_id

  -- Ищем приветствия
  if content:find("привет") or content:find("hello") then
    bot.log("info", "Обнаружено приветствие")

    -- Получаем информацию о пользователе
    local user = bot.getUser(post.user_id)

    if user then
      local greeting = "Привет, " .. user.username .. "! 👋"
      bot.sendThreadPost(threadId, greeting)
    else
      bot.sendThreadPost(threadId, "Привет! 👋")
    end
  end
end`}</code></pre>
      </div>

      <h2>Следующие шаги</h2>
      <ul>
        <li>Изучите <a href="/events">обработчики событий</a></li>
        <li>Ознакомьтесь с <a href="/api">API Reference</a></li>
        <li>Посмотрите больше <a href="/examples">примеров</a></li>
      </ul>

      <div className="bg-primary/10 border border-primary/20 rounded-xl p-6 my-8">
        <h3 className="text-primary mb-2">💡 Совет</h3>
        <p className="text-gray-300">
          Начните с простого бота и постепенно добавляйте функциональность.
          Используйте <code>bot.log()</code> для отладки на каждом этапе.
        </p>
      </div>
    </div>
  )
}
