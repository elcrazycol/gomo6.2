-- Messenger attachments: images, files, voice messages
-- Migration: 062_messenger_attachments.sql

CREATE TABLE message_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    type VARCHAR(20) NOT NULL,  -- image, video, audio, file
    name TEXT NOT NULL,
    size BIGINT NOT NULL,
    mime VARCHAR(100) NOT NULL,
    meta JSONB,  -- poster, duration, coverArt, etc.
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attachments_message ON message_attachments(message_id);

-- RLS
ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY att_select ON message_attachments FOR SELECT USING (
    EXISTS (
        SELECT 1 FROM chat_messages m
        JOIN chat_members cm ON cm.conversation_id = m.conversation_id
        WHERE m.id = message_id
          AND cm.user_id = current_setting('app.current_user_id', true)::UUID
    )
);

CREATE POLICY att_insert ON message_attachments FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM chat_messages m
        JOIN chat_members cm ON cm.conversation_id = m.conversation_id
        WHERE m.id = message_id
          AND cm.user_id = current_setting('app.current_user_id', true)::UUID
    )
);
