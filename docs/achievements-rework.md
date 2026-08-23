# Переработка системы достижений (feat/achievements-overhaul)

Полный снос старой системы достижений и построение новой. Ветка: `feat/achievements-overhaul`.

## Принципы

1. **Каталог в Go-коде** — единый источник правды. БД-таблица `achievements` — только зеркало,
   синхронизируемое при старте (см. «Авто-синк и пересчёт»). Никаких сидов в миграциях.
2. **Мессенджер не трогаем** — личная переписка вне скоупа достижений. Движок вообще не получает
   событий из мессенджера, никакие счётчики по нему не ведутся.
3. **Единая модель контента** — без разделений «треды/стена/сабы»:
   - **Записи** = threads + profile_wall_posts (по `author_id`; запись на чужой стене идёт автору)
   - **Комментарии** = posts (внутри тредов) + profile_wall_post_comments
   - **Лайки** (полученные/поставленные) = все 4 таблицы лайков вместе
   - (совпадает с определениями миграции `091_unified_user_stats.sql`)
4. **Лёгкий клиент** — минимум запросов: каталог кэшируется, прогресс приходит одним запросом,
   обновление по WS-событию unlock + `profile-cache:invalidate`. Оптимизировано для медленного интернета.
5. **Гибрид триггеров**: события для частых действий (инкремент счётчиков), пересчёт для редких/производных.
6. **Авто-пересчёт при деплое**: при изменении определений группы её прогресс пересчитывается по данным.
7. **Расширяемые награды**: сейчас только гарма; новый тип награды = регистрация обработчика.
8. **Приватность как сейчас**: `private_hide_achievements`; секретные достижения раскрываются после открытия.

## Каталог (21 группа)

### Контент (единый)
| Группа | Тип | Уровни (порог — название — редкость — +гарма) |
|---|---|---|
| `entries` | progressive | 1 «Первое слово» common 10 · 50 «Писатель» uncommon 50 · 500 «Романист» rare 200 · 2500 «Классик» epic 1000 · 10000 «Графоман» legendary 5000 |
| `comments` | progressive | 1 «Первое мнение» common 5 · 100 «Комментатор» uncommon 50 · 1000 «Эксперт» rare 500 · 5000 «Оракул» epic 2500 |
| `likes_received` | progressive | 1 «Замеченный» common 15 · 100 «Популярный» uncommon 150 · 1000 «Звезда» rare 1000 · 10000 «Легенда» legendary 10000 |
| `likes_given` | progressive | 1 «Добрый» common 5 · 100 «Щедрый» uncommon 50 · 1000 «Меценат» rare 500 |
| `images` | progressive | 1 «Фотограф» common 10 · 100 «Галерист» uncommon 100 · 1000 «Фотохудожник» rare 1000 |
| `reposts` | one_time | 1 «Распространитель» uncommon 30 |

### Сообщества
| Группа | Тип | Уровни |
|---|---|---|
| `sub_join` | one_time common | 1 «Свой человек» 10 |
| `sub_rules` | one_time common | 1 «Законопослушный» 10 |
| `sub_create` | one_time rare | 1 «Основатель» 100 |

### Удержание
| Группа | Тип | Уровни |
|---|---|---|
| `daily_streak` | progressive (derived) | 3 «Завсегдатай» common 10 · 7 «Постоянный» uncommon 50 · 30 «Неотъемлемый» rare 300 · 100 «Неразлучный» epic 2000 · 365 «Ветеран» legendary 10000 |
| `session_time` | progressive (derived, минуты) | 60 «Задержавшийся» common 10 · 600 «Домосед» uncommon 100 · 6000 «Житель» rare 1000 · 30000 «Душа сайта» epic 5000 |

### Профиль / Интеграции / Подарки
| Группа | Тип | Уровни |
|---|---|---|
| `avatar` | one_time common | 1 «Лицо» 20 |
| `bio` | one_time common | 1 «О себе» 15 |
| `profile_style` | one_time rare | 1 «Стиль» 50 |
| `spotify` | one_time rare | 1 «Меломан» 50 |
| `gift_sent` | one_time uncommon | 1 «Щедрый даритель» 25 |
| `gift_received` | one_time uncommon | 1 «Любимчик» 25 |

### Секретные (hidden, раскрываются после открытия)
| Группа | Условие (порог) | Редкость / награда |
|---|---|---|
| `secret_owl` | 10 записей в 3:00–6:00 (порог 10) | rare / 300 |
| `secret_shower` | 12+ часов на сайте за один день (порог 720 мин) | epic / 1000 |
| `secret_lurk` | 30 дней подряд заходил, но не написал ни одной записи/комментария (порог 30) | epic / 1000 |
| `secret_allrounder` | уровень 2+ в 5 разных прогрессивных группах (порог 5) | rare / 500 |

