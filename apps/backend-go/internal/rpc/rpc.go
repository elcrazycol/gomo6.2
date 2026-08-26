// Package rpc implements the public /api/rpc surface: likes batches and
// counts, recent likers, emoji resolve, avatar history, wall views and
// gomosub RPC. Extracted from the former api/handlers god package as part of
// the F1 sweep — the domain is self-contained (its own SQL, visibility and
// privacy-gated predicates and per-surface rate budgets), so it lives as a
// leaf package next to messenger/gifts/drops and is wired into the router
// from routes.go.
package rpc

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/notifications"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/profiles"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// RPCHandler handles all RPC endpoints for the forum.
type RPCHandler struct {
	db               *sql.DB
	redis            *redis.Client
	wsHub            interface{}
	recomputeStatsFn func(*sql.DB, string)
	achEngine        *achievements.Engine
	notif            *notifications.Service
}

// NewRPCHandler creates a new RPCHandler.
func NewRPCHandler(db *sql.DB) *RPCHandler {
	return &RPCHandler{
		db: db,
		recomputeStatsFn: func(db *sql.DB, userID string) {
			profiles.RecomputeUserProfileStats(db, userID)
		},
	}
}

func (h *RPCHandler) SetAchievementEngine(e *achievements.Engine) {
	h.achEngine = e
}

