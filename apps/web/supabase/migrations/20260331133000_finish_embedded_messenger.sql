drop policy if exists "chat user keys readable" on public.chat_user_keys;
create policy "chat user keys readable"
on public.chat_user_keys
for select
using (auth.role() = 'authenticated');

create or replace function public.chat_mark_delivered(target_conversation_id uuid, target_message_id uuid default null)
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

  update public.chat_receipts receipts
  set
    delivered_at = coalesce(receipts.delivered_at, now()),
    updated_at = now()
  from public.chat_messages messages
  where receipts.message_id = messages.id
    and receipts.user_id = current_user_id
    and messages.conversation_id = target_conversation_id
    and messages.sent_at <= delivered_cutoff;
end;
$$;

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
