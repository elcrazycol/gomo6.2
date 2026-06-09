-- Clean messenger: Discord-quality DM system
-- Migration: 040_clean_messenger.sql
-- Replaces old 019/030/037 migrations with a clean, RLS-protected schema.

-- 1. Drop old tables (cascade everything)
DROP TABLE IF EXISTS chat_receipts CASCADE;
DROP TABLE IF EXISTS chat_messages CASCADE;
DROP TABLE IF EXISTS chat_conversation_members CASCADE;
DROP TABLE IF EXISTS chat_conversations CASCADE;
DROP TABLE IF EXISTS chat_user_keys CASCADE;

-- 2. Drop old triggers & functions
DROP FUNCTION IF EXISTS update_conversation_last_message() CASCADE;
DROP FUNCTION IF EXISTS update_unread_count() CASCADE;
DROP FUNCTION IF EXISTS get_or_create_direct_chat(UUID) CASCADE;
DROP FUNCTION IF EXISTS chat_mark_delivered(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS chat_mark_read(UUID, UUID) CASCADE;
DROP FUNCTION IF EXISTS chat_toggle_pin_message(UUID, UUID) CASCADE;

-- ═══════════════════════════════════════════════════════════════════════
-- NEW SCHEMA
-- ═══════════════════════════════════════════════════════════════════════

-- Conversations (1:1 direct messages for now, group-ready via members table)
CREATE TABLE chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    last_message_sender_id UUID REFERENCES users(id) ON DELETE SET NULL,
    pinned_message_id UUID  -- will FK to chat_messages after table creation
);

-- Conversation members
CREATE TABLE chat_members (
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_message_id UUID,
    unread_count INTEGER NOT NULL DEFAULT 0,
    is_muted BOOLEAN NOT NULL DEFAULT false,
    PRIMARY KEY (conversation_id, user_id)
);

-- Messages
CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_message_id UUID,  -- FK to chat_messages (reply/quote), added below
    content TEXT NOT NULL,
    is_edited BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    edited_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Idempotency: client-generated key to prevent duplicate sends
    client_id TEXT NOT NULL,
    CONSTRAINT unique_client_msg UNIQUE (conversation_id, client_id)
);

-- Add FK for pinned_message_id (circular reference resolved)
ALTER TABLE chat_conversations
    ADD CONSTRAINT fk_pinned_message
    FOREIGN KEY (pinned_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Add FK for parent_message_id (reply/quote)
ALTER TABLE chat_messages
    ADD CONSTRAINT fk_parent_message
    FOREIGN KEY (parent_message_id) REFERENCES chat_messages(id) ON DELETE SET NULL;

-- Read receipts (one per message, per user beyond the sender)
CREATE TABLE chat_receipts (
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════════════════

CREATE INDEX idx_chat_conversations_updated ON chat_conversations(updated_at DESC);
CREATE INDEX idx_chat_conversations_last_msg ON chat_conversations(last_message_at DESC NULLS LAST);
CREATE INDEX idx_chat_members_user ON chat_members(user_id);
CREATE INDEX idx_chat_messages_conv_time ON chat_messages(conversation_id, sent_at);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_user_id);
CREATE INDEX idx_chat_receipts_user ON chat_receipts(user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- TRIGGERS
-- ═══════════════════════════════════════════════════════════════════════

-- Update conversation last_message_* on new message
CREATE OR REPLACE FUNCTION trg_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE chat_conversations
    SET
        last_message_at = NEW.sent_at,
        last_message_sender_id = NEW.sender_user_id,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_conversation_last_message
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION trg_conversation_last_message();

-- Update conversation updated_at and preview when a message is edited
CREATE OR REPLACE FUNCTION trg_conversation_message_edited()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE chat_conversations
    SET updated_at = NOW()
    WHERE id = NEW.conversation_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_conversation_message_edited
AFTER UPDATE OF is_edited ON chat_messages
FOR EACH ROW
WHEN (NEW.is_edited = true)
EXECUTE FUNCTION trg_conversation_message_edited();

-- Increment unread count for other members on new message (skip sender)
CREATE OR REPLACE FUNCTION trg_increment_unread()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE chat_members
    SET unread_count = unread_count + 1
    WHERE conversation_id = NEW.conversation_id
      AND user_id != NEW.sender_user_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_increment_unread
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION trg_increment_unread();

-- ═══════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════

-- All policies use current_setting('app.current_user_id', true)::UUID
-- which is set by the Go server before each authenticated request.

-- chat_conversations: only members can see
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY conv_select ON chat_conversations
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY conv_insert ON chat_conversations
    FOR INSERT
    WITH CHECK (true);  -- created via RPC which adds members

CREATE POLICY conv_update ON chat_conversations
    FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- chat_members: only members of same conversation can see
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY members_select ON chat_members
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_members cm
            WHERE cm.conversation_id = conversation_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY members_insert ON chat_members
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = chat_members.conversation_id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
        OR NOT EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = chat_members.conversation_id
        )
    );

