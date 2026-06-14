-- Add visibility column to boards (public/private)
ALTER TABLE boards ADD COLUMN IF NOT EXISTS visibility VARCHAR(10) NOT NULL DEFAULT 'public';
CREATE INDEX IF NOT EXISTS idx_boards_visibility ON boards(visibility);

-- Invite links for private gomosubs
CREATE TABLE IF NOT EXISTS gomosub_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    code VARCHAR(64) NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES users(id),
    max_uses INT DEFAULT 0,       -- 0 = unlimited
    current_uses INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP WITH TIME ZONE,  -- NULL = never expires
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_gomosub_invites_board_id ON gomosub_invites(board_id);
CREATE INDEX IF NOT EXISTS idx_gomosub_invites_code ON gomosub_invites(code);
