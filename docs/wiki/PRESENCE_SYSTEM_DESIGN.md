# Дизайн-док: Redis-центричная система онлайна (presence)

> Статус: **реализовано (фаза 1: бэкенд + фронт — профили / мессенджер / друзья)**
> Версия: 1.0 (2026-08-12)
> Выбранный вариант: **B** (Redis как источник правды, фаза 1 — профили / мессенджер / друзья)
> Параметры: TTL онлайн-маркера **60 сек**, sweeper каждые **15 сек**

## 1. Цели

1. **Мгновенный статус «в сети» (< 1 сек)** на странице профиля: открыл профиль → пришёл снапшот статуса → дальше только живые дельты по WebSocket.
2. **Правдивый оффлайн**: детект «тихого» пропадания сети за ≤ 60 сек, без зависимости от `pongWait` (сейчас до 60 сек + дебаунс).
3. **Приватность**: никакой глобальной рассылки presence всей платформы. Статус получают только друзья и те, кто открыл профиль (подписная модель через румы).
4. **Отсутствие БД-нагрузки** от presence-событий: подключение/отключение не пишут в `users` напрямую.
5. **last_seen = активность** (как в Telegram/VK): обновляется при любом действии пользователя, а не только при connect/disconnect.
6. **Исправить известные баги**: мульти-вкладочный оффлайн, два писателя флага, 60-секундный stale-статус через REST.

**Вне объёма (фаза 2, отдельно):** аватарки в ленте/комментариях, анонимный WS-канал, единый presence-стор на фронте.

## 2. Текущее состояние и проблемы

Схема сейчас:

```
WS connect+auth ──► Hub.presence[userID] ──► UPDATE users SET is_online=true (дебаунс 500мс)
                  └──► broadcastUserStatus() ──► Redis realtime:status ──► ВСЕМ клиентам (глобально!)

WS disconnect   ──► UPDATE users SET is_online=false  ← БАГ: не проверяются другие коннекты
                  └──► user_offline ВСЕМ клиентам (глобально!)

REST: GET /users/:id/status и bulk ── читают users.is_online (БД)
Фронт: useOnlineStatus() PUT /profiles (свой статус) + useRealtimeStatus() слушает глобальные события
```

### Проблемы (подтверждены кодом)

| # | Проблема | Файл |
|---|----------|------|
| 1 | **Мульти-вкладочный баг**: закрытие одной вкладки ставит `is_online=false` в БД, даже если у пользователя есть живые коннекты других вкладок/устройств. `removeClientLocked` проверяет только **ту же сессию**, а не пользователя целиком | `websocket/hub.go`, case `unregister` |
| 2 | **Утечка приватности**: каждое `user_online`/`user_offline` (user_id + username) рассылается **всем** подключённым клиентам. Отмечено в `docs/SECURITY_AUDIT_2026.md` | `hub.go` `broadcastUserStatus` → `handleRedisEvent` |
| 3 | **Оффлайн до 60 сек** при тихом обрыве сети (`pongWait = 60s`) + дебаунс | `websocket/client.go` |
| 4 | **Нет снапшота при подписке**: статус при открытии страницы приходит из REST-опроса (stale до 60 сек), а не мгновенно | фронт |
| 5 | **Анонимы без WS**: реального времени нет вообще, только опрос раз в минуту | `websocket.ts` `connect()` |
| 6 | **Два писателя флага**: REST-PUT из `useOnlineStatus` и WS-hub конкурируют за `is_online` | фронт + бэк |

## 3. Архитектура (целевая)

### 3.1 Источник правды

**Redis** — единственный источник правды для онлайна. БД `users.is_online` / `last_seen_at` становится **производной** (кэшем для REST-эндпоинтов и анонимных читателей), обновляется фоном.

### 3.2 Redis-схема

