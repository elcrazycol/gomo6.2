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

type ThreadsHandler struct {
	db                *sql.DB
	redis             *redis.Client
	botEventPublisher *BotEventPublisher
}

func NewThreadsHandler(db *sql.DB) *ThreadsHandler {
	return &ThreadsHandler{db: db}
}

// SetRedis sets the Redis client for cache invalidation
func (h *ThreadsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// SetBotEventPublisher sets the bot event publisher
func (h *ThreadsHandler) SetBotEventPublisher(publisher *BotEventPublisher) {
	h.botEventPublisher = publisher
}

// TODO: Run migration 001 (tags JSONB DEFAULT '[]') to add tags column to threads table,
// then restore 't.tags' in SELECT and Scan below.
func (h *ThreadsHandler) GetThreads(c *gin.Context) {
	query := `
		SELECT t.id, t.board_id, t.user_id, t.title, t.content, t.content_json, t.image_url, t.image_urls,
		       t.attachments, t.post_count, t.server_domain, t.created_at, t.updated_at, t.is_remote,
		       u.username, u.avatar_url,
		       b.slug as board_slug, b.name as board_name, b.is_gomosub as board_is_gomosub, b.is_rules_board as board_is_rules_board
		FROM threads t
		LEFT JOIN users u ON t.user_id = u.id
		LEFT JOIN boards b ON t.board_id = b.id
	`

	var args []interface{}
	var conditions []string

	// Handle board_id filter (eq.uuid or in.(uuid,...))
	if boardID := c.Query("board_id"); boardID != "" {
		if strings.HasPrefix(boardID, "eq.") {
			bid := strings.TrimPrefix(boardID, "eq.")
			conditions = append(conditions, "t.board_id = $"+strconv.Itoa(len(args)+1))
			args = append(args, bid)
		} else if strings.HasPrefix(boardID, "in.(") && strings.HasSuffix(boardID, ")") {
			raw := strings.TrimSuffix(strings.TrimPrefix(boardID, "in.("), ")")
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
				conditions = append(conditions, "t.board_id IN ("+strings.Join(placeholders, ",")+")")
			}
		} else {
			conditions = append(conditions, "t.board_id = $"+strconv.Itoa(len(args)+1))
			args = append(args, boardID)
		}
	}

	// Handle id filter
	if id := c.Query("id"); id != "" {
		id = strings.TrimPrefix(id, "eq.")
		if strings.HasPrefix(id, "in.(") && strings.HasSuffix(id, ")") {
			raw := strings.TrimSuffix(strings.TrimPrefix(id, "in.("), ")")
			ids := strings.Split(raw, ",")
			placeholders := make([]string, 0, len(ids))
			for _, candidate := range ids {
				placeholders = append(placeholders, "$"+strconv.Itoa(len(args)+1))
				args = append(args, strings.TrimSpace(candidate))
			}
			if len(placeholders) > 0 {
				conditions = append(conditions, "t.id IN ("+strings.Join(placeholders, ",")+")")
			}
		} else {
			conditions = append(conditions, "t.id = $"+strconv.Itoa(len(args)+1))
			args = append(args, id)
		}
	}

	// Handle user_id filter (eq.uuid)
	if userID := c.Query("user_id"); userID != "" {
		uid := strings.TrimPrefix(userID, "eq.")
		conditions = append(conditions, "t.user_id = $"+strconv.Itoa(len(args)+1))
		args = append(args, uid)
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
		if s, ok := parseOrderClause(joined, "t"); ok {
			query += " ORDER BY " + s
		}
	} else {
		query += " ORDER BY t.updated_at DESC"
	}

	// Handle pagination
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

	query += " LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var threads []models.ThreadWithBoards
	for rows.Next() {
		var thread models.ThreadWithBoards
		var avatarURL sql.NullString
		var boardSlug, boardName string
		var boardIsGomosub, boardIsRulesBoard bool
		var contentJSON []byte

		err := rows.Scan(
			&thread.ID, &thread.BoardID, &thread.UserID, &thread.Title, &thread.Content, &contentJSON,
			&thread.ImageURL, &thread.ImageURLs, &thread.Attachments, &thread.PostCount, &thread.ServerDomain,
			&thread.CreatedAt, &thread.UpdatedAt, &thread.IsRemote, &thread.Username, &avatarURL,
			&boardSlug, &boardName, &boardIsGomosub, &boardIsRulesBoard,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		if avatarURL.Valid {
			thread.AvatarURL = &avatarURL.String
		}
		if len(contentJSON) > 0 {
			var decoded interface{}
			if err := json.Unmarshal(contentJSON, &decoded); err == nil {
				thread.ContentJSON = json.RawMessage(contentJSON)
			} else {
				thread.ContentJSON = nil
			}
		}
		thread.Boards = models.BoardInfo{
			Slug:         boardSlug,
			Name:         boardName,
			IsGomosub:    boardIsGomosub,
			IsRulesBoard: boardIsRulesBoard,
		}
		threads = append(threads, thread)
	}

	threadCount := len(threads)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: threads, Count: &threadCount})
}