func (h *RPCHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func (h *RPCHandler) SetWebSocketHub(hub interface{}) {
	h.wsHub = hub
}

func (h *RPCHandler) SetNotifier(n *notifications.Service) {
	h.notif = n
}

// canWriteChannel checks if a user can write to a channel (handles private channels).
func (h *RPCHandler) canWriteChannel(userID string, channelID string) (bool, error) {
	if userID == "" {
		return false, nil
	}
	var isPrivate bool
	var ownerID string
	err := h.db.QueryRow(`
		SELECT c.is_private, b.owner_id
		FROM channels c JOIN boards b ON c.board_id = b.id
		WHERE c.id = $1
	`, channelID).Scan(&isPrivate, &ownerID)
	if err != nil {
		return false, err
	}
	if !isPrivate {
		return true, nil
	}
	if ownerID == userID {
		return true, nil
	}
	var hasAccess bool
	err = h.db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM channel_permissions cp
			JOIN gomosub_memberships gm ON gm.role_id = cp.role_id AND gm.user_id = $2 AND gm.board_id = (SELECT board_id FROM channels WHERE id = $1)
			WHERE cp.channel_id = $1 AND cp.can_write = true
		)
	`, channelID, userID).Scan(&hasAccess)
	if err != nil {
		return false, err
	}
	return hasAccess, nil
}

// ─── Wall Post RPC ──────────────────────────────────────────────────────────

// ToggleWallPostPin toggles the pin status of a wall post.
//
// ToggleWallPostPin godoc
// @Summary      Toggle wall post pin
// @Description  Pin or unpin a wall post
// @Tags         RPC
// @Produce      json
// @Param        _post_id  query string true "Post ID"
// @Param        _user_id  query string true "User ID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/toggle_wall_post_pin [get]
// @Security     BearerAuth
func (h *RPCHandler) ToggleWallPostPin(c *gin.Context) {
	// The acting user is ALWAYS the authenticated caller. The _user_id query
	// parameter is client-controlled and must never be trusted: otherwise any
	// authenticated user could pin/unpin posts on someone else's wall by
	// passing the victim's ID.
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}
	userID := claims.UserID

	postID := c.Query("_post_id")
	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_post_id parameter required"))
		return
	}

	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
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
		httpx.ServerError(c, "handler error", err)
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	cache.InvalidateCacheForWallPostPin(h.redis, postID, userID)

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}

// ─── Core Post/Thread Creation RPCs ─────────────────────────────────────────

// CreatePostRPC creates a new post.
// POST /api/rpc/create_post — protected, requires auth.
//
// CreatePostRPC godoc
// @Summary      Create post (RPC)
// @Description  Create a new post in a thread
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body models.CreatePostRequest true "Post data"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/create_post [post]
// @Security     BearerAuth
func (h *RPCHandler) CreatePostRPC(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
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
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrPostEmpty, "Post cannot be empty", nil))
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

	// Check board-level access for the thread's board
	var postBoardID string
	err = h.db.QueryRow("SELECT board_id FROM threads WHERE id = $1", req.ThreadID).Scan(&postBoardID)
	if err == nil {
		var postBoardVisibility string
		var postBoardOwnerID string
		err = h.db.QueryRow("SELECT visibility, owner_id FROM boards WHERE id = $1", postBoardID).Scan(&postBoardVisibility, &postBoardOwnerID)
		if err == nil && postBoardVisibility == "private" && postBoardOwnerID != claims.UserID {
			var isMember bool
			memberErr := h.db.QueryRow(
				"SELECT EXISTS(SELECT 1 FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2)",
				postBoardID, claims.UserID,
			).Scan(&isMember)
			if memberErr == nil && !isMember {
				c.JSON(http.StatusForbidden, models.ErrorResponse("You are not a member of this gomosub"))
				return
			}
		}
	}
	post, createErr := h.insertPostAndNotify(claims.UserID, claims.Username, &req, postBoardID)
	if createErr != nil {
		httpx.ServerError(c, "create post", createErr)
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(post))
}

// insertPostAndNotify inserts the post row and runs the write side effects
// (thread counter, profile stats, achievements, reply notification, cache
// invalidation and WebSocket fan-out). Extracted from CreatePostRPC so the
// handler stays thin and the DB+fan-out work is a separable unit.
func (h *RPCHandler) insertPostAndNotify(userID, username string, req *models.CreatePostRequest, postBoardID string) (models.Post, error) {
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
	err := h.db.QueryRow(query,
		req.ThreadID, userID, req.Content, insertContentJSON, imageURL,
		imageURLs, req.Attachments, req.ReplyTo, req.IsPrivate, req.PrivateRecipientID,
		"localhost:8080",
	).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &retContentJSON,
		&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
	)

	if err != nil {
		return models.Post{}, err
	}
	if len(retContentJSON) > 0 {
		post.ContentJSON = json.RawMessage(retContentJSON)
	}

	_, err = h.db.Exec("UPDATE threads SET post_count = post_count + 1, updated_at = NOW() WHERE id = $1", req.ThreadID)
	if err != nil {
		log.Printf("ERROR: Failed to update thread post count: %v\n", err)
	}

	h.recomputeStatsFn(h.db, userID)

	achievements.EmitAchievement(h.achEngine, userID, achievements.EventCommentCreated)

	var threadAuthor string
	_ = h.db.QueryRow("SELECT user_id FROM threads WHERE id = $1", req.ThreadID).Scan(&threadAuthor)
	// Private posts (is_private = true) are DMs between the author and
	// private_recipient_id. The thread author is not necessarily a participant in
	// that DM, so no reply notification carrying a content snippet may reach them
	// (it would leak the DM content via notifications REST + WS).
	if threadAuthor != "" && threadAuthor != userID && !req.IsPrivate && h.notif != nil {
		params := &models.NotificationParams{Actor: username}
		shortContent := post.Content
		if len(shortContent) > 100 {
			shortContent = shortContent[:100] + "..."
		}
		_, _ = h.notif.CreateNotification(notifications.CreateParams{
			RecipientID:     threadAuthor,
			Type:            "reply",
			Message:         shortContent,
			Params:          params,
			RelatedThreadID: &req.ThreadID,
			RelatedPostID:   &post.ID,
			ActorID:         &userID,
		})
	}

	if h.redis != nil {
		cache.InvalidateCacheForThread(h.redis, req.ThreadID)
		// The board's thread list (threads?board_id=eq.X) is cached under the
		// board_id and embeds post_count. InvalidateForThread only clears the
		// standalone thread page, so without this the board list would show a
		// stale post_count for up to the data-cache TTL.
		if postBoardID != "" {
			cache.InvalidateCacheForBoard(h.redis, postBoardID)
		}
		// New replies bump the thread in the unified feed (updated_at changes).
		cache.InvalidateCacheForFeed(h.redis)
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

	return post, nil
}

// CreateThreadRPC creates a new thread with optional poll.
// POST /api/rpc/create_thread — protected, requires auth.
//
// CreateThreadRPC godoc
// @Summary      Create thread (RPC)
// @Description  Create a new thread in a board
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body models.CreateThreadRequest true "Thread data"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/create_thread [post]
// @Security     BearerAuth
func (h *RPCHandler) CreateThreadRPC(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
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

	// Check board-level access for private boards
	var boardVisibility string
	var boardOwnerID string
	err = h.db.QueryRow("SELECT visibility, owner_id FROM boards WHERE id = $1", req.BoardID).Scan(&boardVisibility, &boardOwnerID)
	if err == nil && boardVisibility == "private" && boardOwnerID != claims.UserID {
		var isMember bool
		memberErr := h.db.QueryRow(
			"SELECT EXISTS(SELECT 1 FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2)",
			req.BoardID, claims.UserID,
		).Scan(&isMember)
		if memberErr == nil && !isMember {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You are not a member of this gomosub"))
			return
		}
	}

	// Check channel write access for private channels
	if req.ChannelID != nil && *req.ChannelID != "" {
		// First verify the channel exists
		var channelExists bool
		err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM channels WHERE id = $1)", *req.ChannelID).Scan(&channelExists)
		if err != nil || !channelExists {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Channel not found"))
			return
		}
		canWrite, err := h.canWriteChannel(claims.UserID, *req.ChannelID)
		if err != nil && err != sql.ErrNoRows {
			httpx.ServerError(c, "handler error", err)
			return
		}
		if !canWrite {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to post in this channel"))
			return
		}
	}
	thread, createErr := h.insertThreadAndNotify(claims.UserID, &req, boardVisibility)
	if createErr != nil {
		httpx.ServerError(c, "create thread", createErr)
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(thread))
}

// insertThreadAndNotify inserts the thread row (with optional poll) inside a
// transaction and runs the write side effects (profile stats, achievements,
// cache invalidation and WebSocket fan-out). Extracted from CreateThreadRPC so
// the handler stays thin and the DB+fan-out work is a separable unit.
func (h *RPCHandler) insertThreadAndNotify(userID string, req *models.CreateThreadRequest, boardVisibility string) (models.Thread, error) {
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
		return models.Thread{}, err
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
	`, req.BoardID, channelID, userID, req.Title, req.Content, insertContentJSON,
		imageURL, imageURLs, req.Attachments, "localhost:8080",
	).Scan(
		&thread.ID, &thread.BoardID, &thread.ChannelID, &thread.UserID, &thread.Title, &thread.Content, &retContentJSON,
		&thread.ImageURL, &thread.ImageURLs, &thread.Attachments, &thread.PostCount, &thread.ServerDomain,
		&thread.CreatedAt, &thread.UpdatedAt, &thread.IsRemote,
	)
	if err != nil {
		return models.Thread{}, err
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
			return models.Thread{}, err
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
		return models.Thread{}, err
	}

	h.recomputeStatsFn(h.db, userID)

	achievements.EmitAchievement(h.achEngine, userID, achievements.EventEntryCreated)
	if len(req.ImageURLs) > 0 {
		achievements.EmitAchievement(h.achEngine, userID, achievements.EventImageUploaded)
	}

	if h.redis != nil {
		cache.InvalidateCacheForBoard(h.redis, req.BoardID)
		// A brand-new thread is a candidate for the unified feed.
		cache.InvalidateCacheForFeed(h.redis)
	}

	if h.wsHub != nil {
		if hub, ok := h.wsHub.(*websocket.Hub); ok {
			// Private boards must not leak into the global feed room: non-members
			// would receive the thread title/content in realtime even though the
			// thread is invisible to them via REST. Content is only attached for
			// public boards; the hub additionally skips the feed broadcast when
			// the event carries visibility=private.
			threadData := map[string]interface{}{
				"id":         thread.ID,
				"board_id":   thread.BoardID,
				"channel_id": thread.ChannelID,
				"user_id":    thread.UserID,
				"title":      thread.Title,
				"created_at": thread.CreatedAt,
				"visibility": boardVisibility,
			}
			if boardVisibility != "private" {
				threadData["content"] = thread.Content
			}
			if err := hub.PublishNewThread(threadData); err != nil {
				fmt.Printf("[WebSocket] Error publishing new thread event: %v\n", err)
			}
		}
	}

	return thread, nil
}

