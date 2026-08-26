package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// ─── Like-related RPC handlers ──────────────────────────────────────────────

// rpcLikesViewerID returns the authenticated viewer ID for the public likes
// RPC surface, or "" for anonymous callers. Guests only ever match the public
// branches of the visibility predicate below.
func rpcLikesViewerID(c *gin.Context) string {
	if claims := getClaims(c); claims != nil {
		return claims.UserID
	}
	return ""
}

// rpcLikesVisibilityPredicate builds the board/channel visibility predicate
// for the likes RPC surface (M-1 from the 2026-08-14 audit): likes and likers
// of posts/threads on private boards or in private channels must be hidden
// from guests and non-members, exactly like the posts/threads surface
// (posts.go GetPosts/GetPost). The enclosing query must expose the aliases
// t (threads), b (boards) and ch (channels); argIndex is the next free bind
// parameter. Returns the SQL clause plus the viewer args to append (nil for
// anonymous callers).
func rpcLikesVisibilityPredicate(viewerID string, argIndex int) (string, []interface{}) {
	if viewerID == "" {
		return "(b.visibility != 'private' AND (t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false))", nil
	}
	p1 := strconv.Itoa(argIndex)
	p2 := strconv.Itoa(argIndex + 1)
	boardCond := "(b.visibility != 'private' OR b.owner_id::text = $" + p1 +
		" OR EXISTS(SELECT 1 FROM gomosub_memberships gm WHERE gm.board_id = t.board_id AND gm.user_id::text = $" + p2 + "))"
	channelCond := "(t.channel_id IS NULL OR COALESCE(ch.is_private, false) = false OR b.owner_id::text = $" + p1 +
		" OR EXISTS(SELECT 1 FROM gomosub_memberships gm2 WHERE gm2.board_id = t.board_id AND gm2.user_id::text = $" + p2 + "))"
	return boardCond + " AND " + channelCond, []interface{}{viewerID, viewerID}
}

// postLikesVisibilityJoins links a post_likes row to its post's board/channel.
const postLikesVisibilityJoins = `
	LEFT JOIN posts p ON pl.post_id = p.id
	LEFT JOIN threads t ON p.thread_id = t.id
	LEFT JOIN boards b ON t.board_id = b.id
	LEFT JOIN channels ch ON t.channel_id = ch.id`

// threadLikesVisibilityJoins links a thread_likes row to its board/channel.
const threadLikesVisibilityJoins = `
	LEFT JOIN threads t ON tl.thread_id = t.id
	LEFT JOIN boards b ON t.board_id = b.id
	LEFT JOIN channels ch ON t.channel_id = ch.id`

// postVisibilityExtraJoins extends a query that already joins posts p with the
// thread's board/channel chain so the visibility predicate can be applied.
const postVisibilityExtraJoins = `
	LEFT JOIN threads t ON p.thread_id = t.id
	LEFT JOIN boards b ON t.board_id = b.id
	LEFT JOIN channels ch ON t.channel_id = ch.id`

// threadVisibilityExtraJoins extends a query that already joins threads t with
// the board/channel chain.
const threadVisibilityExtraJoins = `
	LEFT JOIN boards b ON t.board_id = b.id
	LEFT JOIN channels ch ON t.channel_id = ch.id`

// GetPostLikesCount returns the number of likes for a post.
//
// GetPostLikesCount godoc
// @Summary      Get post likes count
// @Description  Get the number of likes for a post
// @Tags         RPC
// @Produce      json
// @Param        post_uuid query string true "Post UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_post_likes_count [get]
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

	// M-1: likes of posts on private boards/channels must not leak to guests
	// and non-members — the count query filters by the same visibility
	// predicate as the posts surface, so an invisible post reports 0.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 2)
	args := []interface{}{postID}
	args = append(args, predArgs...)

	var count int
	err = h.db.QueryRow(`SELECT COUNT(*) FROM post_likes pl`+postLikesVisibilityJoins+
		`
		WHERE pl.post_id = $1 AND `+pred, args...).Scan(&count)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// GetThreadLikesCount returns the number of likes for a thread.
//
// GetThreadLikesCount godoc
// @Summary      Get thread likes count
// @Description  Get the number of likes for a thread
// @Tags         RPC
// @Produce      json
// @Param        thread_uuid query string true "Thread UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_thread_likes_count [get]
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

	// M-1: same visibility gate as GetPostLikesCount.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 2)
	args := []interface{}{threadID}
	args = append(args, predArgs...)

	var count int
	err = h.db.QueryRow(`SELECT COUNT(*) FROM thread_likes tl`+threadLikesVisibilityJoins+
		`
		WHERE tl.thread_id = $1 AND `+pred, args...).Scan(&count)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// HasUserLikedPost checks if a user liked a specific post.
