-- 155_messenger_protocol_v2.sql
-- Phase 1: Typed message envelope, monotonic event_id on edit/delete,
-- and lightweight delivery cursor on chat_members.

-- 1. Typed message envelope columns
ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'text',
    ADD COLUMN IF NOT EXISTS payload JSONB;

-- 2. Delivery line on chat_members (mirrors last_read_at from 109)
ALTER TABLE chat_members
    ADD COLUMN IF NOT EXISTS last_delivered_at TIMESTAMPTZ;

-- Backfill last_delivered_at from existing chat_receipts where present
UPDATE chat_members cm
SET last_delivered_at = sub.latest_delivered
FROM (
    SELECT r.user_id, m.conversation_id, MAX(r.delivered_at) AS latest_delivered
    FROM chat_receipts r
    INNER JOIN chat_messages m ON m.id = r.message_id
    WHERE r.delivered_at IS NOT NULL
    GROUP BY r.user_id, m.conversation_id
) sub
WHERE cm.conversation_id = sub.conversation_id
  AND cm.user_id = sub.user_id
  AND cm.last_delivered_at IS NULL;

-- 3. Composite index for deterministic keyset backward pagination
CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_time_id
    ON chat_messages (conversation_id, sent_at DESC, id DESC);
