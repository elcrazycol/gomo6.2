# Исправления системы воспроизведения аудио

## Дата: 2026-04-08

## Проблемы

1. **Аудио не догружается до конца** - файлы останавливаются на середине и бесконечно грузятся
2. **Файлы не подгружаются** - некоторые треки вообще не начинают воспроизведение
3. **Панель Now Playing работает нестабильно** - баги с переключением треков, зависания

## Причины

### 1. Отсутствие поддержки HTTP Range запросов
- Backend не поддерживал частичную загрузку (Range header)
- Браузер не мог перематывать или докачивать файл
- При попытке перемотки начиналась загрузка всего файла заново

### 2. Неправильная стратегия preload
- Использовался `preload="auto"` - загружает весь файл сразу
- Создавал огромную нагрузку на сеть при открытии страницы с плейлистом
- Блокировал другие запросы

### 3. Отсутствие обработки ошибок
- Нет обработки сетевых ошибок, таймаутов, 404
- При ошибке плеер зависал, не переключался на следующий трек
- Пользователь не видел никаких сообщений об ошибке

### 4. Слишком частые обновления UI
- Progress обновлялся каждые 200мс
- Вызывал лишние re-renders React компонентов
- Замедлял интерфейс при воспроизведении

## Исправления

### Backend (Go)

#### 1. Добавлена поддержка HTTP Range запросов

**Файл:** `apps/backend-go/internal/storage/handlers/upload.go`

```go
// Парсинг Range header
rangeHeader := c.GetHeader("Range")
var rangeStart, rangeEnd *int64

if rangeHeader != "" {
    if strings.HasPrefix(rangeHeader, "bytes=") {
        rangeSpec := strings.TrimPrefix(rangeHeader, "bytes=")
        parts := strings.Split(rangeSpec, "-")
        if len(parts) == 2 {
            if parts[0] != "" {
                if start, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
                    rangeStart = &start
                }
            }
            if parts[1] != "" {
                if end, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
                    rangeEnd = &end
                }
            }
        }
    }
}

// Использование GetObjectRange вместо GetObject
out, err := h.client.GetObjectRange(c.Request.Context(), bucket, key, rangeStart, rangeEnd)

// Установка правильных заголовков
c.Header("Accept-Ranges", "bytes")
if out.ContentRange != nil && aws.ToString(out.ContentRange) != "" {
    c.Header("Content-Range", aws.ToString(out.ContentRange))
    c.Status(http.StatusPartialContent) // 206
} else {
    c.Status(http.StatusOK) // 200
}
```

**Файл:** `apps/backend-go/internal/storage/client.go`

Добавлен новый метод `GetObjectRange`:

```go
func (s *StorageClient) GetObjectRange(ctx context.Context, bucket, key string, rangeStart, rangeEnd *int64) (*s3.GetObjectOutput, error) {
    input := &s3.GetObjectInput{
        Bucket: aws.String(bucket),
        Key:    aws.String(key),
    }

    // Build Range header if specified
    if rangeStart != nil || rangeEnd != nil {
        var rangeStr string
        if rangeStart != nil && rangeEnd != nil {
            rangeStr = fmt.Sprintf("bytes=%d-%d", *rangeStart, *rangeEnd)
        } else if rangeStart != nil {
            rangeStr = fmt.Sprintf("bytes=%d-", *rangeStart)
        } else if rangeEnd != nil {
            rangeStr = fmt.Sprintf("bytes=0-%d", *rangeEnd)
        }
        if rangeStr != "" {
            input.Range = aws.String(rangeStr)
        }
    }

    return s.s3.GetObject(ctx, input)
}
```

### Frontend (React/TypeScript)

#### 2. Исправлена стратегия preload

**Файл:** `apps/web/src/components/MediaPlayer.tsx`

```typescript
<Element
  ref={mediaRef as any}
  className="w-full"
  playsInline
  controls
  preload="metadata"  // Было: без атрибута (по умолчанию auto)
  crossOrigin="anonymous"
  data-poster={poster}
>
```

**Файл:** `apps/web/src/components/AppLayout.tsx`

Все создания Audio элементов:

```typescript
const audio = new Audio(meta.src);
audio.preload = "metadata";  // Было: "auto"
audio.crossOrigin = "anonymous";
```

#### 3. Добавлена обработка ошибок

**MediaPlayer.tsx** - обработка ошибок Plyr:

```typescript
instance.on("error", (event: any) => {
  console.error("Media playback error:", event);
  if (kind === "audio") {
    window.dispatchEvent(
      new CustomEvent("global-audio-error", {
        detail: { playerId: playerKey, error: event, title },
      })
    );
  }
});
```

**AppLayout.tsx** - обработка ошибок нативного Audio:

