package moderation

import (
	"context"
	"database/sql"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// ReportDetail is the full picture of one report: the report itself, its target,
// every moderation action touching that target (or its author) and the author's
// sanction/appeal chain.
type ReportDetail struct {
	Report    ReportItem             `json:"report"`
	Target    TargetInfo             `json:"target"`
	Actions   []ModerationActionItem `json:"actions"`
	Sanctions []SanctionItem         `json:"sanctions"`
	Appeals   []AppealItem           `json:"appeals"`
}

// ActionDetail is one audit entry in full, with its target, the originating
// report and the target author's sanction/appeal chain.
type ActionDetail struct {
	Action    ModerationActionItem `json:"action"`
	Target    TargetInfo           `json:"target"`
	Report    *ReportItem          `json:"report"`
	Sanctions []SanctionItem       `json:"sanctions"`
	Appeals   []AppealItem         `json:"appeals"`
}

// GetReport — GET /api/v1/moderation/reports/:id.
// Moderator/helper read. Everything about one report on one screen.
func (h *Handler) GetReport(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid report id"))
		return
	}
	ctx := c.Request.Context()

	report, err := h.loadReport(ctx, id)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Report not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "load report", err)
		return
	}

	detail := ReportDetail{
		Report:    *report,
		Actions:   []ModerationActionItem{},
		Sanctions: []SanctionItem{},
		Appeals:   []AppealItem{},
	}
	detail.Target = h.targetByID(ctx, report.TargetType, report.TargetID)
	detail.Actions = h.loadActionsForTarget(ctx, report.TargetType, report.TargetID, detail.Target.AuthorID)
	if detail.Target.AuthorID != "" {
		detail.Sanctions = h.loadSanctions(ctx, detail.Target.AuthorID)
		detail.Appeals = h.loadAppealsForSanctions(ctx, sanctionIDs(detail.Sanctions))
	}

	c.JSON(http.StatusOK, models.SuccessResponse(detail))
}

// GetAction — GET /api/v1/moderation/actions/:id.
func (h *Handler) GetAction(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid action id"))
		return
	}
	ctx := c.Request.Context()

	var it ModerationActionItem
	var reportID sql.NullString
	err := h.db.QueryRowContext(ctx, `
		SELECT a.id::text, a.action, a.target_type, a.target_id::text, a.reason_code, a.note,
		       a.created_at, COALESCE(m.username, ''), a.report_id::text
		FROM moderation_actions a
		LEFT JOIN users m ON m.id = a.moderator_id
		WHERE a.id = $1`, id).
		Scan(&it.ID, &it.Action, &it.TargetType, &it.TargetID, &it.ReasonCode, &it.Note,
			&it.CreatedAt, &it.Moderator, &reportID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Action not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "load action", err)
		return
	}

	detail := ActionDetail{
		Action:    it,
		Target:    h.targetByID(ctx, it.TargetType, it.TargetID),
		Sanctions: []SanctionItem{},
		Appeals:   []AppealItem{},
	}
	detail.Action.Link = detail.Target.Link
	if reportID.Valid && reportID.String != "" {
		if r, err := h.loadReport(ctx, reportID.String); err == nil {
			detail.Report = r
		}
	}
	if detail.Target.AuthorID != "" {
		detail.Sanctions = h.loadSanctions(ctx, detail.Target.AuthorID)
		detail.Appeals = h.loadAppealsForSanctions(ctx, sanctionIDs(detail.Sanctions))
	}

	c.JSON(http.StatusOK, models.SuccessResponse(detail))
}

// ──────────────────────────── Helpers ────────────────────────────

