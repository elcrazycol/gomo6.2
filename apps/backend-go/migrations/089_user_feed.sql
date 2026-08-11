-- 089_user_feed.sql
--
-- Unified personalized feed: mixes board/gsub threads and profile-wall posts
-- into a single scored stream, ranked for the requesting user.
--
-- Signals used for ranking:
--   * interest — tag values the user has engaged with (liked / posted in /
--                subscribed) plus tags of the gsubs they belong to;
--   * social   — author is a friend, the user liked their content before,
--                they share a gsub, board not yet joined (discovery bonus);
--   * popularity — likes + comments + reposts, log-scaled;
--   * freshness — HN-style exponential decay on age.
--
-- Privacy is enforced INSIDE the function:
--   * threads only from boards the caller may access (public, own private,
--     or gsubs the caller is a member of);
--   * threads of private profiles are hidden from non-friends;
--   * wall posts only from walls the caller may view (own, public+not
--     hidden, or a mutual friend's), mirroring profile_wall.go.
--
-- Anonymous callers (user_uuid IS NULL) get the global popularity+recency
-- stream with all personal signals zeroed out.
--
-- NOTE on PL/pgSQL: the RETURNS TABLE column names become in-function
-- variables, so every reference to a same-named table column inside the SQL
-- must be qualified with its table/CTE alias. This function deliberately
-- qualifies ALL column references for that reason.

CREATE OR REPLACE FUNCTION get_user_feed(
  user_uuid UUID DEFAULT NULL,
  limit_count INT DEFAULT 20,
  offset_count INT DEFAULT 0
)
RETURNS TABLE (
  item_type TEXT,
  item_id UUID,
  score NUMERIC,
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
  liked_by_viewer BOOLEAN
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
    -- threads.tags is an object ({key: value}); the column DEFAULT is '[]'
    -- (an array), so guard with jsonb_typeof before jsonb_each_text.
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
      -- interest: how many of the thread's tag values match the user's set
      (SELECT COUNT(*)::DOUBLE PRECISION FROM jsonb_each_text(
          CASE WHEN jsonb_typeof(t.tags) = 'object' THEN t.tags ELSE '{}'::jsonb END) kv_tags
       WHERE kv_tags.value IN (SELECT it.tag FROM interest_tags it)
          OR kv_tags.value IN (SELECT ig.tag FROM interest_gsub_tags ig)) AS interest_score,
      -- social: friend + liked-before + shared gsub + discovery (board not joined)
      (CASE WHEN EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = t.user_id) THEN 4.0 ELSE 0.0 END
       + CASE WHEN EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = t.user_id) THEN 2.0 ELSE 0.0 END
       + CASE WHEN EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = t.user_id) THEN 1.5 ELSE 0.0 END
       + CASE WHEN NOT EXISTS(SELECT 1 FROM member_board_ids mb WHERE mb.bid = t.board_id) THEN 2.0 ELSE 0.0 END
      ) AS social_score,
      EXTRACT(EPOCH FROM (now() - t.created_at)) / 3600.0 AS age_hours
    FROM threads t
    JOIN boards b ON b.id = t.board_id
    LEFT JOIN users u ON u.id = t.user_id
    LEFT JOIN privacy_settings ps ON ps.user_id = t.user_id
    WHERE t.channel_id IS NULL
      AND NOT COALESCE(b.is_rules_board, FALSE)
      -- exclude the caller's own threads
      AND NOT (user_uuid IS NOT NULL AND t.user_id = user_uuid)
      -- board visibility: public, own private board, or member of the gsub
      AND (COALESCE(b.visibility, 'public') <> 'private'
           OR b.owner_id = user_uuid
           OR (user_uuid IS NOT NULL AND EXISTS (SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id = user_uuid)))
      -- private profiles: only friends (or the author themself) see their threads
      AND (t.user_id IS NULL
           OR t.user_id = user_uuid
           OR NOT COALESCE(ps.private_profile, FALSE)
           OR EXISTS (SELECT 1 FROM friendships f
                      WHERE (f.user1_id = t.user_id AND f.user2_id = user_uuid)
                         OR (f.user1_id = user_uuid AND f.user2_id = t.user_id)))

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
      -- interest: wall posts carry no tags — use author affinity
      (CASE WHEN EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = p.author_id) THEN 1.0 ELSE 0.0 END) AS interest_score,
      -- social: wall owner is friend / author is friend / liked author / shared gsub
      (CASE WHEN EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.user_id) THEN 4.0 ELSE 0.0 END
       + CASE WHEN EXISTS(SELECT 1 FROM friend_ids f WHERE f.fid = p.author_id) THEN 2.0 ELSE 0.0 END
       + CASE WHEN EXISTS(SELECT 1 FROM liked_author_ids la WHERE la.aid = p.author_id) THEN 2.0 ELSE 0.0 END
       + CASE WHEN EXISTS(SELECT 1 FROM shared_gsub_author_ids sa WHERE sa.aid = p.author_id) THEN 1.5 ELSE 0.0 END
      ) AS social_score,
      EXTRACT(EPOCH FROM (now() - p.created_at)) / 3600.0 AS age_hours
    FROM profile_wall_posts p
    LEFT JOIN users u ON u.id = p.author_id
    LEFT JOIN privacy_settings ps ON ps.user_id = p.user_id
    WHERE NOT (user_uuid IS NOT NULL AND p.author_id = user_uuid)
      -- wall visibility (same rule as profile_wall.go): own, public+not hidden, or mutual friend
      AND (p.user_id = user_uuid
           OR (NOT COALESCE(ps.private_profile, FALSE) AND NOT COALESCE(ps.private_hide_wall, FALSE))
           OR EXISTS (SELECT 1 FROM friendships f
                      WHERE (f.user1_id = p.user_id AND f.user2_id = user_uuid)
                         OR (f.user1_id = user_uuid AND f.user2_id = p.user_id)))
  ),
  ranked AS (
    SELECT it.*,
      (3.0 * it.interest_score + 4.0 * it.social_score
       + 2.0 * LN(1 + it.likes_count + 2 * it.comments_count + 3 * it.reposts_count)
       + 4.0 / POWER(it.age_hours + 2.0, 1.5)
      ) AS rank_score,
      -- diversity: cap at 3 items per author so one author cannot flood the
      -- feed. Anonymous threads/wall posts (author_id NULL) partition by their
      -- own item id so they never crowd each other out.
      ROW_NUMBER() OVER (PARTITION BY COALESCE(it.author_id, it.item_id) ORDER BY
        (3.0 * it.interest_score + 4.0 * it.social_score
         + 2.0 * LN(1 + it.likes_count + 2 * it.comments_count + 3 * it.reposts_count)
         + 4.0 / POWER(it.age_hours + 2.0, 1.5)) DESC
      ) AS author_rn
    FROM items it
  )
  SELECT
    r.item_type, r.item_id, ROUND(r.rank_score::NUMERIC, 3), r.created_at, r.updated_at,
    r.title, r.content, r.content_json, r.image_url, r.image_urls, r.attachments, r.tags, r.post_count,
    r.author_id, r.author_username, r.author_display_name, r.author_nickname_emoji_id,
    r.author_is_anonymous, r.author_avatar_url, r.board_id, r.board_slug, r.board_name,
    r.board_is_gomosub, r.wall_user_id, r.likes_count, r.comments_count, r.reposts_count, r.liked_by_viewer
  FROM ranked r
  WHERE r.author_rn <= 3
  ORDER BY r.rank_score DESC, r.created_at DESC
  LIMIT limit_count OFFSET offset_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_feed(UUID, INT, INT) TO gomo6;
