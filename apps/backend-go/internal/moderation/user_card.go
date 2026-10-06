package moderation

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/authz"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/sanctions"
	"github.com/google/uuid"
)

const (
	maxModNoteRunes     = 4000
	cardRecentReports   = 10
	activityDefault     = 50
	activityMax         = 200
	maxSanctionDuration = 60 * 24 * 365 // one year, in minutes
)

// ──────────────────────────── Card payload ────────────────────────────

type cardUser struct {
	ID            string     `json:"id"`
	Username      string     `json:"username"`
	DisplayName   string     `json:"display_name,omitempty"`
	AvatarURL     *string    `json:"avatar_url,omitempty"`
	CreatedAt     *time.Time `json:"created_at"`
	IsOnline      bool       `json:"is_online"`
	IsAnonymous   bool       `json:"is_anonymous"`
	Garma         int64      `json:"garma"`
	Posts         int64      `json:"posts"`
	Threads       int64      `json:"threads"`
	WallPosts     int64      `json:"wall_posts"`
	Comments      int64      `json:"comments"`
	LikesReceived int64      `json:"likes_received"`
	Roles         []string   `json:"roles"`
	IsStaff       bool       `json:"is_staff"`
}

// SanctionItem is one row of the user's sanction history. Active is computed in
// SQL so the client never has to reason about expiry.
type SanctionItem struct {
	ID         string     `json:"id"`
	Kind       string     `json:"kind"`
	Reason     string     `json:"reason"`
	ReasonCode *string    `json:"reason_code,omitempty"`
	IssuedBy   string     `json:"issued_by,omitempty"`
	CreatedAt  *time.Time `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at,omitempty"`
	RevokedAt  *time.Time `json:"revoked_at,omitempty"`
	RevokedBy  string     `json:"revoked_by,omitempty"`
	Active     bool       `json:"active"`
}

// NoteItem is one internal moderator note.
type NoteItem struct {
	ID        string     `json:"id"`
	Body      string     `json:"body"`
	Author    string     `json:"author,omitempty"`
	CreatedAt *time.Time `json:"created_at"`
}

// ReportSummary is a count plus a short recent list.
type ReportSummary struct {
	Open   int          `json:"open"`
	Total  int          `json:"total"`
	Recent []ReportItem `json:"recent"`
}

// ActivityItem is one entry of the append-only activity ledger.
type ActivityItem struct {
	ID         int64      `json:"id"`
	EventType  string     `json:"event_type"`
	TargetType string     `json:"target_type,omitempty"`
	TargetID   string     `json:"target_id,omitempty"`
	Link       string     `json:"link,omitempty"`
	CreatedAt  *time.Time `json:"created_at"`
}

type userCardResponse struct {
	User           cardUser       `json:"user"`
	Sanctions      []SanctionItem `json:"sanctions"`
	Notes          []NoteItem     `json:"notes"`
	ReportsAgainst ReportSummary  `json:"reports_against"`
	ReportsBy      ReportSummary  `json:"reports_by"`
}

// ──────────────────────────── Card ────────────────────────────

// GetUserCard — GET /api/v1/moderation/users/:id.
// Moderator-only. One payload with everything the moderation card shows: the
// account summary, sanction history, internal notes and the reports filed
// against the user and by the user.
func (h *Handler) GetUserCard(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	ctx := c.Request.Context()

	user, err := h.loadCardUser(ctx, userID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "load user", err)
		return
	}

	card := userCardResponse{User: *user}
	card.Sanctions = h.loadSanctions(ctx, userID)
	card.Notes = h.loadNotes(ctx, userID)
	card.ReportsAgainst = h.loadReportsAgainst(ctx, userID)
	card.ReportsBy = h.loadReportsBy(ctx, userID)

	c.JSON(http.StatusOK, models.SuccessResponse(card))
}

