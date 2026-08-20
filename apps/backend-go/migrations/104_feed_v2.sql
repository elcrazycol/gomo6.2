-- 104_feed_v2.sql
--
-- Feed v2: "reverse chronology + light personalization".
--
-- Problem with v1 (089/090/094): items were ordered by a weighted score where
-- the freshness term (4/(age+2)^1.5) decayed so fast that an old post from a
-- friend (social +4) or an old viral post (100 likes ~ +9) outranked a brand
-- new post from a stranger (~1.4). Result: "new posts appear somewhere", not
-- at the top.
--
-- v2 reorders by a single sort key:
--
--   sort_key = EXTRACT(EPOCH FROM created_at) + boost_seconds
--
-- where boost_seconds is capped at 4 hours and sums:
--   * friend author             +2h
--   * author you've liked       +1h
--   * author shares a gsub      +30m
--   * each matching tag         +15m (capped 1h)
--   * engagement popularity     up to +4h  (ln-scaled likes/comments/reposts/views)
--
-- Because the boost is bounded, freshness still dominates: anything older than
-- ~4h can never jump above brand-new content, but within the recent window a
-- friend's or popular post is nudged up ("light personalization"), and when
-- there is no fresh content the most popular recent items float to the top
-- ("popularity fallback" for cold start). No ML required — pure heuristics
-- from existing interaction tables.
--
-- Pagination changed from OFFSET (which drifted as the score changed, causing
-- dupes/skips) to a keyset cursor over (score, item_id), plus a `since`
-- timestamp cursor to fetch only newer items for the pull-to-refresh "new
-- posts" pill.
--
-- CREATE OR REPLACE cannot change the signature, so DROP + CREATE.

DROP FUNCTION IF EXISTS get_user_feed(UUID, INT, INT);

