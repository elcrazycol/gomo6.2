package rpc

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gomo6/backend/internal/gomosubaudit"
	"github.com/gomo6/backend/internal/gomosubperms"
	"github.com/gomo6/backend/internal/websocket"

	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"

	"github.com/gin-gonic/gin"
)

// ─── GomoSub moderation (Discord-like kick/ban/timeout) ─────────────────────
// Stage 2 of the gomosub overhaul. All mutations enforce three gates:
//   1. Permission: the specific grant (kick/ban/timeout_members), or
//      can_manage_members, or administrator — owners bypass everything.
//   2. Self-protection: nobody moderates themselves (leave instead) and
//      nobody moderates the board owner.
//   3. Hierarchy: the actor's top role position must be strictly above the
//      target's (gomosubperms.CanManageRole); administrator bypasses.

const (
	// maxTimeoutMinutes is 28 days — Discord parity for timeouts.
	maxTimeoutMinutes = 40320
)

// modProfile is one user's server-level standing on a board, resolved
// through the shared kernel.
type modProfile struct {
	eff *gomosubperms.Effective
}

// loadModProfile resolves the caller's standing via the shared kernel.
func loadModProfile(db *sql.DB, boardID, userID string) (*modProfile, error) {
	eff, err := gomosubperms.LoadEffective(db, boardID, userID)
	if err != nil {
		return nil, err
	}
	return &modProfile{eff: eff}, nil
}

// perms is shorthand for the resolved grant set.
func (p *modProfile) perms() map[string]bool { return p.eff.Perms() }

// isMember reports board membership.
func (p *modProfile) isMember() bool { return p.eff.IsMember }

// topRole is the highest held role position.
func (p *modProfile) topRole() int { return p.eff.Top() }

// authorizeMod enforces the three moderation gates. It returns nil + writes
// the denial response when the action is not allowed.
func (h *RPCHandler) authorizeMod(c *gin.Context, boardID, targetID, needPerm string) bool {
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return false
	}
	actorID := claims.UserID
	if targetID == "" || boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("board_id and user_id are required"))
		return false
	}
	if targetID == actorID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("You cannot moderate yourself"))
		return false
	}

	var ownerID string
	if err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&ownerID); err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return false
	} else if err != nil {
		httpx.ServerError(c, "handler error", err)
		return false
	}
	if targetID == ownerID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("The board owner cannot be moderated"))
		return false
	}
	if actorID == ownerID {
		return true
	}

	actor, err := loadModProfile(h.db, boardID, actorID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return false
	}
	if !actor.isMember() {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You are not a member of this gomosub"))
		return false
	}
	if !actor.perms()[needPerm] && !actor.perms()["can_manage_members"] && !actor.perms()["administrator"] {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
		return false
	}
	if actor.perms()["administrator"] {
		return true
	}
	target, err := loadModProfile(h.db, boardID, targetID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return false
	}
	if actor.topRole() <= target.topRole() {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You cannot moderate someone with an equal or higher role"))
		return false
	}
	return true
}

// publishMemberChanged fans roster changes to the board room (nil-safe).
func (h *RPCHandler) publishMemberChanged(boardID, userID, action string) {
	if hub, ok := h.wsHub.(*websocket.Hub); ok && hub != nil {
		_ = hub.PublishGomoSubMemberChanged(boardID, userID, action)
	}
}

// auditModeration records a moderation action in the audit log (best-effort).
func (h *RPCHandler) auditModeration(boardID, actorID, action string, targetUserID *string, reason *string) {
	if h.db == nil {
		return
	}
	gomosubaudit.Log(h.db, gomosubaudit.Entry{
		BoardID: boardID, ActorID: actorID, Action: action,
		TargetUserID: targetUserID, Reason: reason,
	})
}