//
// HasUserLikedPost godoc
// @Summary      Check if user liked post
// @Description  Check if a specific user has liked a specific post
// @Tags         RPC
// @Produce      json
// @Param        post_uuid query string true "Post UUID"
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/has_user_liked_post [get]
// @Security     BearerAuth
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

	// M-1: the boolean must not reveal likes on private boards/channels — an
	// invisible post is indistinguishable from one nobody liked (false).
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 3)
	args := []interface{}{postID, userID}
	args = append(args, predArgs...)

	var exists bool
	err = h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM post_likes pl`+postLikesVisibilityJoins+
		`
		WHERE pl.post_id = $1 AND pl.user_id = $2 AND `+pred+`)`, args...).Scan(&exists)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(exists))
}

// HasUserLikedThread checks if a user liked a specific thread.
//
// HasUserLikedThread godoc
// @Summary      Check if user liked thread
// @Description  Check if a specific user has liked a specific thread
// @Tags         RPC
// @Produce      json
// @Param        thread_uuid query string true "Thread UUID"
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/has_user_liked_thread [get]
// @Security     BearerAuth
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

	// M-1: same visibility gate as HasUserLikedPost.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 3)
	args := []interface{}{threadID, userID}
	args = append(args, predArgs...)

	var exists bool
	err = h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM thread_likes tl`+threadLikesVisibilityJoins+
		`
		WHERE tl.thread_id = $1 AND tl.user_id = $2 AND `+pred+`)`, args...).Scan(&exists)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(exists))
}

// GetUserLikesGivenCount returns total likes given by a user.
//
// GetUserLikesGivenCount godoc
// @Summary      Get user likes given count
// @Description  Get total number of post likes given by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_likes_given_count [get]
// @Security     BearerAuth
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// GetUserLikesReceivedCount returns total likes received by a user (on their posts).
//
// GetUserLikesReceivedCount godoc
// @Summary      Get user likes received count
// @Description  Get total number of post likes received by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_likes_received_count [get]
// @Security     BearerAuth
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

	// M-1: the received count must exclude likes on posts that live on private
	// boards/channels for this viewer — an anonymous caller must not learn
	// engagement on another user's private content.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 2)
	args := []interface{}{userID}
	args = append(args, predArgs...)

	var count int
	err = h.db.QueryRow(`SELECT COUNT(*) FROM post_likes pl
		JOIN posts p ON pl.post_id = p.id`+postVisibilityExtraJoins+`
		WHERE p.user_id = $1 AND `+pred, args...).Scan(&count)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// GetUserThreadLikesGivenCount returns total thread likes given by a user.
//
// GetUserThreadLikesGivenCount godoc
// @Summary      Get user thread likes given count
// @Description  Get total number of thread likes given by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_thread_likes_given_count [get]
// @Security     BearerAuth
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
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// GetUserThreadLikesReceivedCount returns total thread likes received by a user.
//
// GetUserThreadLikesReceivedCount godoc
// @Summary      Get user thread likes received count
// @Description  Get total number of thread likes received by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_thread_likes_received_count [get]
// @Security     BearerAuth
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

	// M-1: same visibility gate as GetUserLikesReceivedCount.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 2)
	args := []interface{}{userID}
	args = append(args, predArgs...)

	var count int
	err = h.db.QueryRow(`SELECT COUNT(*) FROM thread_likes tl
		JOIN threads t ON tl.thread_id = t.id`+threadVisibilityExtraJoins+`
		WHERE t.user_id = $1 AND `+pred, args...).Scan(&count)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(count))
}