func (h *Handler) loadCardUser(ctx context.Context, userID string) (*cardUser, error) {
	var (
		u         cardUser
		avatarURL sql.NullString
	)
	err := h.db.QueryRowContext(ctx, `
		SELECT id::text, username, COALESCE(display_name, ''), avatar_url, created_at,
		       COALESCE(is_online, false), COALESCE(is_anonymous, false),
		       COALESCE(garma, 0), COALESCE(post_count, 0), COALESCE(thread_count, 0),
		       COALESCE(wall_post_count, 0), COALESCE(comment_count, 0),
		       COALESCE(likes_received_count, 0)
		FROM users WHERE id = $1`, userID).
		Scan(&u.ID, &u.Username, &u.DisplayName, &avatarURL, &u.CreatedAt,
			&u.IsOnline, &u.IsAnonymous, &u.Garma, &u.Posts, &u.Threads,
			&u.WallPosts, &u.Comments, &u.LikesReceived)
	if err != nil {
		return nil, err
	}
	if avatarURL.Valid {
		u.AvatarURL = &avatarURL.String
	}

	u.Roles = []string{}
	rows, err := h.db.QueryContext(ctx,
		`SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role`, userID)
	if err == nil {
		for rows.Next() {
			var role string
			if rows.Scan(&role) == nil {
				u.Roles = append(u.Roles, role)
				if role == authz.RoleModerator || role == authz.RoleAdmin {
					u.IsStaff = true
				}
			}
		}
		rows.Close()
	}
	return &u, nil
}

func (h *Handler) loadSanctions(ctx context.Context, userID string) []SanctionItem {
	out := []SanctionItem{}
	rows, err := h.db.QueryContext(ctx, `
		SELECT s.id::text, s.kind, s.reason, s.reason_code, s.created_at, s.expires_at,
		       s.revoked_at, COALESCE(issuer.username, ''), COALESCE(revoker.username, ''),
		       (s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at > NOW())) AS active
		FROM user_sanctions s
		LEFT JOIN users issuer ON issuer.id = s.issued_by
		LEFT JOIN users revoker ON revoker.id = s.revoked_by
		WHERE s.user_id = $1
		ORDER BY s.created_at DESC`, userID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var it SanctionItem
		if err := rows.Scan(&it.ID, &it.Kind, &it.Reason, &it.ReasonCode, &it.CreatedAt,
			&it.ExpiresAt, &it.RevokedAt, &it.IssuedBy, &it.RevokedBy, &it.Active); err != nil {
			return out
		}
		out = append(out, it)
	}
	return out
}

func (h *Handler) loadNotes(ctx context.Context, userID string) []NoteItem {
	out := []NoteItem{}
	rows, err := h.db.QueryContext(ctx, `
		SELECT n.id::text, n.body, n.created_at, COALESCE(a.username, '')
		FROM user_mod_notes n LEFT JOIN users a ON a.id = n.author_id
		WHERE n.user_id = $1
		ORDER BY n.created_at DESC`, userID)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var it NoteItem
		if err := rows.Scan(&it.ID, &it.Body, &it.CreatedAt, &it.Author); err != nil {
			return out
		}
		out = append(out, it)
	}
	return out
}

// reportsAgainstWhere selects reports filed against a user OR against content
// they authored. $1 is the user id.
const reportsAgainstWhere = `(
	(r.target_type = 'user' AND r.target_id = $1)
	OR (r.target_type = 'wall_post' AND r.target_id IN (SELECT id FROM profile_wall_posts WHERE author_id = $1))
	OR (r.target_type = 'thread' AND r.target_id IN (SELECT id FROM threads WHERE user_id = $1))
	OR (r.target_type = 'post' AND r.target_id IN (SELECT id FROM posts WHERE user_id = $1))
	OR (r.target_type = 'wall_comment' AND r.target_id IN (SELECT id FROM profile_wall_post_comments WHERE user_id = $1))
)`

