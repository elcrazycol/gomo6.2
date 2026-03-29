create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.messenger_users (
  id uuid primary key default gen_random_uuid(),
  main_user_id uuid not null unique,
  username text not null,
  account_number bigint,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messenger_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.messenger_users(id) on delete cascade,
  device_id text not null,
  label text not null default 'browser',
  public_key text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_id)
);

create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  conversation_type text not null default 'direct' check (conversation_type in ('direct')),
  direct_key text not null unique,
  created_by uuid not null references public.messenger_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_message_preview text
);

create table if not exists public.messenger_conversation_members (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references public.messenger_users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  archived_at timestamptz,
  last_read_message_id uuid,
  last_read_at timestamptz,
  unread_count_cache integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists public.messenger_conversation_keys (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  user_id uuid not null references public.messenger_users(id) on delete cascade,
  device_id text not null,
  encrypted_key text not null,
  key_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id, device_id)
);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  sender_user_id uuid not null references public.messenger_users(id) on delete restrict,
  sender_device_id text not null,
  ciphertext text not null,
  nonce text not null,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists messenger_devices_user_idx
  on public.messenger_devices (user_id, last_seen_at desc);

create index if not exists messenger_messages_conversation_sent_idx
  on public.messenger_messages (conversation_id, sent_at);

create index if not exists messenger_members_user_idx
  on public.messenger_conversation_members (user_id, last_read_at desc);

drop trigger if exists messenger_users_touch_updated_at on public.messenger_users;
create trigger messenger_users_touch_updated_at
before update on public.messenger_users
for each row execute function public.touch_updated_at();

drop trigger if exists messenger_devices_touch_updated_at on public.messenger_devices;
create trigger messenger_devices_touch_updated_at
before update on public.messenger_devices
for each row execute function public.touch_updated_at();

drop trigger if exists messenger_conversations_touch_updated_at on public.messenger_conversations;
create trigger messenger_conversations_touch_updated_at
before update on public.messenger_conversations
for each row execute function public.touch_updated_at();

drop trigger if exists messenger_members_touch_updated_at on public.messenger_conversation_members;
create trigger messenger_members_touch_updated_at
before update on public.messenger_conversation_members
for each row execute function public.touch_updated_at();

drop trigger if exists messenger_keys_touch_updated_at on public.messenger_conversation_keys;
create trigger messenger_keys_touch_updated_at
before update on public.messenger_conversation_keys
for each row execute function public.touch_updated_at();

create or replace function public.update_messenger_conversation_activity()
returns trigger
language plpgsql
as $$
begin
  update public.messenger_conversations
  set
    last_message_at = new.sent_at,
    last_message_preview = '[encrypted]'
  where id = new.conversation_id;

  update public.messenger_conversation_members
  set unread_count_cache = unread_count_cache + 1
  where conversation_id = new.conversation_id
    and user_id <> new.sender_user_id;

  update public.messenger_conversation_members
  set
    last_read_message_id = new.id,
    last_read_at = new.sent_at,
    unread_count_cache = 0
  where conversation_id = new.conversation_id
    and user_id = new.sender_user_id;

  return new;
end;
$$;

drop trigger if exists messenger_messages_update_activity on public.messenger_messages;
create trigger messenger_messages_update_activity
after insert on public.messenger_messages
for each row execute function public.update_messenger_conversation_activity();
