package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
)

// ─── Cache Invalidation ─────────────────────────────────────────────────────

// invalidateCacheForTableResult invalidates cache based on table and result data
func (h *UniversalHandler) invalidateCacheForTableResult(c *gin.Context, tableName string, result map[string]interface{}) {
	if h.redis == nil {
		fmt.Printf("[CacheInvalidator] Redis is nil, skipping invalidation for %s\n", tableName)
		return
	}

	fmt.Printf("[CacheInvalidator] Invalidating cache for table %s\n", tableName)
	for k, v := range result {
		fmt.Printf("[CacheInvalidator]   result[%s] = %v (type: %T)\n", k, v, v)
	}

	// Build values map from result
	values := make(map[string]string)
	if id, ok := result["id"].(string); ok && id != "" {
		fmt.Printf("[CacheInvalidator] Found id: %s\n", id)
		values["id"] = id
	} else {
		fmt.Printf("[CacheInvalidator] id not found or not string, ok=%v, id=%v\n", ok, result["id"])
	}

	// Add foreign keys based on table
	// The /my-emoji-subscriptions and /my-emoji-packs handlers embed pack
	// metadata, emoji counts and the full emoji lists. Any emoji-pack write
	// must invalidate them too, otherwise the data cache keeps serving the
	// pre-change list for the whole TTL (a freshly installed pack was invisible
	// for up to 2 minutes — the "pack appears with a delay" bug).
	invalidateMyEmojiLists := func() {
		cache.InvalidateByPattern(h.redis, "data:/api/v1/my-emoji-subscriptions*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/my-emoji-packs*")
	}

	switch tableName {
	case "emoji_packs":
		if authorID, ok := result["author_id"].(string); ok {
			values["author_id"] = authorID
		}
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
		invalidateMyEmojiLists()
	case "custom_emojis":
		if packID, ok := result["pack_id"].(string); ok {
			values["pack_id"] = packID
		}
		cache.InvalidateByPattern(h.redis, "data:/api/v1/custom_emojis*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
		invalidateMyEmojiLists()
	case "profiles":
		if username, ok := result["username"].(string); ok && username != "" {
			values["username"] = username
		}
		fmt.Printf("[CacheInvalidator] Invalidating profile cache: id=%s, username=%s\n", values["id"], values["username"])
		cache.InvalidateForProfile(h.redis, values["id"], values["username"])
	case "boards":
		if slug, ok := result["slug"].(string); ok && slug != "" {
			values["slug"] = slug
		}
		fmt.Printf("[CacheInvalidator] Invalidating board cache: id=%s, slug=%s\n", values["id"], values["slug"])
		cache.InvalidateForBoard(h.redis, values["id"], values["slug"])
	case "posts":
		if threadID, ok := result["thread_id"].(string); ok && threadID != "" {
			values["thread_id"] = threadID
		}
		fmt.Printf("[CacheInvalidator] Invalidating post cache: id=%s, thread_id=%s\n", values["id"], values["thread_id"])
		cache.InvalidateForPost(h.redis, values["id"], values["thread_id"])
		// The board's thread list (threads?board_id=eq.X) is cached under the
		// board_id and embeds post_count — the post-scoped patterns only match
		// the standalone thread page, so the list would go stale for the TTL.
		h.invalidateThreadBoardCache(c, values["thread_id"])
		// New posts bump threads in the unified feed.
		middleware.InvalidateCacheForFeed(h.redis)
	case "threads":
		if boardID, ok := result["board_id"].(string); ok && boardID != "" {
			values["board_id"] = boardID
		}
		fmt.Printf("[CacheInvalidator] Invalidating thread cache: id=%s, board_id=%s\n", values["id"], values["board_id"])
		cache.InvalidateForThread(h.redis, values["id"], values["board_id"])
		// A new/updated thread is a candidate for the unified feed.
		middleware.InvalidateCacheForFeed(h.redis)
	case "profile_wall_posts":
		if wallOwnerID, ok := result["user_id"].(string); ok && wallOwnerID != "" {
			values["user_id"] = wallOwnerID
		}
		fmt.Printf("[CacheInvalidator] Invalidating wall post cache: id=%s, user_id=%s\n", values["id"], values["user_id"])
		cache.InvalidateForWallPost(h.redis, values["id"], values["user_id"])
	case "profile_wall_post_comments":
		if postID, ok := result["post_id"].(string); ok && postID != "" {
			values["post_id"] = postID
		}
		fmt.Printf("[CacheInvalidator] Invalidating wall comment cache: id=%s, post_id=%s\n", values["id"], values["post_id"])
		cache.InvalidateForWallComment(h.redis, values["id"], values["post_id"])
	case "chat_messages":
		if conversationID, ok := result["conversation_id"].(string); ok && conversationID != "" {
			values["conversation_id"] = conversationID
		}
		fmt.Printf("[CacheInvalidator] Invalidating chat message cache: id=%s, conversation_id=%s\n", values["id"], values["conversation_id"])
		cache.InvalidateForChatMessage(h.redis, values["id"], values["conversation_id"])
	case "notifications":
		if userID, ok := result["user_id"].(string); ok && userID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating notification cache for user_id=%s\n", userID)
			cache.InvalidateForNotification(h.redis, userID)
		}
	case "chat_conversation_members":
		if conversationID, ok := result["conversation_id"].(string); ok && conversationID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating chat conversation cache: conversation_id=%s\n", conversationID)
			cache.InvalidateForChatConversation(h.redis, conversationID, "")
		}
	case "channels":
		if boardID, ok := result["board_id"].(string); ok && boardID != "" {
			values["board_id"] = boardID
		}
		fmt.Printf("[CacheInvalidator] Invalidating channels cache: id=%s, board_id=%s\n", values["id"], values["board_id"])
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/channels*board_id=eq.%s*", values["board_id"]))
	case "gift_catalog":
		fmt.Printf("[CacheInvalidator] Invalidating gift_catalog cache: id=%s\n", values["id"])
		cache.InvalidateByPattern(h.redis, "data:/api/v1/gift_catalog*")
	case "user_gifts":
		if recipientID, ok := result["recipient_id"].(string); ok && recipientID != "" {
			values["recipient_id"] = recipientID
		}
		fmt.Printf("[CacheInvalidator] Invalidating user_gifts cache: id=%s, recipient_id=%s\n", values["id"], values["recipient_id"])
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_gifts*recipient_id=eq.%s*", values["recipient_id"]))
	case "gomosub_roles":
		if boardID, ok := result["board_id"].(string); ok && boardID != "" {
			values["board_id"] = boardID
		}
		fmt.Printf("[CacheInvalidator] Invalidating gomosub_roles cache: id=%s, board_id=%s\n", values["id"], values["board_id"])
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_roles*board_id=eq.%s*", values["board_id"]))
	case "channel_permissions":
		if channelID, ok := result["channel_id"].(string); ok && channelID != "" {
			values["channel_id"] = channelID
		}
		fmt.Printf("[CacheInvalidator] Invalidating channel_permissions cache: channel_id=%s\n", values["channel_id"])
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/channel_permissions*channel_id=eq.%s*", values["channel_id"]))
	case "gomosub_memberships":
		if boardID, ok := result["board_id"].(string); ok && boardID != "" {
			values["board_id"] = boardID
		}
		fmt.Printf("[CacheInvalidator] Invalidating gomosub_memberships cache: board_id=%s\n", values["board_id"])
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_memberships*board_id=eq.%s*", values["board_id"]))
	case "friend_requests", "friendships":
		fmt.Printf("[CacheInvalidator] Invalidating friends cache: %s\n", tableName)
		cache.InvalidateByPattern(h.redis, "data:/api/v1/friends*")
	case "profile_customization":
		if userID, ok := result["user_id"].(string); ok && userID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating profile_customization cache: user_id=%s\n", userID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=eq.%s*", userID))
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=%s*", userID))
			// Also invalidate profile hover card cache (contains customization)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
		}
	case "privacy_settings":
		if userID, ok := result["user_id"].(string); ok && userID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating privacy_settings + profile cache: user_id=%s\n", userID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/privacy_settings*user_id=eq.%s*", userID))
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID))
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/friends*user_id=%s*", userID))
			// The public visibility-flags endpoint (GET /api/v1/users/:id/privacy)
			// caches per viewer under data:/api/v1/users/<id>/privacy?|viewer=… —
			// without this, a settings change would keep serving stale hide flags
			// (tabs that were just unhidden stay missing for the cache TTL).
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/users/%s/privacy*", userID))
		}
	case "user_emoji_subscriptions":
		if userID, ok := result["user_id"].(string); ok && userID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating user_emoji_subscriptions cache: user_id=%s\n", userID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_emoji_subscriptions*user_id=eq.%s*", userID))
		}
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
		invalidateMyEmojiLists()
	default:
		fmt.Printf("[CacheInvalidator] Generic invalidation for table %s: %+v\n", tableName, values)
		cache.InvalidateForTable(h.redis, tableName, values)
	}
}