func (h *Handler) loadReportsAgainst(ctx context.Context, userID string) ReportSummary {
	sum := ReportSummary{Recent: []ReportItem{}}
	if err := h.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FILTER (WHERE r.status = 'open')::int, COUNT(*)::int
		 FROM content_reports r WHERE `+reportsAgainstWhere, userID).
		Scan(&sum.Open, &sum.Total); err != nil {
		return sum
	}
	sum.Recent = h.loadReportList(ctx, reportsAgainstWhere, userID, cardRecentReports)
	sum.Recent = h.attachReportLinks(ctx, sum.Recent)
	return sum
}

func (h *Handler) loadReportsBy(ctx context.Context, userID string) ReportSummary {
	sum := ReportSummary{Recent: []ReportItem{}}
	if err := h.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FILTER (WHERE status = 'open')::int, COUNT(*)::int
		 FROM content_reports WHERE reporter_id = $1`, userID).
		Scan(&sum.Open, &sum.Total); err != nil {
		return sum
	}
	sum.Recent = h.loadReportList(ctx, `r.reporter_id = $1`, userID, cardRecentReports)
	sum.Recent = h.attachReportLinks(ctx, sum.Recent)
	return sum
}

// loadReportList runs one of the two report queries above (where is a trusted
// constant, never user input).
func (h *Handler) loadReportList(ctx context.Context, where, userID string, limit int) []ReportItem {
	out := []ReportItem{}
	rows, err := h.db.QueryContext(ctx, `
		SELECT r.id::text, r.target_type, r.target_id::text, COALESCE(r.reporter_id::text, ''), r.category,
		       r.reason, r.status, r.created_at, r.reason_code, r.resolution_note,
		       COALESCE(u.username, ''), u.display_name, u.avatar_url, r.source
		FROM content_reports r
		LEFT JOIN users u ON u.id = r.reporter_id
		WHERE `+where+`
		ORDER BY r.created_at DESC
		LIMIT $2`, userID, limit)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var it ReportItem
		if err := rows.Scan(&it.ID, &it.TargetType, &it.TargetID, &it.ReporterID,
			&it.Category, &it.Reason, &it.Status, &it.CreatedAt, &it.ReasonCode, &it.Note,
			&it.Reporter.Username, &it.Reporter.DisplayName, &it.Reporter.AvatarURL, &it.Source); err != nil {
			return out
		}
		out = append(out, it)
	}
	return out
}

// attachReportLinks fills each report's target link (batch previews, one query
// per type).
func (h *Handler) attachReportLinks(ctx context.Context, reports []ReportItem) []ReportItem {
	if len(reports) == 0 {
		return reports
	}
	types := make([]string, 0, len(reports))
	ids := make([]string, 0, len(reports))
	for _, r := range reports {
		types = append(types, r.TargetType)
		ids = append(ids, r.TargetID)
	}
	previews := h.fetchTargetPreviews(ctx, types, ids)
	for i := range reports {
		if p, ok := previews[reports[i].TargetID]; ok {
			reports[i].TargetLink = p.Link
		}
	}
	return reports
}

// ──────────────────────────── Activity log ────────────────────────────