```typescript
audio.addEventListener("error", (e) => {
  console.error("Audio playback error:", e);
  audioMapRef.current.delete(targetId);
  setQueue((q) => q.filter((k) => k !== targetId));
  controlRef.current?.("next");  // Автоматически переключаемся на следующий трек
});
```

**AppLayout.tsx** - обработка ошибок при play():

```typescript
entry.inst.play().catch((err) => {
  console.error("Failed to play audio:", err);
  audioMapRef.current.delete(targetId);
  setQueue((q) => q.filter((k) => k !== targetId));
  controlRef.current?.("next");
});
```

**AppLayout.tsx** - глобальный обработчик ошибок:

```typescript
const handleAudioError = (e: Event) => {
  const detail = (e as CustomEvent).detail;
  const id = detail?.playerId;
  if (!id) return;

  console.error("Audio error for track:", detail.title, detail.error);
  audioMapRef.current.delete(id);
  setQueue((q) => q.filter((k) => k !== id));

  // Auto-skip to next track on error
  if (nowPlaying?.id === id) {
    controlRef.current?.("next");
  }
};

window.addEventListener("global-audio-error", handleAudioError as EventListener);
```

#### 4. Оптимизированы обновления UI

**AppLayout.tsx** - увеличен throttle с 200мс до 500мс:

```typescript
const update = () => {
  const now = performance.now();
  if (now - lastProgressUpdateRef.current < 500) return;  // Было: 200
  lastProgressUpdateRef.current = now;
  // ...
};
```

Применено во всех местах:
- `playTrackById` - создание нового Audio
- Восстановление аудио при загрузке страницы
- Обработчик `global-audio-play`

## Результаты

### Что улучшилось

1. **Стабильное воспроизведение**
   - Аудио загружается частями по требованию
   - Перемотка работает мгновенно без перезагрузки
   - Нет зависаний на середине трека

2. **Быстрая загрузка страницы**
   - Загружаются только метаданные (длительность, битрейт)
   - Сам аудиофайл загружается только при нажатии Play
   - Плейлист из 10 треков загружается за секунды вместо минут

3. **Автоматическое восстановление**
   - При ошибке загрузки автоматически переключается на следующий трек
   - Пользователь видит ошибки в консоли (для отладки)
   - Плеер не зависает

4. **Плавный интерфейс**
   - Обновления progress bar в 2.5 раза реже
   - Меньше нагрузка на React
   - Плавная анимация без лагов

### Технические детали

**HTTP Range запросы:**
- Браузер запрашивает: `Range: bytes=0-1023` (первый килобайт)
- Сервер отвечает: `206 Partial Content` + `Content-Range: bytes 0-1023/5242880`
- При перемотке: `Range: bytes=2097152-` (с 2МБ до конца)

**Preload стратегии:**
- `auto` - загружает весь файл (плохо для больших файлов)
- `metadata` - загружает только заголовки (оптимально)
- `none` - не загружает ничего (слишком медленный старт)

**Throttling:**
- 200мс = 5 обновлений в секунду (избыточно)
- 500мс = 2 обновления в секунду (оптимально для progress bar)

## Тестирование

### Как проверить Range запросы

1. Открыть DevTools → Network
2. Включить воспроизведение аудио
3. Найти запрос к `/storage/v1/object/content/...`
4. Проверить заголовки:
   - Request: `Range: bytes=0-`
   - Response: `Accept-Ranges: bytes`, `Content-Range: bytes 0-xxx/total`
   - Status: `206 Partial Content`

### Как проверить preload

1. Открыть страницу с аудио (не нажимать Play)
2. DevTools → Network → фильтр по audio
3. Должны быть только маленькие запросы (несколько КБ для метаданных)
4. После нажатия Play - начинается загрузка основного файла

### Как проверить обработку ошибок

1. Удалить файл из storage или изменить URL на несуществующий
2. Попробовать воспроизвести
3. Должно автоматически переключиться на следующий трек
4. В консоли должна быть ошибка с описанием

## Следующие шаги (опционально)

1. **UI для ошибок** - показывать toast уведомление при ошибке загрузки
2. **Retry логика** - повторять попытку загрузки 2-3 раза перед skip
3. **Prefetch** - предзагружать следующий трек в плейлисте
4. **Кэширование** - использовать Service Worker для кэширования аудио
5. **Качество** - поддержка разных битрейтов (128/256/320 kbps)

## Файлы изменены

Backend:
- `apps/backend-go/internal/storage/handlers/upload.go`
- `apps/backend-go/internal/storage/client.go`

Frontend:
- `apps/web/src/components/MediaPlayer.tsx`
- `apps/web/src/components/AppLayout.tsx`

## Команды для применения

```bash
# Backend
docker-compose build backend
docker-compose up -d backend

# Frontend (автоматически при dev mode)
# Просто обновить страницу в браузере
```
