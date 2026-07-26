-- Force RLS on all messenger tables so even the table owner (gomo6) must comply.
-- Without FORCE, the table owner bypasses RLS policies.
-- This is defense-in-depth: the Go middleware also checks membership via isMember().

ALTER TABLE chat_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE message_attachments FORCE ROW LEVEL SECURITY;
ALTER TABLE e2e_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE e2e_one_time_pre_keys FORCE ROW LEVEL SECURITY;
