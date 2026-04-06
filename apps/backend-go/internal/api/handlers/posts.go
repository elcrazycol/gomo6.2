package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
)

type PostsHandler struct {
	db               *sql.DB
	wsHub            interface{}
	botEventPublisher *BotEventPublisher
}

// NewPostsHandler creates a new PostsHandler with optional WebSocket Hub
func NewPostsHandler(db *sql.DB, wsHub ...interface{}) *PostsHandler {
	h := &PostsHandler{db: db}
	if len(wsHub) > 0 {
		h.wsHub = wsHub[0]
	}
	return h
}

// SetBotEventPublisher sets the bot event publisher
func (h *PostsHandler) SetBotEventPublisher(publisher *BotEventPublisher) {
	h.botEventPublisher = publisher
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
			tid := strings.TrimPrefix(threadID, "eq.")
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

	// Handle id filter
	if id := c.Query("id"); id != "" {
		if strings.HasPrefix(id, "eq.") {
			id = strings.TrimPrefix(id, "eq.")
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

	// Handle ordering (Supabase format: column.asc/column.desc)
	if order := c.Query("order"); order != "" {
		column := "p.created_at"
		direction := "ASC"
		parts := strings.Split(order, ".")
		if len(parts) >= 2 {
			switch parts[0] {
			case "created_at":
				column = "p.created_at"
			case "id":
				column = "p.id"
			}
			if strings.EqualFold(parts[1], "desc") {
				direction = "DESC"
			}
		}
		query += " ORDER BY " + column + " " + direction
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
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
			c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
				Error: stringPtr(err.Error()),
			})
			return
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
	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data:  posts,
		Count: &postCount,
	})
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
			c.JSON(http.StatusNotFound, models.SupabaseResponse{
				Error: stringPtr("Post not found"),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}
	if len(contentJSON) > 0 {
		var decoded interface{}
		if err := json.Unmarshal(contentJSON, &decoded); err == nil {
			post.ContentJSON = json.RawMessage(contentJSON)
			fmt.Printf("DEBUG: Post contentJSON decoded successfully: %s\n", string(contentJSON))
		} else {
			post.ContentJSON = nil
			fmt.Printf("DEBUG: Failed to decode contentJSON: %v\n", err)
		}
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: post,
	})
}

func (h *PostsHandler) DeletePost(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		id = c.Query("id")
		if strings.HasPrefix(id, "eq.") {
			id = strings.TrimPrefix(id, "eq.")
		}
	}
	if id == "" {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Post id is required"),
		})
		return
	}

	var authorID, threadID string
	err := h.db.QueryRow(`SELECT user_id, thread_id FROM posts WHERE id = $1`, id).Scan(&authorID, &threadID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.SupabaseResponse{
				Error: stringPtr("Post not found"),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	query := `DELETE FROM posts WHERE id = $1`

	result, err := h.db.Exec(query, id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.SupabaseResponse{
			Error: stringPtr("Post not found"),
		})
		return
	}

	_, _ = h.db.Exec(`
		UPDATE threads SET post_count = GREATEST(0, post_count - 1), updated_at = NOW() WHERE id = $1
	`, threadID)
	RecomputeUserProfileStats(h.db, authorID)

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: gin.H{"deleted": true},
	})
}

