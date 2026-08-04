package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
)

// ─── Cache Invalidation ─────────────────────────────────────────────────────

// invalidateCacheForTableResult invalidates cache based on table and result data
func (h *UniversalHandler) invalidateCacheForTableResult(tableName string, result map[string]interface{}) {
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
	switch tableName {
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
	case "threads":
		if boardID, ok := result["board_id"].(string); ok && boardID != "" {
			values["board_id"] = boardID
		}
		fmt.Printf("[CacheInvalidator] Invalidating thread cache: id=%s, board_id=%s\n", values["id"], values["board_id"])
		cache.InvalidateForThread(h.redis, values["id"], values["board_id"])
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
		}
	case "emoji_packs":
		fmt.Printf("[CacheInvalidator] Invalidating emoji_packs cache: id=%s\n", values["id"])
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
	case "custom_emojis":
		fmt.Printf("[CacheInvalidator] Invalidating custom_emojis cache: id=%s\n", values["id"])
		cache.InvalidateByPattern(h.redis, "data:/api/v1/custom_emojis*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
	case "user_emoji_subscriptions":
		if userID, ok := result["user_id"].(string); ok && userID != "" {
			fmt.Printf("[CacheInvalidator] Invalidating user_emoji_subscriptions cache: user_id=%s\n", userID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_emoji_subscriptions*user_id=eq.%s*", userID))
		}
		cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
	default:
		fmt.Printf("[CacheInvalidator] Generic invalidation for table %s: %+v\n", tableName, values)
		cache.InvalidateForTable(h.redis, tableName, values)
	}
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

	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// ─── POST ───────────────────────────────────────────────────────────────────

// upsertInsertQuery returns INSERT ... ON CONFLICT for tables the frontend calls via .upsert().
func upsertInsertQuery(tableName string, data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
RETURNING *`
		return q, []interface{}{pid, uid}, true
	case "profile_customization":
		uid, hasUID := data["user_id"]
		if !hasUID {
			return "", nil, false
		}
		q := `INSERT INTO profile_customization (user_id, username_css, profile_badge_text, profile_badge_css, updated_at)
VALUES ($1, $2, $3, $4, NOW())
ON CONFLICT (user_id) DO UPDATE SET
  username_css = EXCLUDED.username_css,
  profile_badge_text = EXCLUDED.profile_badge_text,
  profile_badge_css = EXCLUDED.profile_badge_css,
  updated_at = NOW()
RETURNING *`
		return q, []interface{}{
			uid,
			data["username_css"],
			data["profile_badge_text"],
			data["profile_badge_css"],
		}, true
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
// of ownerID: the owner themself, owners of non-private profiles, or mutual
// friends. This mirrors the REST read predicate (profileWallFinishSelectQuery)
// so the write path enforces the exact same privacy rule.
func (h *UniversalHandler) wallOwnerVisibleToViewer(viewerID, ownerID string) (bool, error) {
	if viewerID == ownerID {
		return true, nil
	}
	var private bool
	err := h.db.QueryRow("SELECT COALESCE(private_profile, false) FROM privacy_settings WHERE user_id = $1", ownerID).Scan(&private)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy settings row means the profile is not private.
			return true, nil
		}
		return false, err
	}
	if !private {
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
		if postID, ok := data["post_id"].(string); ok && postID != "" {
			_ = h.db.QueryRowContext(c.Request.Context(),
				"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
		}
	case "profile_wall_comment_likes":
		if commentID, ok := data["comment_id"].(string); ok && commentID != "" {
			_ = h.db.QueryRowContext(c.Request.Context(), `
				SELECT wp.user_id
				FROM profile_wall_post_comments c
				JOIN profile_wall_posts wp ON wp.id = c.post_id
				WHERE c.id = $1`, commentID).Scan(&wallOwner)
		}
	case "profile_wall_post_reposts":
		// post_id references the ORIGINAL post being reposted — its wall owner
		// must be visible to the caller, otherwise private content could be
		// mirrored onto a public wall.
		if postID, ok := data["post_id"].(string); ok && postID != "" {
			_ = h.db.QueryRowContext(c.Request.Context(),
				"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
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
// It writes the HTTP response and returns false when the request is rejected.
func (h *UniversalHandler) enforcePostOwnership(c *gin.Context, tableName string, data map[string]interface{}) bool {
	switch tableName {
	case "profile_wall_posts":
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
	case "profile_wall_post_comments", "profile_wall_post_likes", "profile_wall_comment_likes",
		"user_daily_visits", "thread_custom_message_visits", "gomosub_rules_acceptance", "profile_customization":
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
	case "profile_wall_post_reposts":
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
// wall-related writes so a client can only modify its own content.
// Returns false (response already written) when unauthenticated.
func enforceWallWriteScope(c *gin.Context, tableName string, clauses []string, args []interface{}, argIndex int) ([]string, []interface{}, int, bool) {
	switch tableName {
	case "profile_wall_posts":
		userID := authenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return clauses, args, argIndex, false
		}
		// The author or the wall owner may edit/delete a post.
		clauses = append(clauses, "(author_id = $"+strconv.Itoa(argIndex)+" OR user_id = $"+strconv.Itoa(argIndex)+")")
		args = append(args, userID)
		argIndex++
	case "profile_wall_post_comments", "profile_wall_post_likes", "profile_wall_post_reposts", "profile_wall_comment_likes":
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

	// K1: force ownership so writes cannot impersonate another user.
	if !h.enforcePostOwnership(c, tableName, data) {
		return
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

		// Invalidate profile customization cache on upsert
		if tableName == "profile_customization" && h.redis != nil {
			if userID, ok := result["user_id"].(string); ok {
				fmt.Printf("[CacheInvalidator] Invalidating profile_customization cache on upsert: user_id=%s\n", userID)
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=eq.%s*", userID))
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=%s*", userID))
				cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
			}
		}

		c.JSON(http.StatusOK, models.SuccessResponse(result))
		return
	}

	// Build INSERT query
	query := "INSERT INTO " + tableName + " ("
	var columns []string
	var placeholders []string
	var args []interface{}
	argIndex := 1

	for column, value := range data {
		columns = append(columns, column)
		placeholders = append(placeholders, "$"+strconv.Itoa(argIndex))
		args = append(args, value)
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
		}

		// Also invalidate via the new cache system
		h.invalidateCacheForTableResult(tableName, result)

		// Build enriched payload with author data for WebSocket
		if h.hub != nil {
			var wsPayload map[string]interface{}
			if idStr := fmt.Sprint(result["id"]); idStr != "" {
				if enriched, enrichErr := h.fetchProfileWallPostWithAuthor(idStr); enrichErr == nil && enriched != nil {
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
		}
	}

	if tableName == "profile_wall_post_reposts" {
		// Invalidate cache for both the original post and the user's wall
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
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

	// Invalidate cache for the created record
	h.invalidateCacheForTableResult(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
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
				if enriched, enrichErr := h.fetchProfileWallPostWithAuthor(idStr); enrichErr == nil && enriched != nil {
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
	h.invalidateCacheForTableResult(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

func (h *UniversalHandler) handleDelete(c *gin.Context, tableName string) {
	query := "DELETE FROM " + tableName
	var args []interface{}
	var clauses []string
	argIndex := 1

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
		}
	}

	if tableName == "profile_wall_post_likes" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_post_likes*")
		}
	}

	if tableName == "profile_wall_post_reposts" {
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, userID)
		}
	}

	// Invalidate cache for the deleted record
	h.invalidateCacheForTableResult(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}
