package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

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
		// Note: profile_wall_posts uses author_id, not user_id
		if authorID, ok := result["author_id"].(string); ok && authorID != "" {
			values["user_id"] = authorID
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
	default:
		fmt.Printf("[CacheInvalidator] Generic invalidation for table %s: %+v\n", tableName, values)
		// Generic table invalidation
		cache.InvalidateForTable(h.redis, tableName, values)
	}
}

// UniversalHandler handles generic CRUD operations for any table
type UniversalHandler struct {
	db                *sql.DB
	hub               *websocket.Hub
	redis             *redis.Client
	botEventPublisher *BotEventPublisher
}

func NewUniversalHandler(db *sql.DB, hub *websocket.Hub) *UniversalHandler {
	return &UniversalHandler{db: db, hub: hub}
}

// SetRedis sets the Redis client for cache invalidation
func (h *UniversalHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// SetBotEventPublisher sets the bot event publisher
func (h *UniversalHandler) SetBotEventPublisher(publisher *BotEventPublisher) {
	h.botEventPublisher = publisher
}

// HandleTableRequest handles requests to any table
func (h *UniversalHandler) HandleTableRequest(c *gin.Context) {
	// Extract table name from URL path
	path := c.Request.URL.Path
	// Remove /api/v1/ prefix
	tableName := strings.TrimPrefix(path, "/api/v1/")

	// Handle sub-paths like /user_roles/123
	if strings.Contains(tableName, "/") {
		parts := strings.Split(tableName, "/")
		tableName = parts[0]
	}

	if tableName == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Table name required"))
		return
	}

	// Only allow specific tables for security
	allowedTables := map[string]bool{
		"user_roles":                   true,
		"gomosub_memberships":          true,
		"user_session_time":            true,
		"user_achievements":            true,
		"user_terms_acceptance":        true,
		"profile_customization":        true,
		"user_placeholders":            true,
		"polls":                        true,
		"poll_votes":                   true,
		"thread_subscriptions":         true,
		"privacy_settings":             true,
		"user_daily_visits":            true,
		"thread_custom_message_visits": true,
		"profile_wall_posts":           true,
		"profile_wall_post_comments":   true,
		"profile_wall_post_likes":      true,
		"profile_wall_post_reposts":    true,
		"gomosub_rules_acceptance":     true,
		"reports":                      true,
		"user_bans":                    true,
		"user_settings_changes":        true,
		// Messenger tables
		"chat_user_keys":            true,
		"chat_conversations":        true,
		"chat_conversation_members": true,
		"chat_messages":             true,
		"chat_receipts":             true,
	}

	if !allowedTables[tableName] {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Table not found"))
		return
	}

	switch c.Request.Method {
	case "GET":
		h.handleGet(c, tableName)
	case "POST":
		h.handlePost(c, tableName)
	case "PUT":
		h.handlePut(c, tableName)
	case "DELETE":
		h.handleDelete(c, tableName)
	default:
		c.JSON(http.StatusMethodNotAllowed, models.ErrorResponse("Method not allowed"))
	}
}

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

	// Messenger tables require authentication and access control
	if isMessengerTable(tableName) {
		h.handleMessengerTableGet(c, tableName)
		return
	}

	query := "SELECT * FROM " + tableName
	var args []interface{}

	// Build WHERE clause from query parameters
	var clauses []string
	argIndex := 1
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// upsertInsertQuery returns INSERT ... ON CONFLICT for tables the frontend calls via .upsert().
// Plain INSERT would fail on duplicate keys; resolved server-side.
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
			result[col] = string(b)
		} else {
			result[col] = val
		}
	}
	return result, nil
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

	// Messenger tables require authentication and access control
	if isMessengerTable(tableName) {
		h.handleMessengerTablePost(c, tableName, data)
		return
	}

	if upsertQuery, upsertArgs, useUpsert := upsertInsertQuery(tableName, data); useUpsert {
		rows, err := h.db.Query(upsertQuery, upsertArgs...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		defer rows.Close()
		if !rows.Next() {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
			return
		}
		result, err := scanRowToMap(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
		return
	}

	result, err := scanRowToMap(rows)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if tableName == "profile_wall_posts" {
		// Invalidate cache for this user's wall (author_id is the wall owner)
		if authorID, ok := result["author_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForProfileWall(h.redis, authorID)
		}

		// Also invalidate via the new cache system
		h.invalidateCacheForTableResult(tableName, result)

		if h.hub != nil {
			if err := h.hub.PublishNewWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post event for post %s\n", result["id"])
			}
		}
		// Publish event to bots
		if h.botEventPublisher != nil {
			h.botEventPublisher.PublishWallPost(result)
		}
	}

	if tableName == "profile_wall_post_comments" {
		// Invalidate cache for this comment and the post's comments
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			commentID, _ := result["id"].(string)
			middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
		}

		// Publish event to bots
		if h.botEventPublisher != nil {
			h.botEventPublisher.PublishWallComment(result)
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
	// Frontend sends PUT /table/:id — the filter is embedded in the path, not query params.
	if recordID := extractRecordID(c.Request.URL.Path, tableName); recordID != "" {
		clauses = append(clauses, "id = $"+strconv.Itoa(argIndex))
		args = append(args, recordID)
		argIndex++
	}

	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = string(b)
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

		if h.hub != nil {
			if err := h.hub.PublishUpdateWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post update event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post update event for post %s\n", result["id"])
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

func (h *UniversalHandler) handleDelete(c *gin.Context, tableName string) {
	query := "DELETE FROM " + tableName
	var args []interface{}
	var clauses []string
	argIndex := 1

	// Extract optional record ID from URL path (e.g., /api/v1/user_session_time/abc-123).
	// Frontend sends DELETE /table/:id — the filter is embedded in the path, not query params.
	if recordID := extractRecordID(c.Request.URL.Path, tableName); recordID != "" {
		clauses = append(clauses, "id = $"+strconv.Itoa(argIndex))
		args = append(args, recordID)
		argIndex++
	}

	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = string(b)
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
		// Invalidate cache for this comment and the post's comments
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			commentID, _ := result["id"].(string)
			middleware.InvalidateCacheForWallComment(h.redis, commentID, postID)
		}
	}

	if tableName == "profile_wall_post_likes" {
		// Invalidate cache for the post and its likes
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			middleware.InvalidateCacheForWallPost(h.redis, postID)
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_post_likes*")
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

	// Invalidate cache for the deleted record
	h.invalidateCacheForTableResult(tableName, result)

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}

func buildFilterClause(column, rawValue string, argIndex int) (string, []interface{}, int) {
	parts := strings.SplitN(rawValue, ".", 2)
	if len(parts) != 2 {
		// Backward compatibility: plain equality
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{rawValue}, argIndex + 1
	}

	return buildFilterFromParts(column, parts[0], parts[1], argIndex)
}

func buildFilterFromParts(column, op, value string, argIndex int) (string, []interface{}, int) {
	switch op {
	case "eq":
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "neq":
		return column + " <> $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "gt":
		return column + " > $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "gte":
		return column + " >= $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "lt":
		return column + " < $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "lte":
		return column + " <= $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "ilike":
		return column + " ILIKE $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "is":
		if value == "null" {
			return column + " IS NULL", nil, argIndex
		}
		if value == "true" {
			return column + " IS TRUE", nil, argIndex
		}
		if value == "false" {
			return column + " IS FALSE", nil, argIndex
		}
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	case "in":
		trimmed := strings.TrimPrefix(value, "(")
		trimmed = strings.TrimSuffix(trimmed, ")")
		items := splitCSV(trimmed)
		if len(items) == 0 {
			return "", nil, argIndex
		}
		placeholders := make([]string, 0, len(items))
		args := make([]interface{}, 0, len(items))
		for _, item := range items {
			placeholders = append(placeholders, "$"+strconv.Itoa(argIndex))
			args = append(args, item)
			argIndex++
		}
		return column + " IN (" + strings.Join(placeholders, ", ") + ")", args, argIndex
	case "not":
		// value is expected as "<op>.<value>"
		sub := strings.SplitN(value, ".", 2)
		if len(sub) != 2 {
			return "", nil, argIndex
		}
		clause, args, next := buildFilterFromParts(column, sub[0], sub[1], argIndex)
		if clause == "" {
			return "", nil, argIndex
		}
		return "NOT (" + clause + ")", args, next
	default:
		// Unknown operator fallback
		return column + " = $" + strconv.Itoa(argIndex), []interface{}{value}, argIndex + 1
	}
}

func parseOrCondition(condition string) (column, op, value string, ok bool) {
	parts := strings.SplitN(condition, ".", 3)
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}

func splitCSV(input string) []string {
	if input == "" {
		return nil
	}
	parts := strings.Split(input, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed == "" {
			continue
		}
		out = append(out, trimmed)
	}
	return out
}

// extractRecordID extracts the record ID from a URL path like /api/v1/table_name/abc-123.
// Returns empty string if no ID is present or path contains multiple sub-paths.
func extractRecordID(urlPath string, tableName string) string {
	trimmed := strings.TrimPrefix(urlPath, "/api/v1/"+tableName+"/")
	if trimmed == "" || strings.Contains(trimmed, "/") {
		return ""
	}
	return trimmed
}

// isMessengerTable checks if table is a messenger table requiring access control
func isMessengerTable(tableName string) bool {
	messengerTables := map[string]bool{
		"chat_user_keys":            true,
		"chat_conversations":        true,
		"chat_conversation_members": true,
		"chat_messages":             true,
		"chat_receipts":             true,
	}
	return messengerTables[tableName]
}

// handleMessengerTableGet handles GET requests for messenger tables with access control
func (h *UniversalHandler) handleMessengerTableGet(c *gin.Context, tableName string) {
	// Get authenticated user
	claimsInterface, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return
	}

	claims, ok := claimsInterface.(*auth.Claims)
	if !ok || claims == nil || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid authentication"))
		return
	}

	// Begin transaction for RLS context (set_config with is_local=true)
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	// Set Row-Level Security context — scoped to this transaction
	_, err = tx.Exec("SELECT set_config('app.current_user_id', $1, true)", claims.UserID)
	if err != nil {
		log.Printf("[RLS] Warning: failed to set app.current_user_id: %v", err)
	}

	// Build query with access control
	var query string
	var args []interface{}
	argIndex := 1

	switch tableName {
	case "chat_user_keys":
		// Public keys are readable by everyone (RLS policy: FOR SELECT USING true)
		query = `SELECT * FROM chat_user_keys`

	case "chat_conversations":
		// Only return conversations where user is a member
		query = `
			SELECT c.* FROM chat_conversations c
			INNER JOIN chat_conversation_members cm ON c.id = cm.conversation_id
			WHERE cm.user_id = $1 AND cm.archived_at IS NULL
		`
		args = append(args, claims.UserID)
		argIndex++

	case "chat_conversation_members":
		// Only return members of conversations where user is also a member
		query = `
			SELECT cm.* FROM chat_conversation_members cm
			WHERE cm.conversation_id IN (
				SELECT conversation_id FROM chat_conversation_members
				WHERE user_id = $1 AND archived_at IS NULL
			)
		`
		args = append(args, claims.UserID)
		argIndex++

	case "chat_messages":
		// Only return messages from conversations where user is a member
		query = `
			SELECT m.* FROM chat_messages m
			WHERE m.conversation_id IN (
				SELECT conversation_id FROM chat_conversation_members
				WHERE user_id = $1 AND archived_at IS NULL
			)
		`
		args = append(args, claims.UserID)
		argIndex++

	case "chat_receipts":
		// Only return receipts for messages in user's conversations
		query = `
			SELECT r.* FROM chat_receipts r
			INNER JOIN chat_messages m ON r.message_id = m.id
			WHERE m.conversation_id IN (
				SELECT conversation_id FROM chat_conversation_members
				WHERE user_id = $1 AND archived_at IS NULL
			)
		`
		args = append(args, claims.UserID)
		argIndex++

	default:
		c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied"))
		return
	}

	// Add additional filters from query parameters
	var clauses []string
	for key, values := range c.Request.URL.Query() {
		if key == "select" || key == "order" || key == "limit" || key == "offset" || key == "or" {
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

	if len(clauses) > 0 {
		if strings.Contains(query, "WHERE") {
			query += " AND " + strings.Join(clauses, " AND ")
		} else {
			query += " WHERE " + strings.Join(clauses, " AND ")
		}
	}

	// Handle ORDER BY — supports multiple order params
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
	} else if tableName == "chat_messages" {
		// Default order by sent_at ASC for chat messages
		query += " ORDER BY " + quoteSQLIdent("sent_at") + " ASC"
	}

	// Handle LIMIT and OFFSET
	if limit := c.Query("limit"); limit != "" {
		if n, err := strconv.Atoi(limit); err == nil && n >= 0 && n <= 10000 {
			query += " LIMIT " + strconv.Itoa(n)
		}
	} else if tableName == "chat_messages" {
		// Default limit 50 for chat messages to prevent loading everything
		query += " LIMIT 50"
	}

	if offset := c.Query("offset"); offset != "" {
		if n, err := strconv.Atoi(offset); err == nil && n >= 0 && n <= 1000000 {
			query += " OFFSET " + strconv.Itoa(n)
		}
	}

	rows, err := tx.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// handleMessengerTablePost handles POST requests for messenger tables with access control
func (h *UniversalHandler) handleMessengerTablePost(c *gin.Context, tableName string, data map[string]interface{}) {
	// Get authenticated user
	claimsInterface, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return
	}

	claims, ok := claimsInterface.(*auth.Claims)
	if !ok || claims == nil || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid authentication"))
		return
	}

	// Create validator
	validator := NewMessengerValidator()

	// Begin transaction for RLS context + atomicity
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer tx.Rollback()

	// Set Row-Level Security context — scoped to this transaction
	_, err = tx.Exec("SELECT set_config('app.current_user_id', $1, true)", claims.UserID)
	if err != nil {
		log.Printf("[RLS] Warning: failed to set app.current_user_id: %v", err)
	}

	// Validate access based on table
	switch tableName {
	case "chat_user_keys":
		// Ensure user_id matches authenticated user
		data["user_id"] = claims.UserID

	case "chat_messages":
		// Validate message data
		if err := validator.ValidateMessageData(data); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}

		// Check if user is a member of the conversation
		conversationID, _ := data["conversation_id"].(string)

		var isMember bool
		err := tx.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM chat_conversation_members
				WHERE conversation_id = $1 AND user_id = $2 AND archived_at IS NULL
			)
		`, conversationID, claims.UserID).Scan(&isMember)

		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if !isMember {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied: not a member of this conversation"))
			return
		}

		// Ensure sender_user_id matches authenticated user
		data["sender_user_id"] = claims.UserID

	case "chat_receipts":
		// Check if user is a member of the conversation containing this message
		messageID, ok := data["message_id"].(string)
		if !ok || messageID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
			return
		}

		var isMember bool
		err := tx.QueryRow(`
			SELECT EXISTS(
				SELECT 1 FROM chat_messages m
				INNER JOIN chat_conversation_members cm ON m.conversation_id = cm.conversation_id
				WHERE m.id = $1 AND cm.user_id = $2 AND cm.archived_at IS NULL
			)
		`, messageID, claims.UserID).Scan(&isMember)

		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if !isMember {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied: not a member of this conversation"))
			return
		}

		// Ensure user_id matches authenticated user
		data["user_id"] = claims.UserID

	case "chat_conversations", "chat_conversation_members":
		// These should be created via RPC functions only
		c.JSON(http.StatusForbidden, models.ErrorResponse("Use RPC function get_or_create_direct_chat to create conversations"))
		return

	default:
		c.JSON(http.StatusForbidden, models.ErrorResponse("Access denied"))
		return
	}

	// Build INSERT query
	insertQuery := "INSERT INTO " + tableName + " ("
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

	insertQuery += joinStrings(columns, ", ") + ") VALUES (" + joinStrings(placeholders, ", ") + ") RETURNING *"

	rows, err := tx.Query(insertQuery, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
		return
	}

	result, err := scanRowToMap(rows)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Commit transaction before publishing events
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Publish WebSocket events for new chat messages (after commit)
	if tableName == "chat_messages" {
		if h.hub != nil {
			conversationID := rowUserID(result["conversation_id"])
			if conversationID != "" {
				if err := h.hub.PublishNewChatMessage(result); err != nil {
					fmt.Printf("[WebSocket] Error publishing chat message event: %v\n", err)
				} else {
					fmt.Printf("[WebSocket] Published chat message event for conversation %s\n", conversationID)
				}
			}
		}

		// Publish to bot events
		if h.botEventPublisher != nil {
			// Extract plaintext from BOT_PLAINTEXT: prefix for bots
			if ciphertext, ok := result["ciphertext"].(string); ok {
				if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
					plaintext := strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
					result["plaintext"] = plaintext
				}
			}
			h.botEventPublisher.PublishChatMessage(result)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}
