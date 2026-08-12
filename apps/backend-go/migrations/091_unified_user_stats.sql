-- 091_unified_user_stats.sql
-- Unified content statistics.
--
-- The profile previously counted only forum content: users.post_count (posts
-- inside threads) and users.thread_count. Posts, comments, likes and reposts
-- on profile walls were invisible to every counter, the garma formula and the
-- achievements. This migration adds the missing counters so the profile
-- reflects the unified content model the feed already uses:
--
--   Записи (posts)     = threads + profile_wall_posts (by author_id — a post
--                        written on someone else's wall counts for the AUTHOR)
--   Комментарии        = posts (inside threads) + profile_wall_post_comments
--   Лайки полученные   = post_likes + thread_likes + profile_wall_post_likes
--                        + profile_wall_comment_likes (content belongs to the
--                        author)
--   Лайки поставленные = the same four like tables by user_id

ALTER TABLE users ADD COLUMN IF NOT EXISTS wall_post_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS comment_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS likes_received_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS likes_given_count INTEGER DEFAULT 0;

-- Backfill the new counters for existing users so they are correct immediately,
-- not only after the user's next activity triggers RecomputeUserProfileStats.
UPDATE users u SET
  wall_post_count = s.wpc,
  comment_count = s.cc,
  likes_received_count = s.lrc,
  likes_given_count = s.lgc
FROM (
  SELECT
    u2.id,
    (SELECT COUNT(*)::int FROM profile_wall_posts w WHERE w.author_id = u2.id) AS wpc,
    (SELECT (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = u2.id)
          + (SELECT COUNT(*)::int FROM profile_wall_post_comments c WHERE c.user_id = u2.id)) AS cc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes pl JOIN posts po ON po.id = pl.post_id WHERE po.user_id = u2.id)
      + (SELECT COUNT(*)::int FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = u2.id)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes wl JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = u2.id)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = u2.id)
    ) AS lrc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes WHERE user_id = u2.id)
      + (SELECT COUNT(*)::int FROM thread_likes WHERE user_id = u2.id)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes WHERE user_id = u2.id)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes WHERE user_id = u2.id)
    ) AS lgc
  FROM users u2
) s
WHERE u.id = s.id;

-- The garma formula changed (wall activity now contributes, see
-- RecomputeUserProfileStats): recompute it for ALL users so existing garma
-- values reflect the new weights immediately, not only after the user's next
-- activity happens to trigger a recompute.
UPDATE users u SET garma = GREATEST(0, LEAST(2147483647, FLOOR(
  (SELECT COUNT(*)::numeric FROM posts p WHERE p.user_id = u.id) * 0.5 +
  (SELECT COUNT(*)::numeric FROM threads t WHERE t.user_id = u.id) * 4 +
  (SELECT COUNT(*)::numeric FROM profile_wall_posts wp WHERE wp.author_id = u.id) * 0.5 +
  (SELECT COUNT(*)::numeric FROM profile_wall_post_comments wc WHERE wc.user_id = u.id) * 0.5 +
  (SELECT COUNT(*)::numeric FROM post_likes pl JOIN posts po ON po.id = pl.post_id WHERE po.user_id = u.id) * 2 +
  (SELECT COUNT(*)::numeric FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = u.id) * 3 +
  (SELECT COUNT(*)::numeric FROM profile_wall_post_likes wl JOIN profile_wall_posts wpp ON wpp.id = wl.post_id WHERE wpp.author_id = u.id) * 2 +
  (SELECT COUNT(*)::numeric FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wcc ON wcc.id = cl.comment_id WHERE wcc.user_id = u.id) * 1 +
  (SELECT COUNT(*)::numeric FROM posts p2 JOIN threads th2 ON th2.id = p2.thread_id WHERE th2.user_id = u.id AND p2.user_id <> u.id) * 0.25 +
  COALESCE((SELECT FLOOR(SUM(total_minutes)::numeric / 30) FROM user_session_time st WHERE st.user_id = u.id), 0) +
  COALESCE((SELECT SUM(CAST(COALESCE(a.reward_value, '0') AS integer))
            FROM user_achievements ua JOIN achievements a ON a.id = ua.achievement_id
            WHERE ua.user_id = u.id AND a.reward_type = 'garma'), 0)
)::int));

-- Expose the new counters through the profiles view (kept in sync with users).
DROP VIEW IF EXISTS profiles;
CREATE OR REPLACE VIEW profiles AS
SELECT
    id, username, display_name, email, password_hash, domain,
    avatar_url, bio, bio_json, garma, post_count, thread_count,
    wall_post_count, comment_count, likes_received_count, likes_given_count,
    drops, wallet_address,
    is_remote, is_anonymous, is_online, last_seen_at, account_number,
    search_vector,
    nickname_emoji_id,
    created_at, updated_at
FROM users;

GRANT SELECT, INSERT, UPDATE, DELETE ON profiles TO gomo6;
