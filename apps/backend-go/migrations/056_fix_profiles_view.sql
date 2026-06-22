-- Fix profiles view to include display_name, drops, wallet_address
-- Must DROP first because PostgreSQL cannot rename columns via CREATE OR REPLACE VIEW
DROP VIEW IF EXISTS profiles;
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, display_name, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    drops, wallet_address,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    created_at, updated_at
FROM users;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
