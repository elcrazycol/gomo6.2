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

alter table public.notifications
  add column if not exists related_conversation_id uuid,
  add column if not exists related_message_id uuid;

do $$
begin
  if to_regclass('public.chat_messages') is not null then
    drop trigger if exists chat_messages_on_insert on public.chat_messages;
  end if;

  if to_regclass('public.chat_conversations') is not null then
    drop trigger if exists chat_conversations_touch_updated_at on public.chat_conversations;
  end if;

  if to_regclass('public.chat_conversation_members') is not null then
    drop trigger if exists chat_members_touch_updated_at on public.chat_conversation_members;
  end if;

  if to_regclass('public.chat_receipts') is not null then
    drop trigger if exists chat_receipts_touch_updated_at on public.chat_receipts;
  end if;

  if to_regclass('public.chat_user_preferences') is not null then
    drop trigger if exists chat_user_preferences_touch_updated_at on public.chat_user_preferences;
  end if;

  if to_regclass('public.chat_user_keys') is not null then
    drop trigger if exists chat_user_keys_touch_updated_at on public.chat_user_keys;
  end if;
end
$$;

drop function if exists public.on_chat_message_created() cascade;
drop function if exists public.chat_mark_delivered(uuid, uuid) cascade;
drop function if exists public.chat_mark_read(uuid, uuid) cascade;
drop function if exists public.get_or_create_direct_chat(uuid) cascade;
drop function if exists public.can_access_chat_conversation(uuid, uuid) cascade;

do $$
begin
  if to_regclass('public.chat_conversations') is not null then
    drop policy if exists "chat conversations select" on public.chat_conversations;
    drop policy if exists "chat conversations insert" on public.chat_conversations;
  end if;

  if to_regclass('public.chat_conversation_members') is not null then
    drop policy if exists "chat members select" on public.chat_conversation_members;
    drop policy if exists "chat members update self" on public.chat_conversation_members;
  end if;

  if to_regclass('public.chat_messages') is not null then
    drop policy if exists "chat messages select" on public.chat_messages;
    drop policy if exists "chat messages insert" on public.chat_messages;
  end if;

  if to_regclass('public.chat_receipts') is not null then
    drop policy if exists "chat receipts select own conversations" on public.chat_receipts;
  end if;

  if to_regclass('public.chat_user_preferences') is not null then
    drop policy if exists "chat preferences own" on public.chat_user_preferences;
  end if;

  if to_regclass('public.chat_user_keys') is not null then
    drop policy if exists "chat user keys own write" on public.chat_user_keys;
    drop policy if exists "chat user keys readable" on public.chat_user_keys;
  end if;
end
$$;

drop index if exists public.chat_members_user_idx;
drop index if exists public.chat_messages_conversation_idx;
drop index if exists public.chat_user_keys_public_key_idx;
drop index if exists public.chat_notifications_conversation_idx;

drop table if exists public.chat_message_envelopes cascade;
drop table if exists public.chat_sessions cascade;
drop table if exists public.chat_one_time_prekeys cascade;
drop table if exists public.chat_signed_prekeys cascade;
drop table if exists public.chat_kyber_prekeys cascade;
drop table if exists public.chat_identity_keys cascade;
drop table if exists public.chat_devices cascade;

drop table if exists public.chat_receipts cascade;
drop table if exists public.chat_messages cascade;
drop table if exists public.chat_conversation_members cascade;
drop table if exists public.chat_conversations cascade;
drop table if exists public.chat_user_preferences cascade;
drop table if exists public.chat_user_keys cascade;

drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.messenger_conversation_keys cascade;
drop table if exists public.messenger_messages cascade;
drop table if exists public.messenger_conversation_members cascade;
drop table if exists public.messenger_conversations cascade;
drop table if exists public.messenger_devices cascade;
drop table if exists public.messenger_users cascade;

create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'direct' check (kind in ('direct')),
  direct_key text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_id uuid,
  last_message_at timestamptz,
  last_message_sender_id uuid references auth.users(id) on delete set null
);

create table public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  archived_at timestamptz,
  last_read_message_id uuid,
  last_read_at timestamptz,
  unread_count_cache integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  client_message_id text not null,
  ciphertext text,
  nonce text,
  sender_public_key text,
  recipient_public_key text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (sender_user_id, client_message_id)
);

