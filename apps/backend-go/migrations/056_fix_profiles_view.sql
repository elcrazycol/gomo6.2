-- Fix profiles view to include display_name, drops, wallet_address
-- These columns were added to users but the view was never updated.
-- Uses CREATE OR REPLACE (no DROP) to preserve existing GRANTs.
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, display_name, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    drops, wallet_address,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    created_at, updated_at
FROM users;
