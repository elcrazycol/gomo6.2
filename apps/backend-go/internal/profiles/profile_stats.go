// Package profiles holds the profile-domain helpers shared between the
// api/handlers god package and the crudengine subsystem: the unified
// profile stats recomputation and the profile-customization sanitizers.
// Extracted during F1 so the crudengine subsystem can leave the handlers
// package without dragging the whole profile domain with it.
package profiles

import (
	"context"
	"database/sql"
	"sort"
	"sync"
	"time"

	"github.com/lib/pq"
)

const (
	// statsDirtyCap bounds the in-memory dirty set. A user is stored at most
	// once, so reaching the cap would take that many distinct writers between
	// two sweeps; beyond it the marker is dropped — the periodic full sweep
	// still reconciles everyone.
	statsDirtyCap = 100000
)

var (
	dirtyMu      sync.Mutex
	statsPending = map[string]struct{}{}
)

// RecomputeUserProfileStats marks a user's unified counters as stale.
//
// The counters (post_count, thread_count, the wall-aware comment/like/view
// counters and garma) are NOT recomputed here any more. The old implementation
// ran a ~28-InitPlan UPDATE per user, per interaction, on the request path —
// measured at 5-7 ms each, dominated by planning, with an unconditional row
// write (dead tuples, WAL, bloat) even when nothing had changed.
//
// Marking is O(1) and in-memory: a periodic sweep (RunStatsSweep /
// StatsSweepLoop) recomputes every dirty user in ONE statement, and a less
// frequent full sweep reconciles the whole table, so a missed marker or a
// process restart can never leave counters permanently wrong.
//
// The db parameter is kept so existing call sites (and the injected
// recomputeStatsFn seams) keep compiling; the sweep owns the database now.
func RecomputeUserProfileStats(_ *sql.DB, userID string) {
	MarkStatsDirty(userID)
}

// MarkStatsDirty records userID for the next stats sweep. It never touches the
// database, so it is safe to call from the request path.
func MarkStatsDirty(userID string) {
	if userID == "" {
		return
	}
	dirtyMu.Lock()
	if len(statsPending) < statsDirtyCap {
		statsPending[userID] = struct{}{}
	}
	dirtyMu.Unlock()
}

// drainDirtyUsers swaps out the pending set and returns its keys.
func drainDirtyUsers() []string {
	dirtyMu.Lock()
	defer dirtyMu.Unlock()
	if len(statsPending) == 0 {
		return nil
	}
	ids := make([]string, 0, len(statsPending))
	for id := range statsPending {
		ids = append(ids, id)
	}
	statsPending = make(map[string]struct{})
	// Deterministic order keeps the batched statement's arguments stable (and
	// tests non-flaky); the list is small.
	sort.Strings(ids)
	return ids
}

// restoreDirtyUsers re-marks users whose sweep failed, so the next tick retries
// instead of losing them until the full sweep.
func restoreDirtyUsers(ids []string) {
	dirtyMu.Lock()
	for _, id := range ids {
		if len(statsPending) >= statsDirtyCap {
			break
		}
		statsPending[id] = struct{}{}
	}
	dirtyMu.Unlock()
}

// PendingStatsUsers reports how many users are waiting for a sweep (tests and
// metrics).
func PendingStatsUsers() int {
	dirtyMu.Lock()
	defer dirtyMu.Unlock()
	return len(statsPending)
}

// SweepStats recomputes the unified counters for the given users in a single
// statement. ids == nil sweeps every user (full reconciliation).
//
// The statement is the same formula as before, only batched: the per-row
// correlated subqueries now hang off `t.id` from a `users t` source instead of
// a repeated `$1`, so Postgres plans it once for the whole batch instead of
// once per user. The `IS DISTINCT FROM` guard skips the row write entirely when
// a user's counters did not change, so a sweep over idle users produces no dead
// tuples.
//
// Returns the number of user rows actually written.
func SweepStats(ctx context.Context, db *sql.DB, ids []string) (int64, error) {
	if db == nil {
		return 0, nil
	}
	// nil → SQL NULL → the `$1::uuid[] IS NULL` branch selects every user.
	var arg interface{}
	if ids != nil {
		arg = pq.Array(ids)
	}
	res, err := db.ExecContext(ctx, snapshotStatsSQL, arg)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// RunStatsSweep drains the dirty set and recomputes exactly those users.
// Returns how many users were refreshed (0 when nothing was dirty).
func RunStatsSweep(ctx context.Context, db *sql.DB) (int, error) {
	ids := drainDirtyUsers()
	if len(ids) == 0 {
		return 0, nil
	}
	n, err := SweepStats(ctx, db, ids)
	if err != nil {
		restoreDirtyUsers(ids)
		return 0, err
	}
	return int(n), nil
}

// StatsSweepLoop runs the dirty-user sweep every interval and a full
// reconciliation every fullEvery, until ctx is cancelled. Errors go to onError
// (the caller logs them); the loop never exits on a sweep failure.
func StatsSweepLoop(ctx context.Context, db *sql.DB, interval, fullEvery time.Duration, onError func(error)) {
	if db == nil {
		return
	}
	if interval <= 0 {
		interval = 2 * time.Minute
	}
	if fullEvery <= 0 {
		fullEvery = 60 * time.Minute
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	lastFull := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := RunStatsSweep(ctx, db); err != nil && onError != nil {
				onError(err)
			}
			if time.Since(lastFull) >= fullEvery {
				lastFull = time.Now()
				if _, err := SweepStats(ctx, db, nil); err != nil && onError != nil {
					onError(err)
				}
			}
		}
	}
}

