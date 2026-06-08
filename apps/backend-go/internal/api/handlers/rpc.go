package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
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

func bearerClaims(c *gin.Context) (*auth.Claims, bool) {
	v, exists := c.Get("claims")
	if !exists || v == nil {
		return nil, false
	}
	claims, ok := v.(*auth.Claims)
	if !ok || claims == nil || claims.UserID == "" {
		return nil, false
	}
	return claims, true
}

type RPCHandler struct {
	db                 *sql.DB
	redis              *redis.Client
	wsHub              interface{}
	botEventPublisher  *BotEventPublisher
	recomputeStatsFn   func(*sql.DB, string)
	achievementChecker *AchievementChecker
}

func NewRPCHandler(db *sql.DB) *RPCHandler {
	return &RPCHandler{
		db: db,
		recomputeStatsFn: func(db *sql.DB, userID string) {
			RecomputeUserProfileStats(db, userID)
		},
	}
}

func (h *RPCHandler) SetAchievementChecker(ac *AchievementChecker) {
	h.achievementChecker = ac
}

func (h *RPCHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func (h *RPCHandler) SetWebSocketHub(hub interface{}) {
	h.wsHub = hub
}

func (h *RPCHandler) SetBotEventPublisher(publisher *BotEventPublisher) {
	h.botEventPublisher = publisher
}

// RPC functions

func (h *RPCHandler) GetPostLikesCount(c *gin.Context) {
	postID := c.Query("post_uuid")
	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	var count int
	err = h.db.QueryRow("SELECT COUNT(*) FROM post_likes WHERE post_id = $1", postID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) GetThreadLikesCount(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	var count int
	err = h.db.QueryRow("SELECT COUNT(*) FROM thread_likes WHERE thread_id = $1", threadID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) HasUserLikedPost(c *gin.Context) {
	postID := c.Query("post_uuid")
	userID := c.Query("user_uuid")

	if postID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid and user_uuid parameters required"))
		return
	}

	// Validate UUIDs
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	_, err = uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2)",
		postID, userID).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(exists))
}

func (h *RPCHandler) HasUserLikedThread(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	userID := c.Query("user_uuid")

	if threadID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid and user_uuid parameters required"))
		return
	}

	// Validate UUIDs
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	_, err = uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM thread_likes WHERE thread_id = $1 AND user_id = $2)",
		threadID, userID).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(exists))
}

func (h *RPCHandler) GetUserLikesGivenCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var count int
	err = h.db.QueryRow("SELECT COUNT(*) FROM post_likes WHERE user_id = $1", userID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) GetUserLikesReceivedCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var count int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM post_likes pl 
		JOIN posts p ON pl.post_id = p.id 
		WHERE p.user_id = $1
	`, userID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) GetUserThreadLikesGivenCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var count int
	err = h.db.QueryRow("SELECT COUNT(*) FROM thread_likes WHERE user_id = $1", userID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) GetUserThreadLikesReceivedCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	var count int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM thread_likes tl 
		JOIN threads t ON tl.thread_id = t.id 
		WHERE t.user_id = $1
	`, userID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

