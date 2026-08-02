# Реалтайм обновления через WebSocket

Документация по реализации реалтайм-обновлений на примере стены профиля.

## Архитектура

### 1. WebSocket сервис (`websocket.ts`)

Синглтон-сервис для управления WebSocket соединением:

```typescript
// Основные методы:
wsService.connect()              // Подключение
wsService.subscribe(room)        // Подписка на комнату
wsService.unsubscribe(room)      // Отписка от комнаты
wsService.on(type, handler)      // Подписка на сообщения типа
wsService.off(type, handler)     // Отписка
```

**Типы сообщений:**
- `new_wall_post` — новый пост на стене
- `update_wall_post` — обновление поста
- `delete_wall_post` — удаление поста
- `new_thread` — новый тред
- `new_reply` — новый ответ
- и др.

### 2. Комнаты (rooms)

Комнаты — это каналы для группировки сообщений:

```typescript
// Примеры комнат:
`profile_wall_${userId}`    // Стена конкретного профиля
`thread_${threadId}`         // Конкретный тред
`feed`                       // Лента новостей
`chat_${chatId}`             // Чат
```

Подписка на комнату:
```typescript
wsService.subscribe(`profile_wall_${profileUserId}`);
```

## Паттерн дедупликации

### Проблема

При создании поста происходит дублирование:
1. Пост добавляется локально после ответа API
2. WebSocket сообщение приходит и добавляет тот же пост ещё раз

### Решение

**Timestamp-based дедупликация с использованием refs**

```typescript
// 1. Создаём refs для избежания stale closure
const pendingPostIdRef = useRef<string | null>(null);
const pendingPostTimestampRef = useRef<number | null>(null);
const processedPostIdsRef = useRef<Set<string>>(new Set());

// 2. Функция вызывается ДО API запроса
const handleBeforeCreate = () => {
  const timestamp = Date.now();
  const tempId = crypto.randomUUID();
  
  // Обновляем refs (мгновенно, без ре-рендера)
  pendingPostTimestampRef.current = timestamp;
  pendingPostIdRef.current = tempId;
  
  // И state (для ре-рендеров при необходимости)
  setPendingPostTimestamp(timestamp);
  setPendingPostId(tempId);
  
  return tempId;
};

// 3. WebSocket handler проверяет timestamp
const unsubscribeNewPost = wsService.on('new_wall_post', (message) => {
  const postData = message.data;
  const postId = String(postData.id);
  const postTimestamp = new Date(postData.created_at).getTime();
  
  // Получаем актуальные значения из refs
  const currentPendingTimestamp = pendingPostTimestampRef.current;
  
  // Проверяем: это наш пост?
  const isRecentPost = currentPendingTimestamp && 
    (postTimestamp - currentPendingTimestamp) < 10000; // 10 секунд
  
  if (isRecentPost) {
    // Это наш пост — игнорируем WebSocket сообщение
    pendingPostTimestampRef.current = null;
    return;
  }
  
  // Это чужой пост — добавляем
  setPosts(prev => [postData, ...prev]);
});
```

## Полный пример интеграции

### Компонент формы создания

```typescript
// CreateWallPost.tsx
interface CreateWallPostProps {
  profileUserId: string;
  currentUserId: string;
  onPostCreated?: (post: WallPost) => void;
  onBeforeCreate?: () => string;  // Важно: вызывается ДО API
  onCancel: () => void;
}

const handleSubmit = async () => {
  // 1. Устанавливаем timestamp ДО запроса
  onBeforeCreate?.();
  
  // 2. Отправляем API запрос
  const { data, error } = await supabase
    .from("profile_wall_posts")
    .insert([postData])
    .select()
    .single();
  
  // 3. Добавляем пост локально
  onPostCreated?.(data);
};
```

### Компонент списка

