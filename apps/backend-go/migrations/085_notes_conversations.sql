-- Personal "Заметки" (Notes) self-chat.
-- Migration: 085_notes_conversations.sql
--
-- The notes conversation is a 1:1-ish self-chat with exactly one member (the
-- owner). Unlike regular conversations, its message content is client-side
-- end-to-end encrypted: the client encrypts with a device-local AES-256-GCM
-- key, and the server stores the opaque ciphertext verbatim. The server never
-- holds the key and never attempts to decrypt notes content, so note plaintext
-- is never visible to the server (defense-in-depth beyond the at-rest AES-GCM
-- used for regular chats).

ALTER TABLE chat_conversations
    ADD COLUMN IF NOT EXISTS is_notes BOOLEAN NOT NULL DEFAULT false;

-- At most one notes conversation per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_notes_owner
    ON chat_conversations (created_by)
    WHERE is_notes = true;

CREATE OR REPLACE FUNCTION find_or_create_notes_conversation(p_user UUID)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_conv_id UUID;
BEGIN
    SELECT id INTO v_conv_id
    FROM chat_conversations
    WHERE is_notes = true AND created_by = p_user
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    INSERT INTO chat_conversations (is_notes, created_by, encryption_key_version)
    VALUES (true, p_user, 2)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_conv_id;

    IF v_conv_id IS NULL THEN
        SELECT id INTO v_conv_id
        FROM chat_conversations
        WHERE is_notes = true AND created_by = p_user
        LIMIT 1;
    END IF;

    INSERT INTO chat_members (conversation_id, user_id, role)
    VALUES (v_conv_id, p_user, 'admin')
    ON CONFLICT DO NOTHING;

    RETURN v_conv_id;
END;
$$;