func (h *RPCHandler) GetRecentPostLikers(c *gin.Context) {
	postID := c.Query("post_uuid")
	limit := 10

	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	if limitStr := c.Query("limit_count"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	query := `
		SELECT u.username, u.id, u.avatar_url, u.is_anonymous
		FROM post_likes pl
		JOIN users u ON pl.user_id = u.id
		WHERE pl.post_id = $1
		ORDER BY pl.created_at DESC
		LIMIT $2
	`

	rows, err := h.db.Query(query, postID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var likers []struct {
		Username    string  `json:"username"`
		ID          string  `json:"id"`
		AvatarURL   *string `json:"avatar_url"`
		IsAnonymous bool    `json:"is_anonymous"`
	}

	for rows.Next() {
		var liker struct {
			Username    string  `json:"username"`
			ID          string  `json:"id"`
			AvatarURL   *string `json:"avatar_url"`
			IsAnonymous bool    `json:"is_anonymous"`
		}
		var avatarURL sql.NullString

		err := rows.Scan(&liker.Username, &liker.ID, &avatarURL, &liker.IsAnonymous)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if avatarURL.Valid {
			liker.AvatarURL = &avatarURL.String
		}

		likers = append(likers, liker)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(likers))
}

func (h *RPCHandler) GetRecentThreadLikers(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	limit := 10

	if threadID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid parameter required"))
		return
	}

	// Validate UUID
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	if limitStr := c.Query("limit_count"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	query := `
		SELECT u.username, u.id, u.avatar_url, u.is_anonymous
		FROM thread_likes tl
		JOIN users u ON tl.user_id = u.id
		WHERE tl.thread_id = $1
		ORDER BY tl.created_at DESC
		LIMIT $2
	`

	rows, err := h.db.Query(query, threadID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var likers []struct {
		Username    string  `json:"username"`
		ID          string  `json:"id"`
		AvatarURL   *string `json:"avatar_url"`
		IsAnonymous bool    `json:"is_anonymous"`
	}

	for rows.Next() {
		var liker struct {
			Username    string  `json:"username"`
			ID          string  `json:"id"`
			AvatarURL   *string `json:"avatar_url"`
			IsAnonymous bool    `json:"is_anonymous"`
		}
		var avatarURL sql.NullString

		err := rows.Scan(&liker.Username, &liker.ID, &avatarURL, &liker.IsAnonymous)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if avatarURL.Valid {
			liker.AvatarURL = &avatarURL.String
		}

		likers = append(likers, liker)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(likers))
}

// GetUserPostLikesReceivedTimestamps returns created_at for each like on posts authored by user_uuid (Stats page).
func (h *RPCHandler) GetUserPostLikesReceivedTimestamps(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	if _, ok := bearerClaims(c); !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization Bearer token required"))
		return
	}

	rows, err := h.db.Query(`
		SELECT pl.created_at
		FROM post_likes pl
		INNER JOIN posts p ON p.id = pl.post_id
		WHERE p.user_id = $1
		ORDER BY pl.created_at ASC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// GetUserThreadLikesReceivedTimestamps returns created_at for each like on threads authored by user_uuid.
func (h *RPCHandler) GetUserThreadLikesReceivedTimestamps(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	if _, ok := bearerClaims(c); !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization Bearer token required"))
		return
	}

	rows, err := h.db.Query(`
		SELECT tl.created_at
		FROM thread_likes tl
		INNER JOIN threads t ON t.id = tl.thread_id
		WHERE t.user_id = $1
		ORDER BY tl.created_at ASC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// GetUserThreadReplyTimestamps returns created_at for posts on threads owned by user_uuid written by others.
func (h *RPCHandler) GetUserThreadReplyTimestamps(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	if _, ok := bearerClaims(c); !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization Bearer token required"))
		return
	}

	rows, err := h.db.Query(`
		SELECT p.created_at
		FROM posts p
		INNER JOIN threads t ON t.id = p.thread_id
		WHERE t.user_id = $1 AND p.user_id <> $1
		ORDER BY p.created_at ASC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// ToggleWallPostPin toggles the pin status of a wall post
func (h *RPCHandler) ToggleWallPostPin(c *gin.Context) {
	postID := c.Query("_post_id")
	userID := c.Query("_user_id")

	if postID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_post_id and _user_id parameters required"))
		return
	}

	// Validate UUIDs
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	_, err = uuid.Parse(userID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID format"))
		return
	}

	// Get the post owner and current pin status
	var postOwner string
	var currentPinned bool
	err = h.db.QueryRow("SELECT user_id, is_pinned FROM profile_wall_posts WHERE id = $1", postID).Scan(&postOwner, &currentPinned)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, models.SuccessResponse(false))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Only the wall owner can pin posts
	if postOwner != userID {
		c.JSON(http.StatusOK, models.SuccessResponse(false))
		return
	}

	// Toggle the pin status
	newPinned := !currentPinned

	if newPinned {
		// Get the highest pinned_order for this user
		var maxOrder sql.NullInt32
		err = h.db.QueryRow("SELECT MAX(pinned_order) FROM profile_wall_posts WHERE user_id = $1 AND is_pinned = TRUE", userID).Scan(&maxOrder)
		if err != nil {
			maxOrder = sql.NullInt32{Valid: false}
		}

		newOrder := 1
		if maxOrder.Valid {
			newOrder = int(maxOrder.Int32) + 1
		}

		_, err = h.db.Exec("UPDATE profile_wall_posts SET is_pinned = TRUE, pinned_order = $1, updated_at = NOW() WHERE id = $2", newOrder, postID)

		// Award pin achievement
		if h.achievementChecker != nil {
			go h.achievementChecker.AwardOneTime(userID, "a0000001-0000-0000-0000-000000000027")
		}
	} else {
		_, err = h.db.Exec("UPDATE profile_wall_posts SET is_pinned = FALSE, pinned_order = NULL, updated_at = NOW() WHERE id = $1", postID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}

// Messenger RPC functions

// GetOrCreateDirectChat creates or retrieves a direct chat conversation
func (h *RPCHandler) GetOrCreateDirectChat(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		TargetUserID string `json:"target_user_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.TargetUserID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("target_user_id is required"))
		return
	}

	// Validate UUID
	if _, err := uuid.Parse(req.TargetUserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid target_user_id format"))
		return
	}

	// Cannot create conversation with yourself
	if claims.UserID == req.TargetUserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot create conversation with yourself"))
		return
	}

	// Try to find existing conversation
	var conversationID string
	err := h.db.QueryRow(`
		SELECT cm1.conversation_id
		FROM chat_conversation_members cm1
		INNER JOIN chat_conversation_members cm2
			ON cm1.conversation_id = cm2.conversation_id
		WHERE cm1.user_id = $1
			AND cm2.user_id = $2
			AND cm1.archived_at IS NULL
			AND cm2.archived_at IS NULL
		LIMIT 1
	`, claims.UserID, req.TargetUserID).Scan(&conversationID)

	if err == nil {
		// Conversation exists
		c.JSON(http.StatusOK, conversationID)
		return
	}

	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Create new conversation
	conversationID = uuid.New().String()
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO chat_conversations (id, created_at, updated_at)
		VALUES ($1, NOW(), NOW())
	`, conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	_, err = tx.Exec(`
		INSERT INTO chat_conversation_members (conversation_id, user_id, joined_at, updated_at)
		VALUES ($1, $2, NOW(), NOW()), ($1, $3, NOW(), NOW())
	`, conversationID, claims.UserID, req.TargetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, conversationID)
}

// ChatMarkDelivered marks messages as delivered
func (h *RPCHandler) ChatMarkDelivered(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		TargetConversationID string `json:"target_conversation_id"`
		TargetMessageID      string `json:"target_message_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.TargetConversationID == "" || req.TargetMessageID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("target_conversation_id and target_message_id are required"))
		return
	}

	// Validate UUIDs
	if _, err := uuid.Parse(req.TargetConversationID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id format"))
		return
	}
	if _, err := uuid.Parse(req.TargetMessageID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid message_id format"))
		return
	}

	// Check if user is a member of this conversation
	var isMember bool
	err := h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM chat_conversation_members
			WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL
		)
	`, req.TargetConversationID, claims.UserID).Scan(&isMember)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied: not a member of this conversation"))
		return
	}

	// Get message sent_at timestamp — gracefully handle missing message (race condition)
	var sentAt time.Time
	err = h.db.QueryRow(`
		SELECT sent_at FROM chat_messages WHERE id = $1 AND conversation_id = $2
	`, req.TargetMessageID, req.TargetConversationID).Scan(&sentAt)

	if err != nil {
		if err == sql.ErrNoRows {
			// Message not found — likely a race with pending→confirmed transition. No-op.
			c.JSON(http.StatusOK, nil)
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Mark all messages up to this one as delivered
	_, err = h.db.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at)
		SELECT m.id, $1, NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $2
			AND m.sender_user_id != $1
			AND m.sent_at <= $3
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, claims.UserID, req.TargetConversationID, sentAt)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, nil)
}

// ChatMarkRead marks messages as read
func (h *RPCHandler) ChatMarkRead(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		TargetConversationID string `json:"target_conversation_id"`
		TargetMessageID      string `json:"target_message_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.TargetConversationID == "" || req.TargetMessageID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("target_conversation_id and target_message_id are required"))
		return
	}

	// Validate UUIDs
	if _, err := uuid.Parse(req.TargetConversationID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id format"))
		return
	}
	if _, err := uuid.Parse(req.TargetMessageID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid message_id format"))
		return
	}

	// Check if user is a member of this conversation
	var isMember bool
	err := h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM chat_conversation_members
			WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL
		)
	`, req.TargetConversationID, claims.UserID).Scan(&isMember)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied: not a member of this conversation"))
		return
	}

	// Get message sent_at timestamp — gracefully handle missing message (race condition)
	var sentAt time.Time
	err = h.db.QueryRow(`
		SELECT sent_at FROM chat_messages WHERE id = $1 AND conversation_id = $2
	`, req.TargetMessageID, req.TargetConversationID).Scan(&sentAt)

	if err != nil {
		if err == sql.ErrNoRows {
			// Message not found — likely a race with pending→confirmed transition. No-op.
			c.JSON(http.StatusOK, nil)
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	// Mark all messages up to this one as read and delivered
	_, err = tx.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at, read_at)
		SELECT m.id, $1, NOW(), NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $2
			AND m.sender_user_id != $1
			AND m.sent_at <= $3
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET
			delivered_at = COALESCE(chat_receipts.delivered_at, NOW()),
			read_at = NOW()
	`, claims.UserID, req.TargetConversationID, sentAt)

	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Update last_read_at and reset unread count
	_, err = tx.Exec(`
		UPDATE chat_conversation_members
		SET
			last_read_at = $3,
			unread_count_cache = 0,
			updated_at = NOW()
		WHERE conversation_id = $1
			AND user_id = $2
	`, req.TargetConversationID, claims.UserID, sentAt)

	if err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, nil)
}

