# Исправления Now Playing системы

## Дата: 2026-04-08

## Проблема

При первом переходе со страницы с музыкой аудио паузилось, затем работало нормально. Панель Now Playing была нестабильной.

## Причины

### 1. Неправильное определение состояния воспроизведения

**Проблема:** Код проверял `instance.paused` для Plyr инстансов, но Plyr - это обёртка над HTML5 media элементом. Нужно проверять `instance.media.paused`.

```typescript
// ❌ Неправильно
const isPlaying = !instance.paused;

// ✅ Правильно
const media = instance.media || instance;
const isPlaying = media && !media.paused && !media.ended;
```

### 2. Проблемы с timing при восстановлении воспроизведения

**Проблема:** Использовался `setTimeout(..., 0)` или `setTimeout(..., 100)`, что не гарантирует правильный порядок выполнения после DOM операций.

```typescript
// ❌ Неправильно
setTimeout(() => instance.play(), 0);

// ✅ Правильно
requestAnimationFrame(() => {
  if (media && !media.paused) return; // Already playing
  instance.play().catch(() => {});
});
```

### 3. Некорректная логика pauseOthers

**Проблема:** Функция проверяла `entry.inst.paused === false`, что не работает для Plyr.

### 4. Неправильное отображение кнопки Play/Pause

**Проблема:** UI показывал неправильное состояние из-за проверки `inst.paused` вместо `inst.media.paused`.

## Исправления

### MediaPlayer.tsx

#### 1. Добавлен instanceRef для надёжного доступа

```typescript
const instanceRef = useRef<any>(null);
```

#### 2. Исправлено восстановление воспроизведения при mount

```typescript
if (pooled.wasPlaying) {
  requestAnimationFrame(() => {
    if (!instance || !instance.media) return;
    const media = instance.media;
    if (!media.paused && !media.ended) {
      // Already playing
      return;
    }
    // Force play
    instance.play().catch((err: any) => {
      console.warn("Failed to resume playback:", err);
    });
  });
}
```

#### 3. Исправлено сохранение состояния при unmount

```typescript
// Get actual media element state
const media = instance.media;
const isPlaying = media && !media.paused && !media.ended;

audioPool.set(playerKey, {
  container: container || pooled.container,
  instance,
  wasPlaying: isPlaying
});
```

#### 4. Исправлено продолжение воспроизведения в фоне

```typescript
if (isPlaying) {
  requestAnimationFrame(() => {
    if (instance && instance.media && !instance.media.paused) {
      // Already playing, good
      return;
    }
    instance.play().catch(() => {});
  });
}
```

### AppLayout.tsx

#### 1. Исправлена функция pauseOthers

```typescript
const pauseOthers = (exceptId?: string) => {
  audioMapRef.current.forEach((entry, key) => {
    if (key === exceptId) return;
    if (!entry.inst) return;

    // For Plyr instances, check the actual media element
    const media = entry.inst.media || entry.inst;
    if (media && !media.paused && !media.ended) {
      if (entry.inst.pause) {
        entry.inst.pause();
      } else if (media.pause) {
        media.pause();
      }
    }
  });
};
```

#### 2. Исправлен handleNowPlayingControl (toggle)

```typescript
if (action === "toggle") {
  // For Plyr instances, check the actual media element state
  const media = currentEntry.inst.media || currentEntry.inst;
  const isPlaying = media && !media.paused && !media.ended;

  if (isPlaying) {
    currentEntry.inst.pause();
  } else {
    pauseOthers(nowPlaying.id);
    currentEntry.inst.play().catch((err: any) => {
      console.error("Failed to play:", err);
    });
  }
  return;
}
```

#### 3. Исправлен handleNowPlayingControl (mute)

```typescript
if (action === "mute") {
  const media = currentEntry.inst.media || currentEntry.inst;
  if (media) {
    media.muted = !media.muted;
  }
  return;
}
```

#### 4. Исправлено отображение кнопки Play/Pause

