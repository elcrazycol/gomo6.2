ALTER TABLE profile_wall_post_comments
  ADD COLUMN IF NOT EXISTS parent_id UUID
  REFERENCES profile_wall_post_comments(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_profile_wall_post_comments_parent_id
  ON profile_wall_post_comments(parent_id);
