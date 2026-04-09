-- Lexical rich text JSON for forum threads and posts (same idea as profile_wall / bio_json)
ALTER TABLE threads ADD COLUMN IF NOT EXISTS content_json JSONB;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS content_json JSONB;
