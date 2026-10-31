-- Migration 147: GomoSub roles v2 (Discord-like foundation)
-- Adds @everyone system role, multi-role memberships, bans, timeouts,
-- channel categories and allow/deny channel overwrites. Fully additive and
-- idempotent: old single-role column (gomosub_memberships.role_id) and
-- can_read/can_write stay for compatibility and are backfilled, not dropped.

-- 1. System @everyone flag on roles (one per board, lowest authority).
ALTER TABLE gomosub_roles ADD COLUMN IF NOT EXISTS is_everyone BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_gomosub_roles_everyone_per_board
    ON gomosub_roles(board_id) WHERE is_everyone = TRUE;

-- Ensure every existing gomosub board has an @everyone role.
INSERT INTO gomosub_roles (board_id, name, color, position, permissions, is_everyone)
SELECT b.id, '@everyone', '#99aab5', 0, '{}'::jsonb, TRUE
FROM boards b
WHERE COALESCE(b.is_gomosub, FALSE) = TRUE
  AND NOT EXISTS (SELECT 1 FROM gomosub_roles r WHERE r.board_id = b.id AND r.is_everyone = TRUE)
ON CONFLICT (board_id, name) DO NOTHING;

-- 2. Multi-role memberships: a user can hold many roles per board.
CREATE TABLE IF NOT EXISTS gomosub_member_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES gomosub_roles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_gomosub_member_roles_board_user
    ON gomosub_member_roles(board_id, user_id);
CREATE INDEX IF NOT EXISTS idx_gomosub_member_roles_role
    ON gomosub_member_roles(role_id);

-- Backfill from the legacy single-role column.
INSERT INTO gomosub_member_roles (board_id, user_id, role_id)
SELECT board_id, user_id, role_id
FROM gomosub_memberships
WHERE role_id IS NOT NULL
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. Bans (kick = membership delete; ban = row here + membership delete).
CREATE TABLE IF NOT EXISTS gomosub_bans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(board_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gomosub_bans_board ON gomosub_bans(board_id);

-- 4. Timeouts (mute): member stays but cannot write until timestamp.
ALTER TABLE gomosub_memberships ADD COLUMN IF NOT EXISTS timed_out_until TIMESTAMP WITH TIME ZONE;

-- 5. Channel categories (Discord-like folders; channels.category stays as
-- legacy free text, category_id is the new structured link).
CREATE TABLE IF NOT EXISTS channel_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(board_id, name)
);
CREATE INDEX IF NOT EXISTS idx_channel_categories_board ON channel_categories(board_id);
ALTER TABLE channels ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES channel_categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_channels_category_id ON channels(category_id);

-- 6. Allow/deny overwrites per (channel, role). can_read/can_write stay as
-- the legacy compat columns; new code reads allow/deny first.
ALTER TABLE channel_permissions ADD COLUMN IF NOT EXISTS allow JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE channel_permissions ADD COLUMN IF NOT EXISTS deny JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill overwrites from legacy booleans (only where still empty).
UPDATE channel_permissions
SET allow = (COALESCE(allow, '{}'::jsonb)
    || CASE WHEN COALESCE(can_read, TRUE) THEN '{"view_channel": true}'::jsonb ELSE '{}'::jsonb END
    || CASE WHEN COALESCE(can_write, TRUE) THEN '{"send_messages": true}'::jsonb ELSE '{}'::jsonb END),
    deny = (COALESCE(deny, '{}'::jsonb)
    || CASE WHEN COALESCE(can_read, TRUE) THEN '{}'::jsonb ELSE '{"view_channel": true}'::jsonb END
    || CASE WHEN COALESCE(can_write, TRUE) THEN '{}'::jsonb ELSE '{"send_messages": true}'::jsonb END)
WHERE allow = '{}'::jsonb AND deny = '{}'::jsonb;
