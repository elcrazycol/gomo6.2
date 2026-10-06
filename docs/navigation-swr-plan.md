# План: stale-while-revalidate навигация (SWR-навигация)

Статус: **готово** — фазы 1–5 ✅.
Issue: GitHub `elcrazycol/gomo6.2#500` · Linear `RUS-8`.

Цель: сделать переходы между страницами «мгновенными и честными» — данные
грузятся **до** отрисовки целевого маршрута, прежнее представление остаётся на
экране, пока новое не готово, а префетч запускается при наведении. Всё — через
один общий компонент навигации, чтобы страницы грузились одинаково.

## Что уже есть (важно — не начинаем с нуля)

Проект уже прошёл ~80 % пути вручную. Опорные точки:

| Механизм | Файл | Что делает |
|---|---|---|
| `registerRoutePreloader` / `preloadRoute` | `src/lib/routePreload.ts` | Реестр прелоадеров маршрута; `App.tsx` держит прежний экран (`displayLocation`) и свапает после резолва. **Зарегистрирован только профиль.** |
| `profilePreload` | `src/pages/profile/profilePreload.ts` | Греет тот же `getCached`-ключ, что читает страница. |
| `usePendingView` | `src/hooks/usePendingView.ts` | Retention **внутри** `Index` (feed↔раздел↔mine…), `onReady`/`readyFor`. |
| `getCached` | `src/integrations/api/queryCache.ts` | URL-keyed TTL-кэш всех `api.from().select()` GET-ов, in-flight dedupe, инвалидация писами. |
| TanStack Query | `src/hooks/queries/*` | 23 `useQuery` (threads/posts/profiles/…). staleTime 5 мин, `refetchOnMount:false`, `refetchOnWindowFocus:false`. |
| `PrefetchLink` | `src/components/PrefetchLink.tsx` | Префетчит **только чанк** компонента по `onMouseEnter`, без данных. |
| `runTransition` + стили | `src/lib/viewTransitions.ts` | fade / rise / slide / view-transition / none. |
| `useLoadingBarStore` + `TopLoadingBar` | `src/stores`, `src/components/TopLoadingBar.tsx` | Тонкая полоса прогресса в шапке. |

Чего не хватает для issue: (1) данные греются только у профиля; (2) префетч по
наведению не тянет данные; (3) `Board`/`Thread`/`Profile` показывают полноэкранный
`PentagramLoader`; (4) кэшей **четыре** (URL-кэш, TanStack, контексты, модульные
Map-ы) — нет единой SWR-семантики.

## Зафиксированные решения

| # | Вопрос | Решение |
|---|--------|---------|
| A1 | data router сразу? | **Нет.** Сначала реестр-«загрузчики» на текущем `BrowserRouter`; `createBrowserRouter` — опциональная фаза 6 (см. ниже). |
| A2 | Единый движок SWR | **TanStack Query** — канон. `getCached` остаётся низкоуровневым dedupe/кэшем и получает SWR-режим. |
| A3 | Где живёт загрузчик | Не в компоненте и не в RR — в `src/routes/data/*` как пара `key()+fetch()`, общая для страницы и прелоадера. |
| A4 | Общий компонент | `NavigationLink` — единственная точка «ссылка + префетч данных + префетч чанка + переход». |
| A5 | Retention | Два уровня: маршрутный (реестр + `App.tsx`, как сейчас) и внутристраничный (`usePendingView`, как в `Index`). |
| A6 | Стили переходов | Сохраняем `runTransition` без изменений. |
| A7 | Полноэкранные лоадеры | Убираем: страница, для которой всё прогрето, рисует себя из кэша сразу. Cold deep-link — только тогда лоадер. |
| A8 | Гонки | Дублируемость запросов закрыта in-flight dedupe (`getCached`) + `ensureQueryData` (TanStack) + прелоадер не запускает второй раз. |

## Целевая архитектура

### 1. Реестр данных маршрута — `src/lib/routeData.ts`

Заменяет `routePreload.ts` (тот остаётся тонким реэкспортом для совместимости).

