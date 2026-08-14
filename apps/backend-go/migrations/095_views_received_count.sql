-- 095: total unique views received by the author across their wall posts.
-- The number is maintained by RecomputeUserProfileStats from
-- profile_wall_post_views (each row is one unique viewer per post), the same
-- way likes_received_count is computed from the likes tables.
ALTER TABLE users ADD COLUMN IF NOT EXISTS views_received_count INTEGER NOT NULL DEFAULT 0;
