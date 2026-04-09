-- Messenger RPC functions
-- Migration: 020_messenger_rpc_functions.sql

-- Function to get or create a direct chat conversation
CREATE OR REPLACE FUNCTION get_or_create_direct_chat(target_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_conversation_id UUID;
    v_current_user_id UUID;
BEGIN
    -- Get current user from auth context (this would be set by your auth middleware)
    -- For now, we'll assume it's passed via application context
    v_current_user_id := current_setting('app.current_user_id', true)::UUID;

    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_current_user_id = target_user_id THEN
        RAISE EXCEPTION 'Cannot create conversation with yourself';
    END IF;

    -- Try to find existing conversation
    SELECT cm1.conversation_id INTO v_conversation_id
    FROM chat_conversation_members cm1
    INNER JOIN chat_conversation_members cm2
        ON cm1.conversation_id = cm2.conversation_id
    WHERE cm1.user_id = v_current_user_id
        AND cm2.user_id = target_user_id
        AND cm1.archived_at IS NULL
        AND cm2.archived_at IS NULL
    LIMIT 1;

    IF v_conversation_id IS NOT NULL THEN
        RETURN v_conversation_id;
    END IF;

    -- Create new conversation
    v_conversation_id := gen_random_uuid();

    INSERT INTO chat_conversations (id, created_at, updated_at)
    VALUES (v_conversation_id, NOW(), NOW());

    INSERT INTO chat_conversation_members (conversation_id, user_id, joined_at, updated_at)
    VALUES
        (v_conversation_id, v_current_user_id, NOW(), NOW()),
        (v_conversation_id, target_user_id, NOW(), NOW());

    RETURN v_conversation_id;
END;
$$;

-- Function to mark messages as delivered
CREATE OR REPLACE FUNCTION chat_mark_delivered(
    target_conversation_id UUID,
    target_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_user_id UUID;
    v_sent_at TIMESTAMPTZ;
BEGIN
    v_current_user_id := current_setting('app.current_user_id', true)::UUID;

    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Get message sent_at timestamp
    SELECT sent_at INTO v_sent_at
    FROM chat_messages
    WHERE id = target_message_id;

    IF v_sent_at IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    -- Mark all messages up to this one as delivered
    INSERT INTO chat_receipts (message_id, user_id, delivered_at)
    SELECT m.id, v_current_user_id, NOW()
    FROM chat_messages m
    WHERE m.conversation_id = target_conversation_id
        AND m.sender_user_id != v_current_user_id
        AND m.sent_at <= v_sent_at
    ON CONFLICT (message_id, user_id)
    DO UPDATE SET delivered_at = COALESCE(chat_receipts.delivered_at, NOW());
END;
$$;

-- Function to mark messages as read
CREATE OR REPLACE FUNCTION chat_mark_read(
    target_conversation_id UUID,
    target_message_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_user_id UUID;
    v_sent_at TIMESTAMPTZ;
BEGIN
    v_current_user_id := current_setting('app.current_user_id', true)::UUID;

    IF v_current_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Get message sent_at timestamp
    SELECT sent_at INTO v_sent_at
    FROM chat_messages
    WHERE id = target_message_id;

    IF v_sent_at IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    -- Mark all messages up to this one as read and delivered
    INSERT INTO chat_receipts (message_id, user_id, delivered_at, read_at)
    SELECT m.id, v_current_user_id, NOW(), NOW()
    FROM chat_messages m
    WHERE m.conversation_id = target_conversation_id
        AND m.sender_user_id != v_current_user_id
        AND m.sent_at <= v_sent_at
    ON CONFLICT (message_id, user_id)
    DO UPDATE SET
        delivered_at = COALESCE(chat_receipts.delivered_at, NOW()),
        read_at = NOW();

    -- Update last_read_at and reset unread count
    UPDATE chat_conversation_members
    SET
        last_read_at = v_sent_at,
        unread_count_cache = 0,
        updated_at = NOW()
    WHERE conversation_id = target_conversation_id
        AND user_id = v_current_user_id;
END;
$$;
