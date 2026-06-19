package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type LikesHandler struct {
	db                 *sql.DB
	redis              *redis.Client
	hub                *websocket.Hub
	achievementChecker *AchievementChecker
}

func NewLikesHandler(db *sql.DB, redis *redis.Client) *LikesHandler {
	return &LikesHandler{
		db:    db,
		redis: redis,
	}
}

func (h *LikesHandler) SetWebSocketHub(hub *websocket.Hub) {
	h.hub = hub
}

func (h *LikesHandler) SetAchievementChecker(ac *AchievementChecker) {
	h.achievementChecker = ac
}

// LikeThread godoc
// @Summary      Like a thread
// @Description  Like a thread (one per user)
// @Tags         Likes
// @Produce      json
// @Param        id path string true "Thread ID"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /threads/{id}/like [post]
// @Security     BearerAuth
func (h *LikesHandler) LikeThread(c *gin.Context) {
	threadID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Check if thread exists
	var threadExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", threadID).Scan(&threadExists)
	if err != nil || !threadExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Thread not found"))
		return
	}

	// Check if already liked
	var likeExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM thread_likes WHERE thread_id = $1 AND user_id = $2)",
		threadID, userClaims.UserID).Scan(&likeExists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if likeExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Already liked"))
		return
	}

	// Create like
	query := `
		INSERT INTO thread_likes (thread_id, user_id)
		VALUES ($1, $2)
		RETURNING id, thread_id, user_id, created_at
	`

	var like models.ThreadLike
	err = h.db.QueryRow(query, threadID, userClaims.UserID).Scan(
		&like.ID, &like.ThreadID, &like.UserID, &like.CreatedAt,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	var threadOwner string
	_ = h.db.QueryRow("SELECT user_id FROM threads WHERE id = $1", threadID).Scan(&threadOwner)
	RecomputeUserProfileStats(h.db, threadOwner)

	// Create notification for thread author (if not self-like)
	if threadOwner != "" && threadOwner != userClaims.UserID {
		title := fmt.Sprintf("@%s оценил(а) ваш тред", userClaims.Username)
		_, _ = CreateNotification(h.db, h.redis, h.hub, threadOwner, "like", title, "", &threadID, nil)
	}

	// Check achievements for both the liker and the thread author
	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(userClaims.UserID)
		if threadOwner != "" && threadOwner != userClaims.UserID {
			go h.achievementChecker.CheckAndAward(threadOwner)
		}
	}

	// Invalidate cache for thread and its posts
	if h.redis != nil {
		middleware.InvalidateCacheForThreadLike(h.redis, threadID, "")
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(like))
}