// invalidateWallListCache clears the owner's wall-list cache entry after an
// interaction write. The wall GET now embeds per-post interaction counts
// (likes/comments/reposts + viewer state), so a like/comment/repost must
// invalidate the owner's list key (user_id=eq.<owner>) — the post-scoped
// patterns alone only match the standalone post page.
func (h *UniversalHandler) invalidateWallListCache(c *gin.Context, postID string) {
	if h.redis == nil || postID == "" {
		return
	}
	var ownerID string
	if err := h.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&ownerID); err != nil || ownerID == "" {
		return
	}
	middleware.InvalidateCacheForProfileWall(h.redis, ownerID)
}

// invalidateThreadBoardCache clears the board's thread-list cache after a post
// write. The board list (threads?board_id=eq.X) is cached under the board_id
// and embeds per-thread post_count — post-scoped invalidation only matches the
// standalone thread page, so without this the board list would show a stale
// post_count until the data-cache TTL expires.
func (h *UniversalHandler) invalidateThreadBoardCache(c *gin.Context, threadID string) {
	if h.redis == nil || threadID == "" {
		return
	}
	var boardID string
	if err := h.db.QueryRowContext(c.Request.Context(),
		"SELECT board_id FROM threads WHERE id = $1", threadID).Scan(&boardID); err != nil || boardID == "" {
		return
	}
	middleware.InvalidateCacheForBoard(h.redis, boardID)
}

// invalidateCommentLikesCache invalidates every cache whose response embeds
// comment like counts: the post's comments list and the owner's wall list.
func (h *UniversalHandler) invalidateCommentLikesCache(c *gin.Context, commentID string) {
	if h.redis == nil || commentID == "" {
		return
	}
	var postID string
	if err := h.db.QueryRowContext(c.Request.Context(),
		"SELECT post_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&postID); err != nil || postID == "" {
		return
	}
	middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
	h.invalidateWallListCache(c, postID)
}

// recomputeStatsForWallPostLike refreshes the unified stats of everyone whose
// counters a wall-post like changes: the post's author (likes_received) and
// the liker (likes_given). The author is resolved from the DB because the
// generic CRUD result only carries the like's foreign key.
func (h *UniversalHandler) recomputeStatsForWallPostLike(c *gin.Context, postID, likerID string) {
	if postID != "" {
		var authorID string
		if err := h.db.QueryRowContext(c.Request.Context(),
			"SELECT author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&authorID); err == nil && authorID != "" {
			RecomputeUserProfileStats(h.db, authorID)
		}
	}
	if likerID != "" {
		RecomputeUserProfileStats(h.db, likerID)
	}
}

// recomputeStatsForWallCommentLike — same as recomputeStatsForWallPostLike but
// for likes on wall comments: the comment's author (likes_received) and the
// liker (likes_given).
func (h *UniversalHandler) recomputeStatsForWallCommentLike(c *gin.Context, commentID, likerID string) {
	if commentID != "" {
		var authorID string
		if err := h.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&authorID); err == nil && authorID != "" {
			RecomputeUserProfileStats(h.db, authorID)
		}
	}
	if likerID != "" {
		RecomputeUserProfileStats(h.db, likerID)
	}
}

// wallResultString returns the string value of a generic result-map cell, or "".
func wallResultString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// wallIDPtr returns nil for an empty string, else a pointer to it.
func wallIDPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// wallPostOwnerAuthor resolves the wall owner and author of a wall post.
func (h *UniversalHandler) wallPostOwnerAuthor(c *gin.Context, postID string) (ownerID, authorID string) {
	if postID == "" {
		return "", ""
	}
	_ = h.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id, author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&ownerID, &authorID)
	return ownerID, authorID
}

