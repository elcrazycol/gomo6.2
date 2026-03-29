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

drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;

drop table if exists public.messenger_conversation_keys cascade;
drop table if exists public.messenger_messages cascade;
drop table if exists public.messenger_conversation_members cascade;
drop table if exists public.messenger_conversations cascade;
drop table if exists public.messenger_devices cascade;
drop table if exists public.messenger_users cascade;

create table if not exists public.chat_conversations (
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

create table if not exists public.chat_conversation_members (
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

create table if not exists public.chat_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_device_id text not null,
  signal_device_id smallint not null check (signal_device_id between 1 and 127),
  registration_id integer not null,
  device_label text not null default 'browser',
  identity_public_key text not null,
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_device_id),
  unique (user_id, signal_device_id)
);

create table if not exists public.chat_identity_keys (
  device_id uuid primary key references public.chat_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  public_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_signed_prekeys (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.chat_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  signed_prekey_id integer not null,
  public_key text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  unique (device_id, signed_prekey_id)
);

create table if not exists public.chat_one_time_prekeys (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.chat_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  prekey_id integer not null,
  public_key text not null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (device_id, prekey_id)
);

create table if not exists public.chat_kyber_prekeys (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.chat_devices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kyber_prekey_id integer not null,
  public_key text not null,
  signature text not null,
  created_at timestamptz not null default now(),
  replaced_at timestamptz,
  unique (device_id, kyber_prekey_id)
);

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  local_device_id uuid not null references public.chat_devices(id) on delete cascade,
  remote_device_id uuid not null references public.chat_devices(id) on delete cascade,
  local_user_id uuid not null references auth.users(id) on delete cascade,
  remote_user_id uuid not null references auth.users(id) on delete cascade,
  trust_state text not null default 'trusted' check (trust_state in ('trusted', 'untrusted', 'replaced')),
  established_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  unique (local_device_id, remote_device_id)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  sender_device_id uuid not null references public.chat_devices(id) on delete cascade,
  client_message_id text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (sender_user_id, client_message_id)
);

alter table public.chat_conversations
  add constraint chat_conversations_last_message_fk
  foreign key (last_message_id)
  references public.chat_messages(id)
  on delete set null;

alter table public.chat_conversation_members
  add constraint chat_conversation_members_last_read_fk
  foreign key (last_read_message_id)
  references public.chat_messages(id)
  on delete set null;

create table if not exists public.chat_message_envelopes (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  recipient_device_id uuid not null references public.chat_devices(id) on delete cascade,
  ciphertext text not null,
  message_type smallint not null,
  created_at timestamptz not null default now(),
  delivered_at timestamptz not null default now(),
  opened_at timestamptz,
  primary key (message_id, recipient_device_id)
);

create table if not exists public.chat_receipts (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create table if not exists public.chat_user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  in_app_notifications boolean not null default true,
  desktop_notifications boolean not null default true,
  sound_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_members_user_idx
  on public.chat_conversation_members (user_id, last_read_at desc);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, sent_at desc);

create index if not exists chat_envelopes_recipient_idx
  on public.chat_message_envelopes (recipient_user_id, recipient_device_id, delivered_at desc);

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

drop trigger if exists chat_devices_touch_updated_at on public.chat_devices;
create trigger chat_devices_touch_updated_at
before update on public.chat_devices
for each row execute function public.touch_updated_at();

drop trigger if exists chat_receipts_touch_updated_at on public.chat_receipts;
create trigger chat_receipts_touch_updated_at
before update on public.chat_receipts
for each row execute function public.touch_updated_at();

drop trigger if exists chat_user_preferences_touch_updated_at on public.chat_user_preferences;
create trigger chat_user_preferences_touch_updated_at
before update on public.chat_user_preferences
for each row execute function public.touch_updated_at();

create or replace function public.can_access_chat_conversation(target_conversation_id uuid, target_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversation_members members
    where members.conversation_id = target_conversation_id
      and members.user_id = target_user_id
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
    ) pair
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
  on conflict (conversation_id, user_id) do nothing;

  return conversation_uuid;
end;
$$;

