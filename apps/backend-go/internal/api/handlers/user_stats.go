package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
	"github.com/google/uuid"
)

// Garma weights — MUST stay in sync with profiles.snapshotStatsSQL. They live
// here so the breakdown can label each term instead of the frontend
// reverse-engineering the formula from raw counters (which is what it used to
// do, and why the charts were approximations).
const (
	gwThread          = 4.0
	gwPost            = 0.5
	gwWallPost        = 0.5
	gwWallComment     = 0.5
	gwPostLike        = 2.0
	gwThreadLike      = 3.0
	gwWallPostLike    = 2.0
	gwWallCommentLike = 1.0
	gwReply           = 0.25
)

const (
	// Activity window bounds for the daily series coming from the ledger.
	defaultActivityDays = 30
	maxActivityDays     = 365
)

// statsTotals mirrors the unified counters in users.*. They are a snapshot:
// refreshed by the periodic sweep (see profiles.StatsSweepLoop), so they can lag
// a couple of minutes behind the last interaction.
type statsTotals struct {
	Posts          int64 `json:"posts"`
	Threads        int64 `json:"threads"`
	WallPosts      int64 `json:"wall_posts"`
	Comments       int64 `json:"comments"`
	LikesReceived  int64 `json:"likes_received"`
	LikesGiven     int64 `json:"likes_given"`
	ViewsReceived  int64 `json:"views_received"`
	Garma          int64 `json:"garma"`
	SessionMinutes int64 `json:"session_minutes"`
}

// garmaBreakdownEntry is one weighted term of the garma formula.
type garmaBreakdownEntry struct {
	Key    string  `json:"key"`
	Weight float64 `json:"weight"`
	Raw    int64   `json:"raw"`
	Value  float64 `json:"value"`
}

// activityDay is one day of the ledger-derived activity series.
type activityDay struct {
	Date   string `json:"date"`
	Events int64  `json:"events"`
}

// userStatsResponse is the payload of GET /users/:id/stats.
type userStatsResponse struct {
	UserID   string `json:"user_id"`
	Username string `json:"username"`
	// CanView is false for a private profile the viewer may not see: nothing
	// else in the payload is meaningful then.
	CanView bool `json:"can_view"`
	// StatsHidden is true when the profile is visible but its stats are not
	// (private_hide_stats, or a private profile seen by a non-friend).
	StatsHidden bool `json:"stats_hidden"`
	// Detailed is true when the breakdown + activity series are included
	// (owner, or show_detailed_stats for a non-owner).
	Detailed       bool                  `json:"detailed"`
	Totals         *statsTotals          `json:"totals"`
	GarmaBreakdown []garmaBreakdownEntry `json:"garma_breakdown"`
	ActivityDaily  []activityDay         `json:"activity_daily"`
	ActivityDays   int                   `json:"activity_days"`
	// ActivitySeries holds per-kind daily counts from the source tables, so the
	// charts have the user's full history (the ledger only starts at deploy).
	// Keys: posts, threads, wall_posts, wall_comments, post_likes_received,
	// thread_likes_received, wall_post_likes_received,
	// wall_comment_likes_received, replies.
	ActivitySeries map[string][]activityDay `json:"activity_series"`
	// ComputedAt is when this response was assembled. The counters themselves
	// are refreshed by the ~2-minute snapshot sweep.
	ComputedAt time.Time `json:"computed_at"`
}

