package handlers

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/lib/pq"
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
//
// GetOnlineUsers godoc
// @Summary      Get online users
// @Description  Get a list of all currently online users
// @Tags         Users
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Router       /users/online [get]
func (h *UserStatusHandler) GetOnlineUsers(c *gin.Context) {
	onlineUserIDs := h.hub.GetOnlineUsers()

	// M2: a private profile must not be discoverable as "online" by
	// non-friends. Filter the public list per viewer so private profiles only
	// appear for their owners and mutual friends.
	viewerID := ""
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok && uc != nil {
			viewerID = uc.UserID
		}
	}
	filtered := onlineUserIDs[:0]
	for _, id := range onlineUserIDs {
		if shouldFilter, _, err := ShouldFilterPrivateProfile(h.db, viewerID, id); err == nil && !shouldFilter {
			filtered = append(filtered, id)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"online_users": filtered, "count": len(filtered)}))
}

// GetUserStatus returns the online status of a specific user
// Respects privacy settings - if user has hidden their status, returns offline
//
// GetUserStatus godoc
// @Summary      Get user status
// @Description  Get the online status of a specific user
// @Tags         Users
// @Produce      json
// @Param        id path string true "User ID"
// @Success      200 {object} UserStatusResponse
// @Failure      404 {object} models.APIResponse
// @Router       /users/{id}/status [get]
func (h *UserStatusHandler) GetUserStatus(c *gin.Context) {
	userID := c.Param("id")

	// M1: a private profile must hide online status and last_seen from
	// non-friends — the same rule the profile endpoint applies. Without this,
	// a stranger learns the target's last activity time via /users/:id/status
	// even though /profiles/:id hides it.
	viewerID := ""
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok && uc != nil {
			viewerID = uc.UserID
		}
	}
	if shouldFilter, _, err := ShouldFilterPrivateProfile(h.db, viewerID, userID); err == nil && shouldFilter {
		c.JSON(http.StatusOK, UserStatusResponse{UserID: userID, IsOnline: false})
		return
	}

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
			c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
			return
		}
		serverError(c, "handler error", err)
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
//
// GetBulkUserStatus godoc
// @Summary      Get bulk user status
// @Description  Get online status for multiple users at once (max 100)
// @Tags         Users
// @Accept       json
// @Produce      json
// @Param        request body object true "User IDs"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /users/status/bulk [post]
func (h *UserStatusHandler) GetBulkUserStatus(c *gin.Context) {
	var request struct {
		UserIDs []string `json:"user_ids" binding:"required"`
	}

	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	if len(request.UserIDs) == 0 {
		c.JSON(http.StatusOK, models.SuccessResponse([]UserStatusResponse{}))
		return
	}

	// Limit to 100 users per request
	if len(request.UserIDs) > 100 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Maximum 100 user IDs allowed per request"))
		return
	}

	// M1: hide online status and last_seen of private profiles from non-friends
	// in the bulk endpoint as well (same rule as GetUserStatus).
	viewerID := ""
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok && uc != nil {
			viewerID = uc.UserID
		}
	}

	// Build query with placeholders
	query := `
		SELECT u.id, u.is_online, u.last_seen_at,
		       COALESCE(ps.show_online_status, true) as show_status
		FROM users u
		LEFT JOIN privacy_settings ps ON ps.user_id = u.id
		WHERE u.id = ANY($1)
	`

	rows, err := h.db.Query(query, pq.Array(request.UserIDs))
	if err != nil {
		serverError(c, "handler error", err)
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

		// Private profile + non-friend → strip online state and last_seen.
		if shouldFilter, _, ferr := ShouldFilterPrivateProfile(h.db, viewerID, status.UserID); ferr == nil && shouldFilter {
			status.IsOnline = false
			status.LastSeen = nil
			statuses = append(statuses, status)
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

	c.JSON(http.StatusOK, models.SuccessResponse(statuses))
}
