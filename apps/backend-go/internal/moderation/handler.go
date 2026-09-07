package moderation

import (
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// validCategories is the allow-list for the report category field. Values are
// mirrored on the frontend (ReportDialog); the DB CHECK enforces them again.
var validCategories = map[string]bool{
	"spam": true, "abuse": true, "hate": true, "fraud": true, "explicit": true, "other": true,
}

// maxReasonRunes caps the report reason length in runes (mirrors the DB CHECK).
const maxReasonRunes = 2000

// CreateReport — POST /api/v1/moderation/reports.
// Body: { post_id, category, reason }. Any authenticated user may file one
// report per post (UNIQUE(post_id, reporter_id)); a second attempt returns 409
// with a stable code so the UI can render "you already reported this".
func (h *Handler) CreateReport(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	var body struct {
		PostID   string `json:"post_id"`
		Category string `json:"category"`
		Reason   string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	body.PostID = strings.TrimSpace(body.PostID)
	body.Category = strings.TrimSpace(body.Category)
	body.Reason = strings.TrimSpace(body.Reason)

	if body.PostID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_id is required"))
		return
	}
	if !validCategories[body.Category] {
		body.Category = "other"
	}
	reasonLen := len([]rune(body.Reason))
	if reasonLen < 1 || reasonLen > maxReasonRunes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("reason must be between 1 and 2000 characters"))
		return
	}

	// L5: the target post must exist. A report on a nonexistent post would
	// otherwise be accepted and linger in the queue as a dangling row.
	var exists bool
	if err := h.db.QueryRowContext(c.Request.Context(),
		`SELECT EXISTS(SELECT 1 FROM profile_wall_posts WHERE id = $1)`, body.PostID).Scan(&exists); err != nil {
		httpx.ServerError(c, "lookup wall post", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
		return
	}

	report := ReportItem{}
	err := h.db.QueryRowContext(c.Request.Context(), `
		INSERT INTO content_reports (post_id, reporter_id, category, reason)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (post_id, reporter_id) DO NOTHING
		RETURNING id, post_id, reporter_id, category, reason, status, created_at`,
		body.PostID, claims.UserID, body.Category, body.Reason,
	).Scan(&report.ID, &report.PostID, &report.ReporterID, &report.Category, &report.Reason, &report.Status, &report.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"error":   "Вы уже пожаловались на эту запись",
				"code":    "report_already_exists",
			})
			return
		}
		httpx.ServerError(c, "create report", err)
		return
	}
	report.Reporter = reporter{Username: claims.Username}

	var openCount int
	if err := h.db.QueryRowContext(c.Request.Context(),
		`SELECT COUNT(*) FROM content_reports WHERE post_id = $1 AND status = 'open'`, body.PostID).Scan(&openCount); err != nil {
		openCount = 0
	}

	// A fresh report changes the queue: evict any cached moderation-queue
	// responses so the next fetch (and the realtime-triggered refetch)
	// returns the new report immediately.
	h.invalidateQueueCache()

	// Realtime: push the fresh report to the "moderation" room so open
	// moderation screens show it immediately (nil-hub safe).
	if h.hub != nil {
		_ = h.hub.PublishNewReport(map[string]interface{}{
			"id":          report.ID,
			"post_id":     report.PostID,
			"reporter_id": report.ReporterID,
			"category":    report.Category,
			"open_count":  openCount,
		})
	}

	c.JSON(http.StatusCreated, gin.H{
		"success":    true,
		"data":       report,
		"open_count": openCount,
	})
}