CREATE POLICY members_update ON chat_members
    FOR UPDATE
    USING (user_id = current_setting('app.current_user_id', true)::UUID);

-- chat_messages: only conversation members can read/write
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY msg_select ON chat_messages
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = chat_messages.conversation_id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY msg_insert ON chat_messages
    FOR INSERT
    WITH CHECK (
        sender_user_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM chat_members
            WHERE conversation_id = chat_messages.conversation_id
              AND user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY msg_update ON chat_messages
    FOR UPDATE
    USING (
        sender_user_id = current_setting('app.current_user_id', true)::UUID
    );

-- chat_receipts: only conversation members
ALTER TABLE chat_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY receipts_select ON chat_receipts
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM chat_messages m
            INNER JOIN chat_members cm ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

CREATE POLICY receipts_insert ON chat_receipts
    FOR INSERT
    WITH CHECK (
        user_id = current_setting('app.current_user_id', true)::UUID
        AND EXISTS (
            SELECT 1 FROM chat_messages m
            INNER JOIN chat_members cm ON cm.conversation_id = m.conversation_id
            WHERE m.id = message_id
              AND cm.user_id = current_setting('app.current_user_id', true)::UUID
        )
    );

-- ═══════════════════════════════════════════════════════════════════════
-- RPC FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════

-- Get or create direct chat between two users (1:1)
CREATE OR REPLACE FUNCTION rpc_get_or_create_direct_chat(p_other_user_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_my_id UUID;
    v_conv_id UUID;
BEGIN
    v_my_id := current_setting('app.current_user_id', true)::UUID;

    IF v_my_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_my_id = p_other_user_id THEN
        RAISE EXCEPTION 'Cannot chat with yourself';
    END IF;

    -- Find existing 1:1 conversation
    SELECT cm1.conversation_id INTO v_conv_id
    FROM chat_members cm1
    INNER JOIN chat_members cm2
        ON cm1.conversation_id = cm2.conversation_id
    INNER JOIN chat_conversations c
        ON c.id = cm1.conversation_id
    WHERE cm1.user_id = v_my_id
      AND cm2.user_id = p_other_user_id
    -- Only return 1:1 conversations (exactly 2 members)
      AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id = cm1.conversation_id) = 2
    LIMIT 1;

    IF v_conv_id IS NOT NULL THEN
        RETURN v_conv_id;
    END IF;

    -- Create new conversation + members in a transaction
    v_conv_id := gen_random_uuid();

    INSERT INTO chat_conversations (id) VALUES (v_conv_id);

    INSERT INTO chat_members (conversation_id, user_id)
    VALUES
        (v_conv_id, v_my_id),
        (v_conv_id, p_other_user_id);

    RETURN v_conv_id;
END;
$$;

-- Toggle pinned message
CREATE OR REPLACE FUNCTION rpc_toggle_pin_message(p_conversation_id UUID, p_message_id UUID)
RETURNS UUID  -- returns new pinned_message_id (or NULL if unpinned)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_my_id UUID;
    v_current UUID;
BEGIN
    v_my_id := current_setting('app.current_user_id', true)::UUID;

    -- Auth check
    IF NOT EXISTS (
        SELECT 1 FROM chat_members
        WHERE conversation_id = p_conversation_id AND user_id = v_my_id
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
