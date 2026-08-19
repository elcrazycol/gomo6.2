package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
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
	ID                   string      `json:"id"`
	NotificationID       string      `json:"notification_id"`
	UserID               string      `json:"user_id"`
	Type                 string      `json:"type"`
	Title                string      `json:"title"`
	Message              string      `json:"message"`
	RelatedThreadID      interface{} `json:"related_thread_id"`
	RelatedPostID        interface{} `json:"related_post_id"`
	RelatedUserID        interface{} `json:"related_user_id"`
	RelatedWallPostID    interface{} `json:"related_wall_post_id"`
	RelatedWallCommentID interface{} `json:"related_wall_comment_id"`
	RelatedWallUserID    interface{} `json:"related_wall_user_id"`
	IsRead               bool        `json:"is_read"`
	GroupCount           int         `json:"group_count"`
	CreatedAt            string      `json:"created_at"`
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

// CreateNotification creates a forum notification (thread/post/user references),
// invalidates cache, and broadcasts via WebSocket.
func CreateNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, userID, notifType, title, message string, relatedThreadID, relatedPostID, relatedUserID *string) (*models.Notification, error) {
	return insertNotification(db, redisClient, hub, &models.Notification{
		UserID:          userID,
		Type:            notifType,
		Title:           title,
		Message:         message,
		RelatedThreadID: relatedThreadID,
		RelatedPostID:   relatedPostID,
		RelatedUserID:   relatedUserID,
	})
}

// CreateWallNotification creates a wall notification (profile wall post/comment
// references plus the actor). Shared cache invalidation + WebSocket delivery
// with CreateNotification via insertNotification.
func CreateWallNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, userID, notifType, title, message string, relatedWallPostID, relatedWallCommentID, relatedWallUserID, relatedUserID *string) (*models.Notification, error) {
	return insertNotification(db, redisClient, hub, &models.Notification{
		UserID:               userID,
		Type:                 notifType,
		Title:                title,
		Message:              message,
		RelatedUserID:        relatedUserID,
		RelatedWallPostID:    relatedWallPostID,
		RelatedWallCommentID: relatedWallCommentID,
		RelatedWallUserID:    relatedWallUserID,
	})
}

// insertNotification is the single INSERT + cache invalidation + WebSocket
// broadcast path shared by every notification type across the codebase.
// Repeated same-actor, same-type events within the grouping window are folded
// into one row (group_count increments) instead of producing one row each.
func insertNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, n *models.Notification) (*models.Notification, error) {
	if db == nil {
		return nil, fmt.Errorf("database not available")
	}

	// Try to merge into an existing burst group first (best-effort).
	if merged := mergeNotificationGroup(db, n); merged != nil {
		afterNotificationCreated(redisClient, hub, merged)
		return merged, nil
	}

	now := time.Now()
	n.IsRead = false
	n.GroupCount = 1
	n.CreatedAt = &now

	query := `
		INSERT INTO notifications (user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, is_read, created_at, group_count)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING id, user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, is_read, created_at, group_count
	`

	var retCreatedAt time.Time
	err := db.QueryRow(query,
		n.UserID, n.Type, n.Title, n.Message, n.RelatedThreadID, n.RelatedPostID, n.RelatedUserID,
		n.RelatedWallPostID, n.RelatedWallCommentID, n.RelatedWallUserID, false, now, 1,
	).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.RelatedThreadID,
		&n.RelatedPostID, &n.RelatedUserID, &n.RelatedWallPostID, &n.RelatedWallCommentID,
		&n.RelatedWallUserID, &n.IsRead, &retCreatedAt, &n.GroupCount,
	)

	if err != nil {
		log.Printf("[Notifications] Error creating notification: %v", err)
		return nil, err
	}

	n.CreatedAt = &retCreatedAt
	afterNotificationCreated(redisClient, hub, n)

	return n, nil
}