func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (h *RPCHandler) invalidateMembershipsCache(boardID, userID string) {
	if h.redis == nil {
		return
	}
	cache.InvalidateForTable(h.redis, "gomosub_memberships", map[string]string{"board_id": boardID})
	if userID != "" {
		cache.InvalidateForTable(h.redis, "gomosub_memberships", map[string]string{"user_id": userID})
	}
}

// modRequest is the shared body of kick/ban/timeout calls.
type modRequest struct {
	BoardID string  `json:"board_id"`
	UserID  string  `json:"user_id"`
	Reason  *string `json:"reason"`
}

// KickMember removes a member (and their role grants) without banning.
// POST /api/rpc/gomosub_kick
func (h *RPCHandler) KickMember(c *gin.Context) {
	var req modRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if !h.authorizeMod(c, req.BoardID, req.UserID, "kick_members") {
		return
	}
	claims, _ := httpx.BearerClaims(c)
	tx, err := h.db.Begin()
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM gomosub_member_roles WHERE board_id = $1 AND user_id = $2`, req.BoardID, req.UserID); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	res, err := tx.Exec(`DELETE FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2`, req.BoardID, req.UserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User is not a member of this gomosub"))
		return
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	h.invalidateMembershipsCache(req.BoardID, req.UserID)
	h.publishMemberChanged(req.BoardID, req.UserID, "kicked")
	h.auditModeration(req.BoardID, claims.UserID, gomosubaudit.ActionKick, strPtrOrNil(req.UserID), req.Reason)
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "kicked"}))
}

// BanMember bans a user (active bans block every read/write path), removes
// their membership, and optionally soft-deletes their chat messages.
// POST /api/rpc/gomosub_ban
func (h *RPCHandler) BanMember(c *gin.Context) {
	var req struct {
		modRequest
		ExpiresAt         *time.Time `json:"expires_at"`
		DeleteMessages    bool       `json:"delete_messages"`
		DeleteMessageDays *int       `json:"delete_message_days"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if !h.authorizeMod(c, req.BoardID, req.UserID, "ban_members") {
		return
	}
	if req.ExpiresAt != nil && !req.ExpiresAt.After(time.Now()) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("expires_at must be in the future"))
		return
	}
	claims, _ := httpx.BearerClaims(c)
	tx, err := h.db.Begin()
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer tx.Rollback()
	var reason interface{}
	if req.Reason != nil {
		reason = *req.Reason
	}
	var expires interface{}
	if req.ExpiresAt != nil {
		expires = *req.ExpiresAt
	}
	if _, err := tx.Exec(`
		INSERT INTO gomosub_bans (board_id, user_id, reason, created_by, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (board_id, user_id) DO UPDATE
		SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at,
		    created_by = EXCLUDED.created_by, created_at = NOW()`,
		req.BoardID, req.UserID, reason, claims.UserID, expires); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM gomosub_member_roles WHERE board_id = $1 AND user_id = $2`, req.BoardID, req.UserID); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if _, err := tx.Exec(`DELETE FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2`, req.BoardID, req.UserID); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	// Message purge: delete_message_days (0/1/7, Discord parity) wins when
	// set; the legacy delete_messages flag keeps its all-messages meaning.
	purgeDays := -1
	if req.DeleteMessageDays != nil && (*req.DeleteMessageDays == 0 || *req.DeleteMessageDays == 1 || *req.DeleteMessageDays == 7) {
		purgeDays = *req.DeleteMessageDays
	} else if req.DeleteMessages {
		purgeDays = -1
	}
	if purgeDays >= 0 || req.DeleteMessages {
		cutoff := time.Now().AddDate(0, 0, -purgeDays)
		purgeQuery := `
			UPDATE channel_messages SET deleted_at = NOW()
			WHERE user_id = $2 AND deleted_at IS NULL
			  AND channel_id IN (SELECT id FROM channels WHERE board_id = $1)`
		var purgeArgs []interface{}
		if purgeDays > 0 {
			purgeQuery += " AND created_at > $3"
			purgeArgs = []interface{}{req.BoardID, req.UserID, cutoff}
		} else {
			purgeArgs = []interface{}{req.BoardID, req.UserID}
		}
		if _, err := tx.Exec(purgeQuery, purgeArgs...); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
	}
	if err := tx.Commit(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	h.invalidateMembershipsCache(req.BoardID, req.UserID)
	h.publishMemberChanged(req.BoardID, req.UserID, "banned")
	h.auditModeration(req.BoardID, claims.UserID, gomosubaudit.ActionBan, strPtrOrNil(req.UserID), req.Reason)
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "banned"}))
}

// UnbanMember lifts a ban. POST /api/rpc/gomosub_unban
func (h *RPCHandler) UnbanMember(c *gin.Context) {
	var req modRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if !h.authorizeMod(c, req.BoardID, req.UserID, "ban_members") {
		return
	}
	claims, _ := httpx.BearerClaims(c)
	res, err := h.db.Exec(`DELETE FROM gomosub_bans WHERE board_id = $1 AND user_id = $2`, req.BoardID, req.UserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User is not banned"))
		return
	}
	h.publishMemberChanged(req.BoardID, req.UserID, "unbanned")
	h.auditModeration(req.BoardID, claims.UserID, gomosubaudit.ActionUnban, strPtrOrNil(req.UserID), nil)
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "unbanned"}))
}

// TimeoutMember mutes a member until expires (max 28 days). POST /api/rpc/gomosub_timeout
func (h *RPCHandler) TimeoutMember(c *gin.Context) {
	var req struct {
		modRequest
		DurationMinutes *int       `json:"duration_minutes"`
		ExpiresAt       *time.Time `json:"expires_at"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if !h.authorizeMod(c, req.BoardID, req.UserID, "timeout_members") {
		return
	}
	var until time.Time
	switch {
	case req.ExpiresAt != nil:
		until = *req.ExpiresAt
	case req.DurationMinutes != nil:
		until = time.Now().Add(time.Duration(*req.DurationMinutes) * time.Minute)
	default:
		c.JSON(http.StatusBadRequest, models.ErrorResponse("duration_minutes or expires_at is required"))
		return
	}
	if !until.After(time.Now()) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("timeout must end in the future"))
		return
	}
	if until.After(time.Now().Add(maxTimeoutMinutes * time.Minute)) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("timeout cannot exceed 28 days"))
		return
	}
	res, err := h.db.Exec(`UPDATE gomosub_memberships SET timed_out_until = $3 WHERE board_id = $1 AND user_id = $2`,
		req.BoardID, req.UserID, until)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User is not a member of this gomosub"))
		return
	}
	h.invalidateMembershipsCache(req.BoardID, req.UserID)
	h.publishMemberChanged(req.BoardID, req.UserID, "timed_out")
	claims, _ := httpx.BearerClaims(c)
	h.auditModeration(req.BoardID, claims.UserID, gomosubaudit.ActionTimeout, strPtrOrNil(req.UserID), req.Reason)
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "timed_out"}))
}