// GetRecentPostLikers returns recent users who liked a post.
//
// GetRecentPostLikers godoc
// @Summary      Get recent post likers
// @Description  Get recent users who liked a specific post
// @Tags         RPC
// @Produce      json
// @Param        post_uuid query string true "Post UUID"
// @Param        limit_count query int false "Max results (1-50)" default(10)
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_recent_post_likers [get]
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

	// M-1: likers of posts on private boards/channels are PII (usernames,
	// ids, avatars) — the list must be empty for guests and non-members.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 3)
	query := `
		SELECT u.username, u.id, u.avatar_url, u.nickname_emoji_id, u.is_anonymous
		FROM post_likes pl
		JOIN users u ON pl.user_id = u.id` + postLikesVisibilityJoins + `
		WHERE pl.post_id = $1 AND ` + pred + `
		ORDER BY pl.created_at DESC
		LIMIT $2
	`

	args := []interface{}{postID, limit}
	args = append(args, predArgs...)
	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var likers []struct {
		Username        string  `json:"username"`
		ID              string  `json:"id"`
		AvatarURL       *string `json:"avatar_url"`
		NicknameEmojiID *string `json:"nickname_emoji_id"`
		IsAnonymous     bool    `json:"is_anonymous"`
	}

	for rows.Next() {
		var liker struct {
			Username        string  `json:"username"`
			ID              string  `json:"id"`
			AvatarURL       *string `json:"avatar_url"`
			NicknameEmojiID *string `json:"nickname_emoji_id"`
			IsAnonymous     bool    `json:"is_anonymous"`
		}
		var avatarURL, nicknameEmojiID sql.NullString

		err := rows.Scan(&liker.Username, &liker.ID, &avatarURL, &nicknameEmojiID, &liker.IsAnonymous)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}

		if avatarURL.Valid {
			liker.AvatarURL = &avatarURL.String
		}
		if nicknameEmojiID.Valid {
			liker.NicknameEmojiID = &nicknameEmojiID.String
		}

		likers = append(likers, liker)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(likers))
}

// GetRecentThreadLikers returns recent users who liked a thread.
//
// GetRecentThreadLikers godoc
// @Summary      Get recent thread likers
// @Description  Get recent users who liked a specific thread
// @Tags         RPC
// @Produce      json
// @Param        thread_uuid query string true "Thread UUID"
// @Param        limit_count query int false "Max results (1-50)" default(10)
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_recent_thread_likers [get]
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

	// M-1: same visibility gate as GetRecentPostLikers.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, 3)
	query := `
		SELECT u.username, u.id, u.avatar_url, u.nickname_emoji_id, u.is_anonymous
		FROM thread_likes tl
		JOIN users u ON tl.user_id = u.id` + threadLikesVisibilityJoins + `
		WHERE tl.thread_id = $1 AND ` + pred + `
		ORDER BY tl.created_at DESC
		LIMIT $2
	`

	args := []interface{}{threadID, limit}
	args = append(args, predArgs...)
	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var likers []struct {
		Username        string  `json:"username"`
		ID              string  `json:"id"`
		AvatarURL       *string `json:"avatar_url"`
		NicknameEmojiID *string `json:"nickname_emoji_id"`
		IsAnonymous     bool    `json:"is_anonymous"`
	}

	for rows.Next() {
		var liker struct {
			Username        string  `json:"username"`
			ID              string  `json:"id"`
			AvatarURL       *string `json:"avatar_url"`
			NicknameEmojiID *string `json:"nickname_emoji_id"`
			IsAnonymous     bool    `json:"is_anonymous"`
		}
		var avatarURL, nicknameEmojiID sql.NullString

		err := rows.Scan(&liker.Username, &liker.ID, &avatarURL, &nicknameEmojiID, &liker.IsAnonymous)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}

		if avatarURL.Valid {
			liker.AvatarURL = &avatarURL.String
		}
		if nicknameEmojiID.Valid {
			liker.NicknameEmojiID = &nicknameEmojiID.String
		}

		likers = append(likers, liker)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(likers))
}

// GetUserPostLikesReceivedTimestamps returns created_at for each like on posts authored by user_uuid.
//
// GetUserPostLikesReceivedTimestamps godoc
// @Summary      Get post likes received timestamps
// @Description  Get timestamps of all post likes received by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_post_likes_received_timestamps [get]
// @Security     BearerAuth
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
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// PostLikeBatchItem is a single item in the batch post-likes response.
type PostLikeBatchItem struct {
	PostID  string `json:"post_id"`
	Count   int    `json:"count"`
	IsLiked bool   `json:"is_liked"`
}