// GetUserStats returns a user's profile statistics in one response: the
// snapshot totals (users.*), the garma formula broken down by term, and the
// daily activity series from the append-only activity ledger.
//
// It replaces the previous stats page, which issued ~10 requests (posts,
// threads, wall posts/comments, four like/reply RPCs, session time) and
// reconstructed the garma breakdown with clientside heuristics. Everything the
// page shows now comes from one call.
//
// Visibility follows the same rules the rest of the profile surface enforces:
// a private profile seen by a non-friend returns can_view=false; private_hide_stats
// returns stats_hidden=true. The detailed breakdown/activity additionally require
// show_detailed_stats for non-owners; per-metric stats_visibility toggles remain a
// client-side display filter (they hide bars, not the underlying public totals).
func (h *ProfilesHandler) GetUserStats(c *gin.Context) {
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}

	var viewerID string
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok {
			viewerID = uc.UserID
		}
	}

	// Username is public (it is in /profiles too) and the profile page needs it
	// even when the stats themselves are hidden; the same read tells us whether
	// the user exists at all.
	username, totals, err := h.loadStatsHeader(userID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	visMap, err := privacy.ResolveProfileVisibilityBatch(h.db, viewerID, []string{userID})
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	vis := visMap[userID]

	days := parseActivityDays(c.Query("days"))
	resp := userStatsResponse{
		UserID:       userID,
		Username:     username,
		ActivityDays: days,
		ComputedAt:   time.Now().UTC(),
	}

	if vis.Filter {
		// Private profile, viewer is not the owner or a friend: nothing leaks.
		c.JSON(http.StatusOK, models.SuccessResponse(resp))
		return
	}
	resp.CanView = true
	if vis.HideStats {
		resp.StatsHidden = true
		c.JSON(http.StatusOK, models.SuccessResponse(resp))
		return
	}

	resp.Totals = totals

	isOwner := viewerID != "" && viewerID == userID
	if isOwner || h.showDetailedStats(userID) {
		resp.Detailed = true
		resp.GarmaBreakdown = h.loadGarmaBreakdown(userID)
		resp.ActivityDaily = h.loadActivityDaily(userID, days)
		resp.ActivitySeries = h.loadActivitySeries(userID, days)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}

// parseActivityDays clamps the requested window into [1, maxActivityDays].
func parseActivityDays(raw string) int {
	days := defaultActivityDays
	if raw == "" {
		return days
	}
	if n, err := strconv.Atoi(raw); err == nil && n > 0 {
		days = n
	}
	if days > maxActivityDays {
		days = maxActivityDays
	}
	return days
}

// loadStatsHeader reads the user's username and snapshot counters. It returns
// sql.ErrNoRows for an unknown id (the handler maps that to 404).
func (h *ProfilesHandler) loadStatsHeader(userID string) (string, *statsTotals, error) {
	var (
		username string
		t        statsTotals
	)
	err := h.db.QueryRow(`
		SELECT username,
		       COALESCE(post_count, 0), COALESCE(thread_count, 0),
		       COALESCE(wall_post_count, 0), COALESCE(comment_count, 0),
		       COALESCE(likes_received_count, 0), COALESCE(likes_given_count, 0),
		       COALESCE(views_received_count, 0), COALESCE(garma, 0),
		       COALESCE((SELECT FLOOR(SUM(total_minutes))::int FROM user_session_time WHERE user_id = $1), 0)
		FROM users WHERE id = $1`, userID).
		Scan(&username,
			&t.Posts, &t.Threads, &t.WallPosts, &t.Comments,
			&t.LikesReceived, &t.LikesGiven, &t.ViewsReceived, &t.Garma,
			&t.SessionMinutes)
	if err != nil {
		return "", nil, err
	}
	return username, &t, nil
}

// showDetailedStats reports whether a non-owner may see the garma breakdown and
// the activity series. Missing row → false (the privacy-safe default).
func (h *ProfilesHandler) showDetailedStats(userID string) bool {
	var ok bool
	if err := h.db.QueryRow(
		`SELECT COALESCE(show_detailed_stats, false) FROM privacy_settings WHERE user_id = $1`,
		userID,
	).Scan(&ok); err != nil {
		return false
	}
	return ok
}

// loadGarmaBreakdown returns the weighted terms of the garma formula. It is one
// query with scalar subqueries and only runs on this endpoint, so its cost is
// irrelevant compared with the old client-side reconstruction. A failure is
// non-fatal — the caller returns an empty breakdown rather than failing the
// whole stats request.
func (h *ProfilesHandler) loadGarmaBreakdown(userID string) []garmaBreakdownEntry {
	var (
		threads, wallPosts, comments              int64
		postLikes, threadLikes                    int64
		wallPostLikes, wallCommentLikes           int64
		replies, sessionBuckets, achievementGarma int64
	)
	err := h.db.QueryRow(`
		SELECT
		  (SELECT COUNT(*)::int FROM threads WHERE user_id = $1),
		  (SELECT COUNT(*)::int FROM profile_wall_posts WHERE author_id = $1),
		  (SELECT (SELECT COUNT(*)::int FROM posts WHERE user_id = $1)
		        + (SELECT COUNT(*)::int FROM profile_wall_post_comments WHERE user_id = $1)),
		  (SELECT COUNT(*)::int FROM post_likes pl
		     INNER JOIN posts po ON po.id = pl.post_id WHERE po.user_id = $1),
		  (SELECT COUNT(*)::int FROM thread_likes tl
		     INNER JOIN threads th ON th.id = tl.thread_id WHERE th.user_id = $1),
		  (SELECT COUNT(*)::int FROM profile_wall_post_likes wl
		     INNER JOIN profile_wall_posts wp ON wp.id = wl.post_id WHERE wp.author_id = $1),
		  (SELECT COUNT(*)::int FROM profile_wall_comment_likes cl
		     INNER JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id WHERE wc.user_id = $1),
		  (SELECT COUNT(*)::int FROM posts p2
		     INNER JOIN threads th2 ON th2.id = p2.thread_id
		     WHERE th2.user_id = $1 AND p2.user_id <> $1),
		  (SELECT COALESCE(FLOOR(SUM(total_minutes)::numeric / 30), 0)::int
		     FROM user_session_time WHERE user_id = $1),
		  (SELECT COALESCE(SUM(CAST((l.value->>'reward_value') AS integer)), 0)::int
		     FROM user_achievements ua
		     JOIN achievements a ON a.id = ua.achievement_id
		     CROSS JOIN LATERAL jsonb_array_elements(a.levels) l
		     WHERE ua.user_id = $1
		       AND (l.value->>'reward_type') = 'garma'
		       AND (l.value->>'level')::int <= ua.current_level)`,
		userID,
	).Scan(&threads, &wallPosts, &comments,
		&postLikes, &threadLikes, &wallPostLikes, &wallCommentLikes,
		&replies, &sessionBuckets, &achievementGarma)
	if err != nil {
		return []garmaBreakdownEntry{}
	}

	entry := func(key string, raw int64, weight float64) garmaBreakdownEntry {
		return garmaBreakdownEntry{Key: key, Raw: raw, Weight: weight, Value: float64(raw) * weight}
	}
	return []garmaBreakdownEntry{
		entry("post_likes", postLikes, gwPostLike),
		entry("thread_likes", threadLikes, gwThreadLike),
		entry("threads", threads, gwThread),
		entry("wall_post_likes", wallPostLikes, gwWallPostLike),
		entry("wall_comment_likes", wallCommentLikes, gwWallCommentLike),
		entry("wall_posts", wallPosts, gwWallPost),
		entry("comments", comments, gwWallComment),
		entry("replies", replies, gwReply),
		entry("session_time", sessionBuckets, 1.0),
		entry("achievements", achievementGarma, 1.0),
	}
}

// loadActivityDaily reads the daily activity series from the append-only ledger.
// Days without events are simply absent; the client fills the gaps.
func (h *ProfilesHandler) loadActivityDaily(userID string, days int) []activityDay {
	rows, err := h.db.Query(`
		SELECT (created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		FROM user_activity_events
		WHERE user_id = $1 AND created_at >= NOW() - ($2 || ' days')::interval
		GROUP BY 1
		ORDER BY 1`, userID, days)
	if err != nil {
		return []activityDay{}
	}
	defer rows.Close()

	out := []activityDay{}
	for rows.Next() {
		var d activityDay
		if err := rows.Scan(&d.Date, &d.Events); err != nil {
			return out
		}
		out = append(out, d)
	}
	return out
}

// loadActivitySeries returns per-kind daily counts from the SOURCE TABLES, so
// the charts carry the user's full history (the ledger only starts at deploy).
// One query with UNION ALL branches, bounded by the requested window; it only
// runs on this endpoint. Keys match the frontend metric names.
func (h *ProfilesHandler) loadActivitySeries(userID string, days int) map[string][]activityDay {
	out := map[string][]activityDay{}
	cutoff := time.Now().UTC().Add(-time.Duration(days) * 24 * time.Hour)

	rows, err := h.db.Query(`
		SELECT kind, day, cnt FROM (
		  SELECT 'posts' AS kind, (created_at AT TIME ZONE 'UTC')::date::text AS day, COUNT(*)::int AS cnt
		    FROM posts WHERE user_id = $1 AND created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'threads', (created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM threads WHERE user_id = $1 AND created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'wall_posts', (created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM profile_wall_posts WHERE author_id = $1 AND created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'wall_comments', (created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM profile_wall_post_comments WHERE user_id = $1 AND created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'post_likes_received', (pl.created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM post_likes pl JOIN posts po ON po.id = pl.post_id
		    WHERE po.user_id = $1 AND pl.created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'thread_likes_received', (tl.created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM thread_likes tl JOIN threads th ON th.id = tl.thread_id
		    WHERE th.user_id = $1 AND tl.created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'wall_post_likes_received', (wl.created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM profile_wall_post_likes wl JOIN profile_wall_posts wp ON wp.id = wl.post_id
		    WHERE wp.author_id = $1 AND wl.created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'wall_comment_likes_received', (cl.created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM profile_wall_comment_likes cl JOIN profile_wall_post_comments wc ON wc.id = cl.comment_id
		    WHERE wc.user_id = $1 AND cl.created_at >= $2 GROUP BY 2
		  UNION ALL
		  SELECT 'replies', (p2.created_at AT TIME ZONE 'UTC')::date::text, COUNT(*)::int
		    FROM posts p2 JOIN threads th2 ON th2.id = p2.thread_id
		    WHERE th2.user_id = $1 AND p2.user_id <> $1 AND p2.created_at >= $2 GROUP BY 2
		) x
		ORDER BY day`, userID, cutoff)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var kind, day string
		var cnt int64
		if err := rows.Scan(&kind, &day, &cnt); err != nil {
			return out
		}
		out[kind] = append(out[kind], activityDay{Date: day, Events: cnt})
	}
	return out
}
