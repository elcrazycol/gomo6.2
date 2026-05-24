package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type PostsHandler struct {
	db    *sql.DB
	redis *redis.Client
}

// NewPostsHandler creates a new PostsHandler
func NewPostsHandler(db *sql.DB) *PostsHandler {
	return &PostsHandler{db: db}
}

// SetRedis sets the Redis client for cache invalidation
func (h *PostsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func (h *PostsHandler) GetPosts(c *gin.Context) {
	query := `
		SELECT p.id, p.thread_id, p.user_id, p.content, p.content_json, p.image_url, p.image_urls, p.attachments,
		       p.reply_to, p.is_private, p.private_recipient_id, p.server_domain, p.created_at, p.is_remote,
		       u.username, u.avatar_url
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
	`

	var args []interface{}
	var conditions []string

	// Handle thread_id filter (eq.uuid or in.(uuid,...))
	if threadID := c.Query("thread_id"); threadID != "" {
		if strings.HasPrefix(threadID, "eq.") {
			tid := threadID[3:]
			conditions = append(conditions, "p.thread_id = $"+strconv.Itoa(len(args)+1))
			args = append(args, tid)
		} else if strings.HasPrefix(threadID, "in.(") && strings.HasSuffix(threadID, ")") {
			raw := strings.TrimSuffix(strings.TrimPrefix(threadID, "in.("), ")")
			ids := strings.Split(raw, ",")
			placeholders := make([]string, 0, len(ids))
			for _, candidate := range ids {
				candidate = strings.TrimSpace(candidate)
				if candidate == "" {
					continue
				}
				placeholders = append(placeholders, "$"+strconv.Itoa(len(args)+1))
				args = append(args, candidate)
			}
			if len(placeholders) > 0 {
				conditions = append(conditions, "p.thread_id IN ("+strings.Join(placeholders, ",")+")")
			}
		} else {
			conditions = append(conditions, "p.thread_id = $"+strconv.Itoa(len(args)+1))
			args = append(args, threadID)
		}
	}

	// Handle user_id filter (eq.uuid)
	if userID := c.Query("user_id"); userID != "" {
		uid := strings.TrimPrefix(userID, "eq.")
		conditions = append(conditions, "p.user_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, uid)
	}

	// Handle id filter
	if id := c.Query("id"); id != "" {
		if strings.HasPrefix(id, "eq.") {
			id = id[3:]
			conditions = append(conditions, "p.id = $"+strconv.Itoa(len(args)+1))
			args = append(args, id)
		} else if strings.HasPrefix(id, "in.(") && strings.HasSuffix(id, ")") {
			raw := strings.TrimSuffix(strings.TrimPrefix(id, "in.("), ")")
			ids := strings.Split(raw, ",")
			placeholders := make([]string, 0, len(ids))
			for _, candidate := range ids {
				placeholders = append(placeholders, "$"+strconv.Itoa(len(args)+1))
				args = append(args, strings.TrimSpace(candidate))
			}
			if len(placeholders) > 0 {
				conditions = append(conditions, "p.id IN ("+strings.Join(placeholders, ",")+")")
			}
		} else {
			conditions = append(conditions, "p.id = $"+strconv.Itoa(len(args)+1))
			args = append(args, id)
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	// Handle ordering (format: column.asc/column.desc) — supports multiple order params
	if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		if s, ok := parseOrderClause(joined, "p"); ok {
			query += " ORDER BY " + s
		}
	} else {
		query += " ORDER BY p.created_at ASC"
	}

	// Handle pagination
	limit := 100
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

	var posts []models.Post
	for rows.Next() {
		var post models.Post
		var username, avatarURL sql.NullString
		var contentJSON []byte

		err := rows.Scan(
			&post.ID, &post.ThreadID, &post.UserID, &post.Content, &contentJSON,
			&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
			&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
			&username, &avatarURL,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		if username.Valid {
			post.Username = username.String
		}
		if avatarURL.Valid {
			post.AvatarURL = &avatarURL.String
		}
		if len(contentJSON) > 0 {
			var decoded interface{}
			if err := json.Unmarshal(contentJSON, &decoded); err == nil {
				post.ContentJSON = json.RawMessage(contentJSON)
			} else {
				post.ContentJSON = nil
			}
		}
		posts = append(posts, post)
	}

	postCount := len(posts)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: posts, Count: &postCount})
}

func (h *PostsHandler) GetPost(c *gin.Context) {
	id := c.Param("id")

	query := `
		SELECT p.id, p.thread_id, p.user_id, p.content, p.content_json, p.image_url, p.image_urls, p.attachments,
		       p.reply_to, p.is_private, p.private_recipient_id, p.server_domain, p.created_at, p.is_remote,
		       u.username, u.avatar_url
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
		WHERE p.id = $1
	`

	var post models.Post
	var username, avatarURL sql.NullString
	var contentJSON []byte

	err := h.db.QueryRow(query, id).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &contentJSON,
		&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
		&username, &avatarURL,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if username.Valid {
		post.Username = username.String
	}
	if avatarURL.Valid {
		post.AvatarURL = &avatarURL.String
	}
	if len(contentJSON) > 0 {
		var decoded interface{}
		if err := json.Unmarshal(contentJSON, &decoded); err == nil {
			post.ContentJSON = json.RawMessage(contentJSON)
		} else {
			post.ContentJSON = nil
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(post))
}

func (h *PostsHandler) DeletePost(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		id = c.Query("id")
	}
	id = strings.TrimPrefix(id, "eq.")
	if id == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Post id is required"))
		return
	}

	var authorID, threadID string
	err := h.db.QueryRow(`SELECT user_id, thread_id FROM posts WHERE id = $1`, id).Scan(&authorID, &threadID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	query := `DELETE FROM posts WHERE id = $1`

	result, err := h.db.Exec(query, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
		return
	}

	_, _ = h.db.Exec(`
		UPDATE threads SET post_count = GREATEST(0, post_count - 1), updated_at = NOW() WHERE id = $1
	`, threadID)
	RecomputeUserProfileStats(h.db, authorID)

	// Invalidate cache for this thread's posts
	if h.redis != nil {
		middleware.InvalidateCacheForThread(h.redis, threadID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// UpdatePost updates reply body; only the author may edit.
func (h *PostsHandler) UpdatePost(c *gin.Context) {
	idStr := c.Param("id")
	if idStr == "" {
		idStr = c.Query("id")
		idStr = strings.TrimPrefix(idStr, "eq.")
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid post ID format"))
		return
	}

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var authorID sql.NullString
	err = h.db.QueryRow(`SELECT user_id FROM posts WHERE id = $1`, id.String()).Scan(&authorID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !authorID.Valid || authorID.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the author can edit this post"))
		return
	}

	var req struct {
		Content     string           `json:"content"`
		ContentJSON *json.RawMessage `json:"content_json"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var cj interface{}
	if req.ContentJSON != nil && len(*req.ContentJSON) > 0 {
		cj = []byte(*req.ContentJSON)
	}

	q := `
		UPDATE posts SET content = $1, content_json = $2
		WHERE id = $3
		RETURNING id, thread_id, user_id, content, content_json, image_url, image_urls, reply_to, is_private, private_recipient_id, server_domain, created_at, is_remote
	`
	var post models.Post
	var retJSON []byte
	err = h.db.QueryRow(q, req.Content, cj, id.String()).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &retJSON,
		&post.ImageURL, &post.ImageURLs, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if len(retJSON) > 0 {
		post.ContentJSON = json.RawMessage(retJSON)
	}

	// Invalidate cache for this post and its thread
	if h.redis != nil {
		middleware.InvalidateCacheForPost(h.redis, post.ID, post.ThreadID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(post))
}