// ChatTogglePinMessage toggles the pinned message in a conversation
func (h *RPCHandler) ChatTogglePinMessage(c *gin.Context) {
	_, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		TargetConversationID string `json:"target_conversation_id"`
		TargetMessageID      string `json:"target_message_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.TargetConversationID == "" || req.TargetMessageID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("target_conversation_id and target_message_id are required"))
		return
	}

	if _, err := uuid.Parse(req.TargetConversationID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id format"))
		return
	}
	if _, err := uuid.Parse(req.TargetMessageID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid message_id format"))
		return
	}

	// Execute the SQL function
	var newPinnedID *string
	err := h.db.QueryRow(`
		SELECT chat_toggle_pin_message($1, $2)
	`, req.TargetConversationID, req.TargetMessageID).Scan(&newPinnedID)

	if err != nil {
		log.Printf("ChatTogglePinMessage error: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": newPinnedID}))
}

// GetMessengerUnreadCount returns total unread message count for the current user
func (h *RPCHandler) GetMessengerUnreadCount(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var count int
	err := h.db.QueryRow(`
		SELECT COALESCE(SUM(unread_count_cache), 0)
		FROM chat_conversation_members
		WHERE user_id = $1 AND archived_at IS NULL
	`, claims.UserID).Scan(&count)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}

// GetAvatarHistory returns avatar history for a user
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

	// Validate UUID
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

// DeleteAvatarFromHistory deletes an avatar from history
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

	// Validate UUIDs
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

// Reserved gomosub slugs (mirrors frontend list)
var reservedGomoSubSlugs = []string{
	"b", "pol", "a", "v", "mu", "fit", "d", "tv", "co", "int",
	"rules", "faq", "bugs", "g", "tech", "meta", "admin", "mod", "news",
}

func isReservedSlug(slug string) bool {
	for _, r := range reservedGomoSubSlugs {
		if slug == r {
			return true
		}
	}
	return false
}

var gomosubSlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,24}$`)

