-- 115_achievement_level_images.sql
-- Per-level trophy artwork: a JSON map {"1": "/storage/.../a.png", "2": …} so a
-- single multi-level milestone can have a distinct trophy for each level.
-- `image_url` stays as the single/group image (awards, one-time milestones).
ALTER TABLE achievements ADD COLUMN IF NOT EXISTS level_images JSONB NOT NULL DEFAULT '{}'::jsonb;