// GetPostLikesBatch returns like counts and user-like status for multiple posts in one query.
// GET /api/rpc/get_post_likes_batch?post_ids=uuid1,uuid2,...&user_uuid=uuid
//
// GetPostLikesBatch godoc
// @Summary      Get post likes batch
// @Description  Get like counts and user-like status for multiple posts
// @Tags         RPC
// @Produce      json
// @Param        post_ids   query string true "Comma-separated post UUIDs"
// @Param        user_uuid  query string false "User UUID for is_liked check"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_post_likes_batch [get]
func (h *RPCHandler) GetPostLikesBatch(c *gin.Context) {
	idsRaw := c.Query("post_ids")
	if idsRaw == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("post_ids parameter required"))
		return
	}

	rawParts := strings.Split(idsRaw, ",")
	var postIDs []string
	for _, p := range rawParts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := uuid.Parse(p); err != nil {
			continue // skip invalid UUIDs silently
		}
		postIDs = append(postIDs, p)
	}

	if len(postIDs) == 0 {
		c.JSON(http.StatusOK, models.SuccessResponse([]PostLikeBatchItem{}))
		return
	}

	// Cap at 50 posts to prevent abuse
	if len(postIDs) > 50 {
		postIDs = postIDs[:50]
	}

	placeholders := make([]string, len(postIDs))
	args := make([]interface{}, len(postIDs))
	for i, id := range postIDs {
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = id
	}
	ph := strings.Join(placeholders, ",")

	// M-1: invisible posts (private board/channel for this viewer) are
	// filtered out by the visibility predicate, so they report count 0 and
	// is_liked false — the response keeps every requested ID (stable shape).
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, len(postIDs)+1)
	countArgs := make([]interface{}, 0, len(postIDs)+len(predArgs))
	countArgs = append(countArgs, args...)
	countArgs = append(countArgs, predArgs...)

	// Bulk like counts
	countQuery := `SELECT pl.post_id, COUNT(*) FROM post_likes pl` + postLikesVisibilityJoins +
		`
		WHERE pl.post_id IN (` + ph + `) AND ` + pred + `
		GROUP BY pl.post_id`
	countRows, err := h.db.Query(countQuery, countArgs...)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer countRows.Close()

	countMap := make(map[string]int)
	for countRows.Next() {
		var pid string
		var cnt int
		if err := countRows.Scan(&pid, &cnt); err != nil {
			continue
		}
		countMap[pid] = cnt
	}

	// Bulk is_liked check (only if user is authenticated)
	userID := c.Query("user_uuid")
	likedMap := make(map[string]bool)
	if userID != "" {
		if _, err := uuid.Parse(userID); err == nil {
			uArgs := make([]interface{}, 0, len(postIDs)+1)
			uArgs = append(uArgs, userID)
			uPlaceholders := make([]string, len(postIDs))
			for i, id := range postIDs {
				uPlaceholders[i] = "$" + strconv.Itoa(i+2)
				uArgs = append(uArgs, id)
			}
			uPh := strings.Join(uPlaceholders, ",")
			lPred, lPredArgs := rpcLikesVisibilityPredicate(viewerID, len(postIDs)+2)
			uArgs = append(uArgs, lPredArgs...)
			likedQuery := `SELECT pl.post_id FROM post_likes pl` + postLikesVisibilityJoins +
				`
				WHERE pl.user_id = $1 AND pl.post_id IN (` + uPh + `) AND ` + lPred
			likedRows, err := h.db.Query(likedQuery, uArgs...)
			if err == nil {
				defer likedRows.Close()
				for likedRows.Next() {
					var pid string
					if err := likedRows.Scan(&pid); err == nil {
						likedMap[pid] = true
					}
				}
			}
		}
	}

	result := make([]PostLikeBatchItem, 0, len(postIDs))
	for _, pid := range postIDs {
		result = append(result, PostLikeBatchItem{
			PostID:  pid,
			Count:   countMap[pid],
			IsLiked: likedMap[pid],
		})
	}

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// ThreadLikeBatchItem is a single item in the batch likes response.
type ThreadLikeBatchItem struct {
	ThreadID string `json:"thread_id"`
	Count    int    `json:"count"`
	IsLiked  bool   `json:"is_liked"`
	IsRecent bool   `json:"is_recent"`
}

