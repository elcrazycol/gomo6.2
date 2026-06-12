-- Migration 044: GomoSub Roles & Channel Permissions
-- Adds custom roles with colors, hierarchy, and private channel access.

-- Custom roles per gomosub
CREATE TABLE IF NOT EXISTS gomosub_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL,
    color VARCHAR(7) DEFAULT '#99aab5',  -- hex color like #ff6b6b
    position INTEGER DEFAULT 0,          -- higher = more authority in UI
    permissions JSONB DEFAULT '{}'::jsonb, -- { can_manage_roles, can_manage_channels, can_manage_members, can_delete_threads, can_pin_threads }
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(board_id, name)
);

CREATE INDEX IF NOT EXISTS idx_gomosub_roles_board_id ON gomosub_roles(board_id);

-- Channel permissions: which roles can access private channels
CREATE TABLE IF NOT EXISTS channel_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES gomosub_roles(id) ON DELETE CASCADE,
    can_read BOOLEAN DEFAULT true,
    can_write BOOLEAN DEFAULT true,
    UNIQUE(channel_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_permissions_channel_id ON channel_permissions(channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_permissions_role_id ON channel_permissions(role_id);

-- Add is_private flag to channels (default false = public)
ALTER TABLE channels ADD COLUMN IF NOT EXISTS is_private BOOLEAN DEFAULT false;

-- Add role_id to memberships (NULL = default member, or references a custom role)
ALTER TABLE gomosub_memberships ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES gomosub_roles(id) ON DELETE SET NULL;