| Ключ | Тип | Назначение | TTL |
|------|-----|------------|-----|
| `presence:online` | **Sorted Set**, member = `userID`, score = Unix-время последнего heartbeat/активности | Глобальный индекс онлайн-пользователей | — (члены удаляет sweeper) |
| `ws:online:{userID}:{sessionID}` | string `"1"` | Пер-сессионный маркер для «Devices & sessions» (уже есть) | 5 мин, обновляется при ping |
| `presence:last_seen:{userID}` | string (RFC3339) | Кэш last_seen для мгновенных ответов | 24 ч |

Правила:
- **Онлайн** = `userID` присутствует в `presence:online` **и** `now - score <= 60s`.
- **Heartbeat**: WS-подключение, каждый app-level ping (30 сек), каждая авторизованная активность (middleware).
- **Мульти-устройства**: Sorted Set хранит userID, а не сессии, поэтому любое живое устройство держит пользователя онлайн. Сессии остаются отдельно в `ws:online:*` для списка устройств.

### 3.3 Потоки событий

**Вход в онлайн (мгновенно, < 1 сек):**

```
WS connect + auth
  └─► Hub.register / handleAuth
       ├─► ZADD presence:online {userID: now}
       ├─► h.broadcastUserStatus(userID, username, true)
       │     └─► Redis realtime:status ──► handleRedisEvent
       │           └─► BroadcastToRoom("presence_"+userID)  ← только подписчики рума
       └─► (фоном, debounce) UPDATE users SET is_online=true
```

**Выход из онлайна (два пути):**

```
A) Явное закрытие (close frame / таб закрыт):
   WS disconnect ──► Hub.unregister
     ├─► Проверка: есть ли ДРУГИЕ живые коннекты userID? ── если есть, НИЧЕГО не делаем (фикс бага #1)
     └─► нет коннектов:
           ├─► ZREM presence:online {userID}
           ├─► broadcastUserStatus(..., false) ──► рум presence_<userID>
           └─► markSessionOffline (пер-сессионный ключ)

B) Тихий обрыв сети (нет close frame):
   sweeper каждые 15 сек:
     ├─► ZRANGEBYSCORE presence:online -inf (now-60s) → истёкшие userID
     ├─► для каждого: ZREM + broadcastUserStatus(..., false) + UPDATE users SET is_online=false
     └─► батч-запись в БД (один запрос на всех истёкших)
```

**Подписка на статус пользователя (открытие профиля/чата):**

```
Клиент: wsService.subscribe("presence_<userID>")
  └─► Сервер: canAccessRoom("presence_<userID>") → true
       ├─► SubscribeToRoom
       └─► СНАПШОТ: отправляем {type:"presence_snapshot",
               data:{user_id, is_online, last_seen}} ← из Redis, без БД
Дальше: только дельты user_online / user_offline в этот рум.
```

**Активность (last_seen):**

```
Любой авторизованный REST-запрос
  └─► PresenceActivityMiddleware
       ├─► троттлинг: не чаще 1 раза в 5 мин на userID (in-memory map + mutex, сброс по TTL)
       └─► ZADD presence:online {userID: now} + SET presence:last_seen:{userID}
```

### 3.4 Модель авторизации румов

| Рум | Кто может подписаться |
|-----|----------------------|
| `presence_<userID>` | Владелец; друзья; **любой** для публичного профиля (правило «кто открыл профиль»); для `private_profile=true` — только владелец и друзья |

Правило повторяет существующий `canViewWallRoom` / `canViewNowPlayingRoom` (проверка `privacy_settings.private_profile` + `friendships`). Единая функция-хелпер, чтобы семантика не разъезжалась.

**Приватность `show_online_status`**: применяется на уровне отдачи статуса (в снапшоте и в `GET /users/:id/status`), не на уровне подписки — событие доставки в рум не зависит от настроек таргета. Скрытие статуса = вернуть `is_online: false` + пустой `last_seen` (как сейчас в `user_status.go`).

### 3.5 Синхронизация БД

