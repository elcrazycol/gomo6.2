-- Migration 151: GomoSub audit log.
-- Every moderation and structural change is recorded (who did what to whom,
-- with an optional reason) so servers are auditable like Discord's audit log.
-- Written best-effort on every path: moderation RPC (kick/ban/unban/timeout)
-- and role/channel/category/overwrite management writes.

CREATE TABLE IF NOT EXISTS gomosub_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_role_id UUID REFERENCES gomosub_roles(id) ON DELETE SET NULL,
    target_channel_id UUID REFERENCES channels(id) ON DELETE SET NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gomosub_audit_board_time
    ON gomosub_audit_log(board_id, created_at DESC);
