-- 118_content_favorites.sql
--
-- Per-user bookmarks («Избранное») for threads and wall posts. Private to the
-- owner. One row per (user, item); item_id is polymorphic (threads or
-- profile_wall_posts), so it carries no foreign key — the handler validates
-- existence before inserting.

CREATE TABLE IF NOT EXISTS content_favorites (
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_type  TEXT        NOT NULL CHECK (item_type IN ('thread', 'wall_post')),
    item_id    UUID        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_content_favorites_user_created
    ON content_favorites(user_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON content_favorites TO gomo6;
