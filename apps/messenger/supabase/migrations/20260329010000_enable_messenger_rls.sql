create or replace function public.current_messenger_user_id()
returns uuid
language sql
stable
as $$
  select mu.id
  from public.messenger_users mu
  where mu.main_user_id = auth.uid()
  limit 1
$$;

alter table public.messenger_users enable row level security;
alter table public.messenger_devices enable row level security;
alter table public.messenger_conversations enable row level security;
alter table public.messenger_conversation_members enable row level security;
alter table public.messenger_conversation_keys enable row level security;
alter table public.messenger_messages enable row level security;

drop policy if exists "messenger_users_select_self_and_peers" on public.messenger_users;
create policy "messenger_users_select_self_and_peers"
on public.messenger_users
for select
to authenticated
using (
  main_user_id = auth.uid()
  or exists (
    select 1
    from public.messenger_conversation_members self_member
    join public.messenger_conversation_members other_member
      on other_member.conversation_id = self_member.conversation_id
    where self_member.user_id = public.current_messenger_user_id()
      and other_member.user_id = messenger_users.id
  )
);

drop policy if exists "messenger_users_update_self" on public.messenger_users;
create policy "messenger_users_update_self"
on public.messenger_users
for update
to authenticated
using (main_user_id = auth.uid())
with check (main_user_id = auth.uid());

drop policy if exists "messenger_devices_select_own" on public.messenger_devices;
create policy "messenger_devices_select_own"
on public.messenger_devices
for select
to authenticated
using (user_id = public.current_messenger_user_id());

drop policy if exists "messenger_devices_insert_own" on public.messenger_devices;
create policy "messenger_devices_insert_own"
on public.messenger_devices
for insert
to authenticated
with check (user_id = public.current_messenger_user_id());

drop policy if exists "messenger_devices_update_own" on public.messenger_devices;
create policy "messenger_devices_update_own"
on public.messenger_devices
for update
to authenticated
using (user_id = public.current_messenger_user_id())
with check (user_id = public.current_messenger_user_id());

drop policy if exists "messenger_conversations_select_member" on public.messenger_conversations;
create policy "messenger_conversations_select_member"
on public.messenger_conversations
for select
to authenticated
using (
  exists (
    select 1
    from public.messenger_conversation_members member
    where member.conversation_id = messenger_conversations.id
      and member.user_id = public.current_messenger_user_id()
  )
);

drop policy if exists "messenger_conversations_insert_creator" on public.messenger_conversations;
create policy "messenger_conversations_insert_creator"
on public.messenger_conversations
for insert
to authenticated
with check (created_by = public.current_messenger_user_id());

drop policy if exists "messenger_conversation_members_select_member" on public.messenger_conversation_members;
create policy "messenger_conversation_members_select_member"
on public.messenger_conversation_members
for select
to authenticated
using (
  exists (
    select 1
    from public.messenger_conversation_members self_member
    where self_member.conversation_id = messenger_conversation_members.conversation_id
      and self_member.user_id = public.current_messenger_user_id()
  )
);

drop policy if exists "messenger_conversation_members_insert_self_or_same_conversation" on public.messenger_conversation_members;
create policy "messenger_conversation_members_insert_self_or_same_conversation"
on public.messenger_conversation_members
for insert
to authenticated
with check (
  user_id = public.current_messenger_user_id()
  or exists (
    select 1
    from public.messenger_conversations conversation
    where conversation.id = messenger_conversation_members.conversation_id
      and conversation.created_by = public.current_messenger_user_id()
  )
);

drop policy if exists "messenger_conversation_members_update_own" on public.messenger_conversation_members;
create policy "messenger_conversation_members_update_own"
on public.messenger_conversation_members
for update
to authenticated
using (user_id = public.current_messenger_user_id())
with check (user_id = public.current_messenger_user_id());

drop policy if exists "messenger_conversation_keys_select_own" on public.messenger_conversation_keys;
create policy "messenger_conversation_keys_select_own"
on public.messenger_conversation_keys
for select
to authenticated
using (user_id = public.current_messenger_user_id());

drop policy if exists "messenger_conversation_keys_insert_own_or_creator" on public.messenger_conversation_keys;
create policy "messenger_conversation_keys_insert_own_or_creator"
on public.messenger_conversation_keys
for insert
to authenticated
with check (
  user_id = public.current_messenger_user_id()
  or exists (
    select 1
    from public.messenger_conversations conversation
    where conversation.id = messenger_conversation_keys.conversation_id
      and conversation.created_by = public.current_messenger_user_id()
  )
);

drop policy if exists "messenger_messages_select_member" on public.messenger_messages;
create policy "messenger_messages_select_member"
on public.messenger_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.messenger_conversation_members member
    where member.conversation_id = messenger_messages.conversation_id
      and member.user_id = public.current_messenger_user_id()
  )
);

drop policy if exists "messenger_messages_insert_member" on public.messenger_messages;
create policy "messenger_messages_insert_member"
on public.messenger_messages
for insert
to authenticated
with check (
  sender_user_id = public.current_messenger_user_id()
  and exists (
    select 1
    from public.messenger_conversation_members member
    where member.conversation_id = messenger_messages.conversation_id
      and member.user_id = public.current_messenger_user_id()
  )
);