- `is_online=true` — пишется на connect (дебаунс 500 мс уже есть, оставляем) и при активности не пишется (только Redis).
- `is_online=false` — пишется sweeper'ом батчем + при явном отключении последнего коннекта.
- `last_seen_at` — обновляется: на connect, на явном offline, и sweeper'ом для активных (если изменилось более чем на N минут).

Требование: **REST-эндпоинты не должны ждать sweeper**. `GET /users/:id/status` и bulk читают **сначала Redis** (быстро), при промахе — БД.

## 4. Сигнатуры (Go, `internal/websocket/hub.go`)

```go
// ── Redis presence store ──────────────────────────────────────────────

// markPresenceOnline добавляет userID в presence:online с текущим score.
func (h *Hub) markPresenceOnline(userID string)

// touchPresence обновляет score (heartbeat/активность). no-op при пустом Redis.
func (h *Hub) touchPresence(userID string)

// clearPresenceOnline убирает userID из presence:online.
func (h *Hub) clearPresenceOnline(userID string)

// presenceOnlineSince возвращает (online bool, lastSeen time.Time).
// online = член в presence:online и now-score <= PresenceTTL.
func (h *Hub) presenceOnlineSince(userID string) (bool, time.Time)

// ── Sweeper ───────────────────────────────────────────────────────────

// runPresenceSweeper запускает горутину: раз в SweepInterval находит
// истёкшие userID (score < now-PresenceTTL), шлёт user_offline по румам
// и пишет is_online=false в БД батчем. Останавливается по ctx.
func (h *Hub) runPresenceSweeper(ctx context.Context)

// expirePresenceUsers возвращает userID, чей score устарел.
func (h *Hub) expirePresenceUsers(now time.Time, ttl time.Duration) []string

// flushOfflineToDB пишет батч-обновление is_online=false для userID.
func (h *Hub) flushOfflineToDB(userIDs []string)

// ── Жизненный цикл (правки существующего) ────────────────────────────

// updateUserOnlineStatus: на connect теперь также markPresenceOnline.
// На unregister: СНАЧАЛА h.hasLiveConnections(userID) — если true, offline НЕ пишем.
func (h *Hub) hasLiveConnections(userID string) bool

// broadcastUserStatus: вместо глобального h.broadcast — только
// BroadcastToRoom("presence_"+userID). Приватные профили — рум всё равно
// создаётся, но доступ к нему закрыт canAccessRoom.
func (h *Hub) broadcastUserStatus(userID, username string, online bool)

// ── Рум-подписка со снапшотом ────────────────────────────────────────

// canAccessRoom: добавить case strings.HasPrefix(room, "presence_")
// (тот же предикат, что canViewWallRoom).

// sendPresenceSnapshot отправляет клиенту {type:"presence_snapshot",
// data:{user_id, is_online, last_seen}} — вызывается после успешной
// подписки на presence_<userID>.
func (h *Hub) sendPresenceSnapshot(client *Client, userID string)

// константы
const (
    PresenceTTL        = 60 * time.Second // онлайн-маркер
    PresenceSweepEvery = 15 * time.Second // интервал sweeper
    PresenceTouchEvery = 5 * time.Minute  // троттлинг активности
)
```

### Middleware (новый файл `internal/middleware/presence.go`)

```go
// PresenceActivity обновляет Redis-маркер активности для авторизованных
// запросов (троттлинг: не чаще 1 раза в 5 мин на userID).
// Работает по claims из контекста (после AuthMiddleware).
func PresenceActivity(redis *redis.Client) gin.HandlerFunc
```

### `internal/api/handlers/user_status.go` (правки)

```go
// GetUserStatus: читает h.hub.presenceOnlineSince(userID) ПЕРВЫМ,
// при промахе — существующий SQL. Сохраняет privacy-фильтры.
// GetBulkUserStatus: тот же Redis-first путь, батч-чтение.
```

## 5. Сигнатуры (TypeScript)

### `apps/web/src/services/websocket.ts`