// UntimeoutMember clears a timeout early. POST /api/rpc/gomosub_untimeout
func (h *RPCHandler) UntimeoutMember(c *gin.Context) {
	var req modRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	if !h.authorizeMod(c, req.BoardID, req.UserID, "timeout_members") {
		return
	}
	res, err := h.db.Exec(`UPDATE gomosub_memberships SET timed_out_until = NULL WHERE board_id = $1 AND user_id = $2`,
		req.BoardID, req.UserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User is not a member of this gomosub"))
		return
	}
	h.invalidateMembershipsCache(req.BoardID, req.UserID)
	h.publishMemberChanged(req.BoardID, req.UserID, "untimeout")
	claims, _ := httpx.BearerClaims(c)
	h.auditModeration(req.BoardID, claims.UserID, gomosubaudit.ActionUntimeout, strPtrOrNil(req.UserID), nil)
	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "untimeout"}))
}

// BanListItem is one active ban with the offender's display name.
type BanListItem struct {
	UserID    string     `json:"user_id"`
	Username  string     `json:"username"`
	Reason    *string    `json:"reason"`
	CreatedBy *string    `json:"created_by"`
	ExpiresAt *time.Time `json:"expires_at"`
	CreatedAt time.Time  `json:"created_at"`
}

// ListBans returns active (non-expired) bans — the Discord ban list.
// GET /api/rpc/gomosub_bans?_board_id=
func (h *RPCHandler) ListBans(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}
	boardID := c.Query("_board_id")
	if boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_board_id is required"))
		return
	}
	var ownerID string
	if err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&ownerID); err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	} else if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if claims.UserID != ownerID {
		prof, err := loadModProfile(h.db, boardID, claims.UserID)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		if !prof.isMember() || (!prof.perms()["ban_members"] && !prof.perms()["can_manage_members"] && !prof.perms()["administrator"]) {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
			return
		}
	}
	rows, err := h.db.Query(`
		SELECT b.user_id, COALESCE(u.username, ''), b.reason, b.created_by, b.expires_at, b.created_at
		FROM gomosub_bans b LEFT JOIN users u ON u.id = b.user_id
		WHERE b.board_id = $1 AND (b.expires_at IS NULL OR b.expires_at > NOW())
		ORDER BY b.created_at DESC`, boardID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()
	items := []BanListItem{}
	for rows.Next() {
		var it BanListItem
		if err := rows.Scan(&it.UserID, &it.Username, &it.Reason, &it.CreatedBy, &it.ExpiresAt, &it.CreatedAt); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(items))
}

