package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

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

// GetPosts godoc
// @Summary      List posts
// @Description  Get posts with optional filters
// @Tags         Posts
// @Produce      json
// @Param        thread_id  query string false "Filter by thread ID"
// @Param        user_id    query string false "Filter by user ID"
// @Param        latest     query string false "Return only latest post per thread (true/false)"
// @Param        limit      query int    false "Max results" default(100)
// @Param        offset     query int    false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Router       /posts [get]
func (h *PostsHandler) GetPosts(c *gin.Context) {
	// latest=true returns only the latest post per thread using DISTINCT ON.
	// Requires thread_id=in.(...) filter. Used by Board.tsx for N+1-free batch loading.
	latest := c.Query("latest") == "true"

	baseSelect := `
		p.id, p.thread_id, p.user_id, p.content, p.content_json, p.image_url, p.image_urls, p.attachments,
		p.reply_to, p.is_private, p.private_recipient_id, p.server_domain, p.created_at, p.is_remote,
		u.username, u.nickname_emoji_id, u.avatar_url
	`

	// H1 (security audit): posts must inherit the visibility of their parent
	// thread's board and channel. The thread surface (threads.go) gates private
	// boards and private channels, but /api/v1/posts previously only applied
	// the is_private DM flag — so posts from private boards/channels were
	// readable by UUID. The FROM clause below joins threads + boards + channels
	// so the same predicate can be applied here (see viewerVisibilityCond).
	const postsBaseFrom = `
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
		LEFT JOIN threads t ON p.thread_id = t.id
		LEFT JOIN boards b ON t.board_id = b.id
		LEFT JOIN channels ch ON t.channel_id = ch.id
	`
	query := `SELECT ` + baseSelect + postsBaseFrom

	var args []interface{}
	var conditions []string
	hasThreadFilter := false

	// Handle thread_id filter (eq.uuid or in.(uuid,...))
	if threadID := c.Query("thread_id"); threadID != "" {
		hasThreadFilter = true
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

	// H2: private posts (is_private = true, i.e. a DM inside a thread) must only
	// be visible to the author and the private recipient. The frontend hides them
	// by render, but the API must not leak content to anyone else. Anonymous
	// viewers (viewerID = "") see public posts only. The user_id columns are
	// compared as text so an empty viewer ID (anonymous) yields a plain false
	// instead of a UUID cast error.
	claims := getClaims(c)
	viewerID := ""
	if claims != nil {
		viewerID = claims.UserID
	}
	privacyCond := "(COALESCE(p.is_private, false) = false OR p.user_id::text = $" +
		strconv.Itoa(len(args)+1) + " OR p.private_recipient_id::text = $" +
		strconv.Itoa(len(args)+2) + ")"
	conditions = append(conditions, privacyCond)
	args = append(args, viewerID, viewerID)

	// H1 (security audit): private boards and private channels must hide their
	// posts from guests and non-members — the same predicate threads.go applies
	// to thread listings. Private boards/channels are visible only to the board
	// owner and gomosub members (basic read access, matching canAccessChannel's
	// read branch). Guests (viewerID == "") only ever match the public
	// branches; the ::text casts keep empty-viewer comparisons from tripping
	// the uuid type.
	if viewerID != "" {
		p1 := strconv.Itoa(len(args) + 1)
		p2 := strconv.Itoa(len(args) + 2)
		boardCond := "(b.visibility != 'private' OR b.owner_id::text = $" + p1 +
			" OR EXISTS(SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id::text = $" + p2 + "))"
		channelCond := "(t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false OR b.owner_id::text = $" + p1 +
			" OR EXISTS(SELECT 1 FROM gomosub_memberships gm2 WHERE gm2.board_id = t.board_id AND gm2.user_id::text = $" + p2 + "))"
		conditions = append(conditions, boardCond, channelCond)
		args = append(args, viewerID, viewerID)
	} else {
		conditions = append(conditions,
			"b.visibility != 'private'",
			"(t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false)")
	}
	// Apply WHERE conditions to non-latest query.
	// For latest=true, query is rebuilt as a DISTINCT ON subquery below.
	if !latest && len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	// Determine ORDER BY and direction (for cursor pagination)
	orderClause := ""
	orderDir := "ASC" // default for posts
	if !latest {
		if orders := c.QueryArray("order"); len(orders) > 0 {
			joined := ""
			for i, o := range orders {
				if i > 0 {
					joined += ","
				}
				joined += o
				if i == 0 {
					if strings.Contains(strings.ToLower(o), ".asc") {
						orderDir = "ASC"
					} else if strings.Contains(strings.ToLower(o), ".desc") {
						orderDir = "DESC"
					}
				}
			}
			if s, ok := parseOrderClause(joined, "p"); ok {
				orderClause = " ORDER BY " + s
			}
		} else {
			orderClause = " ORDER BY p.created_at ASC"
		}

		// Handle cursor-based pagination (non-latest mode only)
		// For ASC: cursor = last seen created_at, filter for later items (created_at > cursor)
		// For DESC: cursor = last seen created_at, filter for earlier items (created_at < cursor)
		cursor := c.Query("cursor")
		if cursor != "" {
			if orderDir == "ASC" {
				conditions = append(conditions, "p.created_at > $"+strconv.Itoa(len(args)+1))
			} else {
				conditions = append(conditions, "p.created_at < $"+strconv.Itoa(len(args)+1))
			}
			args = append(args, cursor)
			// Rebuild WHERE with cursor condition
			query = `SELECT ` + baseSelect + postsBaseFrom
			if len(conditions) > 0 {
				query += " WHERE " + conditions[0]
				for i := 1; i < len(conditions); i++ {
					query += " AND " + conditions[i]
				}
			}
		}
	}

	// Handle ordering (format: column.asc/column.desc) — supports multiple order params
	if latest {
		// Safeguard: latest=true requires thread_id=in.(...) to avoid full table scan
		if !hasThreadFilter {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("latest=true requires thread_id=in.(...) filter"))
			return
		}
		// DISTINCT ON requires p.thread_id as first ORDER BY column.
		// Wrap in subquery, then apply user ordering (or default) on outer.
		query = "SELECT * FROM (SELECT DISTINCT ON (p.thread_id) " + baseSelect +
			" FROM posts p LEFT JOIN users u ON p.user_id = u.id" +
			" LEFT JOIN threads t ON p.thread_id = t.id" +
			" LEFT JOIN boards b ON t.board_id = b.id" +
			" LEFT JOIN channels ch ON t.channel_id = ch.id" +
			" WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
		query += " ORDER BY p.thread_id, p.created_at DESC) sub"
	} else {
		if orderClause != "" {
			query += orderClause
		}
	}

	// Handle ordering for latest subquery (outer sort)
	if latest {
		if orders := c.QueryArray("order"); len(orders) > 0 {
			joined := ""
			for i, o := range orders {
				if i > 0 {
					joined += ","
				}
				joined += o
			}
			if s, ok := parseOrderClause(joined, "sub"); ok {
				query += " ORDER BY " + s
			}
		} else {
			query += " ORDER BY sub.created_at DESC"
		}
	}

	// Handle pagination
	// latest=true allows up to 200 (one post per thread for ~100 threads)
	maxLimit := 100
	if latest {
		maxLimit = 200
	}
	limit := maxLimit
	offset := 0

	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= maxLimit {
			limit = l
		}
	}

	cursor := c.Query("cursor")
	useCursor := cursor != "" && !latest

	if !useCursor {
		if offsetStr := c.Query("offset"); offsetStr != "" {
			if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
				offset = o
			}
		}
		query += " LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
		args = append(args, limit, offset)
	} else {
		query += " LIMIT $" + strconv.Itoa(len(args)+1)
		args = append(args, limit)
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		serverError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var posts []models.Post
	for rows.Next() {
		var post models.Post
		var username, nicknameEmojiID, avatarURL sql.NullString
		var contentJSON []byte

		err := rows.Scan(
			&post.ID, &post.ThreadID, &post.UserID, &post.Content, &contentJSON,
			&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
			&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
			&username, &nicknameEmojiID, &avatarURL,
		)
		if err != nil {
			serverError(c, "handler error", err)
			return
		}
		if username.Valid {
			post.Username = username.String
		}
		if nicknameEmojiID.Valid {
			post.NicknameEmojiID = &nicknameEmojiID.String
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

	// Build response with next_cursor for cursor-based pagination
	resp := models.APIResponse{Success: true, Data: posts, Count: &postCount}
	if len(posts) > 0 && len(posts) >= limit {
		lastCreated := posts[len(posts)-1].CreatedAt.Format(time.RFC3339Nano)
		resp.NextCursor = &lastCreated
	}

	c.JSON(http.StatusOK, resp)
}

// GetPost godoc
// @Summary      Get post
// @Description  Get a post by its ID
// @Tags         Posts
// @Produce      json
// @Param        id path string true "Post ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /posts/{id} [get]
func (h *PostsHandler) GetPost(c *gin.Context) {
	id := c.Param("id")

	// H2: private posts (is_private = true, i.e. a DM inside a thread) must only
	// be visible to the author and the private recipient. A non-participant gets
	// 404 (same as if the post did not exist).
	claims := getClaims(c)
	viewerID := ""
	if claims != nil {
		viewerID = claims.UserID
	}

	// H1 (security audit): single-post reads enforce the same board/channel
	// visibility as GetPosts — a post on a private board or in a private channel
	// is indistinguishable from a nonexistent post (404). The predicate mirrors
	// threads.go GetThread: owner or gomosub member may read; guests and
	// non-members cannot. The ::text casts keep the empty anonymous viewerID
	// from tripping the uuid type.
	visibilityCond := "b.visibility != 'private'"
	channelCond := "(t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false)"
	if viewerID != "" {
		visibilityCond = "(b.visibility != 'private' OR b.owner_id::text = $3 OR EXISTS(SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id::text = $3))"
		channelCond = "(t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false OR b.owner_id::text = $3 OR EXISTS(SELECT 1 FROM gomosub_memberships gm2 WHERE gm2.board_id = t.board_id AND gm2.user_id::text = $3))"
	}

	query := `
		SELECT p.id, p.thread_id, p.user_id, p.content, p.content_json, p.image_url, p.image_urls, p.attachments,
		       p.reply_to, p.is_private, p.private_recipient_id, p.server_domain, p.created_at, p.is_remote,
		       u.username, u.nickname_emoji_id, u.avatar_url
		FROM posts p
		LEFT JOIN users u ON p.user_id = u.id
		LEFT JOIN threads t ON p.thread_id = t.id
		LEFT JOIN boards b ON t.board_id = b.id
		LEFT JOIN channels ch ON t.channel_id = ch.id
		WHERE p.id = $1
		  AND (COALESCE(p.is_private, false) = false OR p.user_id::text = $2 OR p.private_recipient_id::text = $2)
		  AND ` + visibilityCond + `
		  AND ` + channelCond + `
	`

	var post models.Post
	var username, nicknameEmojiID, avatarURL sql.NullString
	var contentJSON []byte

	args := []interface{}{id, viewerID}
	if viewerID != "" {
		args = append(args, viewerID)
	}

	err := h.db.QueryRow(query, args...).Scan(
		&post.ID, &post.ThreadID, &post.UserID, &post.Content, &contentJSON,
		&post.ImageURL, &post.ImageURLs, &post.Attachments, &post.ReplyTo, &post.IsPrivate,
		&post.PrivateRecipientID, &post.ServerDomain, &post.CreatedAt, &post.IsRemote,
		&username, &nicknameEmojiID, &avatarURL,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
			return
		}
		serverError(c, "handler error", err)
		return
	}
	if username.Valid {
		post.Username = username.String
	}
	if nicknameEmojiID.Valid {
		post.NicknameEmojiID = &nicknameEmojiID.String
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

// DeletePost godoc
// @Summary      Delete post
// @Description  Delete a post (author or moderator/admin only)
// @Tags         Posts
// @Produce      json
// @Param        id query string true "Post ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /posts [delete]
// @Security     BearerAuth
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

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var authorID, threadID string
	err := h.db.QueryRow(`SELECT user_id, thread_id FROM posts WHERE id = $1`, id).Scan(&authorID, &threadID)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Post not found"))
			return
		}
		serverError(c, "handler error", err)
		return
	}

	// H1 (security audit): deleting a post is restricted to its author or
	// platform staff. The moderation UI (ModerationPosts, ModeratorMenu) deletes
	// foreign posts through this same endpoint, so moderator/admin roles must be
	// allowed; anyone else gets 403.
	if authorID != userClaims.UserID {
		isStaff, staffErr := isModeratorOrAdmin(h.db, userClaims.UserID)
		if staffErr != nil {
			serverError(c, "check moderation role", staffErr)
			return
		}
		if !isStaff {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Only the author or a moderator can delete this post"))
			return
		}
	}

	query := `DELETE FROM posts WHERE id = $1`

	result, err := h.db.Exec(query, id)
	if err != nil {
		serverError(c, "handler error", err)
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
//
// UpdatePost godoc
// @Summary      Update post
// @Description  Update post content (author only)
// @Tags         Posts
// @Accept       json
// @Produce      json
// @Param        id path string true "Post ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /posts/{id} [put]
// @Security     BearerAuth
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
		serverError(c, "handler error", err)
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
		serverError(c, "handler error", err)
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