// GetThreadLikesBatch returns like counts and user-like status for multiple threads in one query.
// GET /api/rpc/get_thread_likes_batch?thread_ids=uuid1,uuid2,...&user_uuid=uuid
//
// GetThreadLikesBatch godoc
// @Summary      Get thread likes batch
// @Description  Get like counts and user-like status for multiple threads
// @Tags         RPC
// @Produce      json
// @Param        thread_ids query string true "Comma-separated thread UUIDs"
// @Param        user_uuid  query string false "User UUID for is_liked check"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_thread_likes_batch [get]
func (h *RPCHandler) GetThreadLikesBatch(c *gin.Context) {
	idsRaw := c.Query("thread_ids")
	if idsRaw == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("thread_ids parameter required"))
		return
	}

	rawParts := strings.Split(idsRaw, ",")
	var threadIDs []string
	for _, p := range rawParts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if _, err := uuid.Parse(p); err != nil {
			continue // skip invalid UUIDs silently
		}
		threadIDs = append(threadIDs, p)
	}

	if len(threadIDs) == 0 {
		c.JSON(http.StatusOK, models.SuccessResponse([]ThreadLikeBatchItem{}))
		return
	}

	// Cap at 50 threads to prevent abuse
	if len(threadIDs) > 50 {
		threadIDs = threadIDs[:50]
	}

	placeholders := make([]string, len(threadIDs))
	args := make([]interface{}, len(threadIDs))
	for i, id := range threadIDs {
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = id
	}
	ph := strings.Join(placeholders, ",")

	// M-1: same visibility gate as GetPostLikesBatch.
	viewerID := rpcLikesViewerID(c)
	pred, predArgs := rpcLikesVisibilityPredicate(viewerID, len(threadIDs)+1)
	countArgs := make([]interface{}, 0, len(threadIDs)+len(predArgs))
	countArgs = append(countArgs, args...)
	countArgs = append(countArgs, predArgs...)

	// Bulk like counts
	countQuery := `SELECT tl.thread_id, COUNT(*) FROM thread_likes tl` + threadLikesVisibilityJoins +
		`
		WHERE tl.thread_id IN (` + ph + `) AND ` + pred + `
		GROUP BY tl.thread_id`
	countRows, err := h.db.Query(countQuery, countArgs...)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer countRows.Close()

	countMap := make(map[string]int)
	for countRows.Next() {
		var tid string
		var cnt int
		if err := countRows.Scan(&tid, &cnt); err != nil {
			continue
		}
		countMap[tid] = cnt
	}

	// Bulk is_liked check (only if user is authenticated)
	userID := c.Query("user_uuid")
	likedMap := make(map[string]bool)
	if userID != "" {
		if _, err := uuid.Parse(userID); err == nil {
			uArgs := make([]interface{}, 0, len(threadIDs)+1)
			uArgs = append(uArgs, userID)
			uPlaceholders := make([]string, len(threadIDs))
			for i, id := range threadIDs {
				uPlaceholders[i] = "$" + strconv.Itoa(i+2)
				uArgs = append(uArgs, id)
			}
			uPh := strings.Join(uPlaceholders, ",")
			lPred, lPredArgs := rpcLikesVisibilityPredicate(viewerID, len(threadIDs)+2)
			uArgs = append(uArgs, lPredArgs...)
			likedQuery := `SELECT tl.thread_id FROM thread_likes tl` + threadLikesVisibilityJoins +
				`
				WHERE tl.user_id = $1 AND tl.thread_id IN (` + uPh + `) AND ` + lPred
			likedRows, err := h.db.Query(likedQuery, uArgs...)
			if err == nil {
				defer likedRows.Close()
				for likedRows.Next() {
					var tid string
					if err := likedRows.Scan(&tid); err == nil {
						likedMap[tid] = true
					}
				}
			}
		}
	}

	result := make([]ThreadLikeBatchItem, 0, len(threadIDs))
	for _, tid := range threadIDs {
		result = append(result, ThreadLikeBatchItem{
			ThreadID: tid,
			Count:    countMap[tid],
			IsLiked:  likedMap[tid],
			IsRecent: false,
		})
	}

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// GetUserThreadLikesReceivedTimestamps returns created_at for each like on threads authored by user_uuid.
//
// GetUserThreadLikesReceivedTimestamps godoc
// @Summary      Get thread likes received timestamps
// @Description  Get timestamps of all thread likes received by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_thread_likes_received_timestamps [get]
// @Security     BearerAuth
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
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}

// GetUserThreadReplyTimestamps returns created_at for posts on threads owned by user_uuid written by others.
//
// GetUserThreadReplyTimestamps godoc
// @Summary      Get thread reply timestamps
// @Description  Get timestamps of replies on threads owned by a user
// @Tags         RPC
// @Produce      json
// @Param        user_uuid query string true "User UUID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /rpc/get_user_thread_reply_timestamps [get]
// @Security     BearerAuth
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
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var out []map[string]interface{}
	for rows.Next() {
		var t time.Time
		if err := rows.Scan(&t); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		out = append(out, map[string]interface{}{"created_at": t.UTC().Format(time.RFC3339Nano)})
	}
	c.JSON(http.StatusOK, models.SuccessResponse(out))
}