func (h *Handler) loadReport(ctx context.Context, id string) (*ReportItem, error) {
	var it ReportItem
	err := h.db.QueryRowContext(ctx, `
		SELECT r.id::text, r.target_type, r.target_id::text, COALESCE(r.reporter_id::text, ''),
		       r.category, r.reason, r.status, r.created_at, r.reason_code, r.resolution_note,
		       COALESCE(u.username, ''), u.display_name, u.avatar_url, r.source
		FROM content_reports r
		LEFT JOIN users u ON u.id = r.reporter_id
		WHERE r.id = $1`, id).
		Scan(&it.ID, &it.TargetType, &it.TargetID, &it.ReporterID, &it.Category, &it.Reason,
			&it.Status, &it.CreatedAt, &it.ReasonCode, &it.Note,
			&it.Reporter.Username, &it.Reporter.DisplayName, &it.Reporter.AvatarURL, &it.Source)
	if err != nil {
		return nil, err
	}
	it.TargetLink = h.targetByID(ctx, it.TargetType, it.TargetID).Link
	return &it, nil
}

// targetByID returns the preview of one target (empty when it no longer exists).
func (h *Handler) targetByID(ctx context.Context, targetType, targetID string) TargetInfo {
	if _, ok := targetExistenceQuery[targetType]; !ok || targetID == "" {
		return TargetInfo{Type: targetType, ID: targetID}
	}
	previews := h.fetchTargetPreviews(ctx, []string{targetType}, []string{targetID})
	if p, ok := previews[targetID]; ok {
		return p
	}
	return TargetInfo{Type: targetType, ID: targetID}
}

// loadActionsForTarget returns the audit trail of one target, plus the actions
// applied to its author (sanctions carry target_type='user').
func (h *Handler) loadActionsForTarget(ctx context.Context, targetType, targetID, authorID string) []ModerationActionItem {
	// The author filter binds NULL (not "") for an unknown author: a bare ''
	// would be cast to uuid and fail the whole query.
	var authorArg interface{}
	if authorID != "" {
		authorArg = authorID
	}
	rows, err := h.db.QueryContext(ctx, `
		SELECT a.id::text, a.action, a.target_type, a.target_id::text, a.reason_code, a.note,
		       a.created_at, COALESCE(m.username, '')
		FROM moderation_actions a
		LEFT JOIN users m ON m.id = a.moderator_id
		WHERE (a.target_type = $1::text AND a.target_id = $2::uuid)
		   OR ($3::uuid IS NOT NULL AND a.target_type = 'user' AND a.target_id = $3::uuid)
		ORDER BY a.created_at DESC`, targetType, targetID, authorArg)
	if err != nil {
		log.Printf("[moderation] load actions for target failed: %v", err)
		return []ModerationActionItem{}
	}
	defer rows.Close()
	out := []ModerationActionItem{}
	for rows.Next() {
		var it ModerationActionItem
		if err := rows.Scan(&it.ID, &it.Action, &it.TargetType, &it.TargetID,
			&it.ReasonCode, &it.Note, &it.CreatedAt, &it.Moderator); err != nil {
			return out
		}
		out = append(out, it)
	}
	types := make([]string, 0, len(out))
	ids := make([]string, 0, len(out))
	for _, a := range out {
		types = append(types, a.TargetType)
		ids = append(ids, a.TargetID)
	}
	previews := h.fetchTargetPreviews(ctx, types, ids)
	for i := range out {
		if p, ok := previews[out[i].TargetID]; ok {
			out[i].Link = p.Link
		}
	}
	return out
}

func sanctionIDs(items []SanctionItem) []string {
	out := make([]string, 0, len(items))
	for _, s := range items {
		out = append(out, s.ID)
	}
	return out
}

// loadAppealsForSanctions returns the appeals filed against the given sanctions.
func (h *Handler) loadAppealsForSanctions(ctx context.Context, ids []string) []AppealItem {
	out := []AppealItem{}
	if len(ids) == 0 {
		return out
	}
	rows, err := h.db.QueryContext(ctx, `
		SELECT `+appealSelectColumns+appealFromJoin+`
		WHERE a.sanction_id = ANY($1::uuid[])
		ORDER BY a.created_at DESC`, pq.Array(ids))
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var it AppealItem
		if err := rows.Scan(&it.ID, &it.SanctionID, &it.UserID, &it.Username, &it.Body, &it.Status,
			&it.SanctionKind, &it.SanctionReason, &it.DecisionNote, &it.DecidedBy, &it.DecidedAt, &it.CreatedAt); err != nil {
			return out
		}
		out = append(out, it)
	}
	return out
}