create table public.chat_receipts (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table public.chat_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app_notifications boolean not null default true,
  desktop_notifications boolean not null default true,
  sound_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_user_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_conversations_last_message_fk'
  ) then
    alter table public.chat_conversations
      add constraint chat_conversations_last_message_fk
      foreign key (last_message_id)
      references public.chat_messages(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'chat_conversation_members_last_read_fk'
  ) then
    alter table public.chat_conversation_members
      add constraint chat_conversation_members_last_read_fk
      foreign key (last_read_message_id)
      references public.chat_messages(id)
      on delete set null;
  end if;
end
$$;

create index if not exists chat_members_user_idx
  on public.chat_conversation_members (user_id, last_read_at desc);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, sent_at desc);

create index if not exists chat_user_keys_public_key_idx
  on public.chat_user_keys (user_id, updated_at desc);

create index if not exists chat_notifications_conversation_idx
  on public.notifications (user_id, type, related_conversation_id, is_read);

drop trigger if exists chat_conversations_touch_updated_at on public.chat_conversations;
create trigger chat_conversations_touch_updated_at
before update on public.chat_conversations
for each row execute function public.touch_updated_at();

drop trigger if exists chat_members_touch_updated_at on public.chat_conversation_members;
create trigger chat_members_touch_updated_at
before update on public.chat_conversation_members
for each row execute function public.touch_updated_at();

drop trigger if exists chat_receipts_touch_updated_at on public.chat_receipts;
create trigger chat_receipts_touch_updated_at
before update on public.chat_receipts
for each row execute function public.touch_updated_at();

drop trigger if exists chat_user_preferences_touch_updated_at on public.chat_user_preferences;
create trigger chat_user_preferences_touch_updated_at
before update on public.chat_user_preferences
for each row execute function public.touch_updated_at();

drop trigger if exists chat_user_keys_touch_updated_at on public.chat_user_keys;
create trigger chat_user_keys_touch_updated_at
before update on public.chat_user_keys
for each row execute function public.touch_updated_at();

create or replace function public.can_access_chat_conversation(
  target_conversation_id uuid,
  target_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversation_members as members
    where members.conversation_id = target_conversation_id
      and members.user_id = target_user_id
      and members.archived_at is null
  );
$$;

