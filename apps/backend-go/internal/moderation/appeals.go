package moderation

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/sanctions"
	"github.com/google/uuid"
)

const (
	appealDefault = 50
	appealMax     = 200
)

// AppealItem is one sanction appeal.
type AppealItem struct {
	ID             string     `json:"id"`
	SanctionID     string     `json:"sanction_id"`
	UserID         string     `json:"user_id"`
	Username       string     `json:"username"`
	Body           string     `json:"body"`
	Status         string     `json:"status"`
	SanctionKind   string     `json:"sanction_kind"`
	SanctionReason string     `json:"sanction_reason"`
	DecisionNote   *string    `json:"decision_note,omitempty"`
	DecidedBy      string     `json:"decided_by,omitempty"`
	DecidedAt      *time.Time `json:"decided_at,omitempty"`
	CreatedAt      *time.Time `json:"created_at"`
}

const appealSelectColumns = `
	a.id::text, a.sanction_id::text, a.user_id::text, COALESCE(u.username, ''),
	a.body, a.status, s.kind, s.reason, a.decision_note,
	COALESCE(d.username, ''), a.decided_at, a.created_at`

const appealFromJoin = `
	FROM sanction_appeals a
	JOIN user_sanctions s ON s.id = a.sanction_id
	LEFT JOIN users u ON u.id = a.user_id
	LEFT JOIN users d ON d.id = a.decided_by`

