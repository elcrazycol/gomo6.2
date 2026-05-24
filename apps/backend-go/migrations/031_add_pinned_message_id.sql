-- Add pinned_message_id to chat_conversations
-- Migration: 031_add_pinned_message_id.sql

ALTER TABLE chat_conversations
ADD COLUMN pinned_message_id UUID REFERENCES chat_messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chat_conversations_pinned_message_id
    ON chat_conversations(pinned_message_id)
    WHERE pinned_message_id IS NOT NULL;

-- RPC function to toggle pin status of a message in a conversation
CREATE OR REPLACE FUNCTION chat_toggle_pin_message(
    target_conversation_id UUID,
    target_message_id UUID
)
RETURNS UUID  -- returns the new pinned_message_id (null if unpinned)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_user_id UUID;
    v_new_pinned_id UUID;
BEGIN
    v_current_user_id := current_setting('app.current_user_id', true)::UUID;

    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Verify user is a member of this conversation
    IF NOT EXISTS (
        SELECT 1 FROM chat_conversation_members
        WHERE conversation_id = target_conversation_id
          AND user_id = v_current_user_id
    ) THEN
        RAISE EXCEPTION 'Not a member of this conversation';
    END IF;

    -- Verify message exists in this conversation
    IF NOT EXISTS (
        SELECT 1 FROM chat_messages
        WHERE id = target_message_id
          AND conversation_id = target_conversation_id
    ) THEN
        RAISE EXCEPTION 'Message not found in this conversation';
    END IF;

    -- Toggle: if same message is already pinned, unpin it; otherwise pin it
    IF EXISTS (
        SELECT 1 FROM chat_conversations
        WHERE id = target_conversation_id
          AND pinned_message_id = target_message_id
    ) THEN
        v_new_pinned_id := NULL;
    ELSE
        v_new_pinned_id := target_message_id;
    END IF;

    UPDATE chat_conversations
    SET pinned_message_id = v_new_pinned_id,
        updated_at = NOW()
    WHERE id = target_conversation_id;

    -- Bump updated_at for members so conversation list refreshes
    UPDATE chat_conversation_members
    SET updated_at = NOW()
    WHERE conversation_id = target_conversation_id;

    RETURN v_new_pinned_id;
END;
$$;
