-- Monotonic server-side cursor for messenger delta synchronization.
-- Existing rows are backfilled before the default is installed, so every API
-- response has a usable cursor after this migration completes.

CREATE SEQUENCE IF NOT EXISTS chat_messages_event_id_seq;

ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS event_id BIGINT;

SELECT setval(
    'chat_messages_event_id_seq',
    GREATEST(COALESCE((SELECT MAX(event_id) FROM chat_messages WHERE event_id IS NOT NULL), 1), 1),
    EXISTS (SELECT 1 FROM chat_messages WHERE event_id IS NOT NULL)
);

UPDATE chat_messages
SET event_id = nextval('chat_messages_event_id_seq')
WHERE event_id IS NULL;

ALTER TABLE chat_messages
    ALTER COLUMN event_id SET DEFAULT nextval('chat_messages_event_id_seq'),
    ALTER COLUMN event_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_event_id
    ON chat_messages (event_id);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_event_id
    ON chat_messages (conversation_id, event_id);
