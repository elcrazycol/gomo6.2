package moderation

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// validCategories is the allow-list for the report category field. Values are
// mirrored on the frontend (ReportDialog); the DB CHECK enforces them again.
var validCategories = map[string]bool{
	"spam": true, "abuse": true, "hate": true, "fraud": true, "explicit": true, "other": true,
}

// maxReasonRunes caps the report reason length in runes (mirrors the DB CHECK).
const maxReasonRunes = 2000

// Limits for the triage metadata and the queue page.
const (
	maxNoteRunes      = 1000
	maxReasonCodeLen  = 64
	defaultQueueLimit = 50
	maxQueueLimit     = 200
)

// ──────────────────────────── Report creation ────────────────────────────

// CreateReport — POST /api/v1/moderation/reports.
//
// Body: { target_type, target_id, category, reason }. The legacy shape
// { post_id, … } is still accepted and normalised to target_type=wall_post.
// Any authenticated user may file one report per target; a second attempt
// returns 409 with a stable code so the UI can render "you already reported
// this".
func (h *Handler) CreateReport(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	var body struct {
		TargetType string `json:"target_type"`
		TargetID   string `json:"target_id"`
		PostID     string `json:"post_id"` // legacy wall-post reports
		Category   string `json:"category"`
		Reason     string `json:"reason"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	body.TargetType = strings.TrimSpace(body.TargetType)
	body.TargetID = strings.TrimSpace(body.TargetID)
	body.PostID = strings.TrimSpace(body.PostID)
	body.Category = strings.TrimSpace(body.Category)
	body.Reason = strings.TrimSpace(body.Reason)

	if body.TargetType == "" && body.PostID != "" {
		body.TargetType, body.TargetID = TargetWallPost, body.PostID
	}
	if _, ok := targetExistenceQuery[body.TargetType]; !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid target_type"))
		return
	}
	if _, err := uuid.Parse(body.TargetID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid target_id"))
		return
	}
	if !validCategories[body.Category] {
		body.Category = "other"
	}
	if n := len([]rune(body.Reason)); n < 1 || n > maxReasonRunes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("reason must be between 1 and 2000 characters"))
		return
	}

	// L5: the target must exist. A report on a nonexistent target would
	// otherwise be accepted and linger in the queue as a dangling row.
	var exists bool
	if err := h.db.QueryRowContext(c.Request.Context(),
		targetExistenceQuery[body.TargetType], body.TargetID).Scan(&exists); err != nil {
		httpx.ServerError(c, "lookup target", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Target not found"))
		return
	}

	// post_id is a legacy convenience column for wall-post reports only.
	var postIDArg interface{}
	if body.TargetType == TargetWallPost {
		postIDArg = body.TargetID
	}

	report := ReportItem{}
	err := h.db.QueryRowContext(c.Request.Context(), `
		INSERT INTO content_reports (target_type, target_id, post_id, reporter_id, category, reason)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (target_type, target_id, reporter_id) DO NOTHING
		RETURNING id, target_type, target_id, reporter_id, category, reason, status, created_at`,
		body.TargetType, body.TargetID, postIDArg, claims.UserID, body.Category, body.Reason,
	).Scan(&report.ID, &report.TargetType, &report.TargetID, &report.ReporterID,
		&report.Category, &report.Reason, &report.Status, &report.CreatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"error":   "Вы уже пожаловались на это",
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
		`SELECT COUNT(*) FROM content_reports WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
		body.TargetType, body.TargetID).Scan(&openCount); err != nil {
		openCount = 0
	}

	// A fresh report changes the queue: evict cached queue responses and push
	// the new report to open moderation screens (nil-hub safe).
	h.invalidateModerationCache()
	if h.hub != nil {
		_ = h.hub.PublishNewReport(map[string]interface{}{
			"id":          report.ID,
			"target_type": report.TargetType,
			"target_id":   report.TargetID,
			"reporter_id": report.ReporterID,
			"category":    report.Category,
			"open_count":  openCount,
		})
	}

	c.JSON(http.StatusCreated, gin.H{"success": true, "data": report, "open_count": openCount})
}

