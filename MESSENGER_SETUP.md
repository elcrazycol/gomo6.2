# Messenger setup

## Что теперь в репозитории
- `apps/web` — основная соцсеть на Vite/React
- `apps/messenger` — отдельный E2EE messenger на Next.js для `m.gomo6.wtf`
- корень — workspace/Turborepo

## Как деплоить на Vercel
1. Создай два Vercel project из одного репозитория.
2. Для основного сайта укажи Root Directory: `apps/web`.
3. Для мессенджера укажи Root Directory: `apps/messenger`.
4. Привяжи домены:
   - `gomo6.wtf` -> `apps/web`
   - `m.gomo6.wtf` -> `apps/messenger`
5. В оба проекта добавь одинаковый `MESSENGER_SHARED_SESSION_SECRET`.
6. Для `apps/web` добавь env от основного Supabase.
7. Для `apps/messenger` добавь env от отдельного Supabase проекта мессенджера.

## Что важно по auth
- Основной сайт подтверждает текущую Supabase-сессию пользователя через service role.
- После этого `apps/web/api/messenger/handoff.ts` ставит общий `HttpOnly` cookie на `.gomo6.wtf`.
- `m.gomo6.wtf` читает этот cookie сервером и пускает пользователя в мессенджер без query-token и без localStorage handoff.

## Что важно по E2EE
- Сервер хранит только ciphertext, nonce и публичные ключи.
- Ключ диалога создаётся на клиенте.
- Ключ диалога шифруется отдельно для каждого участника через sealed box.
- Сообщения шифруются XChaCha20-Poly1305 на клиенте.

## Ограничения текущей версии
- Сейчас это модель `1 user = 1 browser device`.
- Если собеседник ни разу не открывал `m.gomo6.wtf`, у него ещё нет публичного ключа, и начать E2EE-диалог нельзя.
- Нет вложений, групповых чатов и key-rotation.
- Для максимальной реальной безопасности следующим шагом стоит вынести private keys из `localStorage` в зашифрованное IndexedDB/WebCrypto-хранилище и добавить device management.

## SQL
Запусти миграцию из:
- `apps/messenger/supabase/migrations/20260329000000_create_messenger_schema.sql`