create or replace function public.get_or_create_direct_chat(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  conversation_uuid uuid;
  direct_lookup text;
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if target_user_id is null or target_user_id = current_user_id then
    raise exception 'Invalid target user';
  end if;

  direct_lookup := (
    select string_agg(user_id::text, ':' order by user_id::text)
    from (
      select current_user_id as user_id
      union all
      select target_user_id as user_id
    ) as pair
  );

  select id
  into conversation_uuid
  from public.chat_conversations
  where direct_key = direct_lookup;

  if conversation_uuid is null then
    insert into public.chat_conversations (direct_key, created_by)
    values (direct_lookup, current_user_id)
    returning id into conversation_uuid;
  end if;

  insert into public.chat_conversation_members (conversation_id, user_id)
  values (conversation_uuid, current_user_id), (conversation_uuid, target_user_id)
  on conflict (conversation_id, user_id) do update
  set archived_at = null;

  return conversation_uuid;
end;
$$;

create or replace function public.chat_mark_delivered(
  target_conversation_id uuid,
  target_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  delivered_cutoff timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if not public.can_access_chat_conversation(target_conversation_id, current_user_id) then
    raise exception 'Conversation access denied';
  end if;

  if target_message_id is not null then
    select sent_at
    into delivered_cutoff
    from public.chat_messages
    where id = target_message_id
      and conversation_id = target_conversation_id;
  end if;

  update public.chat_receipts as receipts
  set
    delivered_at = coalesce(receipts.delivered_at, now()),
    updated_at = now()
  from public.chat_messages as messages
  where receipts.message_id = messages.id
    and receipts.user_id = current_user_id
    and messages.conversation_id = target_conversation_id
    and messages.sent_at <= delivered_cutoff;
end;
$$;

create or replace function public.chat_mark_read(
  target_conversation_id uuid,
  target_message_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  resolved_read_at timestamptz := now();
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if not public.can_access_chat_conversation(target_conversation_id, current_user_id) then
    raise exception 'Conversation access denied';
  end if;

  if target_message_id is not null then
    select sent_at
    into resolved_read_at
    from public.chat_messages
    where id = target_message_id
      and conversation_id = target_conversation_id;
  end if;

  update public.chat_conversation_members
  set
    last_read_message_id = coalesce(target_message_id, last_read_message_id),
    last_read_at = resolved_read_at,
    unread_count_cache = 0
  where conversation_id = target_conversation_id
    and user_id = current_user_id;

  update public.chat_receipts as receipts
  set
    delivered_at = coalesce(receipts.delivered_at, now()),
    read_at = coalesce(receipts.read_at, now()),
    updated_at = now()
  from public.chat_messages as messages
  where receipts.message_id = messages.id
    and receipts.user_id = current_user_id
    and messages.conversation_id = target_conversation_id
    and messages.sent_at <= resolved_read_at;

  update public.notifications
  set is_read = true
  where user_id = current_user_id
    and type = 'message'
    and related_conversation_id = target_conversation_id;
end;
$$;

create or replace function public.on_chat_message_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.chat_conversations
  set
    last_message_id = new.id,
    last_message_at = new.sent_at,
    last_message_sender_id = new.sender_user_id
  where id = new.conversation_id;

  update public.chat_conversation_members
  set
    unread_count_cache = case
      when user_id = new.sender_user_id then 0
      else unread_count_cache + 1
    end,
    last_read_message_id = case
      when user_id = new.sender_user_id then new.id
      else last_read_message_id
    end,
    last_read_at = case
      when user_id = new.sender_user_id then new.sent_at
      else last_read_at
    end
  where conversation_id = new.conversation_id;

  insert into public.chat_receipts (message_id, user_id, delivered_at, read_at)
  select
    new.id,
    members.user_id,
    case when members.user_id = new.sender_user_id then new.sent_at else null end,
    case when members.user_id = new.sender_user_id then new.sent_at else null end
  from public.chat_conversation_members as members
  where members.conversation_id = new.conversation_id
  on conflict (message_id, user_id) do update
  set
    delivered_at = excluded.delivered_at,
    read_at = excluded.read_at,
    updated_at = now();

  insert into public.notifications (
    user_id,
    type,
    title,
    message,
    related_conversation_id,
    related_message_id
  )
  select
    members.user_id,
    'message',
    'Новое сообщение',
    'У тебя новое зашифрованное сообщение в messenger',
    new.conversation_id,
    new.id
  from public.chat_conversation_members as members
  left join public.chat_user_preferences as prefs
    on prefs.user_id = members.user_id
  where members.conversation_id = new.conversation_id
    and members.user_id <> new.sender_user_id
    and coalesce(prefs.in_app_notifications, true)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists chat_messages_on_insert on public.chat_messages;
create trigger chat_messages_on_insert
after insert on public.chat_messages
for each row execute function public.on_chat_message_created();

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_receipts enable row level security;
alter table public.chat_user_preferences enable row level security;
alter table public.chat_user_keys enable row level security;

create policy "chat conversations select"
on public.chat_conversations
for select
using (public.can_access_chat_conversation(id));

create policy "chat conversations insert"
on public.chat_conversations
for insert
with check (created_by = auth.uid());

create policy "chat members select"
on public.chat_conversation_members
for select
using (public.can_access_chat_conversation(conversation_id));

create policy "chat members update self"
on public.chat_conversation_members
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat messages select"
on public.chat_messages
for select
using (public.can_access_chat_conversation(conversation_id));

create policy "chat messages insert"
on public.chat_messages
for insert
with check (
  sender_user_id = auth.uid()
  and public.can_access_chat_conversation(conversation_id)
);

create policy "chat receipts select own conversations"
on public.chat_receipts
for select
using (
  exists (
    select 1
    from public.chat_messages as messages
    where messages.id = message_id
      and public.can_access_chat_conversation(messages.conversation_id)
  )
);

create policy "chat preferences own"
on public.chat_user_preferences
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat user keys own write"
on public.chat_user_keys
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy "chat user keys readable"
on public.chat_user_keys
for select
using (auth.role() = 'authenticated');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_conversation_members'
  ) then
    alter publication supabase_realtime add table public.chat_conversation_members;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_receipts'
  ) then
    alter publication supabase_realtime add table public.chat_receipts;
  end if;
end
$$;