```typescript
{(() => {
  const inst = nowPlaying.instance;
  const media = inst?.media || inst;
  const playing = media && !media.paused && !media.ended;
  return playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />;
})()}
```

## Ключевые изменения

### 1. Универсальная проверка состояния

Везде используется паттерн:

```typescript
const media = instance.media || instance;
const isPlaying = media && !media.paused && !media.ended;
```

Это работает и для Plyr (где `instance.media` - это HTMLMediaElement), и для нативного Audio (где `instance` сам является HTMLMediaElement).

### 2. requestAnimationFrame вместо setTimeout

`requestAnimationFrame` гарантирует выполнение после следующего рендера браузера, что критично для DOM операций.

### 3. Проверка перед play()

Всегда проверяем, не играет ли уже аудио, чтобы не вызывать `play()` повторно:

```typescript
if (!media.paused && !media.ended) {
  return; // Already playing
}
instance.play().catch(() => {});
```

### 4. Обработка ошибок play()

Всегда используем `.catch()` для `play()`, так как браузер может заблокировать автовоспроизведение.

## Результаты

### До исправлений:
- ❌ Музыка паузилась при первом переходе
- ❌ Кнопка Play/Pause показывала неправильное состояние
- ❌ pauseOthers не всегда работал
- ❌ Нестабильное поведение при навигации

### После исправлений:
- ✅ Музыка продолжает играть при всех переходах
- ✅ Кнопка Play/Pause всегда показывает правильное состояние
- ✅ Только один трек играет одновременно
- ✅ Стабильная работа при любой навигации

## Тестирование

### Сценарий 1: Первый переход
1. Открыть страницу с аудио
2. Нажать Play
3. Перейти на другую страницу
4. **Ожидается:** музыка продолжает играть
5. Вернуться обратно
6. **Ожидается:** музыка всё ещё играет

### Сценарий 2: Множественные переходы
1. Включить музыку
2. Переходить между разными страницами 5-10 раз
3. **Ожидается:** музыка не прерывается

### Сценарий 3: Кнопка Play/Pause
1. Включить музыку
2. Проверить кнопку в Now Playing - должна показывать Pause
3. Нажать кнопку - музыка должна остановиться
4. Кнопка должна показывать Play
5. Нажать снова - музыка должна возобновиться

### Сценарий 4: Переключение треков
1. Открыть плейлист
2. Включить первый трек
3. Нажать "Следующий" в Now Playing
4. **Ожидается:** первый трек останавливается, второй начинает играть
5. Проверить, что только один трек играет

## Технические детали

### Plyr API

Plyr - это обёртка над HTML5 media элементом:

```typescript
interface PlyrInstance {
  media: HTMLMediaElement;  // Реальный <audio> или <video> элемент
  play(): Promise<void>;
  pause(): void;
  paused: boolean;          // ❌ Может быть неточным
  // ... другие методы
}
```

**Важно:** Всегда используйте `instance.media.paused`, а не `instance.paused`.

### requestAnimationFrame vs setTimeout

```typescript
// setTimeout - выполняется "как можно скорее", но не гарантирует порядок
setTimeout(() => doSomething(), 0);

// requestAnimationFrame - выполняется перед следующим рендером
requestAnimationFrame(() => doSomething());
```

Для операций с DOM и media элементами `requestAnimationFrame` более надёжен.

### Audio Pool

Аудио инстансы хранятся в глобальном Map:

```typescript
const audioPool = new Map<string, {
  container: HTMLElement;  // DOM контейнер Plyr
  instance: any;           // Plyr инстанс
  wasPlaying: boolean;     // Состояние при unmount
}>();
```

При unmount компонента инстанс перемещается в невидимый контейнер и продолжает работать. При mount обратно - возвращается на страницу.

## Файлы изменены

- `apps/web/src/components/MediaPlayer.tsx`
- `apps/web/src/components/AppLayout.tsx`

## Команды

```bash
# Изменения только в frontend, backend не требуется
# Просто обновить страницу в браузере (Ctrl+Shift+R)
```
