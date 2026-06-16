-- Full-text search with PostgreSQL tsvector + GIN indexes
-- Uses GENERATED ALWAYS AS STORED columns — automatically updated on INSERT/UPDATE.

-- ── Users: search on username ──
ALTER TABLE users ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(username, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_users_search_vector ON users USING GIN (search_vector);

-- ── Boards: search on name + description ──
ALTER TABLE boards ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(name, '') || ' ' || coalesce(description, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_boards_search_vector ON boards USING GIN (search_vector);

-- ── Threads: search on title + content ──
ALTER TABLE threads ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_threads_search_vector ON threads USING GIN (search_vector);

-- ── Posts: search on content ──
ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('russian', coalesce(content, ''))) STORED;
CREATE INDEX IF NOT EXISTS idx_posts_search_vector ON posts USING GIN (search_vector);

-- ── Update profiles view to include search_vector ──
DROP VIEW IF EXISTS profiles;
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    created_at, updated_at
FROM users;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