create or replace function public.chat_mark_read(target_conversation_id uuid, target_message_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  resolved_read_at timestamptz;
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if not public.can_access_chat_conversation(target_conversation_id, current_user_id) then
    raise exception 'Conversation access denied';
  end if;

  select sent_at
  into resolved_read_at
  from public.chat_messages
  where id = target_message_id
    and conversation_id = target_conversation_id;

  update public.chat_conversation_members
  set
    last_read_message_id = coalesce(target_message_id, last_read_message_id),
    last_read_at = coalesce(resolved_read_at, now()),
    unread_count_cache = 0
  where conversation_id = target_conversation_id
    and user_id = current_user_id;

  update public.chat_receipts receipts
  set
    read_at = coalesce(receipts.read_at, now()),
    updated_at = now()
  from public.chat_messages messages
  where receipts.message_id = messages.id
    and receipts.user_id = current_user_id
    and messages.conversation_id = target_conversation_id;

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
  from public.chat_conversation_members members
  where members.conversation_id = new.conversation_id
  on conflict (message_id, user_id) do update
  set
    delivered_at = excluded.delivered_at,
    read_at = excluded.read_at,
    updated_at = now();

  insert into public.notifications (user_id, type, title, message, related_conversation_id, related_message_id)
  select
    members.user_id,
    'message',
    'Новое сообщение',
    'У тебя новое зашифрованное сообщение в messenger',
    new.conversation_id,
    new.id
  from public.chat_conversation_members members
  left join public.chat_user_preferences prefs
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
alter table public.chat_devices enable row level security;
alter table public.chat_identity_keys enable row level security;
alter table public.chat_signed_prekeys enable row level security;
alter table public.chat_one_time_prekeys enable row level security;
alter table public.chat_kyber_prekeys enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_message_envelopes enable row level security;
alter table public.chat_receipts enable row level security;
alter table public.chat_user_preferences enable row level security;

drop policy if exists "chat conversations select" on public.chat_conversations;
create policy "chat conversations select"
on public.chat_conversations
for select
using (public.can_access_chat_conversation(id));

drop policy if exists "chat conversations insert" on public.chat_conversations;
create policy "chat conversations insert"
on public.chat_conversations
for insert
with check (created_by = auth.uid());

drop policy if exists "chat members select" on public.chat_conversation_members;
create policy "chat members select"
on public.chat_conversation_members
for select
using (public.can_access_chat_conversation(conversation_id));

drop policy if exists "chat members update self" on public.chat_conversation_members;
create policy "chat members update self"
on public.chat_conversation_members
for update
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "chat devices select self" on public.chat_devices;
create policy "chat devices select self"
on public.chat_devices
for select
using (user_id = auth.uid());

drop policy if exists "chat devices mutate self" on public.chat_devices;
create policy "chat devices mutate self"
on public.chat_devices
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "chat identity keys select self" on public.chat_identity_keys;
create policy "chat identity keys select self"
on public.chat_identity_keys
for select
using (user_id = auth.uid());

drop policy if exists "chat signed prekeys select self" on public.chat_signed_prekeys;
create policy "chat signed prekeys select self"
on public.chat_signed_prekeys
for select
using (user_id = auth.uid());

drop policy if exists "chat signed prekeys mutate self" on public.chat_signed_prekeys;
create policy "chat signed prekeys mutate self"
on public.chat_signed_prekeys
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "chat one time prekeys select self" on public.chat_one_time_prekeys;
create policy "chat one time prekeys select self"
on public.chat_one_time_prekeys
for select
using (user_id = auth.uid());

drop policy if exists "chat one time prekeys mutate self" on public.chat_one_time_prekeys;
create policy "chat one time prekeys mutate self"
on public.chat_one_time_prekeys
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "chat kyber prekeys select self" on public.chat_kyber_prekeys;
create policy "chat kyber prekeys select self"
on public.chat_kyber_prekeys
for select
using (user_id = auth.uid());

drop policy if exists "chat kyber prekeys mutate self" on public.chat_kyber_prekeys;
create policy "chat kyber prekeys mutate self"
on public.chat_kyber_prekeys
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "chat sessions select self" on public.chat_sessions;
create policy "chat sessions select self"
on public.chat_sessions
for select
using (local_user_id = auth.uid());

drop policy if exists "chat sessions mutate self" on public.chat_sessions;
create policy "chat sessions mutate self"
on public.chat_sessions
for all
using (local_user_id = auth.uid())
with check (local_user_id = auth.uid());

drop policy if exists "chat messages select" on public.chat_messages;
create policy "chat messages select"
on public.chat_messages
for select
using (public.can_access_chat_conversation(conversation_id));

drop policy if exists "chat messages insert" on public.chat_messages;
create policy "chat messages insert"
on public.chat_messages
for insert
with check (
  sender_user_id = auth.uid()
  and public.can_access_chat_conversation(conversation_id)
);

drop policy if exists "chat envelopes select own" on public.chat_message_envelopes;
create policy "chat envelopes select own"
on public.chat_message_envelopes
for select
using (recipient_user_id = auth.uid());

drop policy if exists "chat receipts select own conversations" on public.chat_receipts;
create policy "chat receipts select own conversations"
on public.chat_receipts
for select
using (
  exists (
    select 1
    from public.chat_messages messages
    where messages.id = message_id
      and public.can_access_chat_conversation(messages.conversation_id)
  )
);

drop policy if exists "chat preferences own" on public.chat_user_preferences;
create policy "chat preferences own"
on public.chat_user_preferences
for all
using (user_id = auth.uid())
with check (user_id = auth.uid());
