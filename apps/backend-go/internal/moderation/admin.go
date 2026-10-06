package moderation

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

const (
	auditDefault = 50
	auditMax     = 200
)

// ModerationStats is the dashboard payload.
type ModerationStats struct {
	// OpenReports/OpenTargets are the current queue depth.
	OpenReports int `json:"open_reports"`
	OpenTargets int `json:"open_targets"`
	// OldestOpenSeconds is the age of the oldest open report (0 = none).
	OldestOpenSeconds int64 `json:"oldest_open_seconds"`
	// MedianResponseSeconds is the median report→resolution latency over the
	// last 7 days (0 when nothing was resolved yet).
	MedianResponseSeconds int64 `json:"median_response_seconds"`
	// ReportsToday / ActionsToday are per-calendar-day counters.
	ReportsToday int `json:"reports_today"`
	ActionsToday int `json:"actions_today"`
	// OpenAppeals is the number of pending sanction appeals.
	OpenAppeals int       `json:"open_appeals"`
	ComputedAt  time.Time `json:"computed_at"`
}

// GetStats — GET /api/v1/moderation/stats.
// Moderator/helper read. One payload with the queue depth, the median response
// time and the day's activity, so the dashboard is a single request.
func (h *Handler) GetStats(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	ctx := c.Request.Context()
	out := ModerationStats{ComputedAt: time.Now().UTC()}

	if err := h.db.QueryRowContext(ctx, `
		SELECT COUNT(*)::int, COUNT(DISTINCT (target_type, target_id))::int
		FROM content_reports WHERE status = 'open'`).
		Scan(&out.OpenReports, &out.OpenTargets); err != nil {
		httpx.ServerError(c, "queue depth", err)
		return
	}

	var oldest sql.NullTime
	if err := h.db.QueryRowContext(ctx,
		`SELECT MIN(created_at) FROM content_reports WHERE status = 'open'`).Scan(&oldest); err == nil && oldest.Valid {
		out.OldestOpenSeconds = int64(time.Since(oldest.Time).Seconds())
	}

	var median sql.NullFloat64
	if err := h.db.QueryRowContext(ctx, `
		SELECT percentile_cont(0.5) WITHIN GROUP (
		         ORDER BY EXTRACT(EPOCH FROM (resolved_at - created_at)))
		FROM content_reports
		WHERE resolved_at IS NOT NULL AND resolved_at > NOW() - INTERVAL '7 days'`).Scan(&median); err == nil && median.Valid {
		out.MedianResponseSeconds = int64(median.Float64)
	}

	_ = h.db.QueryRowContext(ctx,
		`SELECT COUNT(*)::int FROM content_reports WHERE created_at >= date_trunc('day', NOW())`).
		Scan(&out.ReportsToday)
	_ = h.db.QueryRowContext(ctx,
		`SELECT COUNT(*)::int FROM moderation_actions WHERE created_at >= date_trunc('day', NOW())`).
		Scan(&out.ActionsToday)
	_ = h.db.QueryRowContext(ctx,
		`SELECT COUNT(*)::int FROM sanction_appeals WHERE status = 'open'`).
		Scan(&out.OpenAppeals)

	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// ModerationActionItem is one row of the audit log.
type ModerationActionItem struct {
	ID         string     `json:"id"`
	Action     string     `json:"action"`
	TargetType string     `json:"target_type"`
	TargetID   string     `json:"target_id"`
	Link       string     `json:"link,omitempty"`
	ReasonCode *string    `json:"reason_code,omitempty"`
	Note       *string    `json:"note,omitempty"`
	Moderator  string     `json:"moderator"`
	CreatedAt  *time.Time `json:"created_at"`
}

// ListActions — GET /api/v1/moderation/actions.
// Moderator/helper read. The append-only audit log, newest first, filterable by
// moderator, action and target type. Offset-paginated: the log is bounded and
// its id is a random UUID, so there is no monotonic keyset column.
func (h *Handler) ListActions(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	ctx := c.Request.Context()

	limit := clampInt(parseIntOr(c.Query("limit"), auditDefault), 1, auditMax)
	offset := parseNonNegative(c.Query("offset"))

	args := []interface{}{}
	where := "TRUE"
	addFilter := func(column, value string) {
		if value == "" {
			return
		}
		args = append(args, value)
		where += " AND " + column + " = $" + strconv.Itoa(len(args))
	}
	addFilter("a.moderator_id", strings.TrimSpace(c.Query("moderator_id")))
	addFilter("a.action", strings.TrimSpace(c.Query("action")))
	addFilter("a.target_type", strings.TrimSpace(c.Query("target_type")))

	var total int
	if err := h.db.QueryRowContext(ctx,
		`SELECT COUNT(*)::int FROM moderation_actions a WHERE `+where, args...).Scan(&total); err != nil {
		httpx.ServerError(c, "count actions", err)
		return
	}

	args = append(args, limit, offset)
	rows, err := h.db.QueryContext(ctx, `
		SELECT a.id::text, a.action, a.target_type, a.target_id::text, a.reason_code, a.note,
		       a.created_at, COALESCE(m.username, '')
		FROM moderation_actions a
		LEFT JOIN users m ON m.id = a.moderator_id
		WHERE `+where+`
		ORDER BY a.created_at DESC
		LIMIT $`+strconv.Itoa(len(args)-1)+` OFFSET $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		httpx.ServerError(c, "list actions", err)
		return
	}
	defer rows.Close()

	items := []ModerationActionItem{}
	types := []string{}
	ids := []string{}
	for rows.Next() {
		var it ModerationActionItem
		if err := rows.Scan(&it.ID, &it.Action, &it.TargetType, &it.TargetID,
			&it.ReasonCode, &it.Note, &it.CreatedAt, &it.Moderator); err != nil {
			httpx.ServerError(c, "scan action", err)
			return
		}
		types = append(types, it.TargetType)
		ids = append(ids, it.TargetID)
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate actions", err)
		return
	}

	previews := h.fetchTargetPreviews(ctx, types, ids)
	for i := range items {
		if p, ok := previews[items[i].TargetID]; ok {
			items[i].Link = p.Link
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"items": items, "total": total, "limit": limit, "offset": offset,
	}))
}

// requireModerationRead is the read-side guard: helper, moderator or admin.
func (h *Handler) requireModerationRead(c *gin.Context) bool {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return false
	}
	ok, err := hasModerationRead(h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check moderation role", err)
		return false
	}
	if !ok {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Moderation access required"))
		return false
	}
	return true
}
