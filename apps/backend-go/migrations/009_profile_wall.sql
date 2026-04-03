-- Profile wall (posts, comments, likes, reposts)
CREATE TABLE IF NOT EXISTS profile_wall_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    content TEXT,
    content_json JSONB,
    image_url TEXT,
    attachments JSONB,
    repost_of_post_id UUID REFERENCES profile_wall_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_pinned BOOLEAN DEFAULT FALSE,
    pinned_order INTEGER
);

CREATE TABLE IF NOT EXISTS profile_wall_post_likes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES profile_wall_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id)
);

CREATE TABLE IF NOT EXISTS profile_wall_post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES profile_wall_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT,
    content_json JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profile_wall_post_reposts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES profile_wall_posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    wall_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reposted_wall_post_id UUID REFERENCES profile_wall_posts(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(post_id, user_id, wall_user_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_user_id ON profile_wall_posts(user_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_posts_author_id ON profile_wall_posts(author_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_post_likes_post_id ON profile_wall_post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_post_comments_post_id ON profile_wall_post_comments(post_id);
CREATE INDEX IF NOT EXISTS idx_profile_wall_post_reposts_post_id ON profile_wall_post_reposts(post_id);
