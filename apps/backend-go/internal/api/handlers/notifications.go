package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// notificationPayload is the data sent over WebSocket for a new notification
type notificationPayload struct {
	ID              string      `json:"id"`
	NotificationID  string      `json:"notification_id"`
	UserID          string      `json:"user_id"`
	Type            string      `json:"type"`
	Title           string      `json:"title"`
	Message         string      `json:"message"`
	RelatedThreadID interface{} `json:"related_thread_id"`
	RelatedPostID   interface{} `json:"related_post_id"`
	IsRead          bool        `json:"is_read"`
	CreatedAt       string      `json:"created_at"`
}

type NotificationsHandler struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
}

func NewNotificationsHandler(db *sql.DB) *NotificationsHandler {
	return &NotificationsHandler{db: db}
}

func (h *NotificationsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func (h *NotificationsHandler) SetWebSocketHub(hub *websocket.Hub) {
	h.hub = hub
}

// CreateNotification creates a notification, invalidates cache, and broadcasts via WebSocket.
// This is the single function for ALL notification creation across the codebase.
func CreateNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, userID, notifType, title, message string, relatedThreadID, relatedPostID *string) (*models.Notification, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	now := time.Now()
	notification := &models.Notification{
		UserID:          userID,
		Type:            notifType,
		Title:           title,
		Message:         message,
		RelatedThreadID: relatedThreadID,
		RelatedPostID:   relatedPostID,
		IsRead:          false,
		CreatedAt:       &now,
	}

	query := `
		INSERT INTO notifications (user_id, type, title, message, related_thread_id, related_post_id, is_read, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, user_id, type, title, message, related_thread_id, related_post_id, is_read, created_at
	`

	var retCreatedAt time.Time
	err := db.QueryRow(query,
		userID, notifType, title, message, relatedThreadID, relatedPostID, false, now,
	).Scan(
		&notification.ID, &notification.UserID, &notification.Type,
		&notification.Title, &notification.Message, &notification.RelatedThreadID,
		&notification.RelatedPostID, &notification.IsRead, &retCreatedAt,
	)

	if err != nil {
		log.Printf("[Notifications] Error creating notification: %v", err)
		return nil, err
	}

	notification.CreatedAt = &retCreatedAt

	// Invalidate cache for this user's notifications
	if redisClient != nil {
		middleware.InvalidateCacheForNotification(redisClient, userID)
	}

	// Publish WebSocket event for real-time delivery
	if hub != nil {
		payload := notificationPayload{
			ID:              notification.ID,
			NotificationID:  notification.ID,
			UserID:          notification.UserID,
			Type:            notification.Type,
			Title:           notification.Title,
			Message:         notification.Message,
			RelatedThreadID: nullableString(notification.RelatedThreadID),
			RelatedPostID:   nullableString(notification.RelatedPostID),
			IsRead:          notification.IsRead,
			CreatedAt:       retCreatedAt.Format(time.RFC3339Nano),
		}

		if err := hub.PublishNewNotification(payload); err != nil {
			log.Printf("[Notifications] Error publishing WS event: %v", err)
		}
	}

	return notification, nil
}

// nullableString returns nil if s is nil, otherwise returns *s as string
func nullableString(s *string) interface{} {
	if s == nil {
		return nil
	}
	return *s
}

// --- NotificationsHandler HTTP methods ---

// GetNotifications godoc
// @Summary      List notifications
// @Description  Get notifications for the authenticated user
// @Tags         Notifications
// @Produce      json
// @Param        is_read  query string false "Filter by read status (true/false)"
// @Param        limit    query int    false "Max results (1-100)" default(50)
// @Param        offset   query int    false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /notifications [get]
// @Security     BearerAuth
func (h *NotificationsHandler) GetNotifications(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	query := `
		SELECT id, user_id, type, title, message, related_thread_id, related_post_id, 
		       is_read, created_at
		FROM notifications 
		WHERE user_id = $1
	`

	var args []interface{}
	args = append(args, userClaims.UserID)
	argIdx := 2

	// Support is_read filter: ?is_read=true or ?is_read=eq.true or ?is_read=false
	if isReadStr := c.Query("is_read"); isReadStr != "" {
		switch isReadStr {
		case "true", "eq.true":
			query += " AND is_read = true"
		case "false", "eq.false":
			query += " AND is_read = false"
		}
	}

	query += " ORDER BY created_at DESC"

	limit := 50
	offset := 0

	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	// Fetch limit+1 to detect has_more
	query += fmt.Sprintf(" LIMIT $%d OFFSET $%d", argIdx, argIdx+1)
	args = append(args, limit+1, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var notifications []models.Notification
	for rows.Next() {
		var notification models.Notification
		err := rows.Scan(
			&notification.ID, &notification.UserID, &notification.Type,
			&notification.Title, &notification.Message, &notification.RelatedThreadID,
			&notification.RelatedPostID, &notification.IsRead, &notification.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		notifications = append(notifications, notification)
	}

	// Detect has_more
	hasMore := len(notifications) > limit
	if hasMore {
		notifications = notifications[:limit]
	}

	notificationCount := len(notifications)
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    notifications,
		Count:   &notificationCount,
		HasMore: &hasMore,
	})
}

// MarkAsRead godoc
// @Summary      Mark notification as read
// @Description  Mark a single notification as read
// @Tags         Notifications
// @Produce      json
// @Param        id path string true "Notification ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /notifications/{id}/read [put]
// @Security     BearerAuth
func (h *NotificationsHandler) MarkAsRead(c *gin.Context) {
	notificationID := c.Param("id")

	_, err := uuid.Parse(notificationID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid notification ID format"))
		return
	}

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	query := `
		UPDATE notifications 
		SET is_read = true 
		WHERE id = $1 AND user_id = $2
	`

	result, err := h.db.Exec(query, notificationID, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Notification not found"))
		return
	}

	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

// MarkAllAsRead marks all notifications as read.
//
// MarkAllAsRead godoc
// @Summary      Mark all notifications as read
// @Description  Mark all unread notifications as read
// @Tags         Notifications
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /notifications/read-all [put]
// @Security     BearerAuth
func (h *NotificationsHandler) MarkAllAsRead(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	query := `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`

	_, err := h.db.Exec(query, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

// GetUnreadCount godoc
// @Summary      Get unread notification count
// @Description  Get the number of unread notifications
// @Tags         Notifications
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /notifications/unread-count [get]
// @Security     BearerAuth
func (h *NotificationsHandler) GetUnreadCount(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	var count int
	err := h.db.QueryRow("SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false",
		userClaims.UserID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}
