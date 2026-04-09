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

-- Function to toggle pin status of a wall post
CREATE OR REPLACE FUNCTION toggle_wall_post_pin(_post_id UUID, _user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    post_owner UUID;
    current_pinned BOOLEAN;
    new_pinned BOOLEAN;
    max_order INTEGER;
BEGIN
    -- Get the post owner and current pin status
    SELECT user_id, is_pinned INTO post_owner, current_pinned
    FROM profile_wall_posts
    WHERE id = _post_id;
    
    -- Check if post exists
    IF post_owner IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Only the wall owner can pin posts
    IF post_owner != _user_id THEN
        RETURN FALSE;
    END IF;
    
    -- Toggle the pin status
    new_pinned := NOT current_pinned;
    
    IF new_pinned THEN
        -- Get the highest pinned_order for this user
        SELECT COALESCE(MAX(pinned_order), 0) INTO max_order
        FROM profile_wall_posts
        WHERE user_id = _user_id AND is_pinned = TRUE;
        
        -- Update the post with new pin status and order
        UPDATE profile_wall_posts
        SET is_pinned = TRUE,
            pinned_order = max_order + 1,
            updated_at = NOW()
        WHERE id = _post_id;
    ELSE
        -- Unpin the post
        UPDATE profile_wall_posts
        SET is_pinned = FALSE,
            pinned_order = NULL,
            updated_at = NOW()
        WHERE id = _post_id;
    END IF;
    
    RETURN TRUE;
END;
$$;