CREATE FUNCTION get_user_feed(
  user_uuid UUID DEFAULT NULL,
  limit_count INT DEFAULT 20,
  since_ts TIMESTAMPTZ DEFAULT NULL,
  before_sort DOUBLE PRECISION DEFAULT NULL,
  before_id UUID DEFAULT NULL
)
RETURNS TABLE (
  item_type TEXT,
  item_id UUID,
  score DOUBLE PRECISION,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  title TEXT,
  content TEXT,
  content_json JSONB,
  image_url TEXT,
  image_urls JSONB,
  attachments JSONB,
  tags JSONB,
  post_count INTEGER,
  author_id UUID,
  author_username TEXT,
  author_display_name TEXT,
  author_nickname_emoji_id UUID,
  author_is_anonymous BOOLEAN,
  author_avatar_url TEXT,
  board_id UUID,
  board_slug TEXT,
  board_name TEXT,
  board_is_gomosub BOOLEAN,
  wall_user_id UUID,
  likes_count BIGINT,
  comments_count BIGINT,
  reposts_count BIGINT,
  liked_by_viewer BOOLEAN,
  views_count BIGINT
)
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN QUERY
  WITH
  -- Tag values the user has engaged with (liked threads, own posts' threads,
  -- subscribed threads) — flat values of the {key: value} tags JSONB.
  interest_tags AS (
    SELECT DISTINCT kv.value AS tag
    FROM (
      SELECT t_engaged.tags FROM thread_likes tl_engaged
        JOIN threads t_engaged ON t_engaged.id = tl_engaged.thread_id
        WHERE tl_engaged.user_id = user_uuid
      UNION ALL
      SELECT t_engaged2.tags FROM posts p_engaged
        JOIN threads t_engaged2 ON t_engaged2.id = p_engaged.thread_id
        WHERE p_engaged.user_id = user_uuid
      UNION ALL
      SELECT t_engaged3.tags FROM thread_subscriptions ts_engaged
        JOIN threads t_engaged3 ON t_engaged3.id = ts_engaged.thread_id
        WHERE ts_engaged.user_id = user_uuid
    ) engaged
    CROSS JOIN LATERAL (
      SELECT kv.key, kv.value
      FROM jsonb_each_text(
        CASE WHEN jsonb_typeof(engaged.tags) = 'object' THEN engaged.tags ELSE '{}'::jsonb END
      ) kv
    ) kv
    WHERE kv.value IS NOT NULL AND kv.value <> ''
  ),
  -- Tags of the gsubs the user belongs to (board-level interests).
  interest_gsub_tags AS (
    SELECT DISTINCT elem.tag AS tag
    FROM gomosub_memberships gm_tags
    JOIN boards b_tags ON b_tags.id = gm_tags.board_id
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE WHEN jsonb_typeof(b_tags.gomosub_tags) = 'array' THEN b_tags.gomosub_tags ELSE '[]'::jsonb END
    ) elem(tag)
    WHERE gm_tags.user_id = user_uuid
  ),
  friend_ids AS (
    SELECT CASE WHEN f.user1_id = user_uuid THEN f.user2_id ELSE f.user1_id END AS fid
    FROM friendships f
    WHERE f.user1_id = user_uuid OR f.user2_id = user_uuid
  ),
  -- Authors whose content the user has liked (thread or wall post).
  liked_author_ids AS (
    SELECT t_auth.user_id AS aid
    FROM thread_likes tl_auth JOIN threads t_auth ON t_auth.id = tl_auth.thread_id
    WHERE tl_auth.user_id = user_uuid AND t_auth.user_id IS NOT NULL
    UNION
    SELECT p_auth.author_id AS aid
    FROM profile_wall_post_likes wl_auth JOIN profile_wall_posts p_auth ON p_auth.id = wl_auth.post_id
    WHERE wl_auth.user_id = user_uuid AND p_auth.author_id IS NOT NULL
  ),
  member_board_ids AS (
    SELECT gm_board.board_id AS bid
    FROM gomosub_memberships gm_board
    WHERE gm_board.user_id = user_uuid
  ),
  -- Authors that share at least one gsub with the user.
  shared_gsub_author_ids AS (
    SELECT DISTINCT gm2.user_id AS aid
    FROM gomosub_memberships gm1
    JOIN gomosub_memberships gm2 ON gm2.board_id = gm1.board_id AND gm2.user_id <> user_uuid
    WHERE gm1.user_id = user_uuid
  ),
  items AS (
    -- ── Threads (boards + gsubs) ─────────────────────────────────────────────
    SELECT
      'thread'::TEXT AS item_type,
      t.id AS item_id,
      t.created_at,
      t.updated_at,
      t.title::TEXT AS title,
      t.content::TEXT AS content,
      t.content_json,
      t.image_url,
      t.image_urls,
      t.attachments,
      t.tags,
      t.post_count,
      t.user_id AS author_id,
      u.username::TEXT AS author_username,
      u.display_name::TEXT AS author_display_name,
      u.nickname_emoji_id AS author_nickname_emoji_id,
      COALESCE(u.is_anonymous, FALSE) AS author_is_anonymous,
      u.avatar_url AS author_avatar_url,
      t.board_id,
      b.slug::TEXT AS board_slug,
      b.name::TEXT AS board_name,
      b.is_gomosub AS board_is_gomosub,
      NULL::UUID AS wall_user_id,
      (SELECT COUNT(*)::BIGINT FROM thread_likes tl WHERE tl.thread_id = t.id) AS likes_count,
      t.post_count::BIGINT AS comments_count,
      0::BIGINT AS reposts_count,
      EXISTS(SELECT 1 FROM thread_likes tl WHERE tl.thread_id = t.id AND tl.user_id = user_uuid) AS liked_by_viewer,
      0::BIGINT AS views_count,
      -- Personalization boost components (threads).
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = t.user_id) THEN 7200.0 ELSE 0.0 END) AS friend_boost,
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = t.user_id) THEN 3600.0 ELSE 0.0 END) AS liked_author_boost,
      (CASE WHEN t.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = t.user_id) THEN 1800.0 ELSE 0.0 END) AS shared_gsub_boost,
      LEAST(3600.0, 900.0 * (
        SELECT COUNT(*)::DOUBLE PRECISION
        FROM jsonb_each_text(CASE WHEN jsonb_typeof(t.tags) = 'object' THEN t.tags ELSE '{}'::jsonb END) kv_tags
        WHERE kv_tags.value IN (SELECT it.tag FROM interest_tags it)
           OR kv_tags.value IN (SELECT ig.tag FROM interest_gsub_tags ig)
      )) AS tag_boost
    FROM threads t
    JOIN boards b ON b.id = t.board_id
    LEFT JOIN users u ON u.id = t.user_id
    WHERE t.channel_id IS NULL
      AND NOT COALESCE(b.is_rules_board, FALSE)
      -- board visibility: public, own private board, or member of the gsub.
      AND (COALESCE(b.visibility, 'public') <> 'private'
           OR b.owner_id = user_uuid
           OR (user_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id = user_uuid)))

    UNION ALL

    -- ── Profile wall posts ───────────────────────────────────────────────────
    SELECT
      'wall_post'::TEXT AS item_type,
      p.id AS item_id,
      p.created_at,
      p.updated_at,
      p.title::TEXT AS title,
      p.content::TEXT AS content,
      p.content_json,
      p.image_url,
      NULL::JSONB AS image_urls,
      p.attachments,
      NULL::JSONB AS tags,
      NULL::INTEGER AS post_count,
      p.author_id,
      u.username::TEXT AS author_username,
      u.display_name::TEXT AS author_display_name,
      u.nickname_emoji_id AS author_nickname_emoji_id,
      COALESCE(u.is_anonymous, FALSE) AS author_is_anonymous,
      u.avatar_url AS author_avatar_url,
      NULL::UUID AS board_id,
      NULL::TEXT AS board_slug,
      NULL::TEXT AS board_name,
      FALSE AS board_is_gomosub,
      p.user_id AS wall_user_id,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_likes l WHERE l.post_id = p.id) AS likes_count,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_comments c WHERE c.post_id = p.id) AS comments_count,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_reposts r WHERE r.post_id = p.id) AS reposts_count,
      EXISTS(SELECT 1 FROM profile_wall_post_likes l WHERE l.post_id = p.id AND l.user_id = user_uuid) AS liked_by_viewer,
      (SELECT COUNT(*)::BIGINT FROM profile_wall_post_views v WHERE v.post_id = p.id) AS views_count,
      -- Personalization boost components (wall posts).
      (CASE WHEN (p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.author_id))
              OR (p.user_id IS NOT NULL AND EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.user_id))
            THEN 7200.0 ELSE 0.0 END) AS friend_boost,
      (CASE WHEN p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = p.author_id) THEN 3600.0 ELSE 0.0 END) AS liked_author_boost,
      (CASE WHEN p.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = p.author_id) THEN 1800.0 ELSE 0.0 END) AS shared_gsub_boost,
      0.0 AS tag_boost
    FROM profile_wall_posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
    WHERE -- wall visibility (same rule as profile_wall.go): own, public+not hidden, or mutual friend
      (p.user_id = user_uuid
           OR (NOT COALESCE(ps.private_profile, FALSE) AND NOT COALESCE(ps.private_hide_wall, FALSE))
           OR EXISTS (SELECT 1 FROM friendships f
                      WHERE (f.user1_id = p.user_id AND f.user2_id = user_uuid)
                         OR (f.user1_id = user_uuid AND f.user2_id = p.user_id)))
  ),
  boosted AS (
    SELECT it.*,
      LEAST(
        14400.0,
        COALESCE(it.friend_boost, 0.0)
          + COALESCE(it.liked_author_boost, 0.0)
          + COALESCE(it.shared_gsub_boost, 0.0)
          + COALESCE(it.tag_boost, 0.0)
          + LEAST(14400.0, 1200.0 * LN(1.0
              + it.likes_count::DOUBLE PRECISION
              + 2.0 * it.comments_count::DOUBLE PRECISION
              + 3.0 * it.reposts_count::DOUBLE PRECISION
              + it.views_count::DOUBLE PRECISION / 10.0))
      ) AS boost_seconds
    FROM items it
  ),
  ranked AS (
    SELECT b.*,
      EXTRACT(EPOCH FROM b.created_at) + b.boost_seconds AS score,
      -- diversity: cap per author so one author cannot flood the feed.
      -- Anonymous threads/wall posts (author_id NULL) partition by their own
      -- item id so they never crowd each other out.
      ROW_NUMBER() OVER (
        PARTITION BY COALESCE(b.author_id, b.item_id)
        ORDER BY EXTRACT(EPOCH FROM b.created_at) + b.boost_seconds DESC
      ) AS author_rn
    FROM boosted b
  )
  SELECT
    r.item_type, r.item_id, r.score, r.created_at, r.updated_at,
    r.title, r.content, r.content_json, r.image_url, r.image_urls, r.attachments, r.tags, r.post_count,
    r.author_id, r.author_username, r.author_display_name, r.author_nickname_emoji_id,
    r.author_is_anonymous, r.author_avatar_url, r.board_id, r.board_slug, r.board_name,
    r.board_is_gomosub, r.wall_user_id, r.likes_count, r.comments_count, r.reposts_count, r.liked_by_viewer,
    r.views_count
  FROM ranked r
  WHERE r.author_rn <= 5
    AND (since_ts IS NULL OR r.created_at > since_ts)
    AND (before_sort IS NULL
         OR r.score < before_sort
         OR (r.score = before_sort AND r.item_id < before_id))
  ORDER BY r.score DESC, r.item_id DESC
  LIMIT limit_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_feed(UUID, INT, TIMESTAMPTZ, DOUBLE PRECISION, UUID) TO gomo6;