// CreateGomoSub creates a new gomosub (board with is_gomosub=true).
// POST /api/rpc/create_gomosub — protected, requires auth.
func (h *RPCHandler) CreateGomoSub(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		Slug             string   `json:"slug"`
		Name             string   `json:"name"`
		Description      string   `json:"description"`
		RulesMarkdown    *string  `json:"rules_markdown"`
		CoverImageURL    *string  `json:"cover_image_url"`
		GomosubAvatarURL *string  `json:"gomosub_avatar_url"`
		GomosubTags      []string `json:"gomosub_tags"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Validate required fields
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)

	if req.Slug == "" || req.Name == "" || req.Description == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("slug, name, and description are required"))
		return
	}

	// Validate slug format: /^[a-z0-9][a-z0-9_-]{1,24}$/
	if !gomosubSlugRegex.MatchString(req.Slug) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Слаг: латиница, цифры, - или _, от 2 до 25 символов"))
		return
	}

	// Check reserved slugs
	if isReservedSlug(req.Slug) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Слаг зарезервирован системой"))
		return
	}

	// Check slug uniqueness
	var existingID string
	err := h.db.QueryRow(`SELECT id FROM boards WHERE slug = $1`, req.Slug).Scan(&existingID)
	if err == nil {
		c.JSON(http.StatusConflict, models.ErrorResponse("Такой слаг уже занят"))
		return
	}
	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Build gomosub_tags JSON
	tagsJSON := "[]"
	if len(req.GomosubTags) > 0 {
		b, err := json.Marshal(req.GomosubTags)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Invalid tags format"))
			return
		}
		tagsJSON = string(b)
	}

	query := `
		INSERT INTO boards (slug, name, description, is_gomosub, is_rules_board, owner_id, 
		                   gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown)
		VALUES ($1, $2, $3, true, false, $4, $5, $6, $7::jsonb, $8)
		RETURNING id, slug, name, description, is_gomosub, is_rules_board, owner_id, 
		          gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
	`

	var board models.Board
	err = h.db.QueryRow(query,
		req.Slug, req.Name, req.Description,
		claims.UserID,
		req.GomosubAvatarURL, req.CoverImageURL,
		tagsJSON,
		req.RulesMarkdown,
	).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
		&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
	)

	if err != nil {
		// Handle unique constraint violation (slug)
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, models.ErrorResponse("Такой слаг уже занят"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(board))
}

// CreatePostRPC creates a new post.
// POST /api/rpc/create_post — protected, requires auth.
func (h *RPCHandler) CreatePostRPC(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req models.CreatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.ThreadID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_id is required"))
		return
	}
	req.Content = strings.TrimSpace(req.Content)

	if req.Content == "" && len(req.Attachments) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Пост не может быть пустым"))
		return
	}

	// Validate UUID
	if _, err := uuid.Parse(req.ThreadID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread_id format"))
		return
	}

	// Check thread exists
	var threadExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", req.ThreadID).Scan(&threadExists)
	if err != nil || !threadExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Thread not found"))
		return
	}

	// Build image_urls
	var imageURLs models.JSONB
	if len(req.ImageURLs) > 0 {
		imageURLs = make(models.JSONB, len(req.ImageURLs))
		for i, url := range req.ImageURLs {
			imageURLs[i] = url
		}
	}

	// First image as legacy image_url
	var imageURL *string
	if len(req.ImageURLs) > 0 {
		imageURL = &req.ImageURLs[0]
	}

	// Build content_json
	var insertContentJSON interface{}
	if len(req.ContentJSON) > 0 {
		insertContentJSON = []byte(req.ContentJSON)
	}

	query := `
		INSERT INTO posts (thread_id, user_id, content, content_json, image_url, image_urls,
		                  attachments, reply_to, is_private, private_recipient_id, server_domain)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
		RETURNING id, thread_id, user_id, content, content_json, image_url, image_urls,
		          attachments, reply_to, is_private, private_recipient_id, server_domain, created_at, is_remote
	`

	var post models.Post
	var retContentJSON []byte
	err = h.db.QueryRow(query,
		req.ThreadID, claims.UserID, req.Content, insertContentJSON, imageURL,
		imageURLs, req.Attachments, req.ReplyTo, req.IsPrivate, req.PrivateRecipientID,
		"localhost:8080",
	).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &retContentJSON,
		&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if len(retContentJSON) > 0 {
		post.ContentJSON = json.RawMessage(retContentJSON)
	}

	// Update thread post_count and updated_at
	_, err = h.db.Exec("UPDATE threads SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1", req.ThreadID)
	if err != nil {
		log.Printf("ERROR: Failed to update thread post count: %v\n", err)
	}

	// Recompute user stats
	h.recomputeStatsFn(h.db, claims.UserID)

	// Check achievements after creating a post
	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(claims.UserID)
	}

	// Create notification for thread owner (if replying to someone else's thread)
	var threadAuthor string
	_ = h.db.QueryRow("SELECT user_id FROM threads WHERE id = $1", req.ThreadID).Scan(&threadAuthor)
	if threadAuthor != "" && threadAuthor != claims.UserID {
		title := fmt.Sprintf("@%s ответил(а) в вашем треде", claims.Username)
		shortContent := post.Content
		if len(shortContent) > 100 {
			shortContent = shortContent[:100] + "..."
		}
		var notifHub *websocket.Hub
		if h.wsHub != nil {
			if castHub, ok := h.wsHub.(*websocket.Hub); ok {
				notifHub = castHub
			}
		}
		_, _ = CreateNotification(h.db, h.redis, notifHub, threadAuthor, "reply", title, shortContent, &req.ThreadID, &post.ID)
	}

	// Invalidate Redis cache for this thread's posts
	if h.redis != nil {
		middleware.InvalidateCacheForThread(h.redis, req.ThreadID)
	}

	// Publish WebSocket realtime event
	if h.wsHub != nil {
		if hub, ok := h.wsHub.(*websocket.Hub); ok {
			postData := map[string]interface{}{
				"id":         post.ID,
				"thread_id":  post.ThreadID,
				"user_id":    post.UserID,
				"created_at": post.CreatedAt,
			}
			if err := hub.PublishNewPost(postData); err != nil {
				fmt.Printf("[WebSocket] Error publishing new post event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published new post event for post %s\n", post.ID)
			}
		}
	}

	// Publish event to bots
	if h.botEventPublisher != nil {
		h.botEventPublisher.PublishThreadPost(map[string]interface{}{
			"id":         post.ID,
			"thread_id":  post.ThreadID,
			"user_id":    post.UserID,
			"content":    post.Content,
			"created_at": post.CreatedAt,
		})
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(post))
}

// CreateThreadRPC creates a new thread with optional poll.
// POST /api/rpc/create_thread — protected, requires auth.
func (h *RPCHandler) CreateThreadRPC(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req models.CreateThreadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)

	if req.BoardID == "" || req.Title == "" || req.Content == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("board_id, title, and content are required"))
		return
	}

	// Validate UUID
	if _, err := uuid.Parse(req.BoardID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid board_id format"))
		return
	}

	// Check board exists
	var boardExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1)", req.BoardID).Scan(&boardExists)
	if err != nil || !boardExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Board not found"))
		return
	}

	// Build image_urls
	var imageURLs models.JSONB
	if len(req.ImageURLs) > 0 {
		imageURLs = make(models.JSONB, len(req.ImageURLs))
		for i, url := range req.ImageURLs {
			imageURLs[i] = url
		}
	}

	var imageURL *string
	if len(req.ImageURLs) > 0 {
		imageURL = &req.ImageURLs[0]
	}

	var insertContentJSON interface{}
	if len(req.ContentJSON) > 0 {
		insertContentJSON = []byte(req.ContentJSON)
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	// Insert thread
	var thread models.Thread
	var retContentJSON []byte
	err = tx.QueryRow(`
		INSERT INTO threads (board_id, user_id, title, content, content_json, image_url, image_urls,
		                    attachments, server_domain)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, board_id, user_id, title, content, content_json, image_url, image_urls,
		          attachments, post_count, server_domain, created_at, updated_at, is_remote
	`, req.BoardID, claims.UserID, req.Title, req.Content, insertContentJSON,
		imageURL, imageURLs, req.Attachments, "localhost:8080",
	).Scan(
		&thread.ID, &thread.BoardID, &thread.UserID, &thread.Title, &thread.Content, &retContentJSON,
		&thread.ImageURL, &thread.ImageURLs, &thread.Attachments, &thread.PostCount, &thread.ServerDomain,
		&thread.CreatedAt, &thread.UpdatedAt, &thread.IsRemote,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if len(retContentJSON) > 0 {
		thread.ContentJSON = json.RawMessage(retContentJSON)
	}

	// Create poll if provided
	if req.Poll != nil && req.Poll.Question != "" && len(req.Poll.Options) >= 2 {
		var options []models.PollOption
		for _, opt := range req.Poll.Options {
			if opt.Text != "" {
				options = append(options, opt)
			}
		}

		optionsJSON, err := json.Marshal(options)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Invalid poll options"))
			return
		}

		_, err = tx.Exec(`
			INSERT INTO polls (thread_id, question, options, multiple_choice, show_results, allow_change_vote)
			VALUES ($1, $2, $3::jsonb, $4, $5, $6)
		`, thread.ID, req.Poll.Question, string(optionsJSON),
			req.Poll.AllowMultiple, req.Poll.ShowResults, req.Poll.AllowChangeVote)
		if err != nil {
			log.Printf("Error creating poll for thread %s: %v", thread.ID, err)
			// Don't fail the thread creation if poll fails
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	h.recomputeStatsFn(h.db, claims.UserID)

	// Check achievements after creating a thread
	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(claims.UserID)
	}

	// Invalidate cache for this board's threads
	if h.redis != nil {
		middleware.InvalidateCacheForBoard(h.redis, req.BoardID)
	}

	// Publish event to bots
	if h.botEventPublisher != nil {
		h.botEventPublisher.PublishThread(map[string]interface{}{
			"id":         thread.ID,
			"board_id":   thread.BoardID,
			"user_id":    thread.UserID,
			"title":      thread.Title,
			"content":    thread.Content,
			"created_at": thread.CreatedAt,
		})
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(thread))
}

// ToggleAchievementPin toggles the pin status of an achievement
func (h *RPCHandler) ToggleAchievementPin(c *gin.Context) {
	var req struct {
		UserID        string `json:"_user_id"`
		AchievementID string `json:"_achievement_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.UserID == "" || req.AchievementID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_user_id and _achievement_id are required"))
		return
	}

	// Validate UUIDs
	if _, err := uuid.Parse(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id format"))
		return
	}

	// Get current pin status
	var currentPinned bool
	err := h.db.QueryRow(`
		SELECT is_pinned
		FROM user_achievements
		WHERE user_id = $1 AND achievement_id = $2
	`, req.UserID, req.AchievementID).Scan(&currentPinned)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, models.SuccessResponse(false))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Toggle pin status
	newPinned := !currentPinned

	if newPinned {
		// Check if user already has 4 pinned achievements
		var pinnedCount int
		err = h.db.QueryRow(`
			SELECT COUNT(*)
			FROM user_achievements
			WHERE user_id = $1 AND is_pinned = TRUE
		`, req.UserID).Scan(&pinnedCount)

		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if pinnedCount >= 4 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Maximum 4 achievements can be pinned"))
			return
		}

		// Get highest pinned_order
		var maxOrder sql.NullInt32
		err = h.db.QueryRow(`
			SELECT MAX(pinned_order)
			FROM user_achievements
			WHERE user_id = $1 AND is_pinned = TRUE
		`, req.UserID).Scan(&maxOrder)

		if err != nil {
			maxOrder = sql.NullInt32{Valid: false}
		}

		newOrder := 1
		if maxOrder.Valid {
			newOrder = int(maxOrder.Int32) + 1
		}

		_, err = h.db.Exec(`
			UPDATE user_achievements
			SET is_pinned = TRUE, pinned_order = $1
			WHERE user_id = $2 AND achievement_id = $3
		`, newOrder, req.UserID, req.AchievementID)
	} else {
		_, err = h.db.Exec(`
			UPDATE user_achievements
			SET is_pinned = FALSE, pinned_order = NULL
			WHERE user_id = $1 AND achievement_id = $2
		`, req.UserID, req.AchievementID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}

// AwardAchievement awards an achievement to a user (idempotent).
// POST /api/rpc/award_achievement — protected, requires auth.
func (h *RPCHandler) AwardAchievement(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		UserID        string `json:"_user_id"`
		AchievementID string `json:"_achievement_id"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.UserID == "" || req.AchievementID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_user_id and _achievement_id are required"))
		return
	}

	// Allow users to award themselves only
	if claims.UserID != req.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can only award achievements to yourself"))
		return
	}

	// Check achievement exists
	var achExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM achievements WHERE id = $1)", req.AchievementID).Scan(&achExists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !achExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Achievement not found"))
		return
	}

	// Idempotent insert — ignore if already awarded
	_, err = h.db.Exec(`
		INSERT INTO user_achievements (user_id, achievement_id, level, is_pinned, pinned_order)
		VALUES ($1, $2, 1, FALSE, NULL)
		ON CONFLICT (user_id, achievement_id) DO NOTHING
	`, req.UserID, req.AchievementID)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}
