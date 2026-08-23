-- 105_wall_pagination_keyset.sql
--
-- Composite indexes for the wall list's canonical sort (pinned first by
-- pinned_order, then newest unpinned by created_at).
--
-- The keyset pages in profile_wall.go run two index-friendly queries per user:
--   * pinned:   WHERE user_id = $1 AND is_pinned = true
--               ORDER BY pinned_order ASC, created_at DESC, id DESC
--   * unpinned: WHERE user_id = $1 AND is_pinned = false
--               AND (created_at, id) < (...) ORDER BY created_at DESC, id DESC
--
-- idx_profile_wall_posts_user_pinned_order covers the pinned branch, and
-- idx_profile_wall_posts_user_unpinned_keyset covers the unpinned branch
-- (leading user_id + is_pinned equality, then the created_at/id range).
-- Without them the planner sorts the whole per-user row set on every page.

CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_user_pinned_order
  ON profile_wall_posts (user_id, is_pinned, pinned_order, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_user_unpinned_keyset
  ON profile_wall_posts (user_id, is_pinned, created_at DESC, id);
