-- Nickname emoji: a custom emoji shown right next to the user's display name
-- everywhere their nickname appears (posts, threads, boards, chat, profile, ...).
--
-- The value is the id of a row in custom_emojis. When that emoji (or its pack)
-- is deleted, the reference is silently cleared so the profile never dangles.

ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_emoji_id UUID REFERENCES custom_emojis(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_nickname_emoji ON users(nickname_emoji_id);

-- Expose the column through the profiles view (kept in sync with users).
DROP VIEW IF EXISTS profiles;
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, display_name, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    drops, wallet_address,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    nickname_emoji_id,
    created_at, updated_at
FROM users;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