// GetUserActivity — GET /api/v1/moderation/users/:id/activity.
// Moderator-only. The user's actions from the append-only ledger, newest first,
// keyset-paginated by the monotonic event id (append-only ⇒ id order == time
// order). ?event_type= filters, ?limit= caps, ?before_id= pages.
func (h *Handler) GetUserActivity(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	limit := clampInt(parseIntOr(c.Query("limit"), activityDefault), 1, activityMax)

	args := []interface{}{userID}
	where := "user_id = $1"
	if et := strings.TrimSpace(c.Query("event_type")); et != "" {
		args = append(args, et)
		where += " AND event_type = $" + strconv.Itoa(len(args))
	}
	if before := strings.TrimSpace(c.Query("before_id")); before != "" {
		if id, err := strconv.ParseInt(before, 10, 64); err == nil {
			args = append(args, id)
			where += " AND id < $" + strconv.Itoa(len(args))
		}
	}
	args = append(args, limit)

	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT id, event_type, COALESCE(target_type, ''), COALESCE(target_id::text, ''), created_at
		FROM user_activity_events
		WHERE `+where+`
		ORDER BY id DESC
		LIMIT $`+strconv.Itoa(len(args)), args...)
	if err != nil {
		httpx.ServerError(c, "load activity", err)
		return
	}
	defer rows.Close()

	items := []ActivityItem{}
	types := []string{}
	ids := []string{}
	for rows.Next() {
		var it ActivityItem
		if err := rows.Scan(&it.ID, &it.EventType, &it.TargetType, &it.TargetID, &it.CreatedAt); err != nil {
			httpx.ServerError(c, "scan activity", err)
			return
		}
		if it.TargetType != "" && it.TargetID != "" {
			types = append(types, it.TargetType)
			ids = append(ids, it.TargetID)
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate activity", err)
		return
	}

	previews := h.fetchTargetPreviews(c.Request.Context(), types, ids)
	for i := range items {
		if items[i].TargetID != "" {
			if p, ok := previews[items[i].TargetID]; ok {
				items[i].Link = p.Link
			}
		}
	}

	var nextCursor string
	if len(items) == limit && len(items) > 0 {
		nextCursor = strconv.FormatInt(items[len(items)-1].ID, 10)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"items": items, "next_cursor": nextCursor}))
}

// ──────────────────────────── Notes ────────────────────────────

// AddUserNote — POST /api/v1/moderation/users/:id/notes {body}.
func (h *Handler) AddUserNote(c *gin.Context) {
	if !h.requireModerator(c) {
		return
	}
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	var body struct {
		Body string `json:"body"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	text := trimRunes(body.Body, maxModNoteRunes)
	if text == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Note body is required"))
		return
	}

	var note NoteItem
	err := h.withAudit(c.Request.Context(), func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(c.Request.Context(), `
			INSERT INTO user_mod_notes (user_id, author_id, body)
			VALUES ($1, $2, $3)
			RETURNING id::text, body, created_at`,
			userID, claims.UserID, text).Scan(&note.ID, &note.Body, &note.CreatedAt); err != nil {
			return err
		}
		note.Author = claims.Username
		return insertAction(c.Request.Context(), tx, claims.UserID, "note", TargetUser, userID, "", "", text)
	})
	if err != nil {
		httpx.ServerError(c, "add note", err)
		return
	}
	h.invalidateModerationCache()
	c.JSON(http.StatusCreated, models.SuccessResponse(note))
}

// DeleteUserNote — DELETE /api/v1/moderation/users/:id/notes/:noteId.
func (h *Handler) DeleteUserNote(c *gin.Context) {
	if !h.requireModerator(c) {
		return
	}
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID, noteID := c.Param("id"), c.Param("noteId")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	if _, err := uuid.Parse(noteID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid note id"))
		return
	}
	err := h.withAudit(c.Request.Context(), func(tx *sql.Tx) error {
		res, err := tx.ExecContext(c.Request.Context(),
			`DELETE FROM user_mod_notes WHERE id = $1 AND user_id = $2`, noteID, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		return insertAction(c.Request.Context(), tx, claims.UserID, "note_deleted", TargetUser, userID, "", "", "")
	})
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Note not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "delete note", err)
		return
	}
	h.invalidateModerationCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": noteID}})
}

// ──────────────────────────── Sanctions ────────────────────────────

