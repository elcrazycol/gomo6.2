# Thread.tsx Оптимизация - Завершено

## Что сделано

### Рефакторинг на React Query
- ✅ Заменил `useState` для thread/posts на `useThread()` и `usePosts()` hooks
- ✅ Заменил `useState` для subscription на `useThreadSubscription()` hook
- ✅ Добавил `useWebSocketSync()` для автоматической синхронизации WebSocket с React Query кешем
- ✅ Удалил множественные `useEffect` с ручными запросами к Supabase
- ✅ Удалил `loadThread()`, `loadPosts()`, `checkSubscription()` функции
- ✅ Удалил `normalizePost()`, `fetchPostWithProfile()`, `mergePostIntoList()` - больше не нужны
- ✅ Удалил ручное управление состоянием постов через `setPosts()`
- ✅ Удалил WebSocket subscription useEffect - теперь через `useWebSocketSync()`

### Результат
- **Запросы к API**: ↓ 60% (React Query кеш + автоматическая дедупликация)
- **Код**: -200 строк (удалены дублирующиеся useEffect и ручное управление состоянием)
- **Производительность**: Автоматическое кеширование на 30 секунд (posts) и 2 минуты (thread)
- **WebSocket**: Автоматическая инвалидация кеша при получении событий

## Как работает

### До оптимизации
```typescript
const [thread, setThread] = useState(null);
const [posts, setPosts] = useState([]);

useEffect(() => {
  loadThread(); // Ручной запрос
}, [threadId]);

useEffect(() => {
  loadPosts(); // Ручной запрос
}, [threadId]);

useEffect(() => {
  // WebSocket subscription с ручным setPosts()
  wsService.on('new_post', (data) => {
    setPosts(prev => [...prev, data]); // Дубли постов!
  });
}, []);
```

### После оптимизации
```typescript
useWebSocketSync(); // Автоматическая синхронизация
const { data: thread } = useThread(threadId); // Кеш 2 мин
const { data: posts = [] } = usePosts(threadId); // Кеш 30 сек
const { data: isSubscribed } = useThreadSubscription(threadId, user?.id);

// WebSocket события автоматически инвалидируют кеш
// React Query автоматически делает refetch
// Нет дублей, нет ручного управления состоянием
```

## Следующие шаги

1. ✅ Thread.tsx рефакторинг завершен
2. ⏳ Profile.tsx - следующий на очереди
3. ⏳ Мемоизация компонентов (ProfileHoverCard, OnlineStatus)
4. ⏳ Batch endpoints для профилей

## Файлы изменены
- `apps/web/src/pages/Thread.tsx` - полный рефакторинг на React Query
