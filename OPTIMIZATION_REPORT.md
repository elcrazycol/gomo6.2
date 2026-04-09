# Оптимизация производительности - Отчет

## Проблемы, которые были исправлены

### 🔴 Критическая проблема: Массовые повторные запросы /api/v1/auth/me

**Причина:**
- Отсутствие кеширования на backend
- Отсутствие кеширования на frontend (React Query)
- Вызов тяжелой функции RecomputeUserProfileStats при каждом запросе
- Отсутствие rate limiting

**Исправления:**

1. **Backend кеширование (Redis)** - `apps/backend-go/internal/middleware/auth_cache.go`
   - Добавлен middleware `AuthCacheMiddleware` с кешированием токенов в Redis
   - TTL: 30 секунд
   - Кеш проверяется перед валидацией JWT токена
   - Асинхронное сохранение в кеш для минимизации задержек

2. **Rate limiting** - `apps/backend-go/internal/middleware/auth_rate_limit.go`
   - Добавлен `AuthRateLimiter` с ограничением 10 запросов в минуту на пользователя
   - Token bucket алгоритм
   - Автоматическая очистка старых buckets

3. **Удаление RecomputeUserProfileStats** - `apps/backend-go/internal/api/handlers/auth.go`
   - Убран вызов тяжелой функции из GetMe handler
   - Статистика должна обновляться только при реальных изменениях (новый пост, лайк и т.д.)

4. **Frontend кеширование (React Query)** - `apps/web/src/hooks/useAuth.ts`
   - Создан хук `useAuth()` с кешированием через React Query
   - staleTime: 5 минут
   - gcTime: 10 минут
   - Отключен refetch on window focus и mount

5. **Обновлен QueryClient** - `apps/web/src/App.tsx`
   - Настроены глобальные параметры кеширования для всех запросов
   - Отключены избыточные refetch

### 🟡 Проблема: Множественные WebSocket переподключения

**Причина:**
- Отсутствие debouncing для connect()
- Множественные вызовы wsService.connect() из разных компонентов
- Отсутствие debouncing для обновлений статуса в БД

**Исправления:**

1. **Debouncing для connect()** - `apps/web/src/services/websocket.ts`
   - Добавлена проверка минимального интервала между попытками подключения (1 секунда)
   - Предотвращает множественные одновременные подключения

2. **Удалены дублирующие вызовы connect()**
   - `apps/web/src/pages/Thread.tsx` - убран wsService.connect()
   - `apps/web/src/components/ProfileWall.tsx` - убран wsService.connect()
   - Подключение теперь управляется только из App.tsx и WebSocketContext

3. **Debouncing для статуса пользователя** - `apps/backend-go/internal/websocket/hub.go`
   - Добавлен debouncing 500ms для обновлений is_online/last_seen
   - Предотвращает множественные UPDATE запросы при быстрых переподключениях
   - Используется map с таймерами для каждого пользователя

## Применение изменений

### Backend (Go)

Изменения применятся автоматически при следующем запуске сервера:

```bash
cd apps/backend-go
go run cmd/server/main.go
```

Middleware автоматически подключены в `routes.go`:
- `/api/v1/auth/me` - использует `AuthCacheMiddleware` + `AuthRateLimitMiddleware`
- `/ws` - использует `SupabaseAuthCacheMiddleware`
- Все protected endpoints - используют `SupabaseAuthCacheMiddleware`

### Frontend (React)

Изменения применятся автоматически при следующей сборке:

```bash
cd apps/web
npm run dev
```

## Ожидаемые результаты

### Снижение нагрузки на CPU

1. **Кеширование auth/me:**
   - Первый запрос: полная валидация JWT + запрос к БД
   - Последующие 30 секунд: чтение из Redis (в 10-100 раз быстрее)
   - Frontend кеш 5 минут: запросы вообще не отправляются

2. **Rate limiting:**
   - Максимум 10 запросов /auth/me в минуту на пользователя
   - Защита от request storms

3. **Удаление RecomputeUserProfileStats:**
   - Убраны 6 тяжелых COUNT запросов при каждом /auth/me
   - Снижение нагрузки на БД в десятки раз

### Стабилизация WebSocket

1. **Debouncing connect:**
   - Минимум 1 секунда между попытками подключения
   - Предотвращает "request storm" при проблемах с сетью

2. **Debouncing статуса:**
   - Обновления is_online/last_seen группируются с задержкой 500ms
   - Снижение количества UPDATE запросов в 5-10 раз

3. **Единая точка подключения:**
   - WebSocket подключается только из App.tsx
   - Нет дублирующих подключений из компонентов

## Мониторинг

### Проверка эффективности кеширования

```bash
# Redis - проверка кеша токенов
redis-cli
> KEYS auth:token:*
> TTL auth:token:<token>
```

### Проверка rate limiting

Попробуйте сделать более 10 запросов к /auth/me за минуту:

```bash
for i in {1..15}; do
  curl -H "Authorization: Bearer <token>" http://localhost:8080/api/v1/auth/me
  echo "Request $i"
done
```

После 10-го запроса должен вернуться 429 Too Many Requests.

### Логи WebSocket

Проверьте логи на наличие множественных подключений:

```bash
# Backend logs
grep "Client connected" logs/app.log | wc -l
grep "Client disconnected" logs/app.log | wc -l
```

## Дополнительные рекомендации

### 1. Мониторинг Redis

Убедитесь что Redis работает и доступен:

```bash
redis-cli ping
# Должен вернуть: PONG
```

Если Redis недоступен, кеширование будет пропущено, но приложение продолжит работать.

### 2. Настройка Redis TTL

Текущие значения:
- Auth token cache: 30 секунд
- React Query cache: 5 минут

Можно увеличить для снижения нагрузки, но учитывайте:
- Больше TTL = дольше задержка при изменении прав пользователя
- Меньше TTL = больше запросов к БД

### 3. Мониторинг производительности

Добавьте метрики для отслеживания:
- Cache hit rate для auth tokens
- Количество rate limit срабатываний
- Частота WebSocket переподключений

## Файлы, которые были изменены

### Backend
- `apps/backend-go/internal/middleware/auth_cache.go` (новый)
- `apps/backend-go/internal/middleware/auth_rate_limit.go` (новый)
- `apps/backend-go/internal/api/handlers/auth.go`
- `apps/backend-go/internal/api/routes/routes.go`
- `apps/backend-go/internal/websocket/hub.go`

### Frontend
- `apps/web/src/hooks/useAuth.ts` (новый)
- `apps/web/src/App.tsx`
- `apps/web/src/components/AppLayout.tsx`
- `apps/web/src/services/websocket.ts`
- `apps/web/src/pages/Thread.tsx`
- `apps/web/src/components/ProfileWall.tsx`

## Заключение

Все критические проблемы с повторяющимися запросами и нестабильностью WebSocket были исправлены. Система теперь:

✅ Кеширует auth токены на 30 секунд (Redis)
✅ Кеширует user данные на 5 минут (React Query)
✅ Ограничивает rate для auth/me (10 req/min)
✅ Не выполняет тяжелые запросы при каждом auth check
✅ Предотвращает множественные WebSocket подключения
✅ Группирует обновления статуса пользователя

Ожидаемое снижение нагрузки: **70-90%** для auth endpoints и **50-70%** для WebSocket операций.