```ts
interface RouteDataEntry {
  id: string;
  match: string | string[];        // шаблоны для matchPath() из react-router
  priority?: number;               // порядок/хвост
  warm: (ctx: { location: Location; params: Record<string,string>; signal: AbortSignal }) => Promise<void>;
}
registerRouteData(entry): void
preloadRoute(location): Promise<void>   // маршрутный retention: ждём все совпавшие
prefetchRouteData(location): void       // по наведению: fire-and-forget
```

* `matchPath({ path, end: true }, pathname)` вместо ad-hoc regex.
* Дедуп промиса на локацию, `AbortController` при superseded-навигации, таймаут.
* `begin()/end()` внутри реестра (сейчас их делает только `profilePreload` — убрать
  оттуда, чтобы полоса показывалась на **всех** маршрутах).
* Гварды: `navigator.connection.saveData` / `effectiveType` — префетч по наведению
  отключаем на медленной сети. Маршрутный — оставляем.

### 2. Адаптеры прогрева — `src/lib/routeData.ts`

Греют **ровно тот** ключ, что читает страница:

```ts
warmUrl(key, fetcher, { ttlMs })                  // getCached — как profilePreload
warmQuery(queryClient, queryKey, queryFn, opts)   // TanStack ensureQueryData/prefetchQuery
```

Ключ обязан совпадать с читающим. Если страница читает сырым `fetch` без
`getCached` — сначала переводим её чтение на `getCached`/`useCachedQuery`
(см. `Board` ниже), иначе прогрев уйдёт в никуда.

### 3. Данные маршрута — `src/routes/data/*.ts`

| Модуль | `key` / `fetch` | Читает |
|---|---|---|
| `profileData.ts` | `profile-page:${viewer}:${param}` | `Profile.tsx` (через `getCached`) |
| `boardData.ts` | `boards?slug=eq.` + `threads?board_id=eq.&limit=20` + `channels?board_id=eq.` | `Board.tsx` |
| `threadData.ts` | TanStack `['thread', param]` + `['posts', threadId, {limit,offset}]` | `Thread.tsx` (`useThread`/`usePosts`) |
| `gomosubData.ts` | список `boards?is_gomosub=true` | `GomoSubs.tsx` |
| `achievementsData.ts` | `['achievements', userId]` | `Achievements.tsx` |
| — | `/search` (запросный), `/messages`, `/settings` | не прогреваем (см. «Не делаем») |

**Предусловие для `Board.tsx`:** сейчас board/threads/channels читаются сырым
`fetch` (строки ~439/282/200) и не кэшируются URL-кэшем. Переводим их на
`getCached` с ключами из `boardData.ts` — тогда прелоадер и страница смотрят в
один слот. То же для `ThreadFeed`/`SectionThreads` (у последнего — модульный
`sectionCache` без TTL; обернуть в тот же слой или пометить как «тайловый кэш»).

### 4. Общий компонент — `src/components/NavigationLink.tsx`

Единственная точка навигации (issue: «общий компонент во всех местах»).

* Пропсы: `to`, `prefetch?: "intent" | "render" | "none"`, `prefetchRoute?: boolean`
  (чанк), остальное — как у `<Link>`.
* Intent: `mouseenter` / `focus` / `touchstart` с задержкой ~50 мс, **один раз**,
  только при `@media (hover: hover)` и без `saveData`.
* По intent: (а) `import()` чанка маршрута, (б) `prefetchRouteData(resolved)`.
* `render`-вариант: `IntersectionObserver` для ссылок в зоне видимости.
* `to` берём как есть (приложение линкует абсолютными путями) — это заодно
  сохраняет работоспособность под тестовыми моками `react-router-dom`, которые
  отдают только `Link`.
* Заменяет `PrefetchLink`; последний удаляем вместе со switch-ем.

### 5. Карта чанков — `src/lib/routeChunks.ts`

Сейчас switch «route → import» проживает в двух местах (`lazyWithRetry` в
`App.tsx` и `PrefetchLink`) и уже разошёлся. Выносим один `Record<pattern, () => import()>`,
используемый и ленивой загрузкой, и префетчем.

### 6. Retention

* Маршрутный: `App.tsx` уже держит `displayLocation` и свапает после
  `preloadRoute`. Расширяем покрытие прелоадеров — новых правок в `App.tsx` не нужно.