// notificationGroupWindowHours is how long a burst of same-actor, same-type
// events stays merged into a single notification row. New activity inside the
// window extends the group; activity after it starts a fresh notification.
const notificationGroupWindowHours = 24

// groupableNotificationTypes are the events that can be folded into a burst
// group. One-off events (friend_request, friend_accepted, gifts, achievements)
// are deliberately excluded.
var groupableNotificationTypes = map[string]bool{
	"like":               true,
	"reply":              true,
	"wall_post":          true,
	"wall_post_like":     true,
	"wall_comment":       true,
	"wall_comment_reply": true,
	"wall_repost":        true,
}

// mergeNotificationGroup folds n into the most recent matching notification of
// the same recipient, type and actor when it falls inside the grouping window.
// It returns the merged notification, or nil when there is nothing to merge
// into (the caller then inserts a fresh row). Errors are non-fatal: the caller
// falls back to a normal insert, so a grouping hiccup never drops a notification.
func mergeNotificationGroup(db *sql.DB, n *models.Notification) *models.Notification {
	if n.RelatedUserID == nil || !groupableNotificationTypes[n.Type] {
		return nil
	}

	var (
		existingID          string
		existingCount       int
		existingThread      *string
		existingPost        *string
		existingWallPost    *string
		existingWallComment *string
		existingWallUser    *string
	)

	err := db.QueryRow(`
		SELECT id, group_count, related_thread_id, related_post_id,
		       related_wall_post_id, related_wall_comment_id, related_wall_user_id
		FROM notifications
		WHERE user_id = $1 AND type = $2 AND related_user_id = $3
		  AND created_at >= now() - $4 * interval '1 hour'
		ORDER BY created_at DESC
		LIMIT 1
	`, n.UserID, n.Type, *n.RelatedUserID, notificationGroupWindowHours).Scan(
		&existingID, &existingCount, &existingThread, &existingPost,
		&existingWallPost, &existingWallComment, &existingWallUser,
	)
	if err != nil {
		return nil // no matching group (sql.ErrNoRows) or lookup error
	}

	newCount := existingCount + 1
	title := groupedNotificationTitle(n.Type, actorHandle(n.Title), newCount)
	if title == "" {
		title = n.Title
	}

	// Prefer the new event's related refs (the freshest target); keep the
	// existing ones when the new event doesn't set them.
	merged := *n
	merged.ID = existingID
	merged.Title = title
	merged.Message = ""
	merged.RelatedThreadID = firstNonNilString(n.RelatedThreadID, existingThread)
	merged.RelatedPostID = firstNonNilString(n.RelatedPostID, existingPost)
	merged.RelatedWallPostID = firstNonNilString(n.RelatedWallPostID, existingWallPost)
	merged.RelatedWallCommentID = firstNonNilString(n.RelatedWallCommentID, existingWallComment)
	merged.RelatedWallUserID = firstNonNilString(n.RelatedWallUserID, existingWallUser)
	merged.IsRead = false
	merged.GroupCount = newCount

	var retCreatedAt time.Time
	err = db.QueryRow(`
		UPDATE notifications
		SET group_count = $1, is_read = false, created_at = now(),
		    title = $2, message = '',
		    related_thread_id = $3, related_post_id = $4,
		    related_wall_post_id = $5, related_wall_comment_id = $6,
		    related_wall_user_id = $7
		WHERE id = $8
		RETURNING created_at
	`, newCount, title, merged.RelatedThreadID, merged.RelatedPostID,
		merged.RelatedWallPostID, merged.RelatedWallCommentID, merged.RelatedWallUserID,
		existingID).Scan(&retCreatedAt)
	if err != nil {
		log.Printf("[Notifications] Error merging notification group: %v", err)
		return nil // fall back to a fresh insert
	}

	merged.CreatedAt = &retCreatedAt
	return &merged
}

// actorHandle returns the leading "@username" token of a notification title.
// Groupable notification titles always start with the actor's handle.
func actorHandle(title string) string {
	if idx := strings.IndexByte(title, ' '); idx > 0 {
		return title[:idx]
	}
	return title
}