// wallCommentPostAndAuthor resolves a wall comment's post_id and author.
func (h *UniversalHandler) wallCommentPostAndAuthor(c *gin.Context, commentID string) (postID, authorID string) {
	if commentID == "" {
		return "", ""
	}
	_ = h.db.QueryRowContext(c.Request.Context(),
		"SELECT post_id, user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&postID, &authorID)
	return postID, authorID
}

// createWallNotification creates a wall notification for recipientID, skipping
// self-notifications. Best-effort — a failed notification must never fail the
// underlying wall write.
func (h *UniversalHandler) createWallNotification(c *gin.Context, recipientID, actorID, notifType, message, actorUsername string, wallPostID, wallCommentID, wallUserID *string) {
	if recipientID == "" || actorID == "" || recipientID == actorID {
		return
	}
	params := &models.NotificationParams{Actor: actorUsername}
	if _, err := CreateWallNotification(h.db, h.redis, h.hub, recipientID, notifType, message, params, wallPostID, wallCommentID, wallUserID, &actorID); err != nil {
		fmt.Printf("[WallNotifications] error creating %s notification: %v\n", notifType, err)
	}
}

// notifyWallPostLike creates the "wall_post_like" notification for the wall
// post author.
func (h *UniversalHandler) notifyWallPostLike(c *gin.Context, postID, actorID string) {
	if postID == "" || actorID == "" {
		return
	}
	ownerID, authorID := h.wallPostOwnerAuthor(c, postID)
	if authorID == "" || authorID == actorID {
		return
	}
	h.createWallNotification(c, authorID, actorID, "wall_post_like", "", getUsernameFromDB(h.db, actorID), wallIDPtr(postID), nil, wallIDPtr(ownerID))
}

// notifyWallComment creates the wall comment / reply notifications for a newly
// inserted wall comment.
func (h *UniversalHandler) notifyWallComment(c *gin.Context, result map[string]interface{}) {
	commentID := wallResultString(result["id"])
	postID := wallResultString(result["post_id"])
	actorID := wallResultString(result["user_id"])
	parentID := wallResultString(result["parent_id"])
	if postID == "" || actorID == "" {
		return
	}

	snippet := truncateRunes(wallResultString(result["content"]), 100)
	ownerID, postAuthorID := h.wallPostOwnerAuthor(c, postID)

	// Reply to another comment → notify the parent comment's author.
	if parentID != "" {
		_, parentAuthorID := h.wallCommentPostAndAuthor(c, parentID)
		if parentAuthorID != "" && parentAuthorID != actorID {
			h.createWallNotification(c, parentAuthorID, actorID, "wall_comment_reply", snippet, getUsernameFromDB(h.db, actorID), wallIDPtr(postID), wallIDPtr(commentID), wallIDPtr(ownerID))
		}
		return
	}

	// Top-level comment → notify the post author.
	if postAuthorID != "" && postAuthorID != actorID {
		h.createWallNotification(c, postAuthorID, actorID, "wall_comment", snippet, getUsernameFromDB(h.db, actorID), wallIDPtr(postID), wallIDPtr(commentID), wallIDPtr(ownerID))
	}
}

// notifyWallRepost creates the "wall_repost" notification for the author of the
// original wall post.
func (h *UniversalHandler) notifyWallRepost(c *gin.Context, result map[string]interface{}) {
	originalPostID := wallResultString(result["post_id"])
	actorID := wallResultString(result["user_id"])
	if originalPostID == "" || actorID == "" {
		return
	}
	ownerID, originalAuthorID := h.wallPostOwnerAuthor(c, originalPostID)
	if originalAuthorID == "" || originalAuthorID == actorID {
		return
	}
	h.createWallNotification(c, originalAuthorID, actorID, "wall_repost", "", getUsernameFromDB(h.db, actorID), wallIDPtr(originalPostID), nil, wallIDPtr(ownerID))
}

// ─── GET ────────────────────────────────────────────────────────────────────

func (h *UniversalHandler) handleGet(c *gin.Context, tableName string) {
	if tableName == "user_achievements" {
		h.handleUserAchievementsGet(c)
		return
	}
	if tableName == "profile_wall_posts" {
		h.handleProfileWallPostsGet(c)
		return
	}
	if tableName == "profile_wall_post_comments" {
		h.handleProfileWallPostCommentsGet(c)
		return
	}

	query := "SELECT * FROM " + tableName
	var args []interface{}
	forcedUserID := genericReadScopeUser(c, tableName)

	// Build WHERE clause from query parameters
	var clauses []string
	argIndex := 1
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
			continue
		}
		if !isValidColumnName(key) {
			continue
		}

		for _, rawValue := range values {
			clause, nextArgs, nextIndex := buildFilterClause(key, rawValue, argIndex)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
	}

	// OR conditions: or=col.eq.value,col2.ilike.%term%
	if forcedUserID != "" {
		clauses = append(clauses, "user_id = $"+strconv.Itoa(argIndex))
		args = append(args, forcedUserID)
		argIndex++
	}

	// OR conditions: or=col.eq.value,col2.ilike.%term%
	if orRaw := c.Query("or"); orRaw != "" {
		parts := splitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := parseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := buildFilterFromParts(col, op, value, argIndex)
			if clause != "" {
				orClauses = append(orClauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
		if len(orClauses) > 0 {
			clauses = append(clauses, "("+strings.Join(orClauses, " OR ")+")")
		}
	}

	// Guest/authenticated gomosub structure gating: channels, gomosub_roles and
	// channel_permissions of PRIVATE boards are only readable by the owner and
	// members (public boards are readable by everyone, guests included). This
	// stops anonymous browsing from enumerating a private gomosub's internal
	// structure by guessing UUIDs and also closes the pre-existing exposure of
	// that structure to any logged-in non-member. The predicate applies to
	// exactly the tables the registry marks GomosubVisibility.
	scopeClause, scopeArgs, nextArgIndex := genericGomosubVisibility(c, tableName, argIndex)
	if scopeClause != "" {
		clauses = append(clauses, scopeClause)
		args = append(args, scopeArgs...)
		argIndex = nextArgIndex
	}

	// Emoji packs and their emojis: private packs are only visible to their
	// author and subscribers through the generic surface as well (mirrors the
	// by-slug gate in GetPackBySlug).
	scopeClause, scopeArgs, nextArgIndex = genericEmojiVisibility(c, tableName, argIndex)
	if scopeClause != "" {
		clauses = append(clauses, scopeClause)
		args = append(args, scopeArgs...)
		argIndex = nextArgIndex
	}

	if len(clauses) > 0 {
		query += " WHERE " + strings.Join(clauses, " AND ")
	}

	// Handle ORDER BY (PostgREST: col.asc / col.desc) — supports multiple order params
	if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		if s, ok := parseOrderClause(joined, ""); ok {
			query += " ORDER BY " + s
		}
	}

	// Handle LIMIT and OFFSET
	if limit := c.Query("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil && n >= 0 && n <= 10000 {
			query += " LIMIT " + strconv.Itoa(n)
		}
	}
	if offset := c.Query("offset"); offset != "" {
		if n, err := strconv.Atoi(offset); err == nil && n >= 0 && n <= 1000000 {
			query += " OFFSET " + strconv.Itoa(n)
		}
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		serverError(c, "database error", err)
		return
	}
	defer rows.Close()

	results := []map[string]interface{}{}
	columns, _ := rows.Columns()
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			serverError(c, "database error", err)
			return
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				row[col] = decodeColumnValue(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	// L6: sanitize user-supplied customization CSS on read as well, so rows
	// written before server-side sanitization existed are neutralized for
	// every viewer (defense-in-depth alongside the write-path sanitizer).
	if tableName == "profile_customization" {
		for _, row := range results {
			sanitizeProfileCustomizationRow(row)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// ─── POST ───────────────────────────────────────────────────────────────────

// upsertInsertQuery returns INSERT ... ON CONFLICT for tables the frontend
// calls via .upsert(). Which tables support upsert is declared in the table
// registry (TableMeta.Upsert); this function builds the per-table statement.
func upsertInsertQuery(tableName string, data map[string]interface{}) (query string, args []interface{}, ok bool) {
	meta := GenericTableByName(tableName)
	if meta == nil || !meta.Upsert {
		return "", nil, false
	}
	switch tableName {
	case "user_daily_visits":
		uid, hasUID := data["user_id"]
		if !hasUID {
			return "", nil, false
		}
		vd := data["visit_date"]
		if vd == nil || vd == "" {
			vd = time.Now().UTC().Format("2006-01-02")
		}
		q := `INSERT INTO user_daily_visits (user_id, visit_date) VALUES ($1, $2::date)
ON CONFLICT (user_id, visit_date) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING *`
		return q, []interface{}{uid, vd}, true
	case "user_terms_acceptance":
		// Accepting the rules must be idempotent: the client fires the insert
		// on every TermsOfService accept, and multiple tabs / retries race on
		// the UNIQUE(user_id) constraint — a plain INSERT 500'd on the second
		// write, so a user could "accept" forever without a stored row.
		uid, hasUID := data["user_id"]
		if !hasUID {
			return "", nil, false
		}
		termsVersion := data["terms_version"]
		if termsVersion == nil || termsVersion == "" {
			termsVersion = "1.0"
		}
		q := `INSERT INTO user_terms_acceptance (user_id, terms_version) VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET terms_version = EXCLUDED.terms_version
RETURNING *`
		return q, []interface{}{uid, termsVersion}, true
	case "user_session_time":
		// Flushes fire from timers + visibility/unload handlers and can overlap.
		// The client sends the DELTA in total_minutes; accumulate atomically so
		// concurrent flushes neither trip UNIQUE(user_id, session_date) nor lose
		// minutes (a plain INSERT 500'd on the duplicate key, and a naive
		// read-then-write raced into lost updates).
		uid, hasUID := data["user_id"]
		if !hasUID {
			return "", nil, false
		}
		sd := data["session_date"]
		if sd == nil || sd == "" {
			sd = time.Now().UTC().Format("2006-01-02")
		}
		minutes := int64(0)
		switch v := data["total_minutes"].(type) {
		case float64:
			minutes = int64(v)
		case int:
			minutes = int64(v)
		case int64:
			minutes = v
		case string:
			if n, err := strconv.ParseInt(v, 10, 64); err == nil {
				minutes = n
			}
		}
		q := `INSERT INTO user_session_time (user_id, session_date, total_minutes, updated_at)
VALUES ($1, $2::date, $3, NOW())
ON CONFLICT (user_id, session_date) DO UPDATE SET
  total_minutes = user_session_time.total_minutes + EXCLUDED.total_minutes,
  updated_at = NOW()
RETURNING *`
		return q, []interface{}{uid, sd, minutes}, true
	case "thread_custom_message_visits":
		uid, uok := data["user_id"]
		tid, tok := data["thread_id"]
		if !uok || !tok {
			return "", nil, false
		}
		hcm := false
		switch v := data["has_custom_message"].(type) {
		case bool:
			hcm = v
		case string:
			hcm = v == "true" || v == "1"
		}
		q := `INSERT INTO thread_custom_message_visits (user_id, thread_id, has_custom_message) VALUES ($1, $2, $3)
ON CONFLICT (user_id, thread_id) DO UPDATE SET
  has_custom_message = EXCLUDED.has_custom_message,
  updated_at = NOW()
RETURNING *`
		return q, []interface{}{uid, tid, hcm}, true
	case "gomosub_rules_acceptance":
		uid, hasUID := data["user_id"]
		bid, hasBID := data["board_id"]
		if !hasUID || !hasBID {
			return "", nil, false
		}
		acceptedAt := data["accepted_at"]
		if acceptedAt == nil || acceptedAt == "" {
			acceptedAt = time.Now().UTC().Format(time.RFC3339)
		}
		q := `INSERT INTO gomosub_rules_acceptance (user_id, board_id, accepted_at) VALUES ($1, $2, $3)
ON CONFLICT (user_id, board_id) DO UPDATE SET
  accepted_at = EXCLUDED.accepted_at,
  updated_at = NOW()
RETURNING *`
		return q, []interface{}{uid, bid, acceptedAt}, true
	case "profile_wall_post_likes":
		pid, hasPID := data["post_id"]
		uid, hasUID := data["user_id"]
		if !hasPID || !hasUID {
			return "", nil, false
		}
		q := `INSERT INTO profile_wall_post_likes (post_id, user_id) VALUES ($1, $2)
ON CONFLICT (post_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING *, (xmax = 0) AS inserted`
		return q, []interface{}{pid, uid}, true
	case "profile_customization":
		uid, hasUID := data["user_id"]
		if !hasUID {
			return "", nil, false
		}
		// PARTIAL upsert: only the fields present in the request body are
		// updated. The frontend fires separate .upsert() calls for the
		// background (background_url + regenerated theme_tokens), the theme
		// toggle (theme_enabled alone) and the CSS editors — a naive full-row
		// upsert would NULL-out every omitted column (background_url, tokens,
		// CSS) on each toggle, silently destroying the profile styling.
		cols := []string{"user_id"}
		vals := []interface{}{uid}
		sets := []string{}
		arg := 2
		add := func(column string, value interface{}, cast string) {
			cols = append(cols, column)
			vals = append(vals, value)
			s := column + " = $" + strconv.Itoa(arg)
			arg++
			if cast != "" {
				s += cast
			}
			sets = append(sets, s)
		}
		// L6: user-supplied CSS is never trusted — sanitize it down to the
		// allow-list before it reaches the DB, because the stored value is later
		// rendered inline on every viewer's screen.
		if v, ok := data["username_css"]; ok {
			s, _ := v.(string)
			add("username_css", sanitizeProfileCSS(s), "")
		}
		if v, ok := data["profile_badge_text"]; ok {
			s, _ := v.(string)
			add("profile_badge_text", sanitizeProfileBadgeText(s), "")
		}
		if v, ok := data["profile_badge_css"]; ok {
			s, _ := v.(string)
			add("profile_badge_css", sanitizeProfileCSS(s), "")
		}
		// background_url is a storage key rendered as an <img> src on every
		// viewer's screen — only bare relative keys are stored (see
		// sanitizeProfileBackgroundURL), so absolute URLs never reach the DB.
		// A present-but-null value clears the background (the remove action).
		if v, ok := data["background_url"]; ok {
			s, _ := v.(string)
			add("background_url", sanitizeProfileBackgroundURL(s), "")
		}
		// background_variant is the owner's default display variant for their
		// background (banner/card/page/page_dim) — validated against the
		// allow-list; anything else falls back to the banner default.
		if v, ok := data["background_variant"]; ok {
			s, _ := v.(string)
			add("background_variant", sanitizeProfileBackgroundVariant(s), "")
		}
		// Auto-theme: theme_enabled is a plain bool; theme_tokens is a JSONB
		// payload of CSS variables rendered as inline styles on the profile
		// page — sanitized to allow-listed --* keys with HSL values only.
		if v, ok := data["theme_enabled"]; ok {
			b, _ := v.(bool)
			add("theme_enabled", b, "")
		}
		if v, ok := data["theme_tokens"]; ok {
			themeTokens := sanitizeProfileThemeTokens(v)
			themeTokensJSON := "{}"
			if len(themeTokens) > 0 {
				if b, err := json.Marshal(themeTokens); err == nil {
					themeTokensJSON = string(b)
				}
			}
			add("theme_tokens", themeTokensJSON, "::jsonb")
		}
		// Language is intentionally part of the same partial upsert. Without
		// this branch a language-only request fell through to a plain INSERT,
		// which hit the existing profile_customization(user_id) row and returned
		// HTTP 500 on every language change.
		if v, ok := data["language"]; ok {
			language, _ := v.(string)
			language = strings.TrimSpace(language)
			if language != "" {
				add("language", language, "")
			}
		}
		if len(sets) == 0 {
			return "", nil, false
		}
		placeholders := make([]string, len(cols))
		for i := range cols {
			placeholders[i] = "$" + strconv.Itoa(i+1)
		}
		q := "INSERT INTO profile_customization (" + strings.Join(cols, ", ") + ", updated_at) VALUES (" + strings.Join(placeholders, ", ") + ", NOW()) " +
			"ON CONFLICT (user_id) DO UPDATE SET " + strings.Join(sets, ", ") + ", updated_at = NOW() " +
			"RETURNING *"
		return q, vals, true
	default:
		return "", nil, false
	}
}

func scanRowToMap(rows *sql.Rows) (map[string]interface{}, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}
	if err := rows.Scan(valuePtrs...); err != nil {
		return nil, err
	}
	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		if b, ok := val.([]byte); ok {
			result[col] = decodeColumnValue(b)
		} else {
			result[col] = val
		}
	}
	return result, nil
}

// wallOwnerVisibleToViewer reports whether viewerID may interact with the wall
// of ownerID: the owner themself, owners of non-private profiles who have not
// hidden their wall (private_hide_wall), or mutual friends. This mirrors the
// REST read predicate (profileWallFinishSelectQuery) so the write path enforces
// the exact same privacy rule.
func (h *UniversalHandler) wallOwnerVisibleToViewer(viewerID, ownerID string) (bool, error) {
	if viewerID == ownerID {
		return true, nil
	}
	var private, hideWall bool
	err := h.db.QueryRow(
		"SELECT COALESCE(private_profile, false), COALESCE(private_hide_wall, false) FROM privacy_settings WHERE user_id = $1", ownerID,
	).Scan(&private, &hideWall)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy settings row means the profile is public and the wall
			// is not hidden.
			return true, nil
		}
		return false, err
	}
	if !private && !hideWall {
		return true, nil
	}
	var friend bool
	err = h.db.QueryRow(`SELECT EXISTS(
		SELECT 1 FROM friendships
		WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
	)`, viewerID, ownerID).Scan(&friend)
	if err != nil {
		return false, err
	}
	return friend, nil
}