// ──────────────────────────── Queue ────────────────────────────

// queueHavingClause maps the ?status filter to the HAVING clause that selects
// targets. Whitelisted — no user input reaches the SQL text.
func queueHavingClause(status string) string {
	switch status {
	case "resolved":
		return `COUNT(*) FILTER (WHERE status = 'resolved') > 0`
	case "rejected":
		return `COUNT(*) FILTER (WHERE status = 'rejected') > 0`
	case "all":
		return `TRUE`
	default: // "open"
		return `COUNT(*) FILTER (WHERE status = 'open') > 0`
	}
}

// ListReports — GET /api/v1/moderation/reports.
//
// Moderator-only. Returns the moderation queue grouped per target, sorted by
// open report count (desc) then newest report (desc), with filters:
//
//	?status=open|resolved|rejected|all  (default open)
//	?category=<category>                (optional)
//	?target_type=<type>                 (optional)
//	?limit=<1..200> ?offset=<n>         (grouped pagination)
//
// Targets and their reports are fetched in batch (one query per target type),
// so the queue does not issue a query per row.
func (h *Handler) ListReports(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}

	status := c.Query("status")
	switch status {
	case "open", "resolved", "rejected", "all":
	default:
		status = "open"
	}
	category := c.Query("category")
	if !validCategories[category] {
		category = ""
	}
	targetType := c.Query("target_type")
	if _, ok := targetExistenceQuery[targetType]; !ok {
		targetType = ""
	}
	limit := clampInt(parseIntOr(c.Query("limit"), defaultQueueLimit), 1, maxQueueLimit)
	offset := parseNonNegative(c.Query("offset"))

	having := queueHavingClause(status)
	const where = `WHERE ($1 = '' OR category = $1) AND ($2 = '' OR target_type = $2)`

	ctx := c.Request.Context()

	var total int
	if err := h.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM (SELECT 1 FROM content_reports `+where+
			` GROUP BY target_type, target_id HAVING `+having+`) t`,
		category, targetType).Scan(&total); err != nil {
		httpx.ServerError(c, "count reports", err)
		return
	}

	rows, err := h.db.QueryContext(ctx, `
		SELECT target_type, target_id::text,
		       COUNT(*) FILTER (WHERE status = 'open')::int AS open_count,
		       COUNT(*)::int AS total_count,
		       MAX(created_at) AS last_at
		FROM content_reports
		`+where+`
		GROUP BY target_type, target_id
		HAVING `+having+`
		ORDER BY open_count DESC, last_at DESC
		LIMIT $3 OFFSET $4`, category, targetType, limit, offset)
	if err != nil {
		httpx.ServerError(c, "list reports", err)
		return
	}
	defer rows.Close()

	groups := []*ReportGroup{}
	types := []string{}
	ids := []string{}
	for rows.Next() {
		g := &ReportGroup{}
		if err := rows.Scan(&g.Target.Type, &g.Target.ID, &g.OpenCount, &g.TotalCount, &g.LastAt); err != nil {
			httpx.ServerError(c, "scan report group", err)
			return
		}
		groups = append(groups, g)
		types = append(types, g.Target.Type)
		ids = append(ids, g.Target.ID)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate reports", err)
		return
	}

	// One query for all reports of the page's targets, one query per target
	// type for the previews — no per-row lookups.
	byTarget := h.fetchReportsForTargets(ctx, types, ids)
	previews := h.fetchTargetPreviews(ctx, types, ids)

	for _, g := range groups {
		key := g.Target.Type + ":" + g.Target.ID
		g.Reports = byTarget[key]
		if g.Reports == nil {
			g.Reports = []ReportItem{}
		}
		if p, ok := previews[g.Target.ID]; ok {
			p.Type = g.Target.Type
			g.Target = p
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(QueuePage{
		Items:  derefGroups(groups),
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}))
}

func derefGroups(groups []*ReportGroup) []ReportGroup {
	out := make([]ReportGroup, 0, len(groups))
	for _, g := range groups {
		out = append(out, *g)
	}
	return out
}

// fetchReportsForTargets loads every report of the page's targets in one query,
// keyed by "type:id".
func (h *Handler) fetchReportsForTargets(ctx context.Context, types, ids []string) map[string][]ReportItem {
	out := map[string][]ReportItem{}
	if len(types) == 0 {
		return out
	}
	rows, err := h.db.QueryContext(ctx, `
		SELECT r.id, r.target_type, r.target_id::text, COALESCE(r.reporter_id::text, ''), r.category,
		       r.reason, r.status, r.created_at, r.reason_code, r.resolution_note,
		       COALESCE(u.username, ''), u.display_name, u.avatar_url, r.source
		FROM content_reports r
		LEFT JOIN users u ON u.id = r.reporter_id
		WHERE (r.target_type, r.target_id) IN (
			SELECT t, i FROM unnest($1::text[], $2::uuid[]) AS x(t, i)
		)
		ORDER BY r.created_at DESC`, pq.Array(types), pq.Array(ids))
	if err != nil {
		log.Printf("[moderation] fetch reports failed: %v", err)
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var it ReportItem
		if err := rows.Scan(&it.ID, &it.TargetType, &it.TargetID, &it.ReporterID,
			&it.Category, &it.Reason, &it.Status, &it.CreatedAt, &it.ReasonCode, &it.Note,
			&it.Reporter.Username, &it.Reporter.DisplayName, &it.Reporter.AvatarURL, &it.Source); err != nil {
			log.Printf("[moderation] scan report failed: %v", err)
			return out
		}
		key := it.TargetType + ":" + it.TargetID
		out[key] = append(out[key], it)
	}
	return out
}

// fetchTargetPreviews loads the display context of the page's targets: one
// query per target type present (batch, never per row). Targets that no longer
// exist are simply absent from the map (the caller marks them exists=false).
func (h *Handler) fetchTargetPreviews(ctx context.Context, types, ids []string) map[string]TargetInfo {
	out := map[string]TargetInfo{}
	if len(types) == 0 {
		return out
	}
	idsByType := map[string][]string{}
	seen := map[string]bool{}
	for i, t := range types {
		key := t + ":" + ids[i]
		if seen[key] {
			continue
		}
		seen[key] = true
		idsByType[t] = append(idsByType[t], ids[i])
	}
	// Deterministic type order: map iteration is random, and the preview queries
	// must run in a stable order (tests, and a predictable query log).
	typeKeys := make([]string, 0, len(idsByType))
	for t := range idsByType {
		typeKeys = append(typeKeys, t)
	}
	sort.Strings(typeKeys)

	for _, t := range typeKeys {
		typeIDs := idsByType[t]
		q, ok := targetPreviewQuery[t]
		if !ok {
			continue
		}
		rows, err := h.db.QueryContext(ctx, q, pq.Array(typeIDs))
		if err != nil {
			log.Printf("[moderation] preview %s failed: %v", t, err)
			continue
		}
		for rows.Next() {
			var (
				p          TargetInfo
				authorID   sql.NullString
				ctx1, ctx2 sql.NullString
			)
			p.Type = t
			p.Exists = true
			if err := rows.Scan(&p.ID, &p.Title, &p.Content, &p.AuthorUsername, &authorID,
				&p.CreatedAt, &ctx1, &ctx2); err != nil {
				log.Printf("[moderation] scan preview %s failed: %v", t, err)
				break
			}
			p.AuthorID = authorID.String
			p.Link = buildTargetLink(t, p.ID, ctx1.String, ctx2.String)
			out[p.ID] = p
		}
		rows.Close()
	}
	return out
}

// buildTargetLink returns the in-app path that opens the target, or "" when the
// context needed to build it is missing. The path shapes mirror App.tsx routes
// (profile wall post, thread page, profile).
func buildTargetLink(targetType, id, ctx1, ctx2 string) string {
	switch targetType {
	case TargetWallPost:
		if ctx1 == "" {
			return ""
		}
		return "/profile/" + ctx1 + "/wall/" + id
	case TargetWallComment:
		if ctx1 == "" || ctx2 == "" {
			return ""
		}
		return "/profile/" + ctx1 + "/wall/" + ctx2
	case TargetThread:
		return "/thread/" + id
	case TargetPost:
		if ctx1 == "" {
			return ""
		}
		return "/thread/" + ctx1
	case TargetUser:
		return "/profile/" + id
	case TargetGomosub:
		if ctx1 == "" {
			return ""
		}
		return "/g/" + ctx1
	}
	return ""
}

// ──────────────────────────── Triage ────────────────────────────

// ResolveReport — POST /api/v1/moderation/reports/:id/resolve.
// RejectReport — POST /api/v1/moderation/reports/:id/reject.
// Both close ONE open report, record the reason in the report and write the
// audit row in the same transaction.
func (h *Handler) ResolveReport(c *gin.Context) { h.triageReport(c, "resolved") }
func (h *Handler) RejectReport(c *gin.Context)  { h.triageReport(c, "rejected") }

func (h *Handler) triageReport(c *gin.Context, status string) {
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
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid report id"))
		return
	}

	var body struct {
		ReasonCode string `json:"reason_code"`
		Note       string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body) // body is optional
	reasonCode := trimRunes(body.ReasonCode, maxReasonCodeLen)
	note := trimRunes(body.Note, maxNoteRunes)

	var targetType, targetID, reporterID string
	var reporterNull sql.NullString
	err = h.withAudit(c.Request.Context(), func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(c.Request.Context(), `
			UPDATE content_reports
			SET status = $1, reason_code = NULLIF($2, ''), resolution_note = NULLIF($3, ''),
			    resolved_by = $4, resolved_at = NOW()
			WHERE id = $5 AND status = 'open'
			RETURNING target_type, target_id::text, reporter_id::text`,
			status, reasonCode, note, claims.UserID, id).Scan(&targetType, &targetID, &reporterNull); err != nil {
			return err
		}
		reporterID = reporterNull.String
		return insertAction(c.Request.Context(), tx, claims.UserID, status, targetType, targetID, id, reasonCode, note)
	})
	if err == sql.ErrNoRows {
		// Distinguish "already handled" from "not found".
		var current string
		if e := h.db.QueryRowContext(c.Request.Context(),
			`SELECT status FROM content_reports WHERE id = $1`, id).Scan(&current); e == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Report not found"))
		} else {
			c.JSON(http.StatusConflict, gin.H{
				"success": false,
				"error":   "Report already handled",
				"code":    "report_already_handled",
			})
		}
		return
	}
	if err != nil {
		httpx.ServerError(c, "triage report", err)
		return
	}

	h.invalidateModerationCache()

	// Tell the reporter their report was handled. Best-effort; system reports
	// have no reporter.
	if h.notif != nil && reporterID != "" {
		notifType := "report_resolved"
		if status == "rejected" {
			notifType = "report_rejected"
		}
		_, _ = h.notif.CreateNotification(notifications.CreateParams{
			RecipientID: reporterID,
			Type:        notifType,
			Params:      &models.NotificationParams{Actor: claims.Username},
			ActorID:     &claims.UserID,
		})
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"id": id, "status": status, "target_type": targetType, "target_id": targetID,
	}})
}

// ResolveTargetReports — POST /api/v1/moderation/targets/:targetType/:targetId/resolve.
// Moderator-only. Closes EVERY open report on the target in one transaction and
// logs a single audit row. (The content itself is not touched — deletion is a
// separate action.)
func (h *Handler) ResolveTargetReports(c *gin.Context) {
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
	targetType := c.Param("targetType")
	if _, ok := targetExistenceQuery[targetType]; !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid target_type"))
		return
	}
	targetID := c.Param("targetId")
	if _, err := uuid.Parse(targetID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid target_id"))
		return
	}

	var body struct {
		ReasonCode string `json:"reason_code"`
		Note       string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	reasonCode := trimRunes(body.ReasonCode, maxReasonCodeLen)
	note := trimRunes(body.Note, maxNoteRunes)

	var resolved int64
	err = h.withAudit(c.Request.Context(), func(tx *sql.Tx) error {
		res, err := tx.ExecContext(c.Request.Context(), `
			UPDATE content_reports
			SET status = 'resolved', reason_code = NULLIF($3, ''), resolution_note = NULLIF($4, ''),
			    resolved_by = $5, resolved_at = NOW()
			WHERE target_type = $1 AND target_id = $2 AND status = 'open'`,
			targetType, targetID, reasonCode, note, claims.UserID)
		if err != nil {
			return err
		}
		resolved, _ = res.RowsAffected()
		return insertAction(c.Request.Context(), tx, claims.UserID, "resolve_target", targetType, targetID, "", reasonCode, note)
	})
	if err != nil {
		httpx.ServerError(c, "resolve target reports", err)
		return
	}

	h.invalidateModerationCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{
		"target_type": targetType, "target_id": targetID, "resolved": resolved,
	}})
}

// ──────────────────────────── Content actions ────────────────────────────

// DeletePost — DELETE /api/v1/moderation/posts/:postId.
// Moderator-only. Hard-deletes the wall post (its comments/likes cascade via
// FK), purges its reports (the polymorphic FK is gone) and writes the audit row
// in one transaction, then invalidates every cache that embeds the post and
// pushes a delete_wall_post realtime event.
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
	err = h.withAudit(c.Request.Context(), func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(c.Request.Context(),
			`SELECT user_id FROM profile_wall_posts WHERE id = $1`, postID).Scan(&ownerID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c.Request.Context(),
			`DELETE FROM profile_wall_posts WHERE id = $1`, postID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(c.Request.Context(),
			`DELETE FROM content_reports WHERE target_type = $1 AND target_id = $2`,
			TargetWallPost, postID); err != nil {
			return err
		}
		return insertAction(c.Request.Context(), tx, claims.UserID, "delete_content", TargetWallPost, postID, "", "", "")
	})
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "delete wall post", err)
		return
	}
	row["user_id"] = ownerID

	h.invalidateModerationCache()
	h.invalidatePostCaches(c, row)
	if h.hub != nil {
		_ = h.hub.PublishDeleteWallPost(row)
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": postID}})
}

// ──────────────────────────── Helpers ────────────────────────────

// withAudit runs fn in a transaction. Moderation mutations and their audit row
// commit together — an action can never be applied without a record of who did
// it and why.
func (h *Handler) withAudit(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// insertAction appends one moderation audit row.
func insertAction(ctx context.Context, tx *sql.Tx, moderatorID, action, targetType, targetID, reportID, reasonCode, note string) error {
	var reportArg interface{}
	if reportID != "" {
		reportArg = reportID
	}
	var rcArg, noteArg interface{}
	if reasonCode != "" {
		rcArg = reasonCode
	}
	if note != "" {
		noteArg = note
	}
	_, err := tx.ExecContext(ctx, `
		INSERT INTO moderation_actions (moderator_id, action, target_type, target_id, report_id, reason_code, note)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		moderatorID, action, targetType, targetID, reportArg, rcArg, noteArg)
	return err
}

// invalidateModerationCache clears every cached moderation response (the queue,
// user cards, activity logs). Moderation is no longer served from the data cache
// at all, but this also purges keys written before that change and any other
// cache that ever embeds moderation data.
func (h *Handler) invalidateModerationCache() {
	if h.redis == nil {
		return
	}
	cache.InvalidateByPattern(h.redis, "data:/api/v1/moderation*")
}

// invalidatePostCaches evicts every cached response that embeds the deleted
// post: the owner's wall list, the standalone post page (+ its comments/likes/
// repost lists) and the unified feed.
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

// trimRunes trims space and caps a string to n runes.
func trimRunes(s string, n int) string {
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

func parseIntOr(s string, fallback int) int {
	if s == "" {
		return fallback
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return fallback
	}
	return n
}

func parseNonNegative(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil || n < 0 {
		return 0
	}
	return n
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