```ts
// Новые типы сообщений
type WebSocketMessageType = ... | 'presence_snapshot' | 'presence_subscribed';

// Новые методы
subscribeToPresence(userId: string): void;   // subscribe(`presence_${userId}`)
unsubscribeFromPresence(userId: string): void;
```

### `apps/web/src/hooks/useRealtimeStatus.ts` (переработка)

```ts
// Заменяет useUserRealtimeStatus (глобальный слушатель) на подписную модель:
export function usePresenceStatus(userId: string | undefined): {
  is_online: boolean | null;   // null = ещё нет данных (грузим снапшот)
  last_seen?: string;
}
// Поведение:
//  - при userId: подписка на presence_<userId> + слушаем user_online /
//    user_offline / presence_snapshot только для этого userId
//  - снапшот приходит сразу после подписки — статус мгновенный
//  - очистка подписки при unmount / смене userId
```

### `apps/web/src/pages/Profile.tsx`

```tsx
// Замена текущей логики (REST-статус + глобальные события):
const { is_online, last_seen } = usePresenceStatus(profileOwnerId);
// + useUserStatus (REST) остаётся как начальный фолбэк до снапшота
```

### `apps/web/src/services/messengerWebSocket.ts`

```ts
// При открытии диалога: подписка на presence_<other_user_id> для
// каждого участника; offline-детект участников в чате.
// messengerStore.onlineUsers продолжает работать, но наполняется из
// румов, а не из глобального фида.
```

### `apps/web/src/components/FriendsList.tsx` + `useUserStatus.ts`

```ts
// Список друзей: bulk-снапшот через POST /users/status/bulk (Redis-first,
// теперь быстрый) + подписка на presence_<friend_id> для видимых друзей.
```

## 6. Изменения API

| Эндпоинт | Изменение |
|----------|-----------|
| `GET /users/:id/status` | Redis-first (мгновенно), фолбэк на БД. Формат ответа не меняется |
| `POST /users/status/bulk` | Redis-first. Формат не меняется |
| `GET /users/online` | Без изменений (уже читает из hub) |
| WS | Новый рум `presence_<userID>` + событие `presence_snapshot` |

Обратная совместимость: старые клиенты (если есть) продолжают получать `user_online`/`user_offline` только если подписаны на рум. Глобальной рассылки больше нет — это ломающее изменение для кода, который полагался на глобальные события (весь фронт переводится на подписки в рамках этой же задачи).

## 7. Приватность (сводная таблица)

| Ситуация | Что видит зритель |
|----------|-------------------|
| Публичный профиль, любой зритель | `is_online` + `last_seen` (если `show_online_status=true`) |
| `private_profile=true`, не друг | Подписка на рум запрещена; REST возвращает `is_online:false`, пустой `last_seen` |
| `show_online_status=false` | Везде `is_online:false` + пустой `last_seen` (и в снапшоте, и в REST) |
| Свой профиль | Всегда полная информация |
| Глобальный фид presence | **Удалён полностью** — событий на всех больше нет |

## 8. План внедрения (шаги)

**Бэкенд:**
1. `hub.go`: константы, `markPresenceOnline`/`touchPresence`/`clearPresenceOnline`/`presenceOnlineSince`
2. `hub.go`: `runPresenceSweeper` + `expirePresenceUsers` + `flushOfflineToDB`; запуск в `Run()`
3. `hub.go`: `hasLiveConnections` — фикс мульти-вкладочного бага в case `unregister`
4. `hub.go`: `broadcastUserStatus` → таргетинг на рум `presence_<userID>`; убрать глобальный broadcast в `handleRedisEvent`
5. `hub.go`: `canAccessRoom` + `sendPresenceSnapshot`; `client.go`: вызов снапшота после успешной подписки на presence-рум
6. `middleware/presence.go`: `PresenceActivity` + регистрация в роутере
7. `user_status.go`: Redis-first чтение статусов
8. Юнит-тесты Go (см. §10)

