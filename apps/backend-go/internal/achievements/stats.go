package achievements

import (
	"context"
	"database/sql"
)

// sourceCount recomputes a counter milestone's value from live data. It mirrors
// the unified content model:
//
//	Записи         = threads + profile_wall_posts (by author_id)
//	Лайки получены = post_likes + thread_likes + profile_wall_post_likes +
//	                 profile_wall_comment_likes (received by owner)
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
	"likes_received": `
SELECT (
  (SELECT COUNT(*)::int FROM post_likes pl JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1)
  + (SELECT COUNT(*)::int FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_post_likes wl JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1)
  + (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1)
)`,
}

// derivedValue computes a derived milestone's value from live data.
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
	// resonance: the user's best single piece of content by unique engagement.
	// Score = uniq-likers + 3·uniq-commenters + 5·uniq-reposters, counted over
	// distinct users (a single account cannot inflate its own score). Comments
	// and reposts are only possible on threads and wall posts; a plain post
	// scores on likes alone.
	"resonance": `
SELECT GREATEST(
  COALESCE((SELECT MAX(s) FROM (
    SELECT
      (SELECT COUNT(DISTINCT tl.user_id) FROM thread_likes tl WHERE tl.thread_id = t.id)
      + 3 * (SELECT COUNT(DISTINCT p.user_id) FROM posts p
              WHERE p.thread_id = t.id AND p.user_id IS NOT NULL AND p.user_id <> t.user_id)
      AS s
    FROM threads t WHERE t.user_id = $1
  ) a), 0),
  COALESCE((SELECT MAX(s) FROM (
    SELECT (SELECT COUNT(DISTINCT pl.user_id) FROM post_likes pl WHERE pl.post_id = p.id) AS s
    FROM posts p WHERE p.user_id = $1
  ) b), 0),
  COALESCE((SELECT MAX(s) FROM (
    SELECT
      (SELECT COUNT(DISTINCT wl.user_id) FROM profile_wall_post_likes wl WHERE wl.post_id = w.id)
      + 3 * (SELECT COUNT(DISTINCT wc.user_id) FROM profile_wall_post_comments wc
              WHERE wc.post_id = w.id AND wc.user_id <> w.author_id)
      + 5 * (SELECT COUNT(DISTINCT wr.user_id) FROM profile_wall_post_reposts wr WHERE wr.post_id = w.id)
      AS s
    FROM profile_wall_posts w WHERE w.author_id = $1
  ) c), 0)
)`,
}

// tenureDays returns the account age in whole days.
func (e *Engine) tenureDays(ctx context.Context, userID string) (int, error) {
	if e.db == nil {
		return 0, sql.ErrConnDone
	}
	var days int
	err := e.db.QueryRowContext(ctx, `
SELECT COALESCE(FLOOR(EXTRACT(EPOCH FROM (NOW() - created_at)) / 86400), 0)::int
FROM users WHERE id = $1`, userID).Scan(&days)
	if err != nil {
		return 0, err
	}
	return days, nil
}

// tenureLevel maps account age in days to a level:
//
//	0          — less than half a year
//	1          — half a year
//	n (n>=2)   — (n-1) full years on the site
//
// It is the only unbounded series: there is no fixed level list, so the level is
// computed rather than matched against thresholds.
func tenureLevel(days int) int {
	if days < 183 {
		return 0
	}
	if days < 365 {
		return 1
	}
	return days/365 + 1
}