func (h *ThreadsHandler) GetThread(c *gin.Context) {
	idStr := c.Param("id")

	// Parse and validate UUID
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	query := `
		SELECT t.id, t.board_id, t.user_id, t.title, t.content, t.content_json, t.image_url, t.image_urls,
		       t.attachments, t.post_count, t.server_domain, t.created_at, t.updated_at, t.is_remote,
		       u.username, u.avatar_url,
		       b.slug as board_slug, b.name as board_name, b.is_gomosub as board_is_gomosub, b.is_rules_board as board_is_rules_board
		FROM threads t
		LEFT JOIN users u ON t.user_id = u.id
		LEFT JOIN boards b ON t.board_id = b.id
		WHERE t.id = $1
	`

	var thread models.ThreadWithBoards
	var avatarURL sql.NullString
	var boardSlug, boardName string
	var boardIsGomosub, boardIsRulesBoard bool
	var contentJSON []byte

	err = h.db.QueryRow(query, id.String()).Scan(
		&thread.ID, &thread.BoardID, &thread.UserID, &thread.Title, &thread.Content, &contentJSON,
		&thread.ImageURL, &thread.ImageURLs, &thread.Attachments, &thread.PostCount, &thread.ServerDomain,
		&thread.CreatedAt, &thread.UpdatedAt, &thread.IsRemote, &thread.Username, &avatarURL,
		&boardSlug, &boardName, &boardIsGomosub, &boardIsRulesBoard,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Thread not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if avatarURL.Valid {
		thread.AvatarURL = &avatarURL.String
	}
	if len(contentJSON) > 0 {
		var decoded interface{}
		if err := json.Unmarshal(contentJSON, &decoded); err == nil {
			thread.ContentJSON = json.RawMessage(contentJSON)
		} else {
			thread.ContentJSON = nil
		}
	}
	thread.Boards = models.BoardInfo{
		Slug:         boardSlug,
		Name:         boardName,
		IsGomosub:    boardIsGomosub,
		IsRulesBoard: boardIsRulesBoard,
	}

	c.JSON(http.StatusOK, models.SuccessResponse(thread))
}

func (h *ThreadsHandler) CreateThread(c *gin.Context) {
	var req models.CreateThreadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Get user ID from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Validate board_id UUID
	_, err := uuid.Parse(req.BoardID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid board ID format"))
		return
	}

	// Check if board exists
	var boardExists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM boards WHERE id = $1)", req.BoardID).Scan(&boardExists)
	if err != nil || !boardExists {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Board not found"))
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
	}

	query := `
		INSERT INTO threads (board_id, user_id, title, content, content_json, image_url, image_urls, attachments, server_domain)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, board_id, user_id, title, content, content_json, image_url, image_urls, attachments, post_count, server_domain, created_at, updated_at, is_remote
	`

	var thread models.Thread
	var retContentJSON []byte
	err = h.db.QueryRow(query,
		req.BoardID, userClaims.UserID, req.Title, req.Content, insertContentJSON,
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

	RecomputeUserProfileStats(h.db, userClaims.UserID)

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

func (h *ThreadsHandler) DeleteThread(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		id = c.Query("id")
		id = strings.TrimPrefix(id, "eq.")
	}
	if id == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Thread id is required"))
		return
	}

	var ownerID string
	err := h.db.QueryRow(`SELECT user_id FROM threads WHERE id = $1`, id).Scan(&ownerID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Thread not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	result, err := h.db.Exec("DELETE FROM threads WHERE id = $1", id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Thread not found"))
		return
	}

	RecomputeUserProfileStats(h.db, ownerID)

	// Invalidate cache for this thread
	if h.redis != nil {
		middleware.InvalidateCacheForThread(h.redis, id)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// UpdateThread updates thread body (OP text); only the author may edit.
func (h *ThreadsHandler) UpdateThread(c *gin.Context) {
	idStr := c.Param("id")
	if idStr == "" {
		idStr = c.Query("id")
		idStr = strings.TrimPrefix(idStr, "eq.")
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid thread ID format"))
		return
	}

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var ownerID sql.NullString
	err = h.db.QueryRow(`SELECT user_id FROM threads WHERE id = $1`, id.String()).Scan(&ownerID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Thread not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !ownerID.Valid || ownerID.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the author can edit this thread"))
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
		UPDATE threads SET content = $1, content_json = $2, updated_at = NOW()
		WHERE id = $3
		RETURNING id, board_id, user_id, title, content, content_json, image_url, image_urls, post_count, server_domain, created_at, updated_at, is_remote
	`
	var thread models.Thread
	var retJSON []byte
	err = h.db.QueryRow(q, req.Content, cj, id.String()).Scan(
		&thread.ID, &thread.BoardID, &thread.UserID, &thread.Title, &thread.Content, &retJSON,
		&thread.ImageURL, &thread.ImageURLs, &thread.PostCount, &thread.ServerDomain,
		&thread.CreatedAt, &thread.UpdatedAt, &thread.IsRemote,
	)
	if len(retJSON) > 0 {
		thread.ContentJSON = json.RawMessage(retJSON)
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Invalidate cache for this thread and its board
	if h.redis != nil {
		middleware.InvalidateCacheForThread(h.redis, thread.ID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(thread))
}