// groupedNotificationTitle builds the X-style "@user did N of your things"
// title for a burst group. Returns "" when the type has no group template.
func groupedNotificationTitle(notifType, actorHandle string, count int) string {
	name := strings.TrimPrefix(actorHandle, "@")
	switch notifType {
	case "like":
		return fmt.Sprintf("@%s оценил(а) %d из ваших постов", name, count)
	case "wall_post_like":
		return fmt.Sprintf("@%s оценил(а) %d из ваших записей", name, count)
	case "reply":
		return fmt.Sprintf("@%s ответил(а) на %d из ваших постов", name, count)
	case "wall_comment":
		return fmt.Sprintf("@%s прокомментировал(а) %d из ваших записей", name, count)
	case "wall_comment_reply":
		return fmt.Sprintf("@%s ответил(а) на %d из ваших комментариев", name, count)
	case "wall_repost":
		return fmt.Sprintf("@%s репостнул(а) %d из ваших записей", name, count)
	case "wall_post":
		return fmt.Sprintf("@%s написал(а) на вашей стене %d %s", name, count, ruPlural(count, "запись", "записи", "записей"))
	}
	return ""
}

// ruPlural returns the correct Russian noun form for a numeral.
func ruPlural(n int, one, few, many string) string {
	if n%10 == 1 && n%100 != 11 {
		return one
	}
	if n%10 >= 2 && n%10 <= 4 && (n%100 < 12 || n%100 > 14) {
		return few
	}
	return many
}

// firstNonNilString returns a when non-nil, otherwise b.
func firstNonNilString(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}

// afterNotificationCreated invalidates the user's notification cache and
// broadcasts the notification over WebSocket. Shared by the fresh-insert and
// group-merge paths so both deliver identically.
func afterNotificationCreated(redisClient *redis.Client, hub *websocket.Hub, n *models.Notification) {
	if redisClient != nil {
		middleware.InvalidateCacheForNotification(redisClient, n.UserID)
	}

	if hub != nil {
		payload := notificationPayload{
			ID:                   n.ID,
			NotificationID:       n.ID,
			UserID:               n.UserID,
			Type:                 n.Type,
			Title:                n.Title,
			Message:              n.Message,
			RelatedThreadID:      nullableString(n.RelatedThreadID),
			RelatedPostID:        nullableString(n.RelatedPostID),
			RelatedUserID:        nullableString(n.RelatedUserID),
			RelatedWallPostID:    nullableString(n.RelatedWallPostID),
			RelatedWallCommentID: nullableString(n.RelatedWallCommentID),
			RelatedWallUserID:    nullableString(n.RelatedWallUserID),
			IsRead:               n.IsRead,
			GroupCount:           n.GroupCount,
			CreatedAt:            n.CreatedAt.Format(time.RFC3339Nano),
		}

		if err := hub.PublishNewNotification(payload); err != nil {
			log.Printf("[Notifications] Error publishing WS event: %v", err)
		}
	}
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
		SELECT id, user_id, type, title, message, related_thread_id, related_post_id, related_user_id,
		       related_wall_post_id, related_wall_comment_id, related_wall_user_id,
		       is_read, created_at, group_count
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
		serverError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var notifications []models.Notification
	for rows.Next() {
		var notification models.Notification
		err := rows.Scan(
			&notification.ID, &notification.UserID, &notification.Type,
			&notification.Title, &notification.Message, &notification.RelatedThreadID,
			&notification.RelatedPostID, &notification.RelatedUserID,
			&notification.RelatedWallPostID, &notification.RelatedWallCommentID, &notification.RelatedWallUserID,
			&notification.IsRead, &notification.CreatedAt, &notification.GroupCount,
		)
		if err != nil {
			serverError(c, "handler error", err)
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
		serverError(c, "handler error", err)
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
		serverError(c, "handler error", err)
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
		serverError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}
