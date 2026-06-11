package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// ─── Like-related RPC handlers ──────────────────────────────────────────────

// GetPostLikesCount returns the number of likes for a post.
func (h *RPCHandler) GetPostLikesCount(c *gin.Context) {
	postID := c.Query("post_uuid")
	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid parameter required"))
		return
	}

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

// GetThreadLikesCount returns the number of likes for a thread.
func (h *RPCHandler) GetThreadLikesCount(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	if threadID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid parameter required"))
		return
	}

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

// HasUserLikedPost checks if a user liked a specific post.
func (h *RPCHandler) HasUserLikedPost(c *gin.Context) {
	postID := c.Query("post_uuid")
	userID := c.Query("user_uuid")

	if postID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid and user_uuid parameters required"))
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

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2)",
		postID, userID).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(exists))
}

// HasUserLikedThread checks if a user liked a specific thread.
func (h *RPCHandler) HasUserLikedThread(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	userID := c.Query("user_uuid")

	if threadID == "" || userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid and user_uuid parameters required"))
		return
	}

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

// GetUserLikesGivenCount returns total likes given by a user.
func (h *RPCHandler) GetUserLikesGivenCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

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

// GetUserLikesReceivedCount returns total likes received by a user (on their posts).
func (h *RPCHandler) GetUserLikesReceivedCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

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

// GetUserThreadLikesGivenCount returns total thread likes given by a user.
func (h *RPCHandler) GetUserThreadLikesGivenCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

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

// GetUserThreadLikesReceivedCount returns total thread likes received by a user.
func (h *RPCHandler) GetUserThreadLikesReceivedCount(c *gin.Context) {
	userID := c.Query("user_uuid")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_uuid parameter required"))
		return
	}

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

// GetRecentPostLikers returns recent users who liked a post.
func (h *RPCHandler) GetRecentPostLikers(c *gin.Context) {
	postID := c.Query("post_uuid")
	limit := 10

	if postID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_uuid parameter required"))
		return
	}

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

// GetRecentThreadLikers returns recent users who liked a thread.
func (h *RPCHandler) GetRecentThreadLikers(c *gin.Context) {
	threadID := c.Query("thread_uuid")
	limit := 10

	if threadID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_uuid parameter required"))
		return
	}

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

// GetUserPostLikesReceivedTimestamps returns created_at for each like on posts authored by user_uuid.
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