// snapshotStatsSQL is the batched unified-stats UPDATE.
//
// Counters follow the unified content model the feed already uses:
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
const snapshotStatsSQL = `
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
  SELECT t.id AS uid,
    (SELECT COUNT(*)::int FROM posts WHERE user_id = t.id) AS pc,
    (SELECT COUNT(*)::int FROM threads WHERE user_id = t.id) AS tc,
    (SELECT COUNT(*)::int FROM profile_wall_posts WHERE author_id = t.id) AS wpc,
    (SELECT (SELECT COUNT(*)::int FROM posts WHERE user_id = t.id)
          + (SELECT COUNT(*)::int FROM profile_wall_post_comments WHERE user_id = t.id)) AS cc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes pl
           INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = t.id)
      + (SELECT COUNT(*)::int FROM thread_likes tl
           INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = t.id)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes wl
           INNER JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = t.id)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl
           INNER JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = t.id)
    )::int AS lrc,
    (SELECT
        (SELECT COUNT(*)::int FROM post_likes WHERE user_id = t.id)
      + (SELECT COUNT(*)::int FROM thread_likes WHERE user_id = t.id)
      + (SELECT COUNT(*)::int FROM profile_wall_post_likes WHERE user_id = t.id)
      + (SELECT COUNT(*)::int FROM profile_wall_comment_likes WHERE user_id = t.id)
    )::int AS lgc,
    (SELECT COUNT(*)::int FROM profile_wall_post_views v
       INNER JOIN profile_wall_posts wp ON wp.id = v.post_id
       WHERE wp.author_id = t.id) AS vrc,
    GREATEST(0, LEAST(2147483647, FLOOR(
      (SELECT COUNT(*)::numeric FROM posts WHERE user_id = t.id) * 0.5 +
      (SELECT COUNT(*)::numeric FROM threads WHERE user_id = t.id) * 4 +
      (SELECT COUNT(*)::numeric FROM profile_wall_posts WHERE author_id = t.id) * 0.5 +
      (SELECT COUNT(*)::numeric FROM profile_wall_post_comments WHERE user_id = t.id) * 0.5 +
      (SELECT COUNT(*)::numeric FROM post_likes pl
         INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = t.id) * 2 +
      (SELECT COUNT(*)::numeric FROM thread_likes tl
         INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = t.id) * 3 +
      (SELECT COUNT(*)::numeric FROM profile_wall_post_likes wl
         INNER JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = t.id) * 2 +
      (SELECT COUNT(*)::numeric FROM profile_wall_comment_likes cl
         INNER JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = t.id) * 1 +
      (SELECT COUNT(*)::numeric FROM posts p2
         INNER JOIN threads th2 ON th2.id = p2.thread_id
         WHERE th2.user_id = t.id AND p2.user_id <> t.id) * 0.25 +
      COALESCE(
        (SELECT FLOOR(SUM(total_minutes)::numeric / 30) FROM user_session_time WHERE user_id = t.id),
        0
      )::numeric +
      COALESCE(
        (SELECT SUM(CAST((l.value->>'reward_value') AS integer))
         FROM user_achievements ua
         JOIN achievements a ON a.id = ua.achievement_id
         CROSS JOIN LATERAL jsonb_array_elements(a.levels) l
         WHERE ua.user_id = t.id
           AND (l.value->>'reward_type') = 'garma'
           AND (l.value->>'level')::int <= ua.current_level),
        0
      )::numeric
    )::int)) AS g
  FROM users t
  WHERE $1::uuid[] IS NULL OR t.id = ANY($1::uuid[])
) s
WHERE u.id = s.uid
  AND (u.post_count, u.thread_count, u.wall_post_count, u.comment_count,
       u.likes_received_count, u.likes_given_count, u.views_received_count, u.garma)
      IS DISTINCT FROM (s.pc, s.tc, s.wpc, s.cc, s.lrc, s.lgc, s.vrc, s.g)`
