CREATE TABLE IF NOT EXISTS profile_wall_comment_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES profile_wall_post_comments(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_wall_comment_likes_comment_id
  ON profile_wall_comment_likes(comment_id);
