-- 111_profile_albums.sql
--
-- Profile albums: named collections of wall posts (many-to-many). An album
-- belongs to exactly one user (the wall owner); any post on that user's wall
-- (own or written by others) can be added to any of their albums. Post order
-- inside an album is the add order (added_at DESC). Deleting an album or a
-- wall post cascades to the join rows.

CREATE TABLE IF NOT EXISTS profile_albums (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profile_albums_user_id ON profile_albums(user_id);

CREATE TABLE IF NOT EXISTS profile_album_posts (
    album_id UUID NOT NULL REFERENCES profile_albums(id) ON DELETE CASCADE,
    post_id UUID NOT NULL REFERENCES profile_wall_posts(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (album_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_profile_album_posts_album_id ON profile_album_posts(album_id);
CREATE INDEX IF NOT EXISTS idx_profile_album_posts_post_id ON profile_album_posts(post_id);
