package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/lib/pq"
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

func (h *NotificationsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func (h *NotificationsHandler) SetWebSocketHub(hub *websocket.Hub) {
	h.hub = hub
}

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
		       related_wall_post_ids, is_read, created_at, group_count, params
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
		httpx.ServerError(c, "handler error", err)
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
			&notification.RelatedWallPostIDs, &notification.IsRead, &notification.CreatedAt, &notification.GroupCount,
			&notification.Params,
		)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		notifications = append(notifications, notification)
	}

	// Detect has_more
	hasMore := len(notifications) > limit
	if hasMore {
		notifications = notifications[:limit]
	}

	h.fillNotificationPublicIDs(notifications)

	notificationCount := len(notifications)
	c.JSON(http.StatusOK, models.APIResponse{
		Success: true,
		Data:    notifications,
		Count:   &notificationCount,
		HasMore: &hasMore,
	})
}

// fillNotificationPublicIDs resolves the related UUIDs to the human-readable
// numbers the client uses to build links (/profile/<n>, /thread/<n>,
// /profile/<wallUser>/wall/<post>).
//
// Second pass on purpose: the notification query is a plain table read, so the
// numbers are looked up by primary key afterwards rather than joined in. One
// UNION query per page, best-effort — on failure the client falls back to the
// UUID links it already has.
func (h *NotificationsHandler) fillNotificationPublicIDs(notifications []models.Notification) {
	if len(notifications) == 0 {
		return
	}
	var userIDs, threadIDs, wallPostIDs, wallUserIDs []string
	seen := make(map[string]bool)
	collect := func(dst *[]string, id *string) {
		if id == nil || *id == "" || seen[*id] {
			return
		}
		seen[*id] = true
		*dst = append(*dst, *id)
	}
	for i := range notifications {
		n := &notifications[i]
		collect(&userIDs, n.RelatedUserID)
		collect(&wallUserIDs, n.RelatedWallUserID)
		collect(&threadIDs, n.RelatedThreadID)
		collect(&wallPostIDs, n.RelatedWallPostID)
	}
	if len(userIDs)+len(threadIDs)+len(wallPostIDs)+len(wallUserIDs) == 0 {
		return
	}

	users := make(map[string]int64, len(userIDs)+len(wallUserIDs))
	threads := make(map[string]int64, len(threadIDs))
	wallPosts := make(map[string]int64, len(wallPostIDs))

	rows, err := h.db.Query(`
		SELECT 'user'::text AS kind, u.id, u.public_id
		  FROM users u WHERE u.id = ANY($1::uuid[])
		UNION ALL
		SELECT 'thread', t.id, t.public_id
		  FROM threads t WHERE t.id = ANY($2::uuid[])
		UNION ALL
		SELECT 'wall_post', p.id, p.public_id
		  FROM profile_wall_posts p WHERE p.id = ANY($3::uuid[])`,
		pq.Array(append(userIDs, wallUserIDs...)), pq.Array(threadIDs), pq.Array(wallPostIDs))
	if err != nil {
		log.Printf("[notifications] public_id lookup failed: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var kind, id string
		var publicID int64
		if err := rows.Scan(&kind, &id, &publicID); err != nil {
			continue
		}
		switch kind {
		case "user":
			users[id] = publicID
		case "thread":
			threads[id] = publicID
		case "wall_post":
			wallPosts[id] = publicID
		}
	}

	for i := range notifications {
		n := &notifications[i]
		if n.RelatedUserID != nil {
			if v, ok := users[*n.RelatedUserID]; ok {
				n.RelatedUserPublicID = &v
			}
		}
		if n.RelatedWallUserID != nil {
			if v, ok := users[*n.RelatedWallUserID]; ok {
				n.RelatedWallUserPublicID = &v
			}
		}
		if n.RelatedThreadID != nil {
			if v, ok := threads[*n.RelatedThreadID]; ok {
				n.RelatedThreadPublicID = &v
			}
		}
		if n.RelatedWallPostID != nil {
			if v, ok := wallPosts[*n.RelatedWallPostID]; ok {
				n.RelatedWallPostPublicID = &v
			}
		}
	}
}

// GetNotification godoc
//
// @Summary      Get a single notification
// @Description  Get one notification for the authenticated user (used to open a wall-like burst group)
// @Tags         Notifications
// @Produce      json
// @Param        id path string true "Notification ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /notifications/{id} [get]
// @Security     BearerAuth
func (h *NotificationsHandler) GetNotification(c *gin.Context) {
	notificationID := c.Param("id")

	if _, err := uuid.Parse(notificationID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid notification ID format"))
		return
	}

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	var notification models.Notification
	err := h.db.QueryRow(`
		SELECT id, user_id, type, title, message, related_thread_id, related_post_id, related_user_id,
		       related_wall_post_id, related_wall_comment_id, related_wall_user_id,
		       related_wall_post_ids, is_read, created_at, group_count, params
		FROM notifications
		WHERE id = $1 AND user_id = $2
	`, notificationID, userClaims.UserID).Scan(
		&notification.ID, &notification.UserID, &notification.Type,
		&notification.Title, &notification.Message, &notification.RelatedThreadID,
		&notification.RelatedPostID, &notification.RelatedUserID,
		&notification.RelatedWallPostID, &notification.RelatedWallCommentID, &notification.RelatedWallUserID,
		&notification.RelatedWallPostIDs, &notification.IsRead, &notification.CreatedAt, &notification.GroupCount,
		&notification.Params,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Notification not found"))
			return
		}
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(notification))
}

// MarkAsRead godoc
//
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Notification not found"))
		return
	}

	if h.redis != nil {
		cache.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

// MarkAllAsRead marks all notifications as read.
//
// # MarkAllAsRead godoc
//
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	if h.redis != nil {
		cache.InvalidateCacheForNotification(h.redis, userClaims.UserID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

// GetUnreadCount godoc
//
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}
