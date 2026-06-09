-- Migration 041: Fix messenger RPC functions — pass user_id as parameter
-- instead of reading from current_setting('app.current_user_id')
-- which was never set by the Go middleware.

-- Replace rpc_get_or_create_direct_chat to accept p_my_id as parameter
DROP FUNCTION IF EXISTS rpc_get_or_create_direct_chat(UUID);
CREATE OR REPLACE FUNCTION rpc_get_or_create_direct_chat(p_my_id UUID, p_other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_conv_id UUID;
BEGIN
    IF p_my_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF p_my_id = p_other_user_id THEN
        RAISE EXCEPTION 'Cannot chat with yourself';
    END IF;

    -- Find existing 1:1 conversation
    SELECT cm1.conversation_id INTO v_conv_id
    FROM chat_members cm1
    INNER JOIN chat_members cm2
        ON cm1.conversation_id = cm2.conversation_id
    INNER JOIN chat_conversations c
        ON c.id = cm1.conversation_id
    WHERE cm1.user_id = p_my_id
      AND cm2.user_id = p_other_user_id
      AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id = cm1.conversation_id) = 2
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    -- Create new conversation + members
    v_conv_id := gen_random_uuid();

    INSERT INTO chat_conversations (id) VALUES (v_conv_id);

    INSERT INTO chat_members (conversation_id, user_id)
    VALUES
        (v_conv_id, p_my_id),
        (v_conv_id, p_other_user_id);

    RETURN v_conv_id;
END;
$$;

-- Replace rpc_toggle_pin_message to accept p_my_id as parameter
DROP FUNCTION IF EXISTS rpc_toggle_pin_message(UUID, UUID);
CREATE OR REPLACE FUNCTION rpc_toggle_pin_message(p_my_id UUID, p_conversation_id UUID, p_message_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_current UUID;
BEGIN
    -- Auth check
    IF NOT EXISTS (
        SELECT 1 FROM chat_members
        WHERE conversation_id = p_conversation_id AND user_id = p_my_id
    ) THEN
        RAISE EXCEPTION 'Not a member of this conversation';
    END IF;

    SELECT pinned_message_id INTO v_current
    FROM chat_conversations
    WHERE id = p_conversation_id;

    IF v_current = p_message_id THEN
        -- Unpin
        UPDATE chat_conversations SET pinned_message_id = NULL WHERE id = p_conversation_id;
        RETURN NULL;
    ELSE
        -- Pin
        UPDATE chat_conversations SET pinned_message_id = p_message_id WHERE id = p_conversation_id;
        RETURN p_message_id;
    END IF;
END;
$$;
