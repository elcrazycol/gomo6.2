-- ─── GomoSub text channels (Discord-style chat) ─────────────────────────────
-- A gomosub channel can now be either 'forum' (records + comments, the classic
-- behavior) or 'text' (a live message stream, like a Discord channel inside a
-- server). Forum stays the default: every pre-existing channel is 'forum'.

ALTER TABLE channels
    ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'forum'
        CHECK (kind IN ('forum', 'text'));

CREATE TABLE IF NOT EXISTS channel_messages (
    id         BIGSERIAL PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content    TEXT NOT NULL,
    edited_at  TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Keyset pagination for history scrolling (cursor = last seen id, newest
-- first) plus cheap "latest N messages of a channel" loads.
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_id_desc
    ON channel_messages(channel_id, id DESC);
