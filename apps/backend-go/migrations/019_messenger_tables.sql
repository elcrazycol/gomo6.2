-- Messenger tables with end-to-end encryption support
-- Migration: 019_messenger_tables.sql (adapted for standard PostgreSQL)

-- Table for storing user public keys for E2EE
CREATE TABLE IF NOT EXISTS chat_user_keys (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for conversations (direct chats)
CREATE TABLE IF NOT EXISTS chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_message_at TIMESTAMPTZ
);

-- Table for conversation members
CREATE TABLE IF NOT EXISTS chat_conversation_members (
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_read_at TIMESTAMPTZ,
    unread_count_cache INTEGER NOT NULL DEFAULT 0,
    archived_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);

-- Table for encrypted messages
CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_message_id TEXT NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- E2EE fields
    ciphertext TEXT NOT NULL,
    nonce TEXT NOT NULL,
    sender_public_key TEXT NOT NULL,
    recipient_public_key TEXT NOT NULL,
    -- Indexes
    UNIQUE(conversation_id, client_message_id)
);

-- Table for message delivery/read receipts
CREATE TABLE IF NOT EXISTS chat_receipts (
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated_at ON chat_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_members_user_id ON chat_conversation_members(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversation_members_updated_at ON chat_conversation_members(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation_id ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sent_at ON chat_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_chat_receipts_user_id ON chat_receipts(user_id);

-- Trigger to update conversation's last_message_at
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE chat_conversations
    SET
        last_message_at = NEW.sent_at,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_conversation_last_message ON chat_messages;
CREATE TRIGGER trigger_update_conversation_last_message
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_last_message();

-- Trigger to update unread count for recipient
CREATE OR REPLACE FUNCTION update_unread_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Increment unread count for all members except sender
    UPDATE chat_conversation_members
    SET
        unread_count_cache = unread_count_cache + 1,
        updated_at = NOW()
    WHERE conversation_id = NEW.conversation_id
        AND user_id != NEW.sender_user_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_unread_count ON chat_messages;
CREATE TRIGGER trigger_update_unread_count
AFTER INSERT ON chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_unread_count();
