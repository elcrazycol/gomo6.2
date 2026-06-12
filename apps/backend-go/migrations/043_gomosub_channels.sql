-- Migration 043: GomoSub Channels
-- Adds Discord-like text channels within gomosubs.

-- Channels table
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    slug VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(255),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(board_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_channels_board_id ON channels(board_id);
CREATE INDEX IF NOT EXISTS idx_channels_board_slug ON channels(board_id, slug);

-- Add channel_id to threads (NULL = thread belongs to the general feed, backward compatible)
ALTER TABLE threads ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES channels(id) ON DELETE SET NULL;

-- Partial index: only index non-null channel_ids for efficient filtering
CREATE INDEX IF NOT EXISTS idx_threads_channel_id ON threads(channel_id) WHERE channel_id IS NOT NULL;
