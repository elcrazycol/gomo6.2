package handlers

import (
	"database/sql"
	"encoding/json"
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
	ID                   string                 `json:"id"`
	NotificationID       string                 `json:"notification_id"`
	UserID               string                 `json:"user_id"`
	Type                 string                 `json:"type"`
	Title                string                 `json:"title"`
	Message              string                 `json:"message"`
	RelatedThreadID      interface{}            `json:"related_thread_id"`
	RelatedPostID        interface{}            `json:"related_post_id"`
	RelatedUserID        interface{}            `json:"related_user_id"`
	RelatedWallPostID    interface{}            `json:"related_wall_post_id"`
	RelatedWallCommentID interface{}            `json:"related_wall_comment_id"`
	RelatedWallUserID    interface{}            `json:"related_wall_user_id"`
	RelatedWallPostIDs   models.JSONB           `json:"related_wall_post_ids"`
	IsRead               bool                   `json:"is_read"`
	GroupCount           int                    `json:"group_count"`
	Params               map[string]interface{} `json:"params"`
	CreatedAt            string                 `json:"created_at"`
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
// invalidates cache, and broadcasts via WebSocket. The display data is passed as
// structured `params` (language-neutral); title/message are kept empty for new
// rows except message, which may carry a user-content snippet.
func CreateNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, userID, notifType, message string, params *models.NotificationParams, relatedThreadID, relatedPostID, relatedUserID *string) (*models.Notification, error) {
	return insertNotification(db, redisClient, hub, &models.Notification{
		UserID:          userID,
		Type:            notifType,
		Title:           "",
		Message:         message,
		Params:          marshalNotificationParams(params),
		RelatedThreadID: relatedThreadID,
		RelatedPostID:   relatedPostID,
		RelatedUserID:   relatedUserID,
	})
}

// CreateWallNotification creates a wall notification (profile wall post/comment
// references plus the actor). Shared cache invalidation + WebSocket delivery
// with CreateNotification via insertNotification.
func CreateWallNotification(db *sql.DB, redisClient *redis.Client, hub *websocket.Hub, userID, notifType, message string, params *models.NotificationParams, relatedWallPostID, relatedWallCommentID, relatedWallUserID, relatedUserID *string) (*models.Notification, error) {
	return insertNotification(db, redisClient, hub, &models.Notification{
		UserID:               userID,
		Type:                 notifType,
		Title:                "",
		Message:              message,
		Params:               marshalNotificationParams(params),
		RelatedUserID:        relatedUserID,
		RelatedWallPostID:    relatedWallPostID,
		RelatedWallCommentID: relatedWallCommentID,
		RelatedWallUserID:    relatedWallUserID,
	})
}

// marshalNotificationParams encodes structured notification params to JSONB,
// falling back to an empty object for nil params.
func marshalNotificationParams(p *models.NotificationParams) json.RawMessage {
	if p == nil {
		return json.RawMessage("{}")
	}
	b, err := json.Marshal(p)
	if err != nil {
		return json.RawMessage("{}")
	}
	return b
}

// unmarshalNotificationParams decodes the stored params payload (tolerating
// malformed/empty input by returning a zero struct).
func unmarshalNotificationParams(raw json.RawMessage) models.NotificationParams {
	var p models.NotificationParams
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &p)
	}
	return p
}

// notificationParamsJSON returns the raw params as a JSONB string, defaulting
// to "{}" for empty/missing payloads.
func notificationParamsJSON(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "{}"
	}
	return string(raw)
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

	// Seed the liked-post list: a wall_post_like always starts with its single
	// post; every other type keeps an empty array.
	ids := make([]string, 0, 1)
	if n.Type == "wall_post_like" && n.RelatedWallPostID != nil {
		ids = append(ids, *n.RelatedWallPostID)
	}
	n.RelatedWallPostIDs = stringSliceToJSONB(ids)

	query := `
		INSERT INTO notifications (user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, related_wall_post_ids, is_read, created_at, group_count, params)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::jsonb)
		RETURNING id, user_id, type, title, message, related_thread_id, related_post_id, related_user_id, related_wall_post_id, related_wall_comment_id, related_wall_user_id, related_wall_post_ids, is_read, created_at, group_count, params
	`

	var retCreatedAt time.Time
	err := db.QueryRow(query,
		n.UserID, n.Type, n.Title, n.Message, n.RelatedThreadID, n.RelatedPostID, n.RelatedUserID,
		n.RelatedWallPostID, n.RelatedWallCommentID, n.RelatedWallUserID, wallPostIDsJSON(ids), false, now, 1, notificationParamsJSON(n.Params),
	).Scan(
		&n.ID, &n.UserID, &n.Type, &n.Title, &n.Message, &n.RelatedThreadID,
		&n.RelatedPostID, &n.RelatedUserID, &n.RelatedWallPostID, &n.RelatedWallCommentID,
		&n.RelatedWallUserID, &n.RelatedWallPostIDs, &n.IsRead, &retCreatedAt, &n.GroupCount, &n.Params,
	)

	if err != nil {
		log.Printf("[Notifications] Error creating notification: %v", err)
		return nil, err
	}

	n.CreatedAt = &retCreatedAt
	afterNotificationCreated(redisClient, hub, n)

	return n, nil
}