* Страничный: `Board`/`Thread`/`Profile` перестают отдавать полноэкранный
  `PentagramLoader` при тёплом кэше. Логика: нет данных в кэше **и** нет ответа —
  лоадер; иначе рисуем кэш, остаток догружается под полосой прогресса.
* Внутри `Index` поведение не трогаем — `usePendingView` уже корректен.

### 7. SWR-политика

* **TanStack** — свежесть (`staleTime`) на запрос, фоновый рефетч при устаревании;
  кэш отдаётся мгновенно (`initialData`/`placeholderData: keepPreviousData`).
  Убрать глобальный `refetchOnMount:false` там, где он мешает ревалидации —
  вместо этого `staleTime` + фоновый refetch. Публичные «справочники» (sections,
  boards, emoji) оставляем долгоживущими.
* **`getCached`** — SWR-режим: `ttlMs` = окно свежести, `staleTtlMs` = доп.
  удержание (`expiresAt = ttlMs + staleTtlMs`); между ними старое значение
  отдаётся сразу + фоновая ревалидация, `subscribe(key, cb)` уведомляет о
  свежих данных, хук `useCachedQuery(key, fetcher, { ttlMs, staleTtlMs })`
  обновляет компонент на месте.
* Критерий: после окна свежести возврат на маршрут показывает старый контент
  мгновенно + фоновое обновление под полосой; скелетона нет.

## Фазы

### Фаза 1 — Реестр + данные маршрутов ✅
* `lib/routeData.ts` — реестр (`matchPath`, дедуп in-flight, superseded-token,
  `shouldPrefetch` по Save-Data/2g) + адаптеры `warmCached`/`warmQuery`;
  `lib/routeChunks.ts` — единая карта «маршрут → чанк».
* `routes/data/*`: `profileData`, `boardData`, `threadData`, `achievementsData`,
  `gomosubData`; `routes/data/index.ts` регистрирует всё разом.
* `routePreload.ts` и `pages/profile/profilePreload.ts` удалены; `App.tsx`
  импортирует `@/routes/data`, синглтон `QueryClient` вынесен в
  `integrations/api/queryClient.ts`.
* `queryCache`: добавлен синхронный `peekCached` — страницы рисуют тёплые данные
  в первом рендере (`Board` инициализирует строку борда из кэша).
* `PrefetchLink` больше не дублирует switch чанков — берёт `routeChunks`.
* **Отклонения от исходного плана:**
  * `Board.tsx` переведён на `getCached` **только для строки борда и списка
    каналов**. Список тредов g-саба кэшировать URL-ключом нельзя: запрос несёт
    `Authorization`, ключ не учитывает зрителя, и в одном браузере возможна утечка
    приватных каналов после смены аккаунта. Оставляем на потом — нужен
    auth-scoped ключ.
  * Полноэкранные лоадеры пока остаются: у `Board` ворота `checkingRules`, у
    `Achievements`/`GomoSubs` — локальный `loading`. Их снятие — фаза 4 (кэш уже
    тёплый, осталось убрать гейты).
* **Готово, когда:** deep-link на `/g/<slug>`, `/g/<slug>/c/<ch>`, `/thread/<id>`,
  `/profile/<id>`, `/achievements/<id>`, `/gomosubs` прогревает те же ключи, что
  читают страницы; `preloadRoute` показывает полосу; данные не дублируются при
  «наведение → клик». ✅ (проверено тестами + сборкой)

### Фаза 2 — SWR-политика данных ✅
* `queryCache`: `ttlMs` (свежесть) + `staleTtlMs` (удержание), фоновая
  ревалидация на stale-хите, `subscribe(key, cb)`; `invalidateByPrefix` и
  `clearQueryCache` уведомляют подписчиков; неудачная ревалидация сохраняет
  старое значение и не всплывает.
* `hooks/useCachedQuery.ts` — SWR-чтение через `getCached` (`data`/`error`,
  `enabled`), обновляется на месте после ревалидации.
* Явные stale-окна у маршрутных данных: profile (1м/5м), board (5м/30м),
  achievements (профиль 1м/5м, строки 30с/5м, каталог 5м/60м), gomosubs (5м/30м).
