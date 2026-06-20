-- Messenger reliability: conversation uniqueness + cleanup trigger
-- Migration: 054_messenger_reliability.sql

-- 1. Add sorted pair columns for uniqueness constraint
ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS user2_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- 2. Backfill from chat_members (sorted: smaller UUID first)
UPDATE chat_conversations c
SET user1_id = sub.u1, user2_id = sub.u2
FROM (
    SELECT conversation_id,
           MIN(user_id::text)::uuid AS u1,
           MAX(user_id::text)::uuid AS u2
    FROM chat_members
    GROUP BY conversation_id
    HAVING COUNT(*) = 2
) sub
WHERE c.id = sub.conversation_id;

-- 3. Unique index: at most 1 conversation per pair (partial: only 2-member convos)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_conversation_pair
    ON chat_conversations (user1_id, user2_id)
    WHERE user1_id IS NOT NULL AND user2_id IS NOT NULL;

-- 4. Atomic find-or-create function
CREATE OR REPLACE FUNCTION find_or_create_conversation(p_user1 UUID, p_user2 UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_user1 UUID := LEAST(p_user1, p_user2);
    v_user2 UUID := GREATEST(p_user1, p_user2);
    v_conv_id UUID;
BEGIN
    -- Try to find existing 1:1 conversation
    SELECT id INTO v_conv_id
    FROM chat_conversations
    WHERE user1_id = v_user1 AND user2_id = v_user2;

    IF FOUND THEN
        RETURN v_conv_id;
    END IF;

    -- Create new conversation (ON CONFLICT handles race)
    INSERT INTO chat_conversations (user1_id, user2_id)
    VALUES (v_user1, v_user2)
    ON CONFLICT (user1_id, user2_id) WHERE user1_id IS NOT NULL AND user2_id IS NOT NULL
    DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
        -- Race: concurrent insert won — find the winner's conversation
        SELECT id INTO v_conv_id
        FROM chat_conversations
        WHERE user1_id = v_user1 AND user2_id = v_user2;
    END IF;

    -- Add members (ignore duplicate if race)
    INSERT INTO chat_members (conversation_id, user_id)
    VALUES (v_conv_id, p_user1), (v_conv_id, p_user2)
    ON CONFLICT DO NOTHING;

    RETURN v_conv_id;
END;
$$;

-- 5. Cleanup trigger: delete conversation when last member leaves
CREATE OR REPLACE FUNCTION trg_cleanup_empty_conversation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM chat_members WHERE conversation_id = OLD.conversation_id
    ) THEN
        DELETE FROM chat_conversations WHERE id = OLD.conversation_id;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_empty_conversation ON chat_members;
CREATE TRIGGER trg_cleanup_empty_conversation
    AFTER DELETE ON chat_members
    FOR EACH ROW
    EXECUTE FUNCTION trg_cleanup_empty_conversation();

-- 6. Clean up existing orphaned conversations (no members)
DELETE FROM chat_conversations c
WHERE NOT EXISTS (
    SELECT 1 FROM chat_members WHERE conversation_id = c.id
);

-- 7. Null out existing plaintext previews (will be encrypted going forward)
UPDATE chat_conversations
SET last_message_preview = NULL
WHERE last_message_preview IS NOT NULL
  AND length(last_message_preview) > 0
  AND last_message_preview !~ '^[A-Za-z0-9+/=]{20,}';
