# @gomo6/bot

TypeScript SDK для создания ботов в социальной сети gomo6.

## Установка

### Через GitHub (рекомендуется)

```bash
# Клонируйте репозиторий
git clone --depth 1 https://github.com/scramble22/gomo6.2.git

# Перейдите в директорию SDK
cd gomo6.2/packages/bot-sdk

# Соберите пакет
npm install && npm run build

# Создайте tarball
npm pack

# Скопируйте .tgz файл к себе в проект и установите
npm install ./gomo6-bot-0.1.0.tgz
```

### Через npm link (для разработки)

```bash
git clone https://github.com/scramble22/gomo6.2.git
cd gomo6.2/packages/bot-sdk
npm install && npm run build
npm link

# В вашем проекте:
npm link @gomo6/bot
```

## Быстрый старт

```typescript
import { GomoBot } from '@gomo6/bot';

const bot = new GomoBot({
  token: 'gomo6_bot_ваш_токен'
});

bot.on('ready', () => {
  console.log('Бот запущен!');
});

bot.on('message', async (ctx) => {
  if (ctx.text === '/ping') {
    await ctx.reply('Pong! 🏓');
  }
});

bot.start();
```

## Получение токена

1. Откройте [dev.gomo6.wtf/bots](https://dev.gomo6.wtf/bots)
2. Нажмите «Создать бота»
3. Введите имя (автоматически добавится суффикс `_bot`)
4. Скопируйте токен — он показывается **только один раз**

## Конфигурация

```typescript
const bot = new GomoBot({
  token: 'gomo6_bot_...',         // Обязательно
  baseUrl: 'https://gomo6.wtf',   // API сервер (по умолчанию)
  wsUrl: 'wss://gomo6.wtf/ws',    // WebSocket сервер (по умолчанию)
  reconnect: true,                 // Авто-реконнект (по умолчанию true)
  reconnectInterval: 3000,         // Интервал реконнекта в мс
  maxReconnectAttempts: 10,        // Максимум попыток реконнекта
});
```

## События

### Жизненный цикл

```typescript
bot.on('ready', () => {
  // Бот авторизован и готов к работе
});

bot.on('error', (err) => {
  console.error('Ошибка:', err.message);
});

bot.on('disconnected', () => {
  // Соединение разорвано
});

bot.on('reconnecting', (attempt) => {
  console.log(`Переподключение... попытка ${attempt}`);
});
```

### Сообщения в чатах

```typescript
bot.on('message', async (ctx) => {
  console.log(ctx.text);           // Текст сообщения
  console.log(ctx.conversationId); // ID чата
  console.log(ctx.senderId);       // ID отправителя
  console.log(ctx.messageId);      // ID сообщения
  console.log(ctx.sentAt);         // Дата отправки

  await ctx.reply('Ответ');        // Ответить в тот же чат
  await ctx.edit('Новый текст');   // Редактировать сообщение
  await ctx.delete();              // Удалить сообщение
});
```

### Посты и треды

```typescript
bot.on('post_created', async (ctx) => {
  console.log(ctx.text);      // Текст поста
  console.log(ctx.threadId);  // ID треда
  console.log(ctx.postId);    // ID поста

  await ctx.reply('Комментарий'); // Ответить в треде
});

bot.on('thread_created', (thread) => {
  console.log(thread.title);
  console.log(thread.board_id);
});
```

### Лайки

```typescript
bot.on('like', (data) => {
  console.log(`Лайк на пост ${data.post_id} от ${data.user_id}`);
});

bot.on('unlike', (data) => {
  console.log(`Убрал лайк с поста ${data.post_id}`);
});
```

### Статус пользователей

```typescript
bot.on('user_online', (data) => {
  console.log(`${data.username} онлайн`);
});

bot.on('user_offline', (data) => {
  console.log(`${data.username} оффлайн`);
});
```

## API напрямую

Помимо событий, можно использовать REST API через `bot.api`:

```typescript
// Треды
const threads = await bot.api.getThreads({ board_id: '...' });
const thread = await bot.api.getThread('thread-id');
const newThread = await bot.api.createThread({
  board_id: 'board-id',
  title: 'Заголовок',
  content: 'Текст треда'
});

// Посты
const posts = await bot.api.getPosts({ thread_id: '...' });
const newPost = await bot.api.createPost({
  thread_id: 'thread-id',
  content: 'Текст поста'
});

// Мессенджер
const convs = await bot.api.getConversations();
const messages = await bot.api.getMessages('conversation-id');
await bot.api.sendMessage('conversation-id', 'Привет!');

// Доски
const boards = await bot.api.getBoards();

// Лайки
await bot.api.likeThread('thread-id');
await bot.api.likePost('post-id');

// Профили
const me = await bot.api.getMe();
const profile = await bot.api.getProfile('user-id');
```

## Подписки на обновления

Бот автоматически подключается к WebSocket и слушает все события. Но для получения обновлений из конкретных тредов/чатов нужно подписаться:

```typescript
// Подписаться на обновления треда
bot.subscribeToThread('thread-id');

// Подписаться на обновления доски
bot.subscribeToBoard('board-id');

// Подписаться на глобальную ленту
bot.subscribeToFeed();

// Подписаться на чат
bot.subscribeToChat('conversation-id');

// Отписаться
bot.unsubscribeFromThread('thread-id');
```

## Пример: бот-помощник

```typescript
import { GomoBot } from '@gomo6/bot';

const bot = new GomoBot({ token: process.env.BOT_TOKEN! });

bot.on('ready', () => console.log('Бот запущен'));

bot.on('message', async (ctx) => {
  const [command, ...args] = ctx.text.split(' ');

  switch (command) {
    case '/ping':
      await ctx.reply('Pong! 🏓');
      break;

    case '/help':
      await ctx.reply([
        'Доступные команды:',
        '/ping — проверка связи',
        '/help — эта справка',
        '/info — информация о боте',
      ].join('\n'));
      break;

    case '/info':
      const me = await bot.api.getMe();
      await ctx.reply(`Я ${me.username}, создана: ${me.created_at}`);
      break;
  }
});

bot.start();
```

## Пример: автопостер

```typescript
import { GomoBot } from '@gomo6/bot';

const bot = new GomoBot({ token: process.env.BOT_TOKEN! });

// Каждые 60 секунд постить в тред
setInterval(async () => {
  await bot.api.createPost({
    thread_id: 'target-thread-id',
    content: `Текущее время: ${new Date().toLocaleTimeString('ru-RU')}`
  });
}, 60_000);

bot.start();
```

## Лицензия

MIT