* `GomoSubs` переведён на `useCachedQuery` — первый реальный потребитель;
  `gomosubData` получил явный ключ и raw-fetch (чтобы `peek`/`subscribe` имели
  стабильный ключ).
* TanStack: `refetchOnMount: true` в синглтоне (stale-запрос на монтировании
  показывает кэш и ревалидирует в фоне); `placeholderData: keepPreviousData` для
  пагинируемых `usePosts`/`useThreads`.
* **Отклонение от плана:** глобальный SWR-grace в `query-builder.ts` **не
  включал**. Иначе `api.from`-кэш под `usePosts`/`useThreads` начал бы отдавать
  подстаревшие строки собственному TanStack-фетчу, откладывая свежесть до ~65с.
  SWR включается точечно — у навигационно-критичных ключей.
* **Готово, когда:** stale-хит отдаёт старое значение синхронно и обновляет
  кэш/подписчиков в фоне; двойных запросов нет (in-flight dedupe). ✅

### Фаза 3 — Intent-prefetch + `NavigationLink` ✅
* `components/NavigationLink.tsx` — `<Link>` + прогрев чанка и данных по intent
  (hover с задержкой 50 мс, focus/touch — сразу), `prefetchOnViewport`
  (IntersectionObserver), гвард `shouldPrefetch` (Save-Data/2G), проп
  `prefetchData` + legacy-alias `prefetchRoute`.
* `components/PrefetchLink.tsx` стал реэкспортом `NavigationLink` — старые
  вызовы и их тестовые моки продолжают работать.
* Переведены на `NavigationLink`: `AppLayout` (лого, `/settings`, быстрые
  результаты поиска), `MobileMenu`, `Index` и `GomoSubs` (через `PrefetchLink`),
  `MrRandom`, `ModerationNavCard`, `SearchResults`, `Board` (каналы, треды,
  настройки), `Thread`, `GomoThreadCard`, `Footer`.
* `prefetchRoutes()` удалён из `App.tsx` (его заменил intent-prefetch).
* **Отложено** (не критично для навигации): `ThreadCard`/`CompactThreadList`/
  `FeedThreadCard`, ссылки мессенджера, уведомлений, `UserBadge`/`MentionLink`,
  комментарии стены, `ProfileTabs`, `EmojiPackCard`. Их можно перевести позже тем
  же импортом.
* **Готово, когда:** наведение тянет данные и чанк; клик рисует из кэша; на
  `saveData` префетча нет. ✅ (8 unit-тестов `NavigationLink`)

### Фаза 4 — Retention по всем маршрутам ✅
* `Board`: полноэкранный гейт теперь только `!board` (не `checkingRules`) —
  тёплый борд рисуется сразу, проверка правил доезжает за модальным диалогом.
  Cold deep-link по-прежнему показывает лоадер.
* `App.tsx` ждёт перед свапом **и данные, и чанк**
  (`Promise.all([preloadRoute, loadRouteChunk])`) — убран Suspense-флеш
  полноэкранного `LazyPage`-лоадера при переходах.
* `Thread`/`Profile`: эффективного полноэкранного гейта нет — тёплые данные из
  прелоадера дают первый кадр без лоадера (cold deep-link остаётся с лоадером).
* `GomoSubs` уже без лоадера с фазы 2 (`useCachedQuery` синхронно отдаёт warm
  данные). `onReady` оставлен только для внутристраничных видов `Index`.
* **Отложено:** `Achievements` всё ещё гейтит `if (loading)` — для полного
  устранения нужен синхронный `peek`+merge в инициализаторе (не входит в
  критерий приёмки фазы).
* **Готово, когда:** feed → раздел → board → thread не мигает полноэкранным
  лоадером; прежний экран держится до первого кадра нового. ✅ (тест
  «keeps a warm board on screen while the rules check is still in flight»)

### Фаза 5 — Чистка, тесты, наблюдаемость ✅
* Таймаут загрузчика (`LOADER_TIMEOUT_MS = 8s`, raced через `withTimeout`):
  зависший прелоадер не пинит прежний экран навсегда — поздний ответ всё равно
  ляжет в кэш. Superseded-навигация останавливается между загрузчиками.
