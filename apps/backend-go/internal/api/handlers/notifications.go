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

type NotificationsHandler struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
}

func NewNotificationsHandler(db *sql.DB) *NotificationsHandler {
	return &NotificationsHandler{db: db}
}

// SetRedis sets the Redis client for cache invalidation
func (h *NotificationsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// SetWebSocketHub sets the WebSocket hub for real-time notifications
func (h *NotificationsHandler) SetWebSocketHub(hub *websocket.Hub) {
	h.hub = hub
}

// CreateNotification creates a notification for a user and publishes it via WebSocket
func (h *NotificationsHandler) CreateNotification(userID, notifType, title, message string, relatedThreadID, relatedPostID *string) (*models.Notification, error) {
	if h.db == nil {
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
	err := h.db.QueryRow(query,
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
	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, userID)
	}

	// Publish WebSocket event for real-time delivery
	if h.hub != nil {
		notifData := map[string]interface{}{
			"id":                notification.ID,
			"user_id":           notification.UserID,
			"type":              notification.Type,
			"title":             notification.Title,
			"message":           notification.Message,
			"related_thread_id": nullableString(notification.RelatedThreadID),
			"related_post_id":   nullableString(notification.RelatedPostID),
			"is_read":           notification.IsRead,
			"created_at":        retCreatedAt.Format(time.RFC3339Nano),
		}

		// Subscribe the user to their notification room if connected, then publish
		if err := h.hub.PublishNewNotification(notifData); err != nil {
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

// createNotification is a package-level helper that creates a notification in DB and invalidates cache.
// It does NOT use the WebSocket hub — used by handlers that don't have hub access (e.g., LikesHandler).
func createNotification(db *sql.DB, redis *redis.Client, userID, notifType, title, message string, relatedThreadID, relatedPostID *string) error {
	if db == nil {
		return fmt.Errorf("database not available")
	}

	now := time.Now()
	query := `
		INSERT INTO notifications (user_id, type, title, message, related_thread_id, related_post_id, is_read, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`

	_, err := db.Exec(query, userID, notifType, title, message, relatedThreadID, relatedPostID, false, now)
	if err != nil {
		log.Printf("[Notifications] Error creating notification: %v", err)
		return err
	}

	// Invalidate cache for this user's notifications
	if redis != nil {
		middleware.InvalidateCacheForNotification(redis, userID)
	}

	return nil
}

func (h *NotificationsHandler) GetNotifications(c *gin.Context) {
	// Get user from context
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
		ORDER BY created_at DESC
	`

	var args []interface{}
	args = append(args, userClaims.UserID)

	// Handle pagination
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

	query += " LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	args = append(args, limit, offset)

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

	notificationCount := len(notifications)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: notifications, Count: &notificationCount})
}

func (h *NotificationsHandler) MarkAsRead(c *gin.Context) {
	notificationID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(notificationID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid notification ID format"))
		return
	}

	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Update notification
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

	// Invalidate notification cache for user
	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *NotificationsHandler) MarkAllAsRead(c *gin.Context) {
	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Update all notifications for user
	query := `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`

	_, err := h.db.Exec(query, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Invalidate notification cache for user
	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *NotificationsHandler) GetUnreadCount(c *gin.Context) {
	// Get user from context
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
