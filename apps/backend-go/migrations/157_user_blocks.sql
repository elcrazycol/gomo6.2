-- 157_user_blocks.sql
-- Phase 3: user-to-user blocking for the messenger (1:1 spam protection).
--
-- A row means "blocker_id does not want messages from blocked_id". The
-- messenger checks BOTH directions before creating a 1:1 chat or sending into
-- one, so a block is enforced regardless of who is writing.
--
-- Deliberately NOT RLS-protected: the table holds only opaque UUID pairs and
-- must be readable from the messenger request transaction (which runs with
-- app.current_user_id bound). The rows are never exposed through a read API —
-- a blocker learns nothing about the other side.

CREATE TABLE IF NOT EXISTS user_blocks (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- The reverse lookup ("who blocked me") is what a send must check, so it needs
-- its own index: the primary key only serves "who do I block".
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked
    ON user_blocks (blocked_id);