func (h *PostsHandler) CreatePost(c *gin.Context) {
	var req models.CreatePostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	// Validate that content is not empty
	fmt.Printf("DEBUG: CreatePost received %d attachments\n", len(req.Attachments))
	fmt.Printf("DEBUG: Attachments data: %+v\n", req.Attachments)
	if req.Content == "" && len(req.Attachments) == 0 {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Пост не может быть пустым"),
		})
		return
	}

	// Get user ID from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Not authenticated"),
		})
		return
	}

	userClaims := claims.(*auth.Claims)

	// Validate thread_id UUID
	_, err := uuid.Parse(req.ThreadID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Invalid thread ID format"),
		})
		return
	}

	// Check if thread exists
	var threadExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM threads WHERE id = $1)", req.ThreadID).Scan(&threadExists)
	if err != nil || !threadExists {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Thread not found"),
		})
		return
	}

	// Convert image URLs to JSONB
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
		fmt.Printf("DEBUG: req.ContentJSON length: %d\n", len(req.ContentJSON))
		fmt.Printf("DEBUG: req.ContentJSON content: %s\n", string(req.ContentJSON))
	} else {
		fmt.Printf("DEBUG: req.ContentJSON is empty or nil\n")
	}

	query := `
		INSERT INTO posts (thread_id, user_id, content, content_json, image_url, image_urls, attachments, reply_to, server_domain)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, thread_id, user_id, content, content_json, image_url, image_urls, attachments, reply_to, is_private, private_recipient_id, server_domain, created_at, is_remote
	`

	var post models.Post
	var retContentJSON []byte
	fmt.Printf("DEBUG: Storing attachments in DB: %+v\n", req.Attachments)
	err = h.db.QueryRow(query,
		req.ThreadID, userClaims.UserID, req.Content, insertContentJSON, imageURL,
		imageURLs, req.Attachments, req.ReplyTo, "localhost:8080",
	).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &retContentJSON,
		&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}
	if len(retContentJSON) > 0 {
		post.ContentJSON = json.RawMessage(retContentJSON)
		fmt.Printf("DEBUG: CreatePost contentJSON: %s\n", string(retContentJSON))
	}

	// Update thread post count and updated_at
	_, err = h.db.Exec(`
		UPDATE threads 
		SET post_count = post_count + 1, updated_at = NOW()
		WHERE id = $1
	`, req.ThreadID)

	if err != nil {
		// Log error but don't fail the request
		// TODO: Add proper logging
	}

	RecomputeUserProfileStats(h.db, userClaims.UserID)

	// Publish realtime event to WebSocket Hub
	fmt.Printf("[WebSocket DEBUG] wsHub is nil: %v\n", h.wsHub == nil)
	if h.wsHub != nil {
		if hub, ok := h.wsHub.(*websocket.Hub); ok {
			// Fetch author info for the post
			var username, avatarURL string
			h.db.QueryRow("SELECT username, COALESCE(avatar_url, '') FROM users WHERE id = $1", userClaims.UserID).Scan(&username, &avatarURL)

			// Create enriched post data with author info
			postData := struct {
				models.Post
				Username  string `json:"username"`
				AvatarURL string `json:"avatar_url"`
			}{
				Post:      post,
				Username:  username,
				AvatarURL: avatarURL,
			}

			fmt.Printf("[WebSocket DEBUG] Publishing post event for %s by %s\n", post.ID, username)
			if err := hub.PublishNewPost(postData); err != nil {
				fmt.Printf("[WebSocket] Error publishing new post event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published new post event for post %s\n", post.ID)
			}
		} else {
			fmt.Printf("[WebSocket DEBUG] wsHub is not *websocket.Hub, type: %T\n", h.wsHub)
		}
	} else {
		fmt.Printf("[WebSocket DEBUG] wsHub is nil, cannot publish\n")
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

	c.JSON(http.StatusCreated, models.SupabaseResponse{
		Data: post,
	})
}

// UpdatePost updates reply body; only the author may edit.
func (h *PostsHandler) UpdatePost(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Invalid post ID format"),
		})
		return
	}

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Not authenticated"),
		})
		return
	}
	userClaims := claims.(*auth.Claims)

	var authorID sql.NullString
	err = h.db.QueryRow(`SELECT user_id FROM posts WHERE id = $1`, id.String()).Scan(&authorID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.SupabaseResponse{
			Error: stringPtr("Post not found"),
		})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}
	if !authorID.Valid || authorID.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.SupabaseResponse{
			Error: stringPtr("Only the author can edit this post"),
		})
		return
	}

	var req struct {
		Content     string           `json:"content"`
		ContentJSON *json.RawMessage `json:"content_json"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}
	if len(retJSON) > 0 {
		post.ContentJSON = json.RawMessage(retJSON)
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: post,
	})
}
