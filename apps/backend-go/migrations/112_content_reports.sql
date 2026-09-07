-- 112_content_reports.sql
--
-- Content moderation reports: one row per (post, reporter) — a user can file
-- at most one report per wall post (UNIQUE(post_id, reporter_id), enforced in
-- the app too via ON CONFLICT). Reports are soft-resolved (status = 'resolved')
-- when a moderator handles them without deleting the post, and cascade away
-- with the post (ON DELETE CASCADE) when the post is deleted by anyone.

CREATE TABLE IF NOT EXISTS content_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES profile_wall_posts(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL DEFAULT 'other'
        CHECK (category IN ('spam', 'abuse', 'hate', 'fraud', 'explicit', 'other')),
    reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 2000),
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (post_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_post_id ON content_reports(post_id);
-- Queue reads: only open reports, grouped by post, newest first.
CREATE INDEX IF NOT EXISTS idx_content_reports_status_created ON content_reports(status, created_at DESC);