```typescript
// ProfileWall.tsx
export const ProfileWall = ({ profileUserId, currentUserId }) => {
  const [posts, setPosts] = useState<WallPost[]>([]);
  
  // Refs для дедупликации
  const pendingPostIdRef = useRef<string | null>(null);
  const pendingPostTimestampRef = useRef<number | null>(null);
  const processedPostIdsRef = useRef<Set<string>>(new Set());
  
  // WebSocket подписка
  useEffect(() => {
    if (!profileUserId || !currentUserId) return;
    
    // Подключаемся
    if (!wsService.connected) {
      wsService.connect();
    }
    
    // Подписываемся на комнату
    const wallRoom = `profile_wall_${profileUserId}`;
    wsService.subscribe(wallRoom);
    
    // Слушаем новые посты
    const unsubscribeNewPost = wsService.on('new_wall_post', (message) => {
      const postData = typeof message.data === 'string' 
        ? JSON.parse(message.data) 
        : message.data;
      
      if (!postData.id || postData.user_id !== profileUserId) return;
      
      const postId = String(postData.id);
      
      // Уже обработали?
      if (processedPostIdsRef.current.has(postId)) return;
      
      // Это наш пост?
      const currentPendingTimestamp = pendingPostTimestampRef.current;
      const postTimestamp = new Date(postData.created_at).getTime();
      const isRecentPost = currentPendingTimestamp && 
        (postTimestamp - currentPendingTimestamp) < 10000;
      
      if (isRecentPost) {
        pendingPostTimestampRef.current = null;
        return;
      }
      
      // Добавляем новый пост
      setPosts(prevPosts => {
        // Уже есть в списке?
        if (prevPosts.find(p => String(p.id) === postId)) {
          return prevPosts;
        }
        
        processedPostIdsRef.current.add(postId);
        return [postData, ...prevPosts];
      });
    });
    
    // Слушаем обновления
    const unsubscribeUpdatePost = wsService.on('update_wall_post', (message) => {
      const postData = message.data;
      setPosts(prev => prev.map(post => 
        String(post.id) === String(postData.id) ? postData : post
      ));
    });
    
    // Слушаем удаления
    const unsubscribeDeletePost = wsService.on('delete_wall_post', (message) => {
      const postData = message.data;
      setPosts(prev => prev.filter(post => 
        String(post.id) !== String(postData.id)
      ));
    });
    
    return () => {
      unsubscribeNewPost();
      unsubscribeUpdatePost();
      unsubscribeDeletePost();
    };
  }, [profileUserId, currentUserId]);  // ВАЖНО: без pendingPostTimestamp!
  
  // Вызывается ДО API запроса
  const handleBeforeCreate = () => {
    const timestamp = Date.now();
    const tempId = crypto.randomUUID();
    
    pendingPostTimestampRef.current = timestamp;
    pendingPostIdRef.current = tempId;
    
    return tempId;
  };
  
  // Вызывается ПОСЛЕ успешного API запроса
  const handlePostCreated = (newPost: WallPost) => {
    setPosts(prev => [newPost, ...prev]);
    
    // Очищаем через 5 секунд
    setTimeout(() => {
      pendingPostTimestampRef.current = null;
      pendingPostIdRef.current = null;
    }, 5000);
  };
  
  return (
    <CreateWallPost
      profileUserId={profileUserId}
      currentUserId={currentUserId}
      onBeforeCreate={handleBeforeCreate}  // ДО API
      onPostCreated={handlePostCreated}     // ПОСЛЕ API
      onCancel={() => setShowCreateForm(false)}
    />
  );
};
```

## Ключевые принципы

### 1. Порядок вызовов
```
onBeforeCreate() → API запрос → WebSocket приходит → onPostCreated()
```

### 2. Использование refs
- `useRef` для значений, которые читаются в WebSocket handler
- `useState` для значений, которые нужны для UI
- Handler всегда читает из `ref.current` (актуальное значение)

### 3. Зависимости useEffect
```typescript
// ПРАВИЛЬНО:
}, [profileUserId, currentUserId]);

// НЕПРАВИЛЬНО (пересоздаёт handler):
}, [profileUserId, currentUserId, pendingPostTimestamp]);
```

### 4. Окно дедупликации
- 10 секунд достаточно для покрытия задержки API + WebSocket
- Слишком маленькое окно = дубли
- Слишком большое = пропуск чужих постов

### 5. processedPostIdsRef
- Защита от дублей при множественных WebSocket сообщениях
- Один пост = одна обработка

## Применение к другим частям

### Чат
```typescript
// Комната: chat_${chatId}
// События: new_message, update_message, delete_message, typing

useEffect(() => {
  wsService.subscribe(`chat_${chatId}`);
  
  const unsubscribe = wsService.on('new_message', (msg) => {
    // Проверка по author_id и timestamp
    if (msg.data.author_id === currentUserId && isRecent) {
      return; // Наше сообщение
    }
    setMessages(prev => [...prev, msg.data]);
  });
  
  return () => unsubscribe();
}, [chatId]);
```

### Треды форума
```typescript
// Комната: thread_${threadId}
// События: new_reply, update_reply, delete_reply

useEffect(() => {
  wsService.subscribe(`thread_${threadId}`);
  
  const unsubscribe = wsService.on('new_reply', (msg) => {
    setReplies(prev => [...prev, msg.data]);
  });
  
  return () => unsubscribe();
}, [threadId]);
```

### Лента новостей
```typescript
// Комната: feed
// События: new_post

useEffect(() => {
  wsService.subscribe('feed');
  
  const unsubscribe = wsService.on('new_post', (msg) => {
    // Дедупликация по author_id + timestamp
    setFeed(prev => [msg.data, ...prev]);
  });
  
  return () => unsubscribe();
}, []);
```

## Чеклист внедрения

- [ ] Добавить `useRef` для timestamp и ID
- [ ] Создать `handleBeforeCreate` (вызывать ДО API)
- [ ] Создать `handlePostCreated` (вызывать ПОСЛЕ API)
- [ ] Подписаться на WebSocket в `useEffect`
- [ ] Реализовать дедупликацию в handler (timestamp + ID + Set)
- [ ] Отписаться в cleanup функции
- [ ] Убрать state-зависимости из `useEffect` deps
- [ ] Протестировать: быстрые последовательные создания

## Важные моменты

1. **Всегда используй refs** в WebSocket handler — иначе stale closure
2. **onBeforeCreate ДО, onPostCreated ПОСЛЕ** — порядок критичен
3. **Проверяй ID стены/чата/треда** — не все сообщения для тебя
4. **Очищай refs** — через setTimeout после успешного создания
5. **Уникальные ключи** — `post.id` + `created_at` + `index` для React
