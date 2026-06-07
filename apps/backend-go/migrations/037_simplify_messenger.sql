-- Simplify messenger: remove E2E encryption, replace with server-side AES-GCM
-- Migration: 037_simplify_messenger.sql

-- 1. Drop RLS policies (defense-in-depth no longer needed with simplified chat)
DROP POLICY IF EXISTS chat_user_keys_select ON chat_user_keys;
DROP POLICY IF EXISTS chat_user_keys_insert ON chat_user_keys;
DROP POLICY IF EXISTS chat_user_keys_update ON chat_user_keys;
DROP POLICY IF EXISTS chat_user_keys_delete ON chat_user_keys;
DROP POLICY IF EXISTS chat_conversations_select ON chat_conversations;
DROP POLICY IF EXISTS chat_conversation_members_select ON chat_conversation_members;
DROP POLICY IF EXISTS chat_messages_select ON chat_messages;
DROP POLICY IF EXISTS chat_messages_insert ON chat_messages;
DROP POLICY IF EXISTS chat_receipts_select ON chat_receipts;
DROP POLICY IF EXISTS chat_receipts_insert ON chat_receipts;

ALTER TABLE chat_user_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversation_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_receipts DISABLE ROW LEVEL SECURITY;

-- 2. Drop E2E crypto columns from chat_messages, add server-side encrypted content
ALTER TABLE chat_messages
  DROP COLUMN IF EXISTS ciphertext,
  DROP COLUMN IF EXISTS nonce,
  DROP COLUMN IF EXISTS sender_public_key,
  DROP COLUMN IF EXISTS recipient_public_key,
  ADD COLUMN IF NOT EXISTS content_encrypted TEXT;

-- 3. Drop chat_user_keys table (no longer needed)
DROP TABLE IF EXISTS chat_user_keys CASCADE;

-- 4. Drop unused RPC functions (replaced by Go handlers)
DROP FUNCTION IF EXISTS get_or_create_direct_chat(UUID);
DROP FUNCTION IF EXISTS chat_mark_delivered(UUID, UUID);
DROP FUNCTION IF EXISTS chat_mark_read(UUID, UUID);

-- 5. Keep chat_toggle_pin_message - it's useful and simple
-- (defined in migration 031, remains untouched)