Названия/описания — через i18n-ключи (`achievements.<group>.<level>.name` и т.д.), фронт локализует.

Семантика порогов: для counter-групп порог one_time = 1 (само действие открывает);
для derived-групп порог = реальное условие метрики (движок сравнивает `LevelFor(value)`),
поэтому валидация требует лишь положительности порога, а не равенства единице.

## Хранение (миграция `106_achievements_rework.sql`)

- Вайп: `DELETE FROM user_achievements; DELETE FROM achievements;` — чистый старт.
- Дроп легаси-колонок `achievements.reward_type`, `achievements.reward_value` (награды теперь в уровнях).
- `achievements` + `definition_hash TEXT` — хеш определения группы (детект изменений при пересчёте).
- `user_achievements` + `rule_hash TEXT` — версия правил, по которым посчитан текущий уровень.
- Новая таблица-счётчики:

```sql
CREATE TABLE user_achievement_counters (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_key  TEXT NOT NULL,
    value      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, group_key)
);
```

## Архитектура

```
Хендлеры (запись/коммент/лайк/саб/подарок/визит/профиль/интеграция)
        │  emit(Event{UserID, Type, At})
        ▼
   AchievementEngine
        ├── counter:  UPSERT user_achievement_counters (+1)
        ├── evaluate: level = max { levels[i].threshold <= value } (или derived-SQL)
        ├── upgrade:  upsert user_achievements (current_level только вверх, GREATEST)
        ├── rewards:  RewardRegistry (garma — через формулу, прочие — side-effect хуки)
        └── notify:   WS unlock + строка в notifications (+ profile-cache:invalidate)
        ▲
   Startup sync: каталог Go → achievements (upsert + definition_hash);
   группы с изменившимся хешем помечаются dirty → пересчёт
   (лениво на следующем событии/чтении пользователя, полный — по триггеру)
```

### Движок (этап 3-4)

- `Event` — {UserID, Type, At}. Типы: `entry_created`, `comment_created`, `like_given`,
  `like_received`, `image_uploaded`, `repost_created`, `sub_joined`, `rules_accepted`,
  `sub_created`, `gift_sent`, `gift_received`, `avatar_updated`, `bio_updated`,
  `profile_styled`, `integration_connected`, `daily_visit`.
- **Counter-группы** (обычные): событие → инкремент счётчика → оценка уровней.
- **Derived-группы** (стрик, время, секреты): значение вычисляется SQL по живым данным
  (`user_daily_visits`, `user_session_time`, `user_achievements`, записи с фильтром по часу).
- Атомарность: upsert с `GREATEST` — уровень только растёт; при пересчёте (правила изменились)
  уровень перезаписывается точно по правилам (может и понизиться).
- Идемпотентность: повторная обработка события не даёт двойных наград (guard по `rule_hash`).

### Награды

- **Гарма** — единственная награда сейчас. Источник правды — **формула** `RecomputeUserProfileStats`:
  формула разворачивает `achievements.levels` JSONB и суммирует `reward_value` для
  `reward_type='garma'` и `level <= current_level`. Никаких живых `UPDATE users SET garma += N`
  при открытии — это устраняет двойное начисление (баг текущей системы: `applyReward` +
  формула суммировали награды дважды) и рассинхрон.
- **Расширяемость**: `RewardRegistry` — новый тип награды (цвет ника, титул, бейдж) = регистрация
  `Rewarder`, движок не трогаем. Пока зарегистрирован только `garma` (в формуле) — registry
  используется движком для валидации и будущих side-effect наград.

### Уведомления и фронт

- **Старые уведомления об анлоке выпилены полностью**: тост `AchievementUnlockToast` + `AchievementToastListener`, WS-ветка `achievement_unlock` в `notificationStore`, строка/тип `achievement_unlock` в notifications, `Notifier` на движке (engine + `achievement_notifier.go` + роуты), поле `NotificationParams.AchievementName`. Анлок виден только на странице Achievements (инвалидация по WS) — без спама в уведомления.
- 6 пинов на профиле (лимит меняется в `ToggleAchievementPin`), страница Achievements переписывается.
- Лёгкий клиент: каталог кэшируется в queryCache, прогресс одним запросом, инвалидация по WS.
- **Минимализм в стиле сайта**: карточки `bg-card border border-border rounded-lg` без градиентов/свечений, страница без амбер-акцентов и градиентных прогресс-баров.