// notificationGroupWindowMinutes is how long a burst of consecutive wall likes
// from one actor stays merged into a single notification row. New likes inside
// the window extend the group; a like after it starts a fresh notification.
const notificationGroupWindowMinutes = 1

// groupableNotificationTypes are the events folded into a burst group. Only
// wall_post_like groups — one-off and forum events are deliberately excluded
// (see notificationGroupWindowMinutes rationale above).
var groupableNotificationTypes = map[string]bool{
	"wall_post_like": true,
}

// mergeNotificationGroup folds n into the most recent matching wall-like group
// when it falls inside the short grouping window. It returns the merged
// notification, or nil when there is nothing to merge into (the caller then
// inserts a fresh row). Errors are non-fatal: the caller falls back to a normal
// insert, so a grouping hiccup never drops a notification.
func mergeNotificationGroup(db *sql.DB, n *models.Notification) *models.Notification {
	if n.RelatedUserID == nil || n.RelatedWallPostID == nil || !groupableNotificationTypes[n.Type] {
		return nil
	}

	var (
		existingID       string
		existingCount    int
		existingWallPost *string
		existingIDs      models.JSONB
	)

	err := db.QueryRow(`
		SELECT id, group_count, related_wall_post_id, related_wall_post_ids
		FROM notifications
		WHERE user_id = $1 AND type = $2 AND related_user_id = $3
		  AND created_at >= now() - $4 * interval '1 minute'
		ORDER BY created_at DESC
		LIMIT 1
	`, n.UserID, n.Type, *n.RelatedUserID, notificationGroupWindowMinutes).Scan(
		&existingID, &existingCount, &existingWallPost, &existingIDs,
	)
	if err != nil {
		return nil // no matching group (sql.ErrNoRows) or lookup error
	}

	ids := jsonbToStrings(existingIDs)
	ids = appendUniqueString(ids, *n.RelatedWallPostID)
	newCount := len(ids)
	if newCount == 0 {
		newCount = existingCount + 1
	}

	// Keep the actor and record the new count in the structured params so the
	// frontend renders "@actor liked N of your posts" in any language.
	params := unmarshalNotificationParams(n.Params)
	params.Count = newCount

	// The freshest post is the thumbnail; the full list is the burst.
	merged := *n
	merged.ID = existingID
	merged.Title = ""
	merged.Message = ""
	merged.Params = marshalNotificationParams(&params)
	merged.RelatedWallPostID = firstNonNilString(n.RelatedWallPostID, existingWallPost)
	merged.RelatedWallPostIDs = stringSliceToJSONB(ids)
	merged.IsRead = false
	merged.GroupCount = newCount

	var retCreatedAt time.Time
	err = db.QueryRow(`
		UPDATE notifications
		SET group_count = $1, is_read = false, created_at = now(),
		    title = '', message = '',
		    related_wall_post_id = $2,
		    related_wall_post_ids = $3::jsonb,
		    params = $4::jsonb
		WHERE id = $5
		RETURNING created_at
	`, newCount, merged.RelatedWallPostID, wallPostIDsJSON(ids), notificationParamsJSON(merged.Params), existingID).Scan(&retCreatedAt)
	if err != nil {
		log.Printf("[Notifications] Error merging notification group: %v", err)
		return nil // fall back to a fresh insert
	}

	merged.CreatedAt = &retCreatedAt
	return &merged
}

// wallPostIDsJSON marshals a list of wall post IDs into a JSON array string.
func wallPostIDsJSON(ids []string) string {
	if len(ids) == 0 {
		return "[]"
	}
	b, err := json.Marshal(ids)
	if err != nil {
		return "[]"
	}
	return string(b)
}

// stringSliceToJSONB converts a []string into the models.JSONB representation.
func stringSliceToJSONB(ids []string) models.JSONB {
	out := make(models.JSONB, len(ids))
	for i, id := range ids {
		out[i] = id
	}
	return out
}

// jsonbToStrings converts a scanned models.JSONB array back into []string,
// tolerating non-string elements (dropped) and nil (empty).
func jsonbToStrings(j models.JSONB) []string {
	out := make([]string, 0, len(j))
	for _, v := range j {
		if s, ok := v.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

// appendUniqueString appends id to ids unless it is already present.
func appendUniqueString(ids []string, id string) []string {
	for _, existing := range ids {
		if existing == id {
			return ids
		}
	}
	return append(ids, id)
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
		params := map[string]interface{}{}
		if len(n.Params) > 0 {
			_ = json.Unmarshal(n.Params, &params)
		}

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
			RelatedWallPostIDs:   n.RelatedWallPostIDs,
			IsRead:               n.IsRead,
			GroupCount:           n.GroupCount,
			Params:               params,
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
			&notification.RelatedWallPostIDs, &notification.IsRead, &notification.CreatedAt, &notification.GroupCount,
			&notification.Params,
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

// GetNotification godoc
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
		serverError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(notification))
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
