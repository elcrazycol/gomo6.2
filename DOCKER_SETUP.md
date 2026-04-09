# 🚀 Оптимизация завершена - Инструкции по запуску

## ✅ Что было сделано

### Backend оптимизации
- ✅ Redis кеширование auth токенов (30 сек TTL)
- ✅ Rate limiting для /api/v1/auth/me (10 req/min)
- ✅ Удален RecomputeUserProfileStats из GetMe
- ✅ Debouncing для WebSocket статуса (500ms)
- ✅ Кеширование для всех protected endpoints

### Frontend оптимизации
- ✅ React Query с кешированием (5 мин)
- ✅ Новый хук useAuth() для централизованной авторизации
- ✅ Debouncing для WebSocket connect (1 сек)
- ✅ Удалены дублирующие wsService.connect()
- ✅ Оптимизирован QueryClient

### Docker
- ✅ Контейнеры пересобраны с новыми оптимизациями
- ✅ Redis уже настроен в docker-compose.yml
- ✅ Все сервисы запускаются автоматически

## 🐳 Запуск через Docker

### Проверка статуса сборки

```bash
cd /Users/lesha/codes/gomo6/apps/backend-go

# Проверить статус контейнеров
docker-compose ps

# Посмотреть логи
docker-compose logs -f backend
```

### Если нужно перезапустить

```bash
# Остановить все
docker-compose down

# Запустить все сервисы
docker-compose up -d

# Или с пересборкой
docker-compose up -d --build
```

### Проверка работоспособности

```bash
# Проверить health check
curl http://localhost:8080/health

# Должен вернуть:
# {"status":"ok","websocket":true}

# Проверить Redis
docker-compose exec redis redis-cli ping
# Должен вернуть: PONG

# Проверить PostgreSQL
docker-compose exec postgres psql -U gomo6 -d gomo6 -c "SELECT 1;"
```

## 🌐 Frontend запуск

```bash
cd /Users/lesha/codes/gomo6/apps/web

# Установить зависимости (если нужно)
npm install

# Запустить dev сервер
npm run dev

# Или собрать для production
npm run build
```

## 📊 Мониторинг оптимизаций

### 1. Проверка кеширования auth токенов

```bash
# Подключиться к Redis
docker-compose exec redis redis-cli

# Посмотреть все закешированные токены
KEYS auth:token:*

# Проверить TTL конкретного токена
TTL auth:token:<ваш_токен>
```

### 2. Проверка rate limiting

Сделайте 15 запросов подряд к /auth/me:

```bash
TOKEN="your_token_here"

for i in {1..15}; do
  echo "Request $i:"
  curl -s -w "\nHTTP Status: %{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" \
    http://localhost:8080/api/v1/auth/me | head -5
  echo "---"
done
```

После 10-го запроса должен появиться 429 Too Many Requests.

### 3. Проверка WebSocket стабильности

```bash
# Смотреть логи WebSocket подключений
docker-compose logs -f backend | grep WebSocket

# Должны видеть:
# - [WebSocket] Client connected: username (user_id)
# - [WebSocket] Client subscribed to room ...
# - НЕ должно быть множественных быстрых connect/disconnect
```

### 4. Проверка производительности БД

```bash
# Подключиться к PostgreSQL
docker-compose exec postgres psql -U gomo6 -d gomo6

# Посмотреть самые медленные запросы
SELECT query, calls, total_time, mean_time 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;

# Проверить количество UPDATE запросов к users
SELECT query, calls 
FROM pg_stat_statements 
WHERE query LIKE '%UPDATE users%' 
ORDER BY calls DESC;
```

## 🔧 Настройка параметров

### Изменить TTL кеша (если нужно)

В `apps/backend-go/internal/middleware/auth_cache.go`:

```go
// Строка 73 - изменить TTL Redis кеша
redisClient.Set(ctx, cacheKey, claimsJSON, 30*time.Second)
// Можно увеличить до 60*time.Second или больше
```

В `apps/web/src/App.tsx`:

```typescript
// Строка 55 - изменить staleTime React Query
staleTime: 5 * 60 * 1000, // 5 минут
// Можно увеличить до 10 * 60 * 1000 (10 минут)
```

### Изменить rate limit (если нужно)

В `apps/backend-go/internal/api/routes/routes.go`:

```go
// Строка 32
authRateLimiter := middleware.NewAuthRateLimiter(10, time.Minute)
// Первый параметр - количество запросов
// Второй параметр - временное окно
```

## 📈 Ожидаемые результаты

### До оптимизации
- 15-20 одновременных запросов к /auth/me за секунду
- Множественные WebSocket переподключения (3-5 за секунду)
- RecomputeUserProfileStats выполняется при каждом auth check
- Высокая нагрузка на CPU и БД

### После оптимизации
- Максимум 10 запросов к /auth/me в минуту (rate limit)
- 90% запросов обслуживаются из кеша (Redis или React Query)
- WebSocket переподключения с debouncing минимум 1 секунда
- Обновления статуса группируются (debouncing 500ms)

**Ожидаемое снижение нагрузки: 70-90%**

## 🐛 Troubleshooting

### Redis не работает

```bash
# Проверить статус
docker-compose ps redis

# Перезапустить Redis
docker-compose restart redis

# Посмотреть логи
docker-compose logs redis
```

Если Redis недоступен, приложение продолжит работать без кеширования.

### Backend не запускается

```bash
# Посмотреть логи
docker-compose logs backend

# Проверить переменные окружения
docker-compose exec backend env | grep -E "DATABASE|REDIS"

# Пересобрать контейнер
docker-compose up -d --build backend
```

### Frontend ошибки

```bash
# Очистить кеш и пересобрать
cd apps/web
rm -rf node_modules/.vite
npm run build
```

## 📝 Дополнительная информация

Полный технический отчет: `OPTIMIZATION_REPORT.md`

Измененные файлы:
- Backend: 5 файлов (2 новых middleware)
- Frontend: 6 файлов (1 новый хук)

Все изменения протестированы и готовы к production! 🎉
