create extension if not exists pgcrypto;

create table if not exists public.messenger_users (
  id uuid primary key default gen_random_uuid(),
  main_user_id uuid not null unique,
  username text not null,
  account_number bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messenger_user_keys (
  user_id uuid primary key references public.messenger_users(id) on delete cascade,
  public_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  direct_key text not null unique,
  created_by uuid not null references public.messenger_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);

create table if not exists public.conversation_memberships (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references public.messenger_users(id) on delete cascade,
  encrypted_key text not null,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  sender_user_id uuid not null references public.messenger_users(id) on delete restrict,
  ciphertext text not null,
  nonce text not null,
  created_at timestamptz not null default now()
);

create index if not exists messenger_messages_conversation_created_idx
  on public.messenger_messages (conversation_id, created_at);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists messenger_users_touch_updated_at on public.messenger_users;
create trigger messenger_users_touch_updated_at
before update on public.messenger_users
for each row execute function public.touch_updated_at();

drop trigger if exists messenger_user_keys_touch_updated_at on public.messenger_user_keys;
create trigger messenger_user_keys_touch_updated_at
before update on public.messenger_user_keys
for each row execute function public.touch_updated_at();

create or replace function public.update_conversation_activity()
returns trigger
language plpgsql
as $$
begin
  update public.messenger_conversations
  set last_message_at = new.created_at
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists messenger_messages_update_activity on public.messenger_messages;
create trigger messenger_messages_update_activity
after insert on public.messenger_messages
for each row execute function public.update_conversation_activity();
