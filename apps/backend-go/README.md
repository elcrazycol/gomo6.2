# Gomo6 Backend - Go Implementation

Федеративный бэкенд для Gomo6 с поддержкой межсерверного взаимодействия.

## Особенности

- **Федеративная архитектура** - поддержка глобальных g-сабов
- **Custom протокол** - простой REST + WebSocket
- **Совместимость с Supabase** - плавная миграция
- **Высокая производительность** - Go + PostgreSQL + Redis

## Структура проекта

```
apps/backend-go/
├── cmd/server/main.go          # Точка входа
├── internal/
│   ├── api/
│   │   ├── handlers/           # HTTP обработчики
│   │   └── routes/             # Роуты
│   ├── auth/                   # JWT аутентификация
│   ├── database/               # Подключение к БД
│   ├── middleware/             # Middleware
│   ├── models/                 # Модели данных
│   └── websocket/              # Realtime
├── migrations/                 # SQL миграции
├── docker-compose.yml          # Docker конфигурация
└── Dockerfile                  # Docker образ
```

## Быстрый старт

### 1. С Docker Compose (рекомендуется)

```bash
# Запуск всех сервисов
docker-compose up -d

# Проверка работы
curl http://localhost:8080/health
```

### 2. Локальный запуск

```bash
# Установка зависимостей
brew install postgres redis

# Запуск БД и Redis
postgres -D /usr/local/var/postgres &
redis-server &

# Создание БД
createdb gomo6

# Применение миграций
psql gomo6 < migrations/001_initial_schema.sql

# Запуск сервера
go run cmd/server/main.go
```

## API Эндпоинты

### Аутентификация
```
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
```

### Supabase совместимость
```
GET    /rest/v1/profiles
GET    /rest/v1/boards
GET    /rest/v1/threads
GET    /rest/v1/posts
POST   /rest/v1/boards      (требует auth)
POST   /rest/v1/threads     (требует auth)
POST   /rest/v1/posts       (требует auth)
```

### Федерация
```
GET  /federation/users/:username@:domain
GET  /federation/gomosubs/:slug
GET  /federation/servers
```

## Конфигурация

Переменные окружения:

```bash
SERVER_PORT=8080
DATABASE_URL=postgres://user:password@localhost/gomo6?sslmode=disable
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
SERVER_DOMAIN=localhost:8080
FEDERATION_KEY=your-federation-key
ENVIRONMENT=development
```

## Разработка

### Сборка
```bash
go build -o bin/server cmd/server/main.go
./bin/server
```

### Тестирование
```bash
go test ./...
```

### Миграции
```bash
# Создание новой миграции
# Добавить файл в migrations/ с номером

# Применение миграций
psql gomo6 < migrations/001_initial_schema.sql
```

## Федеративная архитектура

### Пользователи
- Формат: `username@domain`
- Глобальная уникальность имен
- Поддержка удаленных пользователей

### G-сабы
- Глобальные сообщества
- Владелец на конкретном сервере
- Возможность создания тредов с других серверов

### Межсерверное взаимодействие
- REST API для основных операций
- WebSocket для real-time
- Криптографическая подпись запросов

## Совместимость с frontend

Бэкенд эмулирует Supabase API для плавной миграции:

- Те же форматы ответов
- Поддержка `apikey` заголовка
- Аналогичные эндпоинты `/rest/v1/*`

## Дальнейшее развитие

1. **Полная реализация CRUD** - все эндпоинты
2. **WebSocket real-time** - замена Supabase realtime  
3. **Федерация** - межсерверное взаимодействие
4. **Bot API** - для создания ботов
5. **Админ панель** - управление федерацией

## Производительность

- **Go** для высокой производительности
- **PostgreSQL** с индексами
- **Redis** для кэша и real-time
- **Connection pooling**
- **Асинхронная обработка**