// AuditListItem is one audit row with display names resolved.
type AuditListItem struct {
	ID              string    `json:"id"`
	ActorID         *string   `json:"actor_id"`
	ActorUsername   string    `json:"actor_username"`
	Action          string    `json:"action"`
	TargetUserID    *string   `json:"target_user_id"`
	TargetUsername  string    `json:"target_username"`
	TargetRoleID    *string   `json:"target_role_id"`
	TargetChannelID *string   `json:"target_channel_id"`
	Reason          *string   `json:"reason"`
	CreatedAt       time.Time `json:"created_at"`
}

// ListAuditLog returns recent audit entries — the Discord audit-log view.
// Same gate as the ban list: owner or a member holding ban/manage-members
// (or administrator). Bounded (default 100, max 200), newest first.
// GET /api/rpc/gomosub_audit_log?_board_id=
func (h *RPCHandler) ListAuditLog(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}
	boardID := c.Query("_board_id")
	if boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_board_id is required"))
		return
	}
	limit := 100
	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 200 {
			limit = l
		}
	}
	var ownerID string
	if err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&ownerID); err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	} else if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if claims.UserID != ownerID {
		prof, err := loadModProfile(h.db, boardID, claims.UserID)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		if !prof.isMember() || (!prof.perms()["ban_members"] && !prof.perms()["can_manage_members"] && !prof.perms()["administrator"]) {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
			return
		}
	}
	rows, err := h.db.Query(`
		SELECT a.id, a.actor_id, COALESCE(au.username, ''), a.action,
		       a.target_user_id, COALESCE(tu.username, ''), a.target_role_id, a.target_channel_id,
		       a.reason, a.created_at
		FROM gomosub_audit_log a
		LEFT JOIN users au ON au.id = a.actor_id
		LEFT JOIN users tu ON tu.id = a.target_user_id
		WHERE a.board_id = $1
		ORDER BY a.created_at DESC
		LIMIT $2`, boardID, limit)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()
	items := []AuditListItem{}
	for rows.Next() {
		var it AuditListItem
		if err := rows.Scan(&it.ID, &it.ActorID, &it.ActorUsername, &it.Action,
			&it.TargetUserID, &it.TargetUsername, &it.TargetRoleID, &it.TargetChannelID,
			&it.Reason, &it.CreatedAt); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		items = append(items, it)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(items))
}