// SubmitAppeal — POST /api/v1/moderation/appeals {sanction_id, body}.
// Any authenticated user may appeal their OWN, still-active sanction, once.
func (h *Handler) SubmitAppeal(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	var body struct {
		SanctionID string `json:"sanction_id"`
		Body       string `json:"body"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if _, err := uuid.Parse(body.SanctionID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid sanction_id"))
		return
	}
	text := trimRunes(body.Body, maxModNoteRunes)
	if text == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Appeal text is required"))
		return
	}

	ctx := c.Request.Context()

	var (
		revokedAt sql.NullTime
		expiresAt sql.NullTime
	)
	err := h.db.QueryRowContext(ctx,
		`SELECT revoked_at, expires_at FROM user_sanctions WHERE id = $1 AND user_id = $2`,
		body.SanctionID, claims.UserID).Scan(&revokedAt, &expiresAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Sanction not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "lookup sanction", err)
		return
	}
	if revokedAt.Valid || (expiresAt.Valid && expiresAt.Time.Before(time.Now())) {
		c.JSON(http.StatusConflict, gin.H{
			"success": false, "error": "Санкция уже не действует", "code": "sanction_inactive",
		})
		return
	}

	var id string
	err = h.db.QueryRowContext(ctx, `
		INSERT INTO sanction_appeals (sanction_id, user_id, body)
		VALUES ($1, $2, $3)
		ON CONFLICT (sanction_id) DO NOTHING
		RETURNING id::text`, body.SanctionID, claims.UserID, text).Scan(&id)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusConflict, gin.H{
			"success": false, "error": "Вы уже подали апелляцию", "code": "appeal_already_exists",
		})
		return
	}
	if err != nil {
		httpx.ServerError(c, "create appeal", err)
		return
	}

	h.invalidateModerationCache()

	// Realtime: a fresh appeal lands in every open moderation screen.
	if h.hub != nil {
		_ = h.hub.PublishNewAppeal(map[string]interface{}{
			"id":          id,
			"sanction_id": body.SanctionID,
			"user_id":     claims.UserID,
		})
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{"id": id, "status": "open"}))
}

// ListMySanctions — GET /api/v1/moderation/sanctions/mine.
// The caller's own sanctions (active + history), so the appeals page can list
// what is appealable without exposing anyone else's data.
func (h *Handler) ListMySanctions(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	items := h.loadSanctions(c.Request.Context(), claims.UserID)
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"items": items}))
}

// ListMyAppeals — GET /api/v1/moderation/appeals/mine.
// The caller's own appeals, newest first.
func (h *Handler) ListMyAppeals(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	items := h.queryAppeals(c, `a.user_id = $1`, []interface{}{claims.UserID}, appealMax, 0)
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"items": items}))
}

// ListAppeals — GET /api/v1/moderation/appeals.
// Moderator/helper read. ?status=open|accepted|rejected|all, ?limit, ?offset.
func (h *Handler) ListAppeals(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	limit := clampInt(parseIntOr(c.Query("limit"), appealDefault), 1, appealMax)
	offset := parseNonNegative(c.Query("offset"))

	args := []interface{}{}
	where := "TRUE"
	status := c.Query("status")
	switch status {
	case "open", "accepted", "rejected":
		args = append(args, status)
		where = "a.status = $1"
	case "all":
	default:
		args = append(args, "open")
		where = "a.status = $1"
	}

	var total int
	if err := h.db.QueryRowContext(c.Request.Context(),
		`SELECT COUNT(*)::int `+appealFromJoin+` WHERE `+where, args...).Scan(&total); err != nil {
		httpx.ServerError(c, "count appeals", err)
		return
	}
	items := h.queryAppeals(c, where, args, limit, offset)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"items": items, "total": total, "limit": limit, "offset": offset,
	}))
}

// queryAppeals runs the shared appeal SELECT with a trusted WHERE fragment.
func (h *Handler) queryAppeals(c *gin.Context, where string, args []interface{}, limit, offset int) []AppealItem {
	rows, err := h.db.QueryContext(c.Request.Context(),
		`SELECT `+appealSelectColumns+appealFromJoin+` WHERE `+where+
			` ORDER BY a.created_at DESC LIMIT $`+strconv.Itoa(len(args)+1)+
			` OFFSET $`+strconv.Itoa(len(args)+2),
		append(args, limit, offset)...)
	if err != nil {
		httpx.ServerError(c, "list appeals", err)
		return []AppealItem{}
	}
	defer rows.Close()

	out := []AppealItem{}
	for rows.Next() {
		var it AppealItem
		if err := rows.Scan(&it.ID, &it.SanctionID, &it.UserID, &it.Username, &it.Body, &it.Status,
			&it.SanctionKind, &it.SanctionReason, &it.DecisionNote, &it.DecidedBy, &it.DecidedAt, &it.CreatedAt); err != nil {
			httpx.ServerError(c, "scan appeal", err)
			return out
		}
		out = append(out, it)
	}
	return out
}

// DecideAppeal — POST /api/v1/moderation/appeals/:id/accept|reject.
// Accepting also lifts the sanction. Both write the audit row and notify the
// user, in one transaction with the decision.
func (h *Handler) DecideAppeal(c *gin.Context) {
	h.decideAppeal(c, "accepted")
}

// RejectAppeal — POST /api/v1/moderation/appeals/:id/reject.
func (h *Handler) RejectAppeal(c *gin.Context) {
	h.decideAppeal(c, "rejected")
}

func (h *Handler) decideAppeal(c *gin.Context, status string) {
	if !h.requireModerator(c) {
		return
	}
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	id := c.Param("id")
	if _, err := uuid.Parse(id); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid appeal id"))
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&body)
	note := trimRunes(body.Note, maxNoteRunes)

	ctx := c.Request.Context()
	var userID, sanctionID string
	err := h.withAudit(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `
			UPDATE sanction_appeals
			SET status = $1, decided_by = $2, decided_at = NOW(), decision_note = NULLIF($3, '')
			WHERE id = $4 AND status = 'open'
			RETURNING user_id::text, sanction_id::text`,
			status, claims.UserID, note, id).Scan(&userID, &sanctionID); err != nil {
			return err
		}
		if status == "accepted" {
			// The appeal succeeds → the sanction is lifted.
			if _, err := tx.ExecContext(ctx, `
				UPDATE user_sanctions SET revoked_at = NOW(), revoked_by = $1
				WHERE id = $2 AND revoked_at IS NULL`, claims.UserID, sanctionID); err != nil {
				return err
			}
		}
		return insertAction(ctx, tx, claims.UserID, "appeal_"+status, TargetUser, userID, "", "", note)
	})
	if err == sql.ErrNoRows {
		c.JSON(http.StatusConflict, gin.H{
			"success": false, "error": "Апелляция не найдена или уже рассмотрена", "code": "appeal_not_open",
		})
		return
	}
	if err != nil {
		httpx.ServerError(c, "decide appeal", err)
		return
	}

	sanctions.InvalidateBlockCache(ctx, h.redis, userID)
	h.invalidateModerationCache()

	if h.notif != nil {
		notifType := "appeal_rejected"
		if status == "accepted" {
			notifType = "appeal_accepted"
		}
		_, _ = h.notif.CreateNotification(notifications.CreateParams{
			RecipientID: userID,
			Type:        notifType,
			Params:      &models.NotificationParams{Actor: claims.Username},
			ActorID:     &claims.UserID,
		})
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"id": id, "status": status}))
}
