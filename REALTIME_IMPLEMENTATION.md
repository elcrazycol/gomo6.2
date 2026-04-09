# Реализация Real-time функциональности (WebSocket + Redis Pub/Sub)

## Обзор

Реализована система real-time обновлений для социальной сети Gomo6, позволяющая мгновенно показывать новые посты всем онлайн-пользователям без перезагрузки страницы.

## Архитектура

### Технологический стек
- **Go (Gin)** — WebSocket сервер и REST API
- **PostgreSQL** — основная база данных
- **Redis** — Pub/Sub для масштабирования между серверами
- **TypeScript/React** — фронтенд с WebSocket клиентом

### Компоненты системы

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Пользователь А │      │   Redis Pub/Sub │      │   Пользователь Б │
│   (создаёт пост) │─────▶│   (realtime:posts│────▶│   (получает обновление)│
└─────────────────┘      └─────────────────┘      └─────────────────┘
         │                        ▲                        │
         ▼                        │                        ▼
┌─────────────────┐               │               ┌─────────────────┐
│   Go Backend    │───────────────┘               │   Go Backend    │
│   (POST /posts) │                               │   (WebSocket)   │
└─────────────────┘                               └─────────────────┘
```

## Бэкенд (Go)

### 1. WebSocket Hub (`internal/websocket/hub.go`)

- Управляет подключениями клиентов
- Подписывается на Redis Pub/Sub каналы
- Распространяет сообщения по комнатам (rooms)
- Поддерживает масштабирование через Redis

**Ключевые функции:**
```go
func NewHub(redisClient *redis.Client) *Hub
func (h *Hub) Run()  // Запускает обработку сообщений
func (h *Hub) PublishNewPost(post interface{}) error
func (h *Hub) BroadcastToRoom(room string, message []byte)
```

**Redis каналы:**
- `realtime:posts` — новые посты и ответы
- `realtime:threads` — новые треды
- `realtime:likes` — лайки

### 2. WebSocket Client (`internal/websocket/client.go`)

- Управляет соединением с браузером
- Обрабатывает ping/pong для поддержания соединения
- Поддерживает подписку/отписку от комнат

**Возможности:**
- Автоматический reconnect с exponential backoff
- Heartbeat (ping каждые 30 секунд)
- Буферизированная отправка сообщений

### 3. WebSocket Handler (`internal/websocket/handler.go`)

HTTP endpoint для WebSocket соединения:
- `GET /ws` — WebSocket endpoint (требует авторизации)
- `GET /ws/stats` — статистика онлайн пользователей

### 4. Интеграция с API (`internal/api/handlers/posts.go`)

При создании поста автоматически публикует событие в Redis:

```go
func (h *PostsHandler) CreatePost(c *gin.Context) {
    // ... создание поста в БД ...
    
    // Publish realtime event
    if h.wsHub != nil {
        if hub, ok := h.wsHub.(*websocket.Hub); ok {
            hub.PublishNewPost(postData)
        }
    }
}
```

## Фронтенд (React/TypeScript)

### 1. WebSocket Service (`src/services/websocket.ts`)

Синглтон для управления WebSocket соединением:

```typescript
export const wsService = new WebSocketService();

// Использование:
wsService.connect();
wsService.subscribe('feed');
wsService.on('new_post', (message) => {
    console.log('New post:', message.data);
});
```

**Возможности:**
- Автоматический reconnect (до 10 попыток с exponential backoff)
- Автоматическая подписка на комнаты после reconnect
- Типизированные сообщения

### 2. React Hooks (`src/hooks/useWebSocket.ts`)

```typescript
// Базовый хук
const { connected, subscribe, on } = useWebSocket();

// Хук для ленты
useRealtimePosts((post) => {
    // Добавить пост в UI
    setPosts(prev => [post, ...prev]);
});

// Хук для треда
useRealtimeReplies(threadId, (reply) => {
    // Добавить ответ в тред
    setReplies(prev => [...prev, reply]);
});
```

## Протокол WebSocket

### Сообщения от клиента

```json
// Подписка на комнату
{
  "type": "subscribe",
  "data": "feed",
  "timestamp": 1234567890
}

// Отписка
{
  "type": "unsubscribe", 
  "data": "thread_id",
  "timestamp": 1234567890
}

// Typing indicator
{
  "type": "typing",
  "data": { "room": "thread_id" },
  "timestamp": 1234567890
}
```

### Сообщения от сервера

```json
// Подтверждение подключения
{
  "type": "connected",
  "data": { "user_id": "...", "username": "..." },
  "timestamp": 1234567890
}

// Новый пост
{
  "type": "new_post",
  "data": {
    "id": "...",
    "thread_id": "...",
    "content": "...",
    "username": "...",
    "avatar_url": "...",
    "created_at": "..."
  },
  "timestamp": 1234567890
}

// Подтверждение подписки
{
  "type": "confirmation",
  "data": { "action": "subscribe", "room": "feed" },
  "timestamp": 1234567890
}
```

## Комнаты (Rooms)

- `feed` — глобальная лента всех постов
- `{thread_id}` — конкретный тред (для ответов)

## Интеграция в приложение

### Бэкенд

1. Hub запускается в `main.go`:
```go
wsHub := websocket.NewHub(redisClient)
go wsHub.Run()
routes.SetupRoutes(router, db, redisClient, wsHub)
```

2. При создании поста событие публикуется через `wsHub.PublishNewPost()`

### Фронтенд

1. Добавить в `App.tsx` или корневой компонент:
```typescript
import { wsService } from './services/websocket';

// При загрузке приложения
useEffect(() => {
    wsService.connect();
}, []);
```

2. В компоненте ленты:
```typescript
import { useRealtimePosts } from './hooks/useWebSocket';

function Feed() {
    const [posts, setPosts] = useState([]);
    
    useRealtimePosts((newPost) => {
        setPosts(prev => [newPost, ...prev]);
    });
    
    return (...);
}
```

## Безопасность

1. **Аутентификация**: WebSocket endpoint требует валидный JWT токен
2. **Токен передаётся**: через query параметр `?token=...` при установлении соединения
3. **CORS**: настроен для разрешения WebSocket соединений
4. **Rate limiting**: рекомендуется добавить на уровне nginx/ingress

## Масштабирование

Система поддерживает горизонтальное масштабирование:

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Server 1   │◄────►│   Redis     │◄────►│  Server 2   │
│  (WebSocket)│     │  (Pub/Sub)  │     │  (WebSocket)│
└─────────────┘     └─────────────┘     └─────────────┘
```

Все серверы подписываются на одни Redis каналы, поэтому события доставляются всем клиентам независимо от сервера.

## Мониторинг

- `GET /ws/stats` — количество онлайн пользователей
- `GET /health` — включает статус WebSocket (`websocket: true/false`)
- Логирование всех событий в stdout

## Переменные окружения

### Бэкенд (`.env`)
```
REDIS_URL=redis://localhost:6379
SERVER_PORT=8080
```

### Фронтенд (`.env.local`)
```
VITE_API_BASE_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
```

## Docker специфика

При запуске в Docker контейнерах:

1. **Порты**: WebSocket использует тот же порт 8080, что и HTTP API
2. **Сеть**: Контейнеры должны быть в одной сети (docker-compose это обеспечивает)
3. **URL**: Браузер должен подключаться к `ws://localhost:8080/ws`

### Проверка в Docker

```bash
# Пересобрать бэкенд
cd apps/backend-go
docker-compose up -d --build backend

# Проверить что WebSocket endpoint доступен
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Host: localhost:8080" \
  -H "Origin: http://localhost:8080" \
  http://localhost:8080/ws
```

### Логи для отладки

Бэкенд логирует WebSocket события:
```
[WebSocket] Client connected: username (user_id)
[WebSocket] Client subscribed to room feed
[WebSocket] Broadcasted to room feed (5 clients)
[WebSocket] Published new post event for post abc-123
```

## Проверка работы

1. Запустить бэкенд и фронтенд
2. Открыть приложение в двух браузерах (два разных пользователя)
3. В первом браузере создать пост
4. Во втором браузере пост должен появиться мгновенно без перезагрузки

## Файлы системы

### Бэкенд
- `internal/websocket/hub.go` — Hub с Redis Pub/Sub
- `internal/websocket/client.go` — WebSocket клиент
- `internal/websocket/handler.go` — HTTP хендлеры
- `internal/api/routes/routes.go` — интеграция в роуты
- `internal/api/handlers/posts.go` — публикация событий при создании поста
- `cmd/server/main.go` — запуск Hub

### Фронтенд
- `src/services/websocket.ts` — WebSocket клиент
- `src/hooks/useWebSocket.ts` — React hooks
- `src/components/...` — компоненты для интеграции (необходимо добавить)

## TODO / Дальнейшее развитие

- [ ] Добавить typing indicators в UI
- [ ] Реализовать online/offline статус пользователей
- [ ] Добавить поддержку thread-specific уведомлений
- [ ] Реализовать rate limiting для WebSocket сообщений
- [ ] Добавить end-to-end тесты для WebSocket
