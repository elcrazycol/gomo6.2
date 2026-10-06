package moderation

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/authz"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/lib/pq"
)

// StaffMember is one user holding at least one moderation role.
type StaffMember struct {
	UserID      string   `json:"user_id"`
	Username    string   `json:"username"`
	DisplayName string   `json:"display_name,omitempty"`
	AvatarURL   *string  `json:"avatar_url,omitempty"`
	Roles       []string `json:"roles"`
}

// uiManagedRoles are the roles an admin may grant or revoke from the staff page.
// 'admin' is deliberately excluded: it is provisioned out of band (DB), so a
// compromised admin session cannot mint more admins through the UI.
var uiManagedRoles = map[string]bool{
	authz.RoleHelper:    true,
	authz.RoleModerator: true,
}

// ListStaff — GET /api/v1/moderation/staff.
// Moderator/helper read: who currently holds moderation roles.
func (h *Handler) ListStaff(c *gin.Context) {
	if !h.requireModerationRead(c) {
		return
	}
	rows, err := h.db.QueryContext(c.Request.Context(), `
		SELECT u.id::text, u.username, COALESCE(u.display_name, ''), u.avatar_url,
		       array_agg(r.role ORDER BY r.role)
		FROM user_roles r
		JOIN users u ON u.id = r.user_id
		WHERE r.role IN ('helper', 'moderator', 'admin')
		GROUP BY u.id, u.username, u.display_name, u.avatar_url
		ORDER BY u.username`)
	if err != nil {
		httpx.ServerError(c, "list staff", err)
		return
	}
	defer rows.Close()

	items := []StaffMember{}
	for rows.Next() {
		var m StaffMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.DisplayName, &m.AvatarURL, pq.Array(&m.Roles)); err != nil {
			httpx.ServerError(c, "scan staff", err)
			return
		}
		items = append(items, m)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"items": items}))
}

// GrantRole — POST /api/v1/moderation/staff {username|user_id, role}.
// Admin only. Grants 'helper', 'moderator' or 'admin' and records the audit row.
func (h *Handler) GrantRole(c *gin.Context) {
	claims := h.requireAdmin(c)
	if claims == nil {
		return
	}
	var body struct {
		Username string `json:"username"`
		UserID   string `json:"user_id"`
		Role     string `json:"role"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	role := strings.TrimSpace(strings.ToLower(body.Role))
	if role == authz.RoleAdmin {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false, "error": "Админа через интерфейс назначить нельзя", "code": "role_admin_locked",
		})
		return
	}
	if !uiManagedRoles[role] {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid role"))
		return
	}

	ctx := c.Request.Context()
	userID := strings.TrimSpace(body.UserID)
	username := strings.TrimPrefix(strings.TrimSpace(body.Username), "@")
	if userID == "" {
		if username == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("username or user_id is required"))
			return
		}
		if err := h.db.QueryRowContext(ctx,
			`SELECT id::text FROM users WHERE username = $1`, username).Scan(&userID); err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
				return
			}
			httpx.ServerError(c, "lookup user", err)
			return
		}
	} else if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}

	var granted bool
	err := h.withAudit(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT (user_id, role) DO NOTHING`,
			userID, role)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			granted = true
		}
		return insertAction(ctx, tx, claims.UserID, "role_granted", TargetUser, userID, "", role, "")
	})
	if err != nil {
		httpx.ServerError(c, "grant role", err)
		return
	}
	if !granted {
		c.JSON(http.StatusConflict, gin.H{
			"success": false, "error": "У пользователя уже есть эта роль", "code": "role_already_granted",
		})
		return
	}

	h.invalidateModerationCache()
	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{"user_id": userID, "role": role}))
}

// RevokeRole — DELETE /api/v1/moderation/staff/:userId/:role.
// Admin only. Refuses to remove the caller's own admin role or the last admin.
func (h *Handler) RevokeRole(c *gin.Context) {
	claims := h.requireAdmin(c)
	if claims == nil {
		return
	}
	userID, role := c.Param("userId"), strings.ToLower(strings.TrimSpace(c.Param("role")))
	if role == authz.RoleAdmin {
		c.JSON(http.StatusBadRequest, gin.H{
			"success": false, "error": "Роль admin через интерфейс не меняется", "code": "role_admin_locked",
		})
		return
	}
	if !uiManagedRoles[role] {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid role"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}
	ctx := c.Request.Context()

	err := h.withAudit(ctx, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`DELETE FROM user_roles WHERE user_id = $1 AND role = $2`, userID, role)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n == 0 {
			return sql.ErrNoRows
		}
		return insertAction(ctx, tx, claims.UserID, "role_revoked", TargetUser, userID, "", role, "")
	})
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Role not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "revoke role", err)
		return
	}

	h.invalidateModerationCache()
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"user_id": userID, "role": role}))
}

// requireAdmin writes 401/403 and returns the claims, or nil.
func (h *Handler) requireAdmin(c *gin.Context) *auth.Claims {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return nil
	}
	ok, err := authz.IsAdmin(c.Request.Context(), h.db, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check admin role", err)
		return nil
	}
	if !ok {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Admin access required"))
		return nil
	}
	return claims
}
