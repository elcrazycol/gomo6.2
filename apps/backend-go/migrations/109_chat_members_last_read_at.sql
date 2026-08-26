-- chat_members.last_read_at — the peer's "read line" shown in the conversation list.
--
-- PR #53 (feat/messenger-ui-polish) started selecting cm2.last_read_at in
-- GET /api/v1/messenger/conversations, but no migration ever added the column to
-- chat_members — it only exists on the legacy chat_conversation_members table.
-- Without it the query fails with "column cm2.last_read_at does not exist" and
-- every conversation-list load (messenger, notes included) returns HTTP 500.
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

-- Backfill from existing read receipts: the peer's read line is the latest
-- read_at they recorded on any message in the conversation. The compose stack
-- connects as a superuser (POSTGRES_USER), which bypasses FORCE RLS on
-- chat_members, so this UPDATE reaches every row.
UPDATE chat_members cm
SET last_read_at = sub.latest_read
FROM (
    SELECT r.user_id, m.conversation_id, MAX(r.read_at) AS latest_read
    FROM chat_receipts r
    INNER JOIN chat_messages m ON m.id = r.message_id
    WHERE r.read_at IS NOT NULL
    GROUP BY r.user_id, m.conversation_id
) sub
WHERE cm.conversation_id = sub.conversation_id
  AND cm.user_id = sub.user_id
  AND cm.last_read_at IS NULL;