**Фронтенд:**
9. `websocket.ts`: `subscribeToPresence`/`unsubscribeFromPresence` + типы
10. `useRealtimeStatus.ts`: `usePresenceStatus` (подписная модель со снапшотом)
11. `Profile.tsx` на `usePresenceStatus`; `messengerWebSocket.ts` — подписки на участников диалога; `FriendsList` — bulk-снапшот + подписки
12. `useOnlineStatus.tsx`: **удалён целиком** — REST-PUT больше не нужен, сервер знает всё сам. Единственный клиентский сигнал активности — app-level WS-ping каждые 30 с (backed TouchPresence). Признание: пользователь без WS (например, за корпоративным firewall) не будет помечен онлайн — осознанный трейдофф дизайна
13. Тесты TS (vitest)

**Валидация:** `go build ./...`, `go vet`, `go test ./...` (юниты на sqlmock/miniredis), `npx tsc --noEmit -p apps/web/tsconfig.app.json`, `npm run lint --workspace=@gomo6/web`, vitest по затронутым модулям.

## 9. Риски и митигации

| Риск | Митигация |
|------|-----------|
| Redis падает → все статусы «оффлайн» | Фолбэк на БД в REST-чтении; sweeper логирует; hub уже fail-safe по Redis (nil-проверки) |
| Разрыв мульти-инстанса (два хаба, разные Redis) | Redis pub/sub уже покрывает кросс-серверную рассылку; `presence:online` общий |
| Событие `user_offline` от sweeper при живом клиенте (гонка TTL vs ping) | Ping каждые 30с «перезаряжает» score (TTL 60с) — окно гонки 30с; при повторном ping статус вернётся в онлайн и придёт `user_online` |
| Нагрузка ZADD на каждый REST-запрос | Троттлинг 5 мин на пользователя в middleware; пинг — уже 1/30с |
| Ломающее изменение глобальных событий | Вся задача переводит фронт на подписки синхронно; убрать глобальный фид только после перевода всех потребителей |

## 10. Тестирование

**Go (unit, sqlmock + miniredis):**
- `markPresenceOnline` / `presenceOnlineSince` с miniredis (TTL-границы: 59s online, 61s offline)
- Sweeper: истёкшие вычищаются, `user_offline` уходит только в рум, батч-запись в БД
- `hasLiveConnections`: true при второй живой вкладке → offline НЕ пишется (регресс-тест бага #1)
- `canAccessRoom` для `presence_<userID>`: владелец/друг/чужой/приватный профиль
- Снапшот после подписки: содержимое `presence_snapshot`, уважение `show_online_status`
- `user_status.go`: Redis-first чтение + фолбэк + privacy-фильтры

**TS (vitest):**
- `usePresenceStatus`: подписка при монтировании, отписка при unmount, снапшот → стейт
- `messengerWebSocket`: подписки на участников диалога
- `Profile`: статус из снапшота поверх REST-фолбэка
- Регресс: существующие тесты `useRealtimeStatus`, `messengerStore`, страницы (хук `useOnlineStatus` удалён вместе с тестами)

## 11. Открытые вопросы

1. **Пик статусов на профиле**: показывать ли «в сети» мгновенно, а last_seen догружать — или ждать полный снапшот? (рекомендация: показывать сразу, снапшот приходит < 100мс)
2. **Троттлинг активности 5 мин** — достаточно ли для правдивого last_seen? (можно 2 мин, если хочется живее)
3. Нужен ли флаг-переключатель (env) для отключения глобального фида на время миграции фронта?
4. `GET /users/online` (админ-лист) — оставляем как есть?

## 12. Ресурсы

- Существующая WS-архитектура: [REALTIME_WEBSOCKET_PATTERN.md](./REALTIME_WEBSOCKET_PATTERN.md)
- Безопасность мессенджера (фон по WS-авторизации): [MESSENGER_SECURITY.md](./MESSENGER_SECURITY.md)
- Уязвимость глобального фида presence: `docs/SECURITY_AUDIT_2026.md`
