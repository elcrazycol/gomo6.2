package achievements

import (
	"context"
	"database/sql"
)

// sourceCount recomputes a counter group's value from live data (backfill /
// full recompute / dirty-group healing). It mirrors the unified content model:
//
//	Записи      = threads + profile_wall_posts (by author_id)
//	Комментарии = posts (in threads) + profile_wall_post_comments
//	Лайки       = post_likes + thread_likes + profile_wall_post_likes +
//	              profile_wall_comment_likes (received by owner / given by user)
func (e *Engine) sourceCount(ctx context.Context, userID, key string) (int, error) {
	if e.db == nil {
		return 0, sql.ErrConnDone
	}
	q, ok := sourceCountQueries[key]
	if !ok {
		return 0, nil
	}
	var value int
	err := e.db.QueryRowContext(ctx, q, userID).Scan(&value)
	if err != nil {
		return 0, err
	}
	return value, nil
}

var sourceCountQueries = map[string]string{
	"entries": `
SELECT (
  (SELECT COUNT(*)::int FROM threads t WHERE t.user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_posts w WHERE w.author_id = $1)
)`,
	"comments": `
SELECT (
  (SELECT COUNT(*)::int FROM posts p WHERE p.user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_post_comments c WHERE c.user_id = $1)
)`,
	"likes_received": `
SELECT (
  (SELECT COUNT(*)::int FROM post_likes pl JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1)
  + (SELECT COUNT(*)::int FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_post_likes wl JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1)
)`,
	"likes_given": `
SELECT (
  (SELECT COUNT(*)::int FROM post_likes WHERE user_id = $1)
  + (SELECT COUNT(*)::int FROM thread_likes WHERE user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_post_likes WHERE user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_comment_likes WHERE user_id = $1)
)`,
	"images": `
SELECT (
  (SELECT COUNT(*)::int FROM threads t
    WHERE t.user_id = $1
      AND (t.image_url IS NOT NULL
           OR (t.image_urls IS NOT NULL
               AND jsonb_typeof(t.image_urls) = 'array'
               AND jsonb_array_length(t.image_urls) > 0)))
  + (SELECT COUNT(*)::int FROM profile_wall_posts w
    WHERE w.author_id = $1 AND w.image_url IS NOT NULL)
)`,
	"reposts": `
SELECT COUNT(*)::int FROM profile_wall_posts
WHERE author_id = $1 AND repost_of_post_id IS NOT NULL`,
	"sub_join": `
SELECT COUNT(*)::int FROM gomosub_memberships WHERE user_id = $1`,
	"sub_rules": `
SELECT COUNT(*)::int FROM gomosub_rules_acceptance WHERE user_id = $1`,
	"sub_create": `
SELECT COUNT(*)::int FROM boards WHERE owner_id = $1 AND is_gomosub = TRUE`,
	"avatar": `
SELECT CASE WHEN avatar_url IS NOT NULL AND avatar_url <> '' THEN 1 ELSE 0 END
FROM users WHERE id = $1`,
	"bio": `
SELECT CASE WHEN bio IS NOT NULL AND bio <> '' THEN 1 ELSE 0 END
FROM users WHERE id = $1`,
	"profile_style": `
SELECT COUNT(*)::int FROM profile_customization WHERE user_id = $1`,
	"spotify": `
SELECT COUNT(*)::int FROM user_integrations WHERE user_id = $1 AND provider = 'spotify'`,
	"gift_sent": `
SELECT COUNT(*)::int FROM user_gifts WHERE sender_id = $1`,
	"gift_received": `
SELECT COUNT(*)::int FROM user_gifts WHERE recipient_id = $1`,
}

// derivedValue computes a derived group's metric from live data.
func (e *Engine) derivedValue(ctx context.Context, userID, key string) (int, error) {
	if e.db == nil {
		return 0, sql.ErrConnDone
	}
	q, ok := derivedValueQueries[key]
	if !ok {
		return 0, nil
	}
	var value int
	err := e.db.QueryRowContext(ctx, q, userID).Scan(&value)
	if err != nil {
		return 0, err
	}
	return value, nil
}

var derivedValueQueries = map[string]string{
	// Longest run of consecutive visit days (user_daily_visits has one row
	// per (user, day)); a missed day breaks the run because there is no row.
	"daily_streak": `
WITH days AS (
  SELECT visit_date AS d FROM user_daily_visits WHERE user_id = $1
),
runs AS (
  SELECT d, d - (ROW_NUMBER() OVER (ORDER BY d))::int AS grp FROM days
)
SELECT COALESCE(MAX(cnt), 0)::int
FROM (SELECT COUNT(*)::int AS cnt FROM runs GROUP BY grp) x`,

	// Total minutes on the site (user_session_time: one row per day).
	"session_time": `
SELECT COALESCE(SUM(total_minutes), 0)::int FROM user_session_time WHERE user_id = $1`,

	// secret_owl: entries written between 03:00 and 06:00.
	"secret_owl": `
SELECT (
  (SELECT COUNT(*)::int FROM threads t
    WHERE t.user_id = $1 AND EXTRACT(HOUR FROM t.created_at) >= 3 AND EXTRACT(HOUR FROM t.created_at) < 6)
  + (SELECT COUNT(*)::int FROM profile_wall_posts w
    WHERE w.author_id = $1 AND EXTRACT(HOUR FROM w.created_at) >= 3 AND EXTRACT(HOUR FROM w.created_at) < 6)
)`,

	// secret_shower: max minutes on a single day.
	"secret_shower": `
SELECT COALESCE(MAX(total_minutes), 0)::int FROM user_session_time WHERE user_id = $1`,

	// secret_lurk: longest run of consecutive visit days on which the user
	// wrote nothing (no entry, no comment). Bucket counter resets on any
	// "wrote" day, so each silent run gets its own group.
	"secret_lurk": `
WITH days AS (
  SELECT visit_date AS d,
         (EXISTS(SELECT 1 FROM threads t WHERE t.user_id = $1 AND t.created_at::date = visit_date)
          OR EXISTS(SELECT 1 FROM profile_wall_posts w WHERE w.author_id = $1 AND w.created_at::date = visit_date)
          OR EXISTS(SELECT 1 FROM posts p WHERE p.user_id = $1 AND p.created_at::date = visit_date)
          OR EXISTS(SELECT 1 FROM profile_wall_post_comments c WHERE c.user_id = $1 AND c.created_at::date = visit_date)) AS wrote
  FROM user_daily_visits WHERE user_id = $1
),
buckets AS (
  SELECT d, wrote, SUM(CASE WHEN wrote THEN 1 ELSE 0 END) OVER (ORDER BY d) AS grp
  FROM days
)
SELECT COALESCE(MAX(cnt), 0)::int
FROM (SELECT COUNT(*)::int AS cnt FROM buckets WHERE NOT wrote GROUP BY grp) x`,

	// secret_allrounder: progressive groups with level >= 2.
	"secret_allrounder": `
SELECT COUNT(*)::int FROM user_achievements ua
JOIN achievements a ON a.id = ua.achievement_id
WHERE ua.user_id = $1 AND a.achievement_type = 'progressive' AND ua.current_level >= 2`,
}
