-- Retire the old client-side encryption schema from deployed databases.
-- Historical migrations remain immutable; this forward migration removes only
-- objects that are no longer used by the server-encrypted messenger.

-- Remove the old overload first. The active function is rebuilt below using
-- the current chat_members-backed schema and the existing pair columns.
DROP FUNCTION IF EXISTS find_or_create_conversation(UUID, UUID, BOOLEAN);

-- Remove legacy-mode conversations before dropping the mode column. This
-- intentionally discards only the retired client-side-encrypted conversations;
-- regular server-encrypted conversations remain intact. The migration runner
-- uses the database owner, but FORCE RLS must still be handled explicitly so
-- cleanup cannot silently leave legacy rows behind.
ALTER TABLE chat_conversations DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_receipts DISABLE ROW LEVEL SECURITY;
DELETE FROM chat_conversations WHERE is_e2e = true;
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
ALTER TABLE chat_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_receipts FORCE ROW LEVEL SECURITY;

-- These indexes reference the legacy mode column and must be removed before
-- that column is dropped.
DROP INDEX IF EXISTS idx_conv_pair_regular;
DROP INDEX IF EXISTS idx_conv_pair_e2e;
DROP INDEX IF EXISTS idx_conversations_e2e;
DROP INDEX IF EXISTS idx_chat_conversations_e2e;
DROP INDEX IF EXISTS idx_opk_available;

CREATE OR REPLACE FUNCTION find_or_create_conversation(p_user1 UUID, p_user2 UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_user1 UUID := LEAST(p_user1, p_user2);
    v_user2 UUID := GREATEST(p_user1, p_user2);
    v_conv_id UUID;
BEGIN
    SELECT id INTO v_conv_id
    FROM chat_conversations
    WHERE user1_id = v_user1 AND user2_id = v_user2
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    INSERT INTO chat_conversations (user1_id, user2_id, encryption_key_version)
    VALUES (v_user1, v_user2, 2)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
        SELECT id INTO v_conv_id
        FROM chat_conversations
        WHERE user1_id = v_user1 AND user2_id = v_user2
        LIMIT 1;
    END IF;

    INSERT INTO chat_members (conversation_id, user_id)
    VALUES (v_conv_id, p_user1), (v_conv_id, p_user2)
    ON CONFLICT DO NOTHING;

    RETURN v_conv_id;
END;
$$;

-- Keep the pair columns: they are part of the server-side uniqueness and
-- lookup path, not client-side cryptographic state.
ALTER TABLE chat_messages
    DROP COLUMN IF EXISTS ciphertexts,
    DROP COLUMN IF EXISTS sender_device_id;

ALTER TABLE chat_conversations
    DROP COLUMN IF EXISTS is_e2e;

-- Restore the server-side uniqueness guarantee after the mode-specific indexes
-- have been removed. The pair columns are populated for regular 1:1 chats by
-- the existing 054/065 migrations.
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair
    ON chat_conversations (user1_id, user2_id)
    WHERE user1_id IS NOT NULL AND user2_id IS NOT NULL;

DROP TABLE IF EXISTS e2e_one_time_pre_keys CASCADE;
DROP TABLE IF EXISTS e2e_devices CASCADE;
DROP TABLE IF EXISTS chat_user_keys CASCADE;