// ApplySanction — POST /api/v1/moderation/users/:id/sanctions
// {kind, reason, reason_code?, duration_minutes?}. Staff cannot be sanctioned.
// Writes the sanction, the audit row and the notification in one request; the
// gate cache is invalidated so the block applies immediately.
func (h *Handler) ApplySanction(c *gin.Context) {
	if !h.requireModerator(c) {
		return
	}
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID := c.Param("id")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	if userID == claims.UserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot sanction yourself"))
		return
	}

	var body struct {
		Kind            string `json:"kind"`
		Reason          string `json:"reason"`
		ReasonCode      string `json:"reason_code"`
		DurationMinutes int    `json:"duration_minutes"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	kind := sanctions.Kind(strings.TrimSpace(body.Kind))
	if !kind.Valid() {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid sanction kind"))
		return
	}
	reason := trimRunes(body.Reason, maxReasonRunes)
	if reason == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Reason is required"))
		return
	}
	reasonCode := trimRunes(body.ReasonCode, maxReasonCodeLen)
	duration := body.DurationMinutes
	if duration < 0 {
		duration = 0
	}
	if duration > maxSanctionDuration {
		duration = maxSanctionDuration
	}

	ctx := c.Request.Context()

	// The target must exist and must not be staff — moderators cannot be
	// sanctioned by other moderators.
	var exists bool
	if err := h.db.QueryRowContext(ctx,
		`SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)`, userID).Scan(&exists); err != nil {
		httpx.ServerError(c, "lookup user", err)
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}
	if isStaff, err := authz.IsModerator(ctx, h.db, userID); err == nil && isStaff {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Cannot sanction a moderator"))
		return
	}

	var expiresArg interface{}
	if duration > 0 {
		expiresArg = time.Now().UTC().Add(time.Duration(duration) * time.Minute)
	}

	var item SanctionItem
	err := h.withAudit(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, `
			INSERT INTO user_sanctions (user_id, kind, reason, reason_code, issued_by, expires_at)
			VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6)
			RETURNING id::text, kind, reason, reason_code, created_at, expires_at`,
			userID, string(kind), reason, reasonCode, claims.UserID, expiresArg).
			Scan(&item.ID, &item.Kind, &item.Reason, &item.ReasonCode, &item.CreatedAt, &item.ExpiresAt); err != nil {
			return err
		}
		item.IssuedBy = claims.Username
		item.Active = true
		return insertAction(ctx, tx, claims.UserID, "sanction_"+string(kind), TargetUser, userID, "", reasonCode, reason)
	})
	if err != nil {
		httpx.ServerError(c, "apply sanction", err)
		return
	}

	sanctions.InvalidateBlockCache(ctx, h.redis, userID)
	h.invalidateModerationCache()

	// Tell the user why. Best-effort: a notification failure never fails the
	// sanction (it is already durably recorded above).
	if h.notif != nil {
		_, _ = h.notif.CreateNotification(notifications.CreateParams{
			RecipientID: userID,
			Type:        "sanction",
			Message:     reason,
			Params:      &models.NotificationParams{Actor: claims.Username},
			ActorID:     &claims.UserID,
		})
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(item))
}

// RevokeSanction — DELETE /api/v1/moderation/users/:id/sanctions/:sanctionId.
// Stamps revoked_at instead of deleting so the history survives.
func (h *Handler) RevokeSanction(c *gin.Context) {
	if !h.requireModerator(c) {
		return
	}
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID, sanctionID := c.Param("id"), c.Param("sanctionId")
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	if _, err := uuid.Parse(sanctionID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid sanction id"))
		return
	}

	ctx := c.Request.Context()
	err := h.withAudit(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx, `
			UPDATE user_sanctions
			SET revoked_at = NOW(), revoked_by = $1
			WHERE id = $2 AND user_id = $3 AND revoked_at IS NULL`,
			claims.UserID, sanctionID, userID)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		return insertAction(ctx, tx, claims.UserID, "unsanction", TargetUser, userID, "", "", "")
	})
	if err == sql.ErrNoRows {
		c.JSON(http.StatusConflict, models.ErrorResponse("Sanction not found or already revoked"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "revoke sanction", err)
		return
	}

	sanctions.InvalidateBlockCache(ctx, h.redis, userID)
	h.invalidateModerationCache()
	c.JSON(http.StatusOK, gin.H{"success": true, "data": gin.H{"id": sanctionID}})
}

// ──────────────────────────── Helpers ────────────────────────────

// requireModerator writes 401/403 and returns false when the caller is not
// staff. Keeps every card handler's guard identical.
func (h *Handler) requireModerator(c *gin.Context) bool {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return false
	}
	mod, err := isModerator(h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check moderator role", err)
		return false
	}
	if !mod {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Moderator access required"))
		return false
	}
	return true
}
