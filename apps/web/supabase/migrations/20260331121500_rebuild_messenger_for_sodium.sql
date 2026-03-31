create table if not exists public.chat_user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists chat_user_keys_touch_updated_at on public.chat_user_keys;
create trigger chat_user_keys_touch_updated_at
before update on public.chat_user_keys
for each row execute function public.touch_updated_at();

alter table public.chat_user_keys enable row level security;

drop policy if exists "chat user keys own" on public.chat_user_keys;
create policy "chat user keys own"
on public.chat_user_keys
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

alter table public.chat_messages
  alter column sender_device_id drop not null;

alter table public.chat_messages
  add column if not exists ciphertext text,
  add column if not exists nonce text,
  add column if not exists sender_public_key text,
  add column if not exists recipient_public_key text;

create index if not exists chat_user_keys_public_key_idx
  on public.chat_user_keys (user_id, updated_at desc);