* Dev-наблюдаемость: `console.debug` (deduped, только DEV и не в тестах) при
  навигации без прелоадера (`[route-data] …`) и при hover по пути без чанка
  (`[route-chunks] …`) — ловит дрейф таблиц.
* Чистка: убран неиспользуемый адаптер `warmCached`, мёртвый `signal` из
  `RouteDataContext` (никто его не использовал), поправлены комментарии
  (`routeChunks` — таблица префетча, `App.tsx` держит свои lazy-импорты).
* Тесты: `routeData` (match, params, dedupe, retry после ошибки, Save-Data/2g,
  `hasRouteData`, supersede, таймаут), `NavigationLink` (intent-задержка, отмена,
  focus, split `?`, Save-Data, `prefetchData={false}`, legacy-alias, «греет один
  раз», viewport), SWR в `queryCache` (stale-serve + ревалидация, подписчики,
  hard-expiry, ошибка ревалидации), `useCachedQuery` (cold/warm/refetch),
  retention `Board`. `usePendingView` не трогали.
* **Готово, когда:** `tsc` чисто, eslint без новых ошибок, весь `vitest` зелёный.
  ✅ **248 файлов / 2558 тестов**, `vite build` успешен.

## Итог

Целевые outcomes issue #500 закрыты: данные грузятся до рендера (реестр
прелоадеров), прежний экран держится до первого кадра нового, префетч запускается
при наведении (`NavigationLink`), всё — через один общий компонент. Опциональная
фаза 6 (`createBrowserRouter`) не делалась: выгоды поверх достигнутого нет, а
цена — переписать движок переходов и оба `backgroundLocation`-`Routes`.

### Фаза 6 (опционально) — `createBrowserRouter` ⬜
Только если после 1–5 захотим примитивы RR (`useNavigation`, `prefetch="intent"`,
`shouldRevalidate`, `defer`/`Await`). Отображение 1:1:

| Сейчас | Станет |
|---|---|
| `registerRouteData().warm` | тело `loader` (`route.lazy`) |
| `displayLocation` в `App.tsx` | нативный «держать старый экран при loader» |
| `runTransition` | `viewTransition` + enter-класс на монтировании; `slide` — CSS VT |
| `preloadRoute` | `Link prefetch="intent"` |
| `lazyWithRetry` | обёртка над `route.lazy` |

**Цена/риск:** переписать движок переходов, оба `backgroundLocation`-`Routes`,
много тестов. **Делать, только если** реестр начнёт дублировать `useNavigation`/
`shouldRevalidate` или понадобятся `defer`/`Await`. Иначе выгоды мало — retention
и префетч уже дают целевой UX.

## Не делаем (явные non-goals)

* Не переносим **мутации** и realtime (WS-инвалидация) в загрузчики — это остаётся
  в компонентах/хуках.
* Не прогреваем пагинацию (вторая страница, `loadMore`) и поиск по запросу —
  только первый экран.
* Не трогаем темизацию, PWA/SW-перезагрузку, `backgroundLocation`-оверлей
  (в фазе 6 — да, но не раньше).
* Не вводим новую библиотеку: TanStack уже стоит.

## Риски

| Риск | Смягчение |
|---|---|
| Кэш-ключ прелоадера ≠ ключ страницы → прогрев впустую | Пара `key+fetch` живёт в одном модуле; тест «после `preloadRoute` страница читает кэш». |
| Четыре кэша дают рассинхрон | Фаза 2: TanStack — канон, `getCached` — dedupe+SWR; ключи не дублируются. |
| Префетч по наведению душит бэкенд | Дедуп + TTL + `saveData`/`effectiveType` + intent-задержка + существующие rate-limit бюджеты. |
| Полноэкранный лоадер убрали раньше прогрева → пустой кадр | Гейт `App.tsx` свапает только после `preloadRoute`; cold deep-link оставляет лоадер. |
| Регресс переходов | `runTransition`/`usePendingView` не трогаем до фазы 6. |

## Метрики успеха

* Ноль полноэкранных лоадеров на прогретых маршрутах (по тесту и вручную).
* Клик по ссылке, на которую наводились: контент в первом кадре (data warm hit).
* Ноль дублирующих GET-ов при наведении+клике (in-flight dedupe).
* `vitest` зелёный, `tsc`/eslint чисто.
