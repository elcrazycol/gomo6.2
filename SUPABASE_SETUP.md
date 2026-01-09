# Инструкции по настройке системы сообщений в Supabase

## Шаги для настройки

### 1. Применить миграцию

Выполните SQL миграцию из файла:
```
supabase/migrations/20260109215318_add_messaging_system.sql
```

Вы можете применить её через:
- Supabase Dashboard → SQL Editor → вставить содержимое файла и выполнить
- Или через CLI: `supabase db push`

### 2. Проверка создания таблиц

После применения миграции должны быть созданы две таблицы:

#### `conversations`
- `id` (UUID, PRIMARY KEY)
- `user1_id` (UUID, FOREIGN KEY → profiles.id)
- `user2_id` (UUID, FOREIGN KEY → profiles.id)
- `last_message_at` (TIMESTAMPTZ)
- `created_at` (TIMESTAMPTZ)
- UNIQUE constraint на (user1_id, user2_id)

#### `messages`
- `id` (UUID, PRIMARY KEY)
- `conversation_id` (UUID, FOREIGN KEY → conversations.id)
- `sender_id` (UUID, FOREIGN KEY → profiles.id)
- `recipient_id` (UUID, FOREIGN KEY → profiles.id)
- `content` (TEXT)
- `is_read` (BOOLEAN, default: false)
- `created_at` (TIMESTAMPTZ)

### 3. Проверка RLS (Row Level Security)

Убедитесь, что RLS включен для обеих таблиц и политики созданы:

**Для conversations:**
- Пользователи могут видеть только свои переписки
- Пользователи могут создавать переписки

**Для messages:**
- Пользователи могут видеть сообщения только в своих переписках
- Пользователи могут отправлять сообщения только в своих переписках
- Пользователи могут обновлять только полученные сообщения (для отметки как прочитанные)

### 4. Проверка триггеров

Должны быть созданы следующие триггеры:

1. **update_conversation_last_message** - обновляет `last_message_at` в conversations при создании нового сообщения
2. **validate_message_participants** - проверяет, что отправитель и получатель являются участниками переписки

### 5. Проверка индексов

Убедитесь, что созданы индексы для оптимизации запросов:
- `conversations_user1_id_idx`
- `conversations_user2_id_idx`
- `conversations_last_message_at_idx`
- `messages_conversation_id_idx`
- `messages_sender_id_idx`
- `messages_recipient_id_idx`
- `messages_is_read_idx` (partial index для is_read = false)
- `messages_created_at_idx`

### 6. Проверка Realtime

Убедитесь, что Realtime включен для таблицы `messages` в Supabase Dashboard:
- Settings → API → Realtime → включить для таблицы `messages`

Это необходимо для получения уведомлений о новых сообщениях в реальном времени.

### 7. Тестирование

После применения миграции:

1. Войдите в приложение как два разных пользователя
2. Зайдите в профиль одного пользователя и нажмите "Написать"
3. Отправьте сообщение
4. Проверьте, что сообщение появилось у получателя
5. Проверьте, что счетчик непрочитанных сообщений обновляется

## Возможные проблемы

### Проблема: Foreign key имена не совпадают

Если возникают ошибки с foreign key именами в запросах, проверьте фактические имена в Supabase:
```sql
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name 
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
WHERE constraint_type = 'FOREIGN KEY' 
  AND tc.table_name IN ('conversations', 'messages');
```

Затем обновите имена в файле `src/pages/Messages.tsx` если они отличаются.

### Проблема: Realtime не работает

Убедитесь, что:
1. Realtime включен в Supabase Dashboard
2. Таблица `messages` добавлена в список таблиц для Realtime
3. RLS политики позволяют пользователю видеть сообщения

## Дополнительные настройки (опционально)

### Ограничение длины сообщений

Если хотите ограничить длину сообщений, добавьте CHECK constraint:
```sql
ALTER TABLE messages 
ADD CONSTRAINT messages_content_length_check 
CHECK (char_length(content) <= 5000);
```

### Автоматическое удаление старых переписок

Можно добавить функцию для автоматического удаления переписок без сообщений старше определенного времени (например, 30 дней).