// ─── Achievement RPCs ───────────────────────────────────────────────────────

// ToggleAchievementPin toggles the pin status of an achievement.
//
// ToggleAchievementPin godoc
// @Summary      Toggle achievement pin
// @Description  Pin or unpin an achievement on profile
// @Tags         RPC
// @Accept       json
// @Produce      json
// @Param        request body object true "User and achievement IDs"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/toggle_achievement_pin [post]
// @Security     BearerAuth
func (h *RPCHandler) ToggleAchievementPin(c *gin.Context) {
	// The acting user is ALWAYS the authenticated caller; _user_id in the body is
	// client-controlled and must never be trusted for authorization.
	claims, ok := httpx.BearerClaims(c)
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

	req.UserID = claims.UserID

	if req.AchievementID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_achievement_id is required"))
		return
	}

	if _, err := uuid.Parse(req.AchievementID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid achievement_id format"))
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	newPinned := !currentPinned

	var updatedID string
	if newPinned {
		// Atomic pin vs. the 6-slot limit (M-01, TOCTOU fix): the cap is
		// enforced INSIDE the UPDATE via a row-lock-safe subquery, so two
		// concurrent requests cannot both read pinned_count = 5 and both
		// pass a separate COUNT check. If the user already has 6 pinned, the
		// UPDATE matches 0 rows and we report the limit instead of silently
		// over-pinning. pinned_order is computed in the same statement so it
		// stays consistent under concurrency.
		err = h.db.QueryRow(`
			UPDATE user_achievements
			SET is_pinned = TRUE,
			    pinned_order = COALESCE((
			        SELECT MAX(pinned_order) FROM user_achievements
			        WHERE user_id = $1 AND is_pinned = TRUE
			    ), 0) + 1
			WHERE user_id = $2 AND achievement_id = $3
			  AND (SELECT COUNT(*) FROM user_achievements
			       WHERE user_id = $2 AND is_pinned = TRUE) < 6
			RETURNING id
		`, req.UserID, req.UserID, req.AchievementID).Scan(&updatedID)

		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("Maximum 6 achievements can be pinned"))
				return
			}
			httpx.ServerError(c, "handler error", err)
			return
		}
	} else {
		_, err = h.db.Exec(`
			UPDATE user_achievements
			SET is_pinned = FALSE, pinned_order = NULL
			WHERE user_id = $1 AND achievement_id = $2
		`, req.UserID, req.AchievementID)
	}

	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(true))
}

