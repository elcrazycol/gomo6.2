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

	rows, err := h.db.Query(`
		SELECT id, avatar_url, uploaded_at, is_current
		FROM avatar_history
		WHERE user_id = $1
		ORDER BY uploaded_at DESC
	`, req.UserUUID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var avatars []map[string]interface{}
	for rows.Next() {
		var id, avatarURL string
		var uploadedAt time.Time
		var isCurrent bool

		if err := rows.Scan(&id, &avatarURL, &uploadedAt, &isCurrent); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Check ownership
	if avatarUserID != req.RequestingUserID {
		c.JSON(http.StatusOK, models.SuccessResponse(false))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	// Delete the avatar
	_, err = tx.Exec("DELETE FROM avatar_history WHERE id = $1", req.AvatarID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// If this was the current avatar, update user profile to use previous avatar
	if isCurrent {
		// Mark all as not current first
		_, err = tx.Exec("UPDATE avatar_history SET is_current = FALSE WHERE user_id = $1", avatarUserID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
				c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
				return
			}
		}

		// Disable trigger temporarily to prevent duplicate
		_, err = tx.Exec("SET session_replication_role = replica")
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		// Update user profile
		if prevAvatarURL.Valid {
			_, err = tx.Exec("UPDATE users SET avatar_url = $1 WHERE id = $2", prevAvatarURL.String, avatarUserID)
		} else {
			_, err = tx.Exec("UPDATE users SET avatar_url = NULL WHERE id = $1", avatarUserID)
		}

		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		// Re-enable trigger
		_, err = tx.Exec("SET session_replication_role = DEFAULT")
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}