## Удаляемое старьё

- `POST /api/rpc/award_achievement` (сломан: пишет в несуществующую колонку `level`; плюс L1 из аудита — самовыдача)
- incel-выдачи в `Board.tsx` / `BoardRouter.tsx` (id не существует — мёртвый код)
- `username_color`-механика: `useUserColor`, `extractColor`, подхват в `ProfileCacheContext` / `IndexRouter`
- легаси-колонки `achievements.reward_type/reward_value`; `user_achievements.progress_target` (не используется)
- старый `AchievementChecker` заменяется новым движком
- старые уведомления об анлоке: тост + листенер, WS `achievement_unlock`, строка в notifications, `Notifier` (engine + `achievement_notifier.go` + роуты), `NotificationParams.AchievementName`, интерполяция `{{name}}` в notifications

## Этапы

1. ✅ Дизайн-док + каталог в Go + валидация + тесты
2. ✅ Миграция `106`: вайп, дроп легаси, счётчики, `definition_hash`/`rule_hash`, unique на `group_key`
3. ✅ Движок `internal/achievements`: события → счётчики → оценка уровней (ratchet/exact), награды, `Notifier`, `Sync`/`Recompute*`, SQL derived-групп + sqlmock-тесты
4. ✅ Интеграция событий в хендлеры + `AchievementNotifier` + `Sync`/`RecomputeDirty` при старте; старый `AchievementChecker` удалён
5. ✅ Выпил старья: RPC `award_achievement`/`award_achievement_with_level` (код + роуты + сгенерённые доки), incel-вызовы в `Board`/`BoardRouter`, `username_color` целиком (`useUserColor`, `ProfileCacheContext`, `IndexRouter`, `UserBadge`/`MentionLink`/`ProcessedContent`/`ProfileHoverCard`/`HeaderUsername`), клиентская выдача в `LikeButton`, ветка `username_color` в `AchievementCard`
6. ✅ Фронт: страница Achievements (новые категории, i18n, queryCache-клиент), AchievementCard (i18n-ключи name_key/description_key/title), 6 пинов (бэкенд + профиль)
7. ✅ Выпил старых уведомлений об анлоке (тост, WS `achievement_unlock`, строка в notifications, `Notifier` на движке) + минималистичный дизайн страницы/карточек в стиле сайта
8. ✅ Одноразовый backfill при старте (`RecomputeAll`, Redis-маркер `achievements:backfill:v1`): после реворка прогресс всех юзеров пересчитывается из живых данных — старые строки дропаются, счётчики сидируются реальной активностью (entries/comments/likes/streak и т.д.)
9. ✅ Фиксы при реальном деплое: миграция 106 (колонка `updated_at`), `$3::text` в upsert зеркала, `jsonb_typeof`-гард в `images` (scalar image_urls)
10. Тесты (Go + vitest) + CI

### Backfill при старте (этап 8)

- `RecomputeAll` в движке: `SELECT id FROM users` → для каждого `RecomputeUser` (все группы, exact-уровни, счётчики из source-таблиц). Тяжёлый, поэтому в фоне после `Sync`.
- Запускается один раз: `redis.SetNX(achievements:backfill:v1)` — маркер живёт в Redis, при `redis flush`/новом контейнере повторится (безвредно: exact-пересчёт идемпотентен).
- После backfill анлоки видны сразу (не ждём следующего действия), `unlocked_at` ставится временем пересчёта.

### Точки интеграции (этап 4)

- `likes.go` LikeThread/LikePost → `EventLikeGiven` (лайкер) + `EventLikeReceived` (владелец)
- `rpc.go` создание треда → `EventEntryCreated` (+ `EventImageUploaded` при картинках); пост в треде → `EventCommentCreated`
- `universal_crud.go` (upsert + INSERT пути): стена → записи/комменты/лайки/репосты, `user_daily_visits` → визит, `gomosub_memberships` → саб, правила → правила, `profile_customization` → стиль
- `profiles.go` → аватар/био; `integrations_handler.go` → интеграция; `gifts.go` SendGift → отправить/получить подарок; `rpc_gomosub.go` → создать саб
- `routes.go`: каталог `achievements.Default()` → движок + `RecomputeStats`; при старте `Sync` (зеркало) + фоновый `RecomputeDirty`. Без `Notifier` — уведомления об анлоке выпилены (этап 7)
- `session_time` оценивается на `EventDailyVisit` (вместе со стриком и секретами удержания)