// enforceWallTargetPrivacy rejects interactions with walls that the caller may
// not view: posting on a private wall, commenting on/liking a post of a private
// wall, or reposting a private wall post onto the caller's own wall.
// It writes the HTTP response and returns false when the request is rejected.
func (h *UniversalHandler) enforceWallTargetPrivacy(c *gin.Context, tableName string, data map[string]interface{}, userID string) bool {
	// Resolve the wall owner this interaction targets.
	var wallOwner string
	switch tableName {
	case "profile_wall_posts":
		wallOwner, _ = data["user_id"].(string)
	case "profile_wall_post_comments", "profile_wall_post_likes":
		// L5: the target post must exist. A nonexistent post would leave
		// wallOwner empty and let the `wallOwner == ""` guard below pass,
		// creating an orphan comment/like whose post is gone — and such orphans
		// were readable by everyone (the LEFT JOIN read path had no wall owner
		// to compare against). Fail closed: missing post → 404.
		postID, _ := data["post_id"].(string)
		if postID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("post_id is required"))
			return false
		}
		err := h.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
			} else {
				serverError(c, "lookup wall post", err)
			}
			return false
		}
	case "profile_wall_comment_likes":
		// L5: same fail-closed rule — the commented post must exist. The JOIN
		// also rejects likes on orphan comments whose post is already gone.
		commentID, _ := data["comment_id"].(string)
		if commentID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("comment_id is required"))
			return false
		}
		err := h.db.QueryRowContext(c.Request.Context(), `
			SELECT wp.user_id
			FROM profile_wall_post_comments c
			JOIN profile_wall_posts wp ON wp.id = c.post_id
			WHERE c.id = $1`, commentID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall comment not found"))
			} else {
				serverError(c, "lookup wall comment", err)
			}
			return false
		}
	case "profile_wall_post_reposts":
		// post_id references the ORIGINAL post being reposted — it must exist
		// and its wall owner must be visible to the caller, otherwise private
		// content could be mirrored onto a public wall (and a dangling repost
		// would be readable by everyone, exactly like an orphan comment).
		postID, _ := data["post_id"].(string)
		if postID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("post_id is required"))
			return false
		}
		err := h.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
			} else {
				serverError(c, "lookup wall post", err)
			}
			return false
		}
		// reposted_wall_post_id is the copy placed on the caller's own wall — it
		// must belong to the caller, otherwise cross-links to other users' posts
		// could be forged on the repost record.
		if copyID, ok := data["reposted_wall_post_id"].(string); ok && copyID != "" {
			var copyOwner string
			err := h.db.QueryRowContext(c.Request.Context(),
				"SELECT user_id FROM profile_wall_posts WHERE id = $1", copyID).Scan(&copyOwner)
			if err == nil && copyOwner != "" && copyOwner != userID {
				c.JSON(http.StatusForbidden, models.ErrorResponse("Invalid repost target"))
				return false
			}
		}
	default:
		return true
	}
	if wallOwner == "" || wallOwner == userID {
		return true
	}
	visible, err := h.wallOwnerVisibleToViewer(userID, wallOwner)
	if err != nil {
		serverError(c, "check wall privacy", err)
		return false
	}
	if !visible {
		c.JSON(http.StatusForbidden, models.ErrorResponse("This wall is private"))
		return false
	}
	return true
}

