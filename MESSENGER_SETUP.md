# Messenger setup

## Что теперь в репозитории
- `apps/web` — основная соцсеть на Vite/React
- `apps/messenger` — отдельный messenger frontend на Next.js для `m.gomo6.wtf`
- messenger использует тот же Supabase project, что и основная соцсеть

## Как деплоить на Vercel
1. Создай два Vercel project из одного репозитория.
2. Для основного сайта укажи Root Directory: `apps/web`.
3. Для мессенджера укажи Root Directory: `apps/messenger`.
4. Привяжи домены:
   - `gomo6.wtf` -> `apps/web`
   - `m.gomo6.wtf` -> `apps/messenger`
5. В оба проекта добавь env от одного и того же Supabase:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
6. Для `apps/messenger` также пробрось:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `APP_BASE_URL`
   - `MESSENGER_BASE_URL`

## Что важно по auth
- Основной сайт подтверждает текущую Supabase-сессию пользователя через service role.
- `apps/web/api/messenger/handoff.ts` больше не ставит messenger-cookie.
- Handoff переносит `access_token` и `refresh_token` во фрагмент URL, а `m.gomo6.wtf` сохраняет сессию в своём Supabase client storage.

## Что важно по данным
- Legacy plaintext DM таблицы закрываются миграцией из `apps/web/supabase/migrations/20260329160000_rebuild_messenger_with_signal.sql`.
- Новый messenger-контур живёт в `chat_*` таблицах того же проекта Supabase, что и `profiles`, `notifications` и остальная соцсеть.
- Новый messenger берёт username, avatar, account number и online state напрямую из `profiles`.

## Что важно по E2EE
- Сервер хранит только encrypted envelopes и публичные device keys.
- Каждое сообщение шифруется отдельно под каждое устройство.
- Текущая реализация использует browser-native WebCrypto и не зависит от старого `libsodium` слоя.

## SQL
Примени миграцию:
- `apps/web/supabase/migrations/20260329160000_rebuild_messenger_with_signal.sql`
