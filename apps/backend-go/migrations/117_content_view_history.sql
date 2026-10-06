-- 117_content_view_history.sql
--
-- Per-user viewing history for content the viewer opened (threads and wall
-- posts). Private to its owner; powers the «История» page.
--
-- One row per (user, item): re-opening an item bumps viewed_at (upsert) so it
-- moves to the top instead of duplicating. item_id is polymorphic (threads or
-- profile_wall_posts), so it carries no foreign key — the handler validates
-- existence before inserting.

CREATE TABLE IF NOT EXISTS content_view_history (
    user_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type TEXT        NOT NULL CHECK (item_type IN ('thread', 'wall_post')),
    item_id   UUID        NOT NULL,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_content_view_history_user_viewed
    ON content_view_history(user_id, viewed_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON content_view_history TO gomo6;
