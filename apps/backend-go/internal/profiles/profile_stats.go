// Package profiles holds the profile-domain helpers shared between the
// api/handlers god package and the crudengine subsystem: the unified
// profile stats recomputation and the profile-customization sanitizers.
// Extracted during F1 so the crudengine subsystem can leave the handlers
// package without dragging the whole profile domain with it.
package profiles

import (
	"database/sql"
	"sync"
)

const (
	// statsWorkers bounds how many unified-stats UPDATEs run concurrently. The
	// query is heavy (a dozen correlated subqueries), so one goroutine per like
	// or post is what saturates Postgres under load.
	statsWorkers = 2
	// statsQueueLen bounds pending users; coalescing keeps it small because a
	// user is queued at most once until their recompute finishes.
	statsQueueLen = 2048
)

type statsJob struct {
	db     *sql.DB
	userID string
}

var (
	statsOnce    sync.Once
	statsQueue   chan statsJob
	statsMu      sync.Mutex
	statsPending = map[string]struct{}{}
)

// RecomputeUserProfileStats sets users.post_count, thread_count and the unified
// wall-aware counters (wall_post_count, comment_count, likes_received_count,
// likes_given_count, views_received_count, garma) from live data.
//
// The counters follow the unified content model the feed already uses:
//
//	Записи:        threads + profile_wall_posts (by author_id — a post written
//	               on someone else's wall counts for the AUTHOR)
//	Комментарии:   posts (inside threads) + profile_wall_post_comments
//	Лайки:         post_likes + thread_likes + profile_wall_post_likes +
//	               profile_wall_comment_likes (received / given)
//	Просмотры:     profile_wall_post_views of the author's wall posts (one row
//	               per unique viewer per post, by author_id)
//
// Garma formula matches the Stats page weights:
//
//	посты в тредах ×0.5 + треды ×4 + записи стены ×0.5 + комменты стены ×0.5 +
//	лайки постов ×2 + лайки тредов ×3 + лайки записей стены ×2 +
//	лайки комментов стены ×1 + ответы других в моих тредах ×0.25 +
//	floor(session_minutes/30) + награды достижений.
//
// This function enqueues the recompute instead of running it inline: the work
// is coalesced per user and executed on a bounded worker set (statsWorkers), so
// a burst of interactions cannot spawn an unbounded number of goroutines.
func RecomputeUserProfileStats(db *sql.DB, userID string) {
	if userID == "" || db == nil {
		return
	}
	statsOnce.Do(startStatsWorkers)

	statsMu.Lock()
	if _, ok := statsPending[userID]; ok {
		statsMu.Unlock()
		return
	}
	statsPending[userID] = struct{}{}
	statsMu.Unlock()

	select {
	case statsQueue <- statsJob{db: db, userID: userID}:
	default:
		// Saturated: release the marker so a later write can retry.
		statsMu.Lock()
		delete(statsPending, userID)
		statsMu.Unlock()
	}
}

// startStatsWorkers launches the fixed-size worker set exactly once.
func startStatsWorkers() {
	statsQueue = make(chan statsJob, statsQueueLen)
	for i := 0; i < statsWorkers; i++ {
		go func() {
			for job := range statsQueue {
				_, _ = job.db.Exec(recomputeStatsSQL, job.userID)
				statsMu.Lock()
				delete(statsPending, job.userID)
				statsMu.Unlock()
			}
		}()
	}
}

// recomputeStatsSQL is the heavy unified stats UPDATE.
const recomputeStatsSQL = `
UPDATE users u SET
  post_count = s.pc,
  thread_count = s.tc,
  wall_post_count = s.wpc,
  comment_count = s.cc,
  likes_received_count = s.lrc,
  likes_given_count = s.lgc,
  views_received_count = s.vrc,
  garma = s.g,
  updated_at = NOW()
FROM (
  SELECT
    (SELECT COUNT(*)::int FROM posts WHERE user_id = $1) AS pc,
    (SELECT COUNT(*)::int FROM threads WHERE user_id = $1) AS tc,
    (SELECT COUNT(*)::int FROM profile_wall_posts WHERE author_id = $1) AS wpc,
    (SELECT (SELECT COUNT(*)::int FROM posts WHERE user_id = $1)
          + (SELECT COUNT(*)::int FROM profile_wall_post_comments WHERE user_id = $1)) AS cc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes pl
           INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1)
      + (SELECT COUNT(*)::int FROM thread_likes tl
           INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes wl
           INNER JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl
           INNER JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1)
    )::int AS lrc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes WHERE user_id = $1)
      + (SELECT COUNT(*)::int FROM thread_likes WHERE user_id = $1)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes WHERE user_id = $1)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes WHERE user_id = $1)
    )::int AS lgc,
    (SELECT COUNT(*)::int FROM profile_wall_post_views v
       INNER JOIN profile_wall_posts wp ON wp.id = v.post_id
       WHERE wp.author_id = $1) AS vrc,
    GREATEST(0, LEAST(2147483647, FLOOR(
      (SELECT COUNT(*)::numeric FROM posts WHERE user_id = $1) * 0.5 +
      (SELECT COUNT(*)::numeric FROM threads WHERE user_id = $1) * 4 +
      (SELECT COUNT(*)::numeric FROM profile_wall_posts WHERE author_id = $1) * 0.5 +
      (SELECT COUNT(*)::numeric FROM profile_wall_post_comments WHERE user_id = $1) * 0.5 +
      (SELECT COUNT(*)::numeric FROM post_likes pl
         INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1) * 2 +
      (SELECT COUNT(*)::numeric FROM thread_likes tl
         INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1) * 3 +
      (SELECT COUNT(*)::numeric FROM profile_wall_post_likes wl
         INNER JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1) * 2 +
      (SELECT COUNT(*)::numeric FROM profile_wall_comment_likes cl
         INNER JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1) * 1 +
      (SELECT COUNT(*)::numeric FROM posts p2
         INNER JOIN threads th2 ON th2.id = p2.thread_id
         WHERE th2.user_id = $1 AND p2.user_id <> $1) * 0.25 +
      COALESCE(
        (SELECT FLOOR(SUM(total_minutes)::numeric / 30) FROM user_session_time WHERE user_id = $1),
        0
      )::numeric +
      COALESCE(
        (SELECT SUM(CAST((l.value->>'reward_value') AS integer))
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         CROSS JOIN LATERAL jsonb_array_elements(a.levels) l
         WHERE ua.user_id = $1
           AND (l.value->>'reward_type') = 'garma'
           AND (l.value->>'level')::int <= ua.current_level),
        0
      )::numeric
    )::int)) AS g
) s
WHERE u.id = $1`