// ListReports — GET /api/v1/moderation/reports.
// Moderator-only. Returns the moderation queue: every post with at least one
// open report, grouped under one entry per post, sorted by open report count
// (descending) and then by the newest report (descending) — more reports push
// a post higher. Resolved reports stay in the expanded per-post list.
func (h *Handler) ListReports(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	mod, err := isModerator(h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check moderator role", err)
		return
	}
	if !mod {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Moderator access required"))
		return
	}

	// All reports (open + resolved) of every post that still has >= 1 open
	// report, with the reporter profile embedded, newest first.
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT r.id, r.post_id, r.reporter_id, r.category, r.reason, r.status, r.created_at,
		       COALESCE(u.username, ''),
		       u.display_name,
		       u.avatar_url
		FROM content_reports r
		LEFT JOIN users u ON u.id = r.reporter_id
		WHERE EXISTS (
			SELECT 1 FROM content_reports open_r
			WHERE open_r.post_id = r.post_id AND open_r.status = 'open'
		)
		ORDER BY r.created_at DESC`)
	if err != nil {
		httpx.ServerError(c, "list reports", err)
		return
	}
	defer rows.Close()

	groups := []*ReportGroup{}
	groupByPost := map[string]*ReportGroup{}
	for rows.Next() {
		var item ReportItem
		if err := rows.Scan(&item.ID, &item.PostID, &item.ReporterID, &item.Category,
			&item.Reason, &item.Status, &item.CreatedAt,
			&item.Reporter.Username, &item.Reporter.DisplayName, &item.Reporter.AvatarURL); err != nil {
			httpx.ServerError(c, "scan report", err)
			return
		}
		group, ok := groupByPost[item.PostID]
		if !ok {
			group = &ReportGroup{}
			groupByPost[item.PostID] = group
			groups = append(groups, group)
		}
		group.Reports = append(group.Reports, item)
		if item.Status == "open" {
			group.OpenCount++
			group.ReportCount++
		}
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "list reports", err)
		return
	}

	// Attach the enriched post row to each group (author embed + interaction
	// counts, same shape as the wall GET) and drop groups whose post vanished
	// between the report query and here.
	kept := groups[:0]
	for _, group := range groups {
		post, err := h.fetchPostWithAuthor(group.Reports[0].PostID)
		if err != nil || post == nil {
			continue
		}
		group.Post = post
		kept = append(kept, group)
	}
	groups = kept

	// Queue order: more open reports first, newest report breaks ties.
	sortReports(groups)

	resp := make([]ReportGroup, 0, len(groups))
	for _, g := range groups {
		resp = append(resp, *g)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}

// ResolvePostReports — POST /api/v1/moderation/posts/:postId/resolve.
// Moderator-only. Marks every open report on the post as resolved WITHOUT
// deleting the post (the content stays up — the reports are what's handled).
func (h *Handler) ResolvePostReports(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	mod, err := isModerator(h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check moderator role", err)
		return
	}
	if !mod {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Moderator access required"))
		return
	}

	postID := c.Param("postId")
	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("postId is required"))
		return
	}

	var exists bool
	if err := h.db.QueryRowContext(c.Request.Context(),
		`SELECT EXISTS(SELECT 1 FROM profile_wall_posts WHERE id = $1)`, postID).Scan(&exists); err != nil {
		httpx.ServerError(c, "lookup wall post", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
		return
	}

	res, err := h.db.ExecContext(c.Request.Context(),
		`UPDATE content_reports SET status = 'resolved' WHERE post_id = $1 AND status = 'open'`, postID)
	if err != nil {
		httpx.ServerError(c, "resolve reports", err)
		return
	}
	n, _ := res.RowsAffected()
	h.invalidateQueueCache()

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"post_id": postID, "resolved": n}})
}

// DeletePost — DELETE /api/v1/moderation/posts/:postId.
// Moderator-only. Hard-deletes the wall post (its reports, comments, likes and
// album links cascade via FK), invalidates every cache that embeds it (the
// owner's wall list, the standalone post page, the unified feed) and pushes a
// delete_wall_post realtime event so open walls drop it immediately.
func (h *Handler) DeletePost(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	mod, err := isModerator(h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check moderator role", err)
		return
	}
	if !mod {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Moderator access required"))
		return
	}

	postID := c.Param("postId")
	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("postId is required"))
		return
	}

	row := map[string]interface{}{"id": postID}
	var ownerID string
	err = h.db.QueryRowContext(c.Request.Context(),
		`SELECT user_id FROM profile_wall_posts WHERE id = $1`, postID).Scan(&ownerID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
			return
		}
		httpx.ServerError(c, "lookup wall post", err)
		return
	}
	row["user_id"] = ownerID

	if _, err := h.db.ExecContext(c.Request.Context(),
		`DELETE FROM profile_wall_posts WHERE id = $1`, postID); err != nil {
		httpx.ServerError(c, "delete wall post", err)
		return
	}

	h.invalidateQueueCache()
	h.invalidatePostCaches(c, row)

	// Realtime: tell open walls to drop the deleted post (nil-hub safe).
	if h.hub != nil {
		_ = h.hub.PublishDeleteWallPost(row)
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": postID}})
}

// invalidateQueueCache clears every cached moderation-queue response so a new
// report / resolution / deletion is reflected on the next fetch.
func (h *Handler) invalidateQueueCache() {
	if h.redis == nil {
		return
	}
	cache.InvalidateByPattern(h.redis, "data:/api/v1/moderation/reports*")
}

// invalidatePostCaches evicts every cached response that embeds the deleted
// post: the owner's wall list, the standalone post page (+ its comments/likes/
// repost lists) and the unified feed. Mirrors the wall write-path deletions.
func (h *Handler) invalidatePostCaches(c *gin.Context, row map[string]interface{}) {
	if h.redis == nil {
		return
	}
	postID := fmt.Sprint(row["id"])
	ownerID := fmt.Sprint(row["user_id"])
	if postID != "" {
		cache.InvalidateCacheForWallPost(h.redis, postID)
		cache.InvalidateForTable(h.redis, "profile_wall_post_comments", map[string]string{"post_id": postID})
		cache.InvalidateForTable(h.redis, "profile_wall_post_likes", map[string]string{"post_id": postID})
		cache.InvalidateForTable(h.redis, "profile_wall_post_reposts", map[string]string{"post_id": postID})
	}
	if ownerID != "" {
		cache.InvalidateCacheForProfileWall(h.redis, ownerID)
	}
	cache.InvalidateCacheForFeed(h.redis)
}

// sortReports orders queue groups by open report count (desc) then newest
// report (desc) — more reports push a post higher in the queue.
func sortReports(groups []*ReportGroup) {
	sort.SliceStable(groups, func(i, j int) bool {
		a, b := groups[i], groups[j]
		if a.OpenCount != b.OpenCount {
			return a.OpenCount > b.OpenCount
		}
		aLatest := a.Reports[0].CreatedAt
		bLatest := b.Reports[0].CreatedAt
		if aLatest != nil && bLatest != nil && !aLatest.Equal(*bLatest) {
			return aLatest.After(*bLatest)
		}
		return aLatest == nil && bLatest != nil
	})
}

// fetchPostWithAuthor returns one wall post in the same enriched shape the
// wall GET serves (author embed + interaction counts), or nil when the post is
// gone. Moderators see posts even on private walls — reports are filed by
// people who already saw the content.
func (h *Handler) fetchPostWithAuthor(id string) (map[string]interface{}, error) {
	q := `
SELECT p.id, p.user_id, p.author_id, p.title, p.content, p.content_json, p.image_url, p.attachments,
       p.repost_of_post_id, p.created_at, p.updated_at, p.is_pinned, p.pinned_order,
       (SELECT COUNT(*) FROM profile_wall_post_likes l WHERE l.post_id = p.id) AS likes_count,
       (SELECT COUNT(*) FROM profile_wall_post_comments cm WHERE cm.post_id = p.id) AS comments_count,
       (SELECT COUNT(*) FROM profile_wall_post_reposts r WHERE r.post_id = p.id) AS reposts_count,
       (SELECT COUNT(*) FROM profile_wall_post_views v WHERE v.post_id = p.id) AS views_count,
       COALESCE(json_build_object(
           'username', u.username,
           'display_name', u.display_name,
           'nickname_emoji_id', u.nickname_emoji_id,
           'is_anonymous', COALESCE(u.is_anonymous, false),
           'avatar_url', u.avatar_url
       ), '{}'::json) AS author
FROM profile_wall_posts p
LEFT JOIN users u ON u.id = p.author_id
WHERE p.id = $1`
	return h.fetchOneRow(q, id)
}

func (h *Handler) fetchOneRow(q string, args ...interface{}) (map[string]interface{}, error) {
	rows, err := h.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return nil, sql.ErrNoRows
	}
	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		return nil, err
	}
	row := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		if col == "author" {
			row[col] = crud.DecodeJSONBMap(val)
			continue
		}
		if col == "content_json" || col == "attachments" {
			row[col] = crud.DecodeJSONB(val)
			continue
		}
		if b, ok := val.([]byte); ok {
			row[col] = string(b)
		} else {
			row[col] = val
		}
	}
	return row, nil
}
