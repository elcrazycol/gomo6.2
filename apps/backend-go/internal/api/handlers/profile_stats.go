package handlers

import (
	"database/sql"
	"fmt"
)

func rowUserID(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return fmt.Sprint(t)
	}
}

// RecomputeUserProfileStats sets users.post_count, thread_count, garma from live data.
// Garma formula matches the Stats page weights: posts×0.5 + threads×4 + likes on posts×2 +
// likes on threads×3 + replies by others in own threads×0.25 + floor(session_minutes/30).
// This function runs asynchronously to avoid blocking the request.
func RecomputeUserProfileStats(db *sql.DB, userID string) {
	if userID == "" {
		return
	}

	// Run in goroutine to avoid blocking
	go func() {
		const q = `
UPDATE users u SET
  post_count = s.pc,
  thread_count = s.tc,
  garma = s.g,
  updated_at = NOW()
FROM (
  SELECT
    (SELECT COUNT(*)::int FROM posts WHERE user_id = $1) AS pc,
    (SELECT COUNT(*)::int FROM threads WHERE user_id = $1) AS tc,
    GREATEST(0, LEAST(2147483647, FLOOR(
      (SELECT COUNT(*)::numeric FROM posts WHERE user_id = $1) * 0.5 +
      (SELECT COUNT(*)::numeric FROM threads WHERE user_id = $1) * 4 +
      (SELECT COUNT(*)::numeric FROM post_likes pl
         INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1) * 2 +
      (SELECT COUNT(*)::numeric FROM thread_likes tl
         INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1) * 3 +
      (SELECT COUNT(*)::numeric FROM posts p2
         INNER JOIN threads th2 ON th2.id = p2.thread_id
         WHERE th2.user_id = $1 AND p2.user_id <> $1) * 0.25 +
      COALESCE(
        (SELECT FLOOR((total_minutes)::numeric / 30) FROM user_session_time WHERE user_id = $1),
        0
      )::numeric
    )::int)) AS g
) s
WHERE u.id = $1`
		_, _ = db.Exec(q, userID)
	}()
}