// UnlikeThread godoc
// @Summary      Unlike a thread
// @Description  Remove like from a thread
// @Tags         Likes
// @Produce      json
// @Param        id path string true "Thread ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /threads/{id}/like [delete]
// @Security     BearerAuth
func (h *LikesHandler) UnlikeThread(c *gin.Context) {
	threadID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Delete like
	query := "DELETE FROM thread_likes WHERE thread_id = $1 AND user_id = $2"
	result, err := h.db.Exec(query, threadID, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Like not found"))
		return
	}

	var threadOwner string
	_ = h.db.QueryRow("SELECT user_id FROM threads WHERE id = $1", threadID).Scan(&threadOwner)
	RecomputeUserProfileStats(h.db, threadOwner)

	// Invalidate cache for thread and its posts
	if h.redis != nil {
		middleware.InvalidateCacheForThreadLike(h.redis, threadID, "")
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// LikePost godoc
// @Summary      Like a post
// @Description  Like a post (one per user)
// @Tags         Likes
// @Produce      json
// @Param        id path string true "Post ID"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /posts/{id}/like [post]
// @Security     BearerAuth
func (h *LikesHandler) LikePost(c *gin.Context) {
	postID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Check if post exists
	var postExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM posts WHERE id = $1)", postID).Scan(&postExists)
	if err != nil || !postExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Post not found"))
		return
	}

	// Check if already liked
	var likeExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2)",
		postID, userClaims.UserID).Scan(&likeExists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if likeExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Already liked"))
		return
	}

	// Create like
	query := `
		INSERT INTO post_likes (post_id, user_id)
		VALUES ($1, $2)
		RETURNING id, post_id, user_id, created_at
	`

	var like models.PostLike
	err = h.db.QueryRow(query, postID, userClaims.UserID).Scan(
		&like.ID, &like.PostID, &like.UserID, &like.CreatedAt,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	var postAuthor, threadID string
	_ = h.db.QueryRow("SELECT user_id, thread_id FROM posts WHERE id = $1", postID).Scan(&postAuthor, &threadID)
	RecomputeUserProfileStats(h.db, postAuthor)

	// Create notification for post author (if not self-like)
	if postAuthor != "" && postAuthor != userClaims.UserID {
		title := fmt.Sprintf("@%s оценил(а) ваш пост", userClaims.Username)
		// Try to create notification (best-effort)
		_, _ = CreateNotification(h.db, h.redis, h.hub, postAuthor, "like", title, "", &threadID, &postID)
	}

	// Check achievements for both the liker and the post author
	if h.achievementChecker != nil {
		go h.achievementChecker.CheckAndAward(userClaims.UserID)
		if postAuthor != "" && postAuthor != userClaims.UserID {
			go h.achievementChecker.CheckAndAward(postAuthor)
		}
	}

	// Invalidate cache for post and its thread
	if h.redis != nil {
		middleware.InvalidateCacheForPostLike(h.redis, postID, threadID)
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(like))
}

// UnlikePost godoc
// @Summary      Unlike a post
// @Description  Remove like from a post
// @Tags         Likes
// @Produce      json
// @Param        id path string true "Post ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /posts/{id}/like [delete]
// @Security     BearerAuth
func (h *LikesHandler) UnlikePost(c *gin.Context) {
	postID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(postID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	// Get user from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Delete like
	query := "DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2"
	result, err := h.db.Exec(query, postID, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Like not found"))
		return
	}

	var postAuthor, threadID string
	_ = h.db.QueryRow("SELECT user_id, thread_id FROM posts WHERE id = $1", postID).Scan(&postAuthor, &threadID)
	RecomputeUserProfileStats(h.db, postAuthor)

	// Invalidate cache for post and its thread
	if h.redis != nil {
		middleware.InvalidateCacheForPostLike(h.redis, postID, threadID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

func (h *LikesHandler) GetThreadLikes(c *gin.Context) {
	threadID := c.Param("id")

	// Validate UUID
	_, err := uuid.Parse(threadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	// Handle pagination
	limit := 10
	offset := 0

	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 50 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	query := `
		SELECT tl.id, tl.thread_id, tl.user_id, tl.created_at,
		       u.username, u.avatar_url
		FROM thread_likes tl
		LEFT JOIN users u ON tl.user_id = u.id
		WHERE tl.thread_id = $1
		ORDER BY tl.created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := h.db.Query(query, threadID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var likes []struct {
		models.ThreadLike
		Username  string  `json:"username"`
		AvatarURL *string `json:"avatar_url"`
	}

	for rows.Next() {
		var like models.ThreadLike
		var username, avatarURL sql.NullString

		err := rows.Scan(&like.ID, &like.ThreadID, &like.UserID, &like.CreatedAt, &username, &avatarURL)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		likes = append(likes, struct {
			models.ThreadLike
			Username  string  `json:"username"`
			AvatarURL *string `json:"avatar_url"`
		}{
			ThreadLike: like,
			Username:   username.String,
			AvatarURL: func() *string {
				if avatarURL.Valid {
					return &avatarURL.String
				}
				return nil
			}(),
		})
	}

	likeCount := len(likes)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: likes, Count: &likeCount})
}
