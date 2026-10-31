# GomoSub: роли, права и модерация (v2, Discord-like)

Гомосаб = `boards` с `is_gomosub=true` + сателлитные таблицы. Модель прав —
упрощённый Discord: union мульти-ролей, иерархия по позиции, allow/deny
перекрытия на канал, бан/таймаут.

## Роли

- `gomosub_roles`: `name`, `color`, `position` (выше = главнее),
  `permissions` JSONB (`{ключ: true}`, отсутствие = false), `is_everyone`
  (ровно одна на саб, нижний уровень; удалить/переименовать/подвинуть
  нельзя, права править можно). Права роли — бинарные строго как в Discord: тумблер вправо = право
  есть, влево = нет (невыставленное и `false` равнозначны отсутствию).
  `@everyone` из коробки даёт вид+письмо, остальные роли докупают
  сверху объединением. Запреты живут только на уровне каналов
  (перекрытия ✓/–/✕), где deny побеждает.
- `@everyone` создаётся автоматически: миграцией 147 для старых сабов и
  `POST /api/rpc/create_gomosub` для новых. Действует только на участников.
- Назначения: `gomosub_member_roles` (0..N ролей на участника) плюс legacy
  `gomosub_memberships.role_id` (читается как ещё один грант).
- Эффективный набор = union `@everyone` + все назначенные роли.
  `administrator` и владелец саба обходят все проверки.

### Ключи прав

Серверные: `administrator`, `can_manage_roles`, `can_manage_channels`,
`can_manage_members`, `kick_members`, `ban_members`, `timeout_members`,
`can_delete_threads` (= manage messages), `can_pin_threads`,
`can_post_stories`, `view_channel`, `send_messages`. Новые способности —
без миграций (JSONB).

### Иерархия

Актор модерирует цель только если его топ-позиция строго выше
(`gomosubperms.CanManageRole`). Владелец и `administrator` — мимо иерархии.
Нельзя модерировать себя и владельца. Топ участника без ролей = 0
(`@everyone`).

То же правило действует на управление (generic CRUD gate): роли можно
создавать/править/удалять только ниже своего топа, `@everyone` нельзя
переименовать/подвинуть/удалить/выдать явно, а выдаваемые права не могут
превышать собственные (нельзя выдать `administrator`, не имея его).
Назначение/снятие ролей (`gomosub_member_roles`, legacy `role_id`) требует
роль строго ниже своей. Баны идут только через RPC (generic-запись
запрещена) — там та же иерархия. Владелец и `administrator` всё обходят.

## Каналы

- `channels.kind`: `forum` (записи) или `text` (живой чат).
- `channel_categories` (id, board_id, name, sort_order) + `channels.category_id`;
  старое свободное поле `category` — fallback для группировки в UI.
- `channel_permissions`: `allow`/`deny` JSONB (`view_channel`,
  `send_messages`) + legacy `can_read`/`can_write` (читаются, когда
  allow/deny пустые). Deny всегда побеждает.
- Enforcement — `internal/channelaccess` (один предикат для REST и WS):
  бан = полный запрет; владелец/`administrator` — всё; чат — только
  участники; таймаут блокирует запись; приватный канал требует
  `view_channel`/`send_messages` из перекрытий.

## Модерация (RPC, все POST + Bearer)

- `gomosub_kick` — снять membership + гранты (без бана, можно вернуться).
- `gomosub_ban` — бан (`reason`, `expires_at`, `delete_messages` чистит
  сообщения в чатах саба) + исключение. Повторный бан обновляет запись.
- `gomosub_unban`, `gomosub_timeout` (`duration_minutes` 1..40320 или
  `expires_at`, кап 28 дней), `gomosub_untimeout`.
- `GET gomosub_bans?_board_id=` — активные баны (истёкшие скрыты).
- `GET gomosub_members?_board_id=` — ростер (участники + роли + гранты)
  для правого сайдбара; только участникам и владельцу.
- Обход бана закрыт: self-join через generic CRUD и вход по инвайту
  отклоняют забаненных.

Гейт общий (`authorizeMod` в `internal/rpc/rpc_moderation.go`): нужный грант
(или `can_manage_members`/`administrator`, владелец мимо) + не себя/не
владельца + строгая иерархия.

## UI

- `/g/:slug/settings`: Основное · Роли (список + редактор, `@everyone`
  заблокирована) · Участники (поиск, мульти-роли, кик/бан/мьют) · Каналы
  (категории, группировка, ✓/–/✕ перекрытия) · Баны · Приглашения
  (только приватные). Десктоп — двухколоночный, мобилка — список→редактор.
- Страница саба: сайдбар с категориями (без категории → сверху, как в
  Discord), правый ростер участников (группы по топ-роли), фильтр приватных
  каналов по union-модели.
- Код: `apps/web/src/components/gomosub/settings/`,
  `GomoSubMemberList.tsx`, `groupChannels.ts`,
  `internal/gomosubperms` (единая истина резолва).
