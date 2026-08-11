package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// ─── Avatar History RPC handlers ────────────────────────────────────────────

// GetAvatarHistory returns avatar history for a user.
// GetAvatarHistory godoc
// @Summary      Get avatar history
// @Description  List a user's avatar history (respects private profile settings)
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body object true "Body: {\"user_uuid\": string}"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_avatar_history [post]
// @Security     BearerAuth
func (h *RPCHandler) GetAvatarHistory(c *gin.Context) {
	var req struct {
		UserUUID string `json:"user_uuid"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.UserUUID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

	if _, err := uuid.Parse(req.UserUUID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	// Privacy: avatar history is profile content. If the target has a private
	// profile with private_hide_avatar, only the owner and mutual friends may
	// list it — otherwise a stranger could harvest every historical avatar URL
	// (photos) of a private user.
	viewerID := ""
	if claims, ok := bearerClaims(c); ok {
		viewerID = claims.UserID
	}
	if viewerID != req.UserUUID {
		ps, err := GetPrivacySettings(h.db, req.UserUUID)
		if err != nil {
			serverError(c, "handler error", err)
			return
		}
		if ps.PrivateProfile && ps.PrivateHideAvatar {
			c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
			return
		}
		if ps.PrivateProfile {
			isFriend, err := IsMutualFriend(h.db, viewerID, req.UserUUID)
			if err != nil {
				serverError(c, "handler error", err)
				return
			}
			if !isFriend {
				c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
				return
			}
		}
	}

	rows, err := h.db.Query(`
		SELECT id, avatar_url, uploaded_at, is_current
		FROM avatar_history
		WHERE user_id = $1
		ORDER BY uploaded_at DESC
	`, req.UserUUID)
	if err != nil {
		serverError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var avatars []map[string]interface{}
	for rows.Next() {
		var id, avatarURL string
		var uploadedAt time.Time
		var isCurrent bool

		if err := rows.Scan(&id, &avatarURL, &uploadedAt, &isCurrent); err != nil {
			serverError(c, "handler error", err)
			return
		}

		avatars = append(avatars, map[string]interface{}{
			"id":          id,
			"avatar_url":  avatarURL,
			"uploaded_at": uploadedAt.UTC().Format(time.RFC3339Nano),
			"is_current":  isCurrent,
		})
	}

	if avatars == nil {
		avatars = []map[string]interface{}{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(avatars))
}

// DeleteAvatarFromHistory deletes an avatar from history.
// DeleteAvatarFromHistory godoc
// @Summary      Delete avatar from history
// @Description  Delete an avatar from history (owner only)
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body object true "Body: {\"avatar_id\": string, \"requesting_user_id\": string}"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /rpc/delete_avatar_from_history [post]
// @Security     BearerAuth
func (h *RPCHandler) DeleteAvatarFromHistory(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		AvatarID         string `json:"avatar_id"`
		RequestingUserID string `json:"requesting_user_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.AvatarID == "" || req.RequestingUserID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("avatar_id and requesting_user_id are required"))
		return
	}

	if _, err := uuid.Parse(req.AvatarID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid avatar_id format"))
		return
	}
	if _, err := uuid.Parse(req.RequestingUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid requesting_user_id format"))
		return
	}

	// Check that requesting user matches authenticated user
	if claims.UserID != req.RequestingUserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied"))
		return
	}

	// Get avatar details
	var avatarUserID, avatarURL string
	var isCurrent bool
	err := h.db.QueryRow(`
		SELECT user_id, avatar_url, is_current
		FROM avatar_history
		WHERE id = $1
	`, req.AvatarID).Scan(&avatarUserID, &avatarURL, &isCurrent)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, models.SuccessResponse(false))
			return
		}
		serverError(c, "handler error", err)
		return
	}

	// Check ownership
	if avatarUserID != req.RequestingUserID {
		c.JSON(http.StatusOK, models.SuccessResponse(false))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		serverError(c, "handler error", err)
		return
	}
	defer tx.Rollback()

	// Delete the avatar
	_, err = tx.Exec("DELETE FROM avatar_history WHERE id = $1", req.AvatarID)
	if err != nil {
		serverError(c, "handler error", err)
		return
	}

	// If this was the current avatar, update user profile to use previous avatar
	if isCurrent {
		// Mark all as not current first
		_, err = tx.Exec("UPDATE avatar_history SET is_current = FALSE WHERE user_id = $1", avatarUserID)
		if err != nil {
			serverError(c, "handler error", err)
			return
		}

		var prevAvatarURL sql.NullString
		err = tx.QueryRow(`
			SELECT avatar_url
			FROM avatar_history
			WHERE user_id = $1
			ORDER BY uploaded_at DESC
			LIMIT 1
		`, avatarUserID).Scan(&prevAvatarURL)

		if err != nil && err != sql.ErrNoRows {
			serverError(c, "handler error", err)
			return
		}

		// Mark previous avatar as current
		if prevAvatarURL.Valid {
			_, err = tx.Exec(`
				UPDATE avatar_history
				SET is_current = TRUE
				WHERE user_id = $1 AND avatar_url = $2
			`, avatarUserID, prevAvatarURL.String)

			if err != nil {
				serverError(c, "handler error", err)
				return
			}
		}

		// Disable trigger temporarily to prevent duplicate
		_, err = tx.Exec("SET session_replication_role = replica")
		if err != nil {
			serverError(c, "handler error", err)
			return
		}

		// Update user profile
		if prevAvatarURL.Valid {
			_, err = tx.Exec("UPDATE users SET avatar_url = $1 WHERE id = $2", prevAvatarURL.String, avatarUserID)
		} else {
			_, err = tx.Exec("UPDATE users SET avatar_url = NULL WHERE id = $1", avatarUserID)
		}

		if err != nil {
			serverError(c, "handler error", err)
			return
		}

		// Re-enable trigger
		_, err = tx.Exec("SET session_replication_role = DEFAULT")
		if err != nil {
			serverError(c, "handler error", err)
			return
		}
	}

	if err := tx.Commit(); err != nil {
		serverError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}
