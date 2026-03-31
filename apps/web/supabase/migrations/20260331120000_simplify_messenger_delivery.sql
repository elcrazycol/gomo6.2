alter table public.chat_messages
  add column if not exists body text not null default '';