// enforcePostOwnership forces ownership columns of user-owned tables to the
// authenticated user so a client can never impersonate another user on write.
// The ownership kind per table comes from the registry (TableMeta.PostOwner):
// OwnSingle forces user_id, OwnWallPost forces author_id (with the wall owner
// allowed when privacy permits), OwnWallRepost forces user_id AND wall_user_id.
// It writes the HTTP response and returns false when the request is rejected.
func (h *UniversalHandler) enforcePostOwnership(c *gin.Context, tableName string, data map[string]interface{}) bool {
	meta := GenericTableByName(tableName)
	if meta == nil {
		return true
	}
	switch meta.PostOwner {
	case OwnWallPost:
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return false
		}
		// The author is always the caller. The wall owner may be another user,
		// but only when their privacy settings allow posts from others AND the
		// caller may view the wall (private walls require friendship).
		data["author_id"] = userID
		wallOwner, _ := data["user_id"].(string)
		if wallOwner == "" {
			wallOwner = userID
			data["user_id"] = userID
		}
		if wallOwner != userID {
			if !h.enforceWallTargetPrivacy(c, tableName, data, userID) {
				return false
			}
			var allowed bool
			err := h.db.QueryRowContext(c.Request.Context(),
				`SELECT COALESCE(allow_wall_posts_from_others, true) FROM privacy_settings WHERE user_id = $1`,
				wallOwner).Scan(&allowed)
			if err != nil && err != sql.ErrNoRows {
				serverError(c, "check wall privacy", err)
				return false
			}
			if err == sql.ErrNoRows {
				allowed = true
			}
			if !allowed {
				c.JSON(http.StatusForbidden, models.ErrorResponse("This user does not allow wall posts from others"))
				return false
			}
		}
	case OwnSingle:
		// Single-owner tables: the owner is always the authenticated user.
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return false
		}
		data["user_id"] = userID
		if !h.enforceWallTargetPrivacy(c, tableName, data, userID) {
			return false
		}
	case OwnWallRepost:
		// Reposts are always authored by and placed on the caller's own wall;
		// wall_user_id must never be client-controlled (foreign-wall bypass).
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return false
		}
		data["user_id"] = userID
		data["wall_user_id"] = userID
		if !h.enforceWallTargetPrivacy(c, tableName, data, userID) {
			return false
		}
	}
	return true
}

// enforceWallWriteScope appends the ownership predicate to the WHERE clause of
// wall-related writes so a client can only modify its own content. The
// ownership kind per table comes from the registry (TableMeta.WriteOwner):
// OwnSingle scopes `user_id = caller`, OwnWallPost scopes
// `author_id = caller OR user_id = caller`.
// Returns false (response already written) when unauthenticated.
func enforceWallWriteScope(c *gin.Context, tableName string, clauses []string, args []interface{}, argIndex int) ([]string, []interface{}, int, bool) {
	meta := GenericTableByName(tableName)
	if meta == nil {
		return clauses, args, argIndex, true
	}
	switch meta.WriteOwner {
	case OwnWallPost:
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return clauses, args, argIndex, false
		}
		// The author or the wall owner may edit/delete a post.
		clauses = append(clauses, "(author_id = $"+strconv.Itoa(argIndex)+" OR user_id = $"+strconv.Itoa(argIndex)+")")
		args = append(args, userID)
		argIndex++
	case OwnSingle:
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return clauses, args, argIndex, false
		}
		clauses = append(clauses, "user_id = $"+strconv.Itoa(argIndex))
		args = append(args, userID)
		argIndex++
	}
	return clauses, args, argIndex, true
}

func validateCustomEmojiAsset(data map[string]interface{}, userID string) error {
	value, ok := data["image_url"]
	if !ok {
		return nil
	}
	imageURL, ok := value.(string)
	if userID == "" || !ok || imageURL == "" || strings.Contains(imageURL, "://") || !strings.HasPrefix(imageURL, userID+"/") {
		return fmt.Errorf("image_url must reference the authenticated user's emoji storage")
	}
	return nil
}

func validateCustomEmojiTriggers(data map[string]interface{}) error {
	raw, ok := data["unicode_triggers"]
	if !ok {
		return fmt.Errorf("unicode_triggers must contain 1 to 3 emoji")
	}
	var encoded []byte
	switch value := raw.(type) {
	case []byte:
		encoded = value
	case string:
		encoded = []byte(value)
	default:
		return fmt.Errorf("unicode_triggers must be an array")
	}
	var triggers []string
	if err := json.Unmarshal(encoded, &triggers); err != nil || len(triggers) < 1 || len(triggers) > 3 {
		return fmt.Errorf("unicode_triggers must contain 1 to 3 emoji")
	}
	for _, trigger := range triggers {
		if !utf8.ValidString(trigger) || strings.TrimSpace(trigger) == "" || len([]rune(trigger)) > 16 {
			return fmt.Errorf("invalid unicode emoji trigger")
		}
		containsEmoji := false
		for _, r := range trigger {
			if unicode.In(r, unicode.So) || r == '\u200d' || r == '\ufe0f' {
				containsEmoji = true
				break
			}
		}
		if !containsEmoji {
			return fmt.Errorf("unicode_triggers must contain emoji characters")
		}
	}
	return nil
}

