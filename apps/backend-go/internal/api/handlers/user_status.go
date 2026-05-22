package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

type UserStatusHandler struct {
	db  *sql.DB
	hub *websocket.Hub
}

func NewUserStatusHandler(db *sql.DB, hub *websocket.Hub) *UserStatusHandler {
	return &UserStatusHandler{
		db:  db,
		hub: hub,
	}
}

// UserStatusResponse represents the response for user status
type UserStatusResponse struct {
	UserID   string     `json:"user_id"`
	IsOnline bool       `json:"is_online"`
	LastSeen *time.Time `json:"last_seen,omitempty"`
}

// GetOnlineUsers returns a list of all online users
func (h *UserStatusHandler) GetOnlineUsers(c *gin.Context) {
	onlineUserIDs := h.hub.GetOnlineUsers()

	c.JSON(http.StatusOK, gin.H{
		"online_users": onlineUserIDs,
		"count":        len(onlineUserIDs),
	})
}

// GetUserStatus returns the online status of a specific user
// Respects privacy settings - if user has hidden their status, returns offline
func (h *UserStatusHandler) GetUserStatus(c *gin.Context) {
	userID := c.Param("id")

	// Query user status and privacy settings
	query := `
		SELECT u.id, u.is_online, u.last_seen_at,
		       COALESCE(ps.show_online_status, true) as show_status
		FROM users u
		LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		WHERE u.id = $1
	`

	var status UserStatusResponse
	var showStatus bool
	var lastSeen sql.NullTime

	err := h.db.QueryRow(query, userID).Scan(
		&status.UserID,
		&status.IsOnline,
		&lastSeen,
		&showStatus,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.SupabaseResponse{
				Error: stringPtr("User not found"),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	// If user has hidden their status, return offline
	if !showStatus {
		status.IsOnline = false
		status.LastSeen = nil
	} else if lastSeen.Valid {
		status.LastSeen = &lastSeen.Time
	}

	c.JSON(http.StatusOK, status)
}

// GetBulkUserStatus returns status for multiple users at once
func (h *UserStatusHandler) GetBulkUserStatus(c *gin.Context) {
	var request struct {
		UserIDs []string `json:"user_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	if len(request.UserIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{"statuses": []UserStatusResponse{}})
		return
	}

	// Limit to 100 users per request
	if len(request.UserIDs) > 100 {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Maximum 100 user IDs allowed per request"),
		})
		return
	}

	// Build query with placeholders
	query := `
		SELECT u.id, u.is_online, u.last_seen_at,
		       COALESCE(ps.show_online_status, true) as show_status
		FROM users u
		LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		WHERE u.id = ANY($1)
	`

	rows, err := h.db.Query(query, request.UserIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}
	defer rows.Close()

	var statuses []UserStatusResponse
	for rows.Next() {
		var status UserStatusResponse
		var showStatus bool
		var lastSeen sql.NullTime

		err := rows.Scan(
			&status.UserID,
			&status.IsOnline,
			&lastSeen,
			&showStatus,
		)
		if err != nil {
			continue
		}

		// If user has hidden their status, return offline
		if !showStatus {
			status.IsOnline = false
			status.LastSeen = nil
		} else if lastSeen.Valid {
			status.LastSeen = &lastSeen.Time
		}

		statuses = append(statuses, status)
	}

	c.JSON(http.StatusOK, gin.H{"statuses": statuses})
}
