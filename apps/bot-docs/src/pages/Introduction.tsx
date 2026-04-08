export function Introduction() {
  return (
    <div className="prose">
      <h1>Gomo6 Bot API</h1>
      <p className="text-xl text-gray-600 mb-8">
        Создавайте мощных ботов для Gomo6 используя простой Lua API
      </p>


      <h2>Что такое Gomo6 боты?</h2>
      <p>
        Gomo6 боты — это автоматизированные аккаунты, которые могут взаимодействовать с пользователями,
        отвечать на сообщения, публиковать контент и выполнять другие действия на платформе.
      </p>

      <h2>Возможности</h2>
      <ul>
        <li>Отправка сообщений в треды и комментариев на стены</li>
        <li>Ответы на конкретные сообщения (reply)</li>
        <li>Создание новых тредов</li>
        <li>Получение информации о пользователях, тредах и постах</li>
        <li>Лайки постов</li>
        <li>Постоянное хранилище данных (key-value)</li>
        <li>HTTP запросы к внешним API</li>
        <li>Логирование и отладка</li>
        <li>Управление временем выполнения</li>
        <li>Фильтрация событий по упоминаниям</li>
      </ul>

      <h2>Как это работает?</h2>
      <p>
        Боты написаны на языке Lua и выполняются в изолированной среде на сервере Gomo6.
        Каждый бот получает события в реальном времени и может реагировать на них,
        используя предоставленный API.
      </p>

      <div className="bg-white dark:bg-[#1a1a1a] p-6 rounded-lg border border-gray-300 dark:border-gray-700 my-8">
        <h3 className="text-lg font-semibold mb-4">Простой пример</h3>
        <pre><code className="language-lua">{`function onThreadPost(post)
  local content = post.content or ""

  if content:find("привет") then
    bot.log("info", "Получено приветствие!")
    bot.sendThreadPost(post.thread_id, "Привет! 👋")
  end
end`}</code></pre>
      </div>

      <h2>Ограничения</h2>
      <p>
        Для обеспечения стабильности платформы, боты имеют следующие ограничения:
      </p>
      <ul>
        <li>Таймаут выполнения: 5 секунд на событие</li>
        <li>Rate limit: 10 сообщений в минуту</li>
        <li>Логи: максимум 1000 записей на бота</li>
        <li>Нет доступа к файловой системе и сети</li>
      </ul>

      <div className="bg-gray-50 dark:bg-[#1a1a1a] border border-gray-300 dark:border-gray-700 rounded-lg p-6 my-8">
        <h3 className="text-lg font-semibold mb-2">Готовы начать?</h3>
        <p className="text-gray-600 dark:text-gray-400 mb-4">
          Перейдите к разделу "Начало работы" чтобы создать своего первого бота
        </p>
        <a
          href="/getting-started"
          className="inline-block bg-black dark:bg-white hover:bg-gray-800 dark:hover:bg-gray-200 text-white dark:text-black px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Начать →
        </a>
      </div>
    </div>
  )
}