func (h *UniversalHandler) handlePost(c *gin.Context, tableName string) {
	data, err := parseJSONObjectBody(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	if err := normalizeJSONValuesForDB(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// C1 (security audit): body keys are interpolated into the INSERT column
	// list verbatim. Reject any key that is not a safe SQL identifier before
	// any other logic sees the payload.
	if err := validateBodyColumnNames(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// H2 (security audit): strip server-managed columns (counters, ownership
	// foreign keys) that must never be client-controlled. Runs after the C1
	// identifier gate and before ownership forcing re-adds user_id/author_id.
	filterWritableColumns(tableName, data)
	if tableName == "custom_emojis" {
		if err := validateCustomEmojiTriggers(data); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
		if err := validateCustomEmojiAsset(data, authenticatedUserID(c)); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
	}

	// Emoji packs and their assets are owned by the authenticated author. Keep
	// these checks here because the generic table surface otherwise accepts any
	// valid UUID/pack_id supplied by the client.
	if tableName == "emoji_packs" {
		uid := authenticatedUserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		data["author_id"] = uid
	}
	if tableName == "custom_emojis" {
		uid := authenticatedUserID(c)
		packID, _ := data["pack_id"].(string)
		if uid == "" || packID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("pack_id is required"))
			return
		}
		var ownsPack bool
		if err := h.db.QueryRowContext(c.Request.Context(), "SELECT EXISTS(SELECT 1 FROM emoji_packs WHERE id = $1 AND author_id = $2)", packID, uid).Scan(&ownsPack); err != nil || !ownsPack {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You can only edit your own emoji pack"))
			return
		}
	}

	// K1: force ownership so writes cannot impersonate another user.
	if !h.enforcePostOwnership(c, tableName, data) {
		return
	}

	// H1 (security audit): joining a board on your own must create the default
	// membership — a client-supplied role_id would let anyone promote themselves
	// to a privileged role or inherit another board's permission set.
	if tableName == "gomosub_memberships" {
		if uid, _ := data["user_id"].(string); uid != "" && uid == authenticatedUserID(c) {
			if rid, ok := data["role_id"]; ok && rid != nil && fmt.Sprint(rid) != "" {
				c.JSON(http.StatusForbidden, models.ErrorResponse("Joining a board cannot assign a role"))
				return
			}
		}
	}

	// H1: channel_permissions has no board_id column — the request board_id is
	// only consumed by the permission check, never stored.
	if tableName == "channel_permissions" {
		delete(data, "board_id")
	}

	if upsertQuery, upsertArgs, useUpsert := upsertInsertQuery(tableName, data); useUpsert {
		rows, err := h.db.Query(upsertQuery, upsertArgs...)
		if err != nil {
			serverError(c, "database error", err)
			return
		}
		defer rows.Close()
		if !rows.Next() {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
			return
		}
		result, err := scanRowToMap(rows)
		if err != nil {
			serverError(c, "database error", err)
			return
		}

		// Invalidate cache for upsert tables that need it
		if tableName == "profile_wall_post_likes" {
			if postID, ok := result["post_id"].(string); ok && h.redis != nil {
				middleware.InvalidateCacheForWallPost(h.redis, postID)
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
				cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_post_likes*")
				// Likes affect feed popularity scores.
				middleware.InvalidateCacheForFeed(h.redis)
			}
		}

		// Invalidate rules acceptance cache so the dialog doesn't re-appear after accepting
		if tableName == "gomosub_rules_acceptance" && h.redis != nil {
			uid := fmt.Sprint(result["user_id"])
			bid := fmt.Sprint(result["board_id"])
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_rules_acceptance*user_id=eq.%s*", uid))
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_rules_acceptance*board_id=eq.%s*", bid))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/gomosub_rules_acceptance?*")
		}

		// Invalidate terms acceptance cache so the dialog doesn't re-appear after accepting
		if tableName == "user_terms_acceptance" && h.redis != nil {
			uid := fmt.Sprint(result["user_id"])
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_terms_acceptance*user_id=eq.%s*", uid))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/user_terms_acceptance?*")
		}

		// Keep profile stats in sync when session time accumulates via upsert
		if tableName == "user_session_time" {
			if uid := rowUserID(result["user_id"]); uid != "" {
				RecomputeUserProfileStats(h.db, uid)
			}
		}

		// Unified profile stats: a wall like changes the likes_received counter
		// of the post's author and the likes_given counter of the liker.
		if tableName == "profile_wall_post_likes" {
			if postID, ok := result["post_id"].(string); ok {
				h.recomputeStatsForWallPostLike(c, postID, rowUserID(result["user_id"]))
				// Notify the post author only on a genuinely new like (xmax = 0
				// distinguishes a fresh INSERT from the ON CONFLICT re-like).
				if inserted, _ := result["inserted"].(bool); inserted {
					h.notifyWallPostLike(c, postID, wallResultString(result["user_id"]))
				}
			}
		}

		// Invalidate profile customization cache on upsert
		if tableName == "profile_customization" && h.redis != nil {
			if userID, ok := result["user_id"].(string); ok {
				fmt.Printf("[CacheInvalidator] Invalidating profile_customization cache on upsert: user_id=%s\n", userID)
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=eq.%s*", userID))
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=%s*", userID))
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
			}
		}

		// Achievements: fires for writes that map to events (daily visit,
		// wall likes, rules acceptance, profile customization, …).
		h.emitUniversalAchievementEvents(tableName, result)

		c.JSON(http.StatusOK, models.SuccessResponse(result))
		return
	}

	// Build INSERT query. Columns are sorted so the generated SQL is
	// deterministic across runs (map iteration order is random in Go) — this
	// keeps tests stable and cache keys predictable.
	query := "INSERT INTO " + tableName + " ("
	columns := make([]string, 0, len(data))
	for column := range data {
		columns = append(columns, column)
	}
	sort.Strings(columns)
	var placeholders []string
	var args []interface{}
	argIndex := 1

	for _, column := range columns {
		placeholders = append(placeholders, "$"+strconv.Itoa(argIndex))
		args = append(args, data[column])
		argIndex++
	}

	query += joinStrings(columns, ", ") + ") VALUES (" + joinStrings(placeholders, ", ") + ") RETURNING *"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		serverError(c, "database error", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
		return
	}

	result, err := scanRowToMap(rows)
	if err != nil {
		serverError(c, "database error", err)
		return
	}

	if tableName == "profile_wall_posts" {
		// Invalidate cache for this user's wall (author_id is the wall owner)
		if wallOwnerID, ok := result["user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, wallOwnerID)
			// A new wall post is a candidate for the unified feed.
			middleware.InvalidateCacheForFeed(h.redis)
		}

		// Also invalidate via the new cache system
		h.invalidateCacheForTableResult(c, tableName, result)

		// Wall notification: someone else posted on this wall.
		wallOwnerID := wallResultString(result["user_id"])
		authorID := wallResultString(result["author_id"])
		if wallOwnerID != "" && authorID != "" && wallOwnerID != authorID {
			postID := wallResultString(result["id"])
			msg := truncateRunes(wallResultString(result["content"]), 100)
			h.createWallNotification(c, wallOwnerID, authorID, "wall_post", msg, getUsernameFromDB(h.db, authorID), wallIDPtr(postID), nil, wallIDPtr(wallOwnerID))
		}

		// Build enriched payload with author data for WebSocket
		if h.hub != nil {
			var wsPayload map[string]interface{}
			if idStr := fmt.Sprint(result["id"]); idStr != "" {
				if enriched, enrichErr := h.fetchProfileWallPostWithAuthor(idStr, authenticatedUserID(c)); enrichErr == nil && enriched != nil {
					wsPayload = enriched
				} else {
					wsPayload = result
				}
			} else {
				wsPayload = result
			}

			if h.hub != nil {
				if err := h.hub.PublishNewWallPost(wsPayload); err != nil {
					fmt.Printf("[WebSocket] Error publishing wall post event: %v\n", err)
				} else {
					fmt.Printf("[WebSocket] Published wall post event for post %s\n", result["id"])
				}
			}
		}
	}

	if tableName == "profile_wall_post_comments" {
		// Invalidate cache for this comment and the post's comments
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			commentID, _ := result["id"].(string)
			middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
			h.invalidateWallListCache(c, postID)
		}
		// Wall notifications: comment → post author; reply → parent comment author.
		h.notifyWallComment(c, result)
	}

	if tableName == "profile_wall_post_reposts" {
		// Invalidate cache for both the original post and the user's wall
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
			h.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
		}
		// Wall notification: the original post's author gets a repost notice.
		h.notifyWallRepost(c, result)
	}

	if tableName == "profile_wall_comment_likes" {
		if commentID, ok := result["comment_id"].(string); ok {
			h.invalidateCommentLikesCache(c, commentID)
		}
	}

	// Unified profile stats: wall content contributes to the AUTHOR's counters
	// (a post written on someone else's wall counts for the author). This must
	// run BEFORE tryRespondProfileWallEnriched — that helper writes the enriched
	// response and returns early for wall posts and wall comments.
	switch tableName {
	case "profile_wall_posts":
		if uid := rowUserID(result["author_id"]); uid != "" {
			RecomputeUserProfileStats(h.db, uid)
		}
	case "profile_wall_post_comments":
		if uid := rowUserID(result["user_id"]); uid != "" {
			RecomputeUserProfileStats(h.db, uid)
		}
	case "profile_wall_post_likes":
		if postID, ok := result["post_id"].(string); ok {
			h.recomputeStatsForWallPostLike(c, postID, rowUserID(result["user_id"]))
		}
	case "profile_wall_comment_likes":
		if commentID, ok := result["comment_id"].(string); ok {
			h.recomputeStatsForWallCommentLike(c, commentID, rowUserID(result["user_id"]))
		}
	}

	// Achievements: fires for wall posts/comments/reposts/likes, sub joins,
	// rules acceptance, customization — before the enriched early-return below.
	h.emitUniversalAchievementEvents(tableName, result)

	if h.tryRespondProfileWallEnriched(c, tableName, result) {
		return
	}

	if tableName == "user_session_time" {
		if uid := rowUserID(result["user_id"]); uid != "" {
			RecomputeUserProfileStats(h.db, uid)
		}
	}

	// Invalidate cache for the created record
	h.invalidateCacheForTableResult(c, tableName, result)

	// M1: a privacy change that makes previously-public content friends-only
	// must revoke the live room subscriptions of non-friend viewers, otherwise
	// a viewer who subscribed while the profile was public keeps receiving
	// wall / now-playing events until they reconnect.
	h.revokeSubscriptionsAfterPrivacyChange(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// revokeSubscriptionsAfterPrivacyChange tears down live WebSocket
// subscriptions when a privacy_settings write restricts previously-public
// content. private_profile → both the wall and the now-playing room become
// friends-only; private_hide_wall alone → only the wall room becomes
// friends-only. Calls on other tables or without a hub are no-ops.
func (h *UniversalHandler) revokeSubscriptionsAfterPrivacyChange(tableName string, result map[string]interface{}) {
	if tableName != "privacy_settings" || h.hub == nil {
		return
	}
	uid, _ := result["user_id"].(string)
	if uid == "" {
		return
	}
	private, _ := result["private_profile"].(bool)
	hideWall, _ := result["private_hide_wall"].(bool)
	if private {
		h.hub.RevokeProfileRoomSubscriptionsFromNonFriends(uid, true, true)
	} else if hideWall {
		h.hub.RevokeProfileRoomSubscriptionsFromNonFriends(uid, true, false)
	}
}

// ─── PUT ────────────────────────────────────────────────────────────────────

func (h *UniversalHandler) handlePut(c *gin.Context, tableName string) {
	data, err := parseJSONObjectBody(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	if err := normalizeJSONValuesForDB(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// C1 (security audit): body keys are interpolated into the UPDATE SET
	// clause verbatim. Reject any key that is not a safe SQL identifier before
	// any other logic sees the payload.
	if err := validateBodyColumnNames(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// H2 (security audit): strip server-managed columns (counters, ownership
	// foreign keys) that must never be client-controlled. Runs after the C1
	// identifier gate and before the ownership scope is applied.
	filterWritableColumns(tableName, data)
	if tableName == "custom_emojis" {
		if err := validateCustomEmojiTriggers(data); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
		if err := validateCustomEmojiAsset(data, authenticatedUserID(c)); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
	}

	// K1: never allow rewriting authorship through a generic update.
	if tableName == "profile_wall_posts" {
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		data["author_id"] = userID
		// The wall owner column must never be changed through a generic PUT:
		// moving a post onto another user's wall would bypass the POST privacy
		// check (allow_wall_posts_from_others). Keep the original wall.
		if wall, ok := data["user_id"].(string); ok && wall != "" && wall != userID {
			delete(data, "user_id")
		}
	}

	// L5: a comment's target post is fixed at creation. A generic PUT must not
	// be able to re-point post_id onto another (possibly nonexistent) post —
	// that would bypass the POST-time privacy check (enforceWallTargetPrivacy)
	// and could forge orphan comments on a foreign wall. parent_id is equally
	// fixed at creation: re-parenting a comment would detach its reply subtree
	// from the visible branch.
	if tableName == "profile_wall_post_comments" {
		delete(data, "post_id")
		delete(data, "parent_id")
	}

	// H1 (security audit): a membership role must belong to the board of the
	// membership being modified — a cross-board role reference would inherit
	// another board's permission set.
	if tableName == "gomosub_memberships" {
		if rid, ok := data["role_id"]; ok && rid != nil && fmt.Sprint(rid) != "" {
			if boardID := gomosubBoardIDFromRequest(c); boardID != "" {
				var valid bool
				if err := h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_roles WHERE id = $1 AND board_id = $2)`, fmt.Sprint(rid), boardID).Scan(&valid); err != nil || !valid {
					c.JSON(http.StatusForbidden, models.ErrorResponse("Role does not belong to this board"))
					return
				}
			}
		}
	}

	// H1: channel_permissions has no board_id column — the request board_id is
	// only consumed by the permission check and the board scope, never stored.
	if tableName == "channel_permissions" {
		delete(data, "board_id")
	}

	// H2: after allow-list stripping, a PUT may carry no writable columns at
	// all (e.g. emoji_packs with only the server-managed updated_at). An empty
	// SET clause would produce `UPDATE t SET WHERE …` — a syntax error and a
	// 500. Reject the request instead.
	if len(data) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No writable columns provided"))
		return
	}

	// Build UPDATE query
	query := "UPDATE " + tableName + " SET "
	var updates []string
	var args []interface{}
	argIndex := 1

	for column, value := range data {
		updates = append(updates, column+" = $"+strconv.Itoa(argIndex))
		args = append(args, value)
		argIndex++
	}

	var clauses []string

	// Handler-scoped tables (registry HandlerScope): PUT/DELETE is bounded to
	// the authenticated user's own rows via the registry-declared predicate.
	// The handler reads the same field the registry test validates, so a table
	// marked HandlerScope is actually scoped here — the declaration and the
	// enforcement cannot drift.
	if meta := GenericTableByName(tableName); meta != nil && meta.HandlerScope != "" {
		uid := authenticatedUserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		clauses = append(clauses, fmt.Sprintf(meta.HandlerScope, argIndex))
		args = append(args, uid)
		argIndex++
	}

	// Extract optional record ID from URL path (e.g., /api/v1/user_session_time/abc-123).
	if recordID := extractRecordID(c.Request.URL.Path, tableName); recordID != "" {
		clauses = append(clauses, "id = $"+strconv.Itoa(argIndex))
		args = append(args, recordID)
		argIndex++
	}

	// K1: wall updates are scoped to the author or the wall owner.
	var ok bool
	clauses, args, argIndex, ok = enforceWallWriteScope(c, tableName, clauses, args, argIndex)
	if !ok {
		return
	}

	// H1 (security audit): gomosub management writes must be bound to the board
	// that granted the permission. Otherwise a moderator of any board could
	// modify records of any other board by passing their own board_id.
	if isGomosubManagementTable(tableName) {
		if boardID := gomosubBoardIDFromRequest(c); boardID != "" {
			clause, arg := gomosubBoardScopeClause(tableName, boardID, argIndex)
			clauses = append(clauses, clause)
			args = append(args, arg)
			argIndex++
		}
	}

	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
			continue
		}
		if !isValidColumnName(key) {
			continue
		}
		// H1: for gomosub management tables, board_id is consumed by the board
		// scope above — adding it again from the query would duplicate the clause
		// (and would be an undefined column on channel_permissions).
		if isGomosubManagementTable(tableName) && key == "board_id" {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := buildFilterClause(key, rawValue, argIndex)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
	}

	if len(clauses) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("At least one filter is required for PUT operation"))
		return
	}

	query += joinStrings(updates, ", ") + " WHERE " + strings.Join(clauses, " AND ") + " RETURNING *"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		serverError(c, "database error", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Record not found"))
		return
	}

	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	if err := rows.Scan(valuePtrs...); err != nil {
		serverError(c, "database error", err)
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = decodeColumnValue(b)
		} else {
			result[col] = val
		}
	}

	// Publish WebSocket events for profile wall posts updates BEFORE enrichment
	if tableName == "profile_wall_posts" {
		// Invalidate cache for this user's wall
		if userID, ok := result["user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
		}

		// Build enriched payload with author data for WebSocket broadcast
		if h.hub != nil {
			var wsPayload map[string]interface{}
			if idStr := fmt.Sprint(result["id"]); idStr != "" {
				if enriched, enrichErr := h.fetchProfileWallPostWithAuthor(idStr, authenticatedUserID(c)); enrichErr == nil && enriched != nil {
					wsPayload = enriched
				} else {
					wsPayload = result
				}
			} else {
				wsPayload = result
			}

			if err := h.hub.PublishUpdateWallPost(wsPayload); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post update event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post update event for post %s\n", result["id"])
			}
		}
	}

	if tableName == "profile_wall_post_comments" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			commentID, _ := result["id"].(string)
			middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
			h.invalidateWallListCache(c, postID)
		}
	}

	if h.tryRespondProfileWallEnriched(c, tableName, result) {
		return
	}

	if tableName == "user_session_time" {
		if uid := rowUserID(result["user_id"]); uid != "" {
			RecomputeUserProfileStats(h.db, uid)
		}
	}

	// Invalidate cache for the updated record
	h.invalidateCacheForTableResult(c, tableName, result)

	// M1: same privacy-change teardown as the POST path (see
	// revokeSubscriptionsAfterPrivacyChange).
	h.revokeSubscriptionsAfterPrivacyChange(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

func (h *UniversalHandler) handleDelete(c *gin.Context, tableName string) {
	// Wall comments are soft-deleted: the row must survive so the replies
	// underneath it (parent_id has ON DELETE CASCADE — a hard delete used to
	// wipe the whole subtree) and the thread structure stay intact. The content
	// is wiped server-side and the comment is flagged, so it renders as a
	// "Комментарий удалён" placeholder with an unknown author. The UPDATE
	// keeps the same WHERE scoping (enforceWallWriteScope → user_id = caller)
	// and RETURNING * contract as the generic DELETE path below.
	query := "DELETE FROM " + tableName
	if tableName == "profile_wall_post_comments" {
		// M-3 (security audit): the author must be gone forever, not just
		// hidden by the UI. user_id is nulled here (migration 093 dropped the
		// NOT NULL) so no read path — current or future — can recover the
		// identity of a deleted comment. The WHERE scope (user_id = caller)
		// still sees the pre-update row, so the delete itself is unaffected.
		query = `UPDATE profile_wall_post_comments
SET content = NULL, content_json = NULL, user_id = NULL, is_deleted = TRUE, updated_at = NOW()`
	}
	var args []interface{}
	var clauses []string
	argIndex := 1

	// Handler-scoped tables (registry HandlerScope): PUT/DELETE is bounded to
	// the authenticated user's own rows via the registry-declared predicate.
	// The handler reads the same field the registry test validates, so a table
	// marked HandlerScope is actually scoped here — the declaration and the
	// enforcement cannot drift.
	if meta := GenericTableByName(tableName); meta != nil && meta.HandlerScope != "" {
		uid := authenticatedUserID(c)
		if uid == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return
		}
		clauses = append(clauses, fmt.Sprintf(meta.HandlerScope, argIndex))
		args = append(args, uid)
		argIndex++
	}

	// Extract optional record ID from URL path (e.g., /api/v1/user_session_time/abc-123).
	if recordID := extractRecordID(c.Request.URL.Path, tableName); recordID != "" {
		clauses = append(clauses, "id = $"+strconv.Itoa(argIndex))
		args = append(args, recordID)
		argIndex++
	}

	// K1: wall deletes are scoped to the author or the wall owner.
	var ok bool
	clauses, args, argIndex, ok = enforceWallWriteScope(c, tableName, clauses, args, argIndex)
	if !ok {
		return
	}

	// H1 (security audit): same board binding as PUT — see handlePut.
	if isGomosubManagementTable(tableName) {
		if boardID := gomosubBoardIDFromRequest(c); boardID != "" {
			clauses = append(clauses, "board_id = $"+strconv.Itoa(argIndex))
			args = append(args, boardID)
			argIndex++
		}
	}

	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
			continue
		}
		if !isValidColumnName(key) {
			continue
		}
		// H1: board_id is consumed by the board scope above (see handlePut).
		if isGomosubManagementTable(tableName) && key == "board_id" {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := buildFilterClause(key, rawValue, argIndex)
			if clause != "" {
				clauses = append(clauses, clause)
				args = append(args, nextArgs...)
				argIndex = nextIndex
			}
		}
	}

	if len(clauses) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("At least one filter is required for DELETE operation"))
		return
	}

	query += " WHERE " + strings.Join(clauses, " AND ") + " RETURNING *"
	rows, err := h.db.Query(query, args...)
	if err != nil {
		serverError(c, "database error", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Record not found"))
		return
	}

	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	if err := rows.Scan(valuePtrs...); err != nil {
		serverError(c, "database error", err)
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = decodeColumnValue(b)
		} else {
			result[col] = val
		}
	}

	// Publish WebSocket events for profile wall posts deletion
	if tableName == "profile_wall_posts" {
		// Invalidate cache for this user's wall
		if userID, ok := result["user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
		}

		// Cascade: invalidate comments and likes for this post
		if postID, ok := result["id"].(string); ok && h.redis != nil {
			cache.InvalidateForTable(h.redis, "profile_wall_post_comments", map[string]string{"post_id": postID})
			cache.InvalidateForTable(h.redis, "profile_wall_post_likes", map[string]string{"post_id": postID})
			cache.InvalidateForTable(h.redis, "profile_wall_post_reposts", map[string]string{"post_id": postID})
		}

		if h.hub != nil {
			if err := h.hub.PublishDeleteWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post delete event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post delete event for post %s\n", result["id"])
			}
		}
	}

	if tableName == "profile_wall_post_comments" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			commentID, _ := result["id"].(string)
			middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
			h.invalidateWallListCache(c, postID)
		}
	}

	if tableName == "profile_wall_post_likes" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_post_likes*")
			h.invalidateWallListCache(c, postID)
		}
	}

	if tableName == "profile_wall_post_reposts" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
			h.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
		}
	}

	if tableName == "profile_wall_comment_likes" {
		if commentID, ok := result["comment_id"].(string); ok {
			h.invalidateCommentLikesCache(c, commentID)
		}
	}

	// Unified profile stats: deleted wall content drops the author's counters.
	// Comments are intentionally absent here: wall comments are soft-deleted
	// (the row survives as a visible "Комментарий удалён" placeholder), so the
	// author's comment_count/garma must stay unchanged.
	switch tableName {
	case "profile_wall_posts":
		if uid := rowUserID(result["author_id"]); uid != "" {
			RecomputeUserProfileStats(h.db, uid)
		}
	case "profile_wall_post_likes":
		if postID, ok := result["post_id"].(string); ok {
			h.recomputeStatsForWallPostLike(c, postID, rowUserID(result["user_id"]))
		}
	case "profile_wall_comment_likes":
		if commentID, ok := result["comment_id"].(string); ok {
			h.recomputeStatsForWallCommentLike(c, commentID, rowUserID(result["user_id"]))
		}
	}

	// Invalidate cache for the deleted record
	h.invalidateCacheForTableResult(c, tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}
