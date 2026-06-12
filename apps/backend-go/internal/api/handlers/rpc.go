package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// bearerClaims extracts auth claims from Gin context.
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

// RPCHandler handles all RPC endpoints for the forum.
type RPCHandler struct {
	db                 *sql.DB
	redis              *redis.Client
	wsHub              interface{}
	botEventPublisher  *BotEventPublisher
	recomputeStatsFn   func(*sql.DB, string)
	achievementChecker *AchievementChecker
}

// NewRPCHandler creates a new RPCHandler.
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

// ─── Wall Post RPC ──────────────────────────────────────────────────────────

// ToggleWallPostPin toggles the pin status of a wall post.
func (h *RPCHandler) ToggleWallPostPin(c *gin.Context) {
	postID := c.Query("_post_id")
	userID := c.Query("_user_id")

	if postID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_post_id and _user_id parameters required"))
		return
	}

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

	if postOwner != userID {
		c.JSON(http.StatusOK, models.SuccessResponse(false))
		return
	}

	newPinned := !currentPinned

	if newPinned {
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
	} else {
		_, err = h.db.Exec("UPDATE profile_wall_posts SET is_pinned = FALSE, pinned_order = NULL, updated_at = NOW() WHERE id = $1", postID)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}

// ─── Core Post/Thread Creation RPCs ─────────────────────────────────────────

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

	if _, err := uuid.Parse(req.ThreadID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread_id format"))
		return
	}

	var threadExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", req.ThreadID).Scan(&threadExists)
	if err != nil || !threadExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Thread not found"))
		return
	}

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

	_, err = h.db.Exec("UPDATE threads SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1", req.ThreadID)
	if err != nil {
		log.Printf("ERROR: Failed to update thread post count: %v\n", err)
	}

	h.recomputeStatsFn(h.db, claims.UserID)

	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(claims.UserID)
	}

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

	if h.redis != nil {
		middleware.InvalidateCacheForThread(h.redis, req.ThreadID)
	}

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

	if _, err := uuid.Parse(req.BoardID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid board_id format"))
		return
	}

	var boardExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1)", req.BoardID).Scan(&boardExists)
	if err != nil || !boardExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Board not found"))
		return
	}

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

	var thread models.Thread
	var retContentJSON []byte
	var channelID interface{}
	if req.ChannelID != nil && *req.ChannelID != "" {
		channelID = *req.ChannelID
	}
	err = tx.QueryRow(`
		INSERT INTO threads (board_id, channel_id, user_id, title, content, content_json, image_url, image_urls,
		                    attachments, server_domain)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, board_id, channel_id, user_id, title, content, content_json, image_url, image_urls,
		          attachments, post_count, server_domain, created_at, updated_at, is_remote
	`, req.BoardID, channelID, claims.UserID, req.Title, req.Content, insertContentJSON,
		imageURL, imageURLs, req.Attachments, "localhost:8080",
	).Scan(
		&thread.ID, &thread.BoardID, &thread.ChannelID, &thread.UserID, &thread.Title, &thread.Content, &retContentJSON,
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
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	h.recomputeStatsFn(h.db, claims.UserID)

	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(claims.UserID)
	}

	if h.redis != nil {
		middleware.InvalidateCacheForBoard(h.redis, req.BoardID)
	}

	if h.wsHub != nil {
		if hub, ok := h.wsHub.(*websocket.Hub); ok {
			threadData := map[string]interface{}{
				"id":         thread.ID,
				"board_id":   thread.BoardID,
				"channel_id": thread.ChannelID,
				"user_id":    thread.UserID,
				"title":      thread.Title,
				"content":    thread.Content,
				"created_at": thread.CreatedAt,
			}
			if err := hub.PublishNewThread(threadData); err != nil {
				fmt.Printf("[WebSocket] Error publishing new thread event: %v\n", err)
			}
		}
	}

	if h.botEventPublisher != nil {
		h.botEventPublisher.PublishThread(map[string]interface{}{
			"id":         thread.ID,
			"board_id":   thread.BoardID,
			"channel_id": thread.ChannelID,
			"user_id":    thread.UserID,
			"title":      thread.Title,
			"content":    thread.Content,
			"created_at": thread.CreatedAt,
		})
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(thread))
}

// ─── Achievement RPCs ───────────────────────────────────────────────────────

// ToggleAchievementPin toggles the pin status of an achievement.
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

	if _, err := uuid.Parse(req.UserID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id format"))
		return
	}

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

	newPinned := !currentPinned

	if newPinned {
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

	if claims.UserID != req.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can only award achievements to yourself"))
		return
	}

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