// GetBoardUserPermissions returns the user's effective permissions for a gomosub board.
// Owner always gets all permissions. Non-owner gets permissions from their assigned role.
//
// GetBoardUserPermissions godoc
// @Summary      Get board user permissions
// @Description  Get the effective permissions for the authenticated user on a gomosub board
// @Tags         RPC
// @Produce      json
// @Param        _board_id query string true "Board ID"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /rpc/get_board_user_permissions [get]
// @Security     BearerAuth
func (h *RPCHandler) GetBoardUserPermissions(c *gin.Context) {
	claims, ok := httpx.BearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	boardID := c.Query("_board_id")
	if boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("_board_id is required"))
		return
	}

	// Check if user is the board owner
	var ownerID string
	err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&ownerID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	if ownerID == claims.UserID {
		c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{
			"is_owner": true,
			"permissions": map[string]bool{
				"can_manage_roles":    true,
				"can_manage_channels": true,
				"can_manage_members":  true,
				"can_delete_threads":  true,
				"can_pin_threads":     true,
			},
		}))
		return
	}

	// Get user's role permissions from membership
	var permissions json.RawMessage
	err = h.db.QueryRow(`
		SELECT gr.permissions
		FROM gomosub_memberships gm
		JOIN gomosub_roles gr ON gm.role_id = gr.id
		WHERE gm.board_id = $1 AND gm.user_id = $2
	`, boardID, claims.UserID).Scan(&permissions)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{
			"is_owner":    false,
			"permissions": map[string]bool{},
		}))
		return
	}
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	var perms map[string]bool
	if err := json.Unmarshal(permissions, &perms); err != nil {
		perms = map[string]bool{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{
		"is_owner":    false,
		"permissions": perms,
	}))
}
