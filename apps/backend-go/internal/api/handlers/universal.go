package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/websocket"
)

// UniversalHandler handles generic CRUD operations for any table
type UniversalHandler struct {
	db  *sql.DB
	hub *websocket.Hub
}

func NewUniversalHandler(db *sql.DB, hub *websocket.Hub) *UniversalHandler {
	return &UniversalHandler{db: db, hub: hub}
}

// HandleTableRequest handles requests to any table
func (h *UniversalHandler) HandleTableRequest(c *gin.Context) {
	// Extract table name from URL path
	path := c.Request.URL.Path
	// Remove /rest/v1/ prefix
	tableName := strings.TrimPrefix(path, "/rest/v1/")

	// Handle sub-paths like /user_roles/123
	if strings.Contains(tableName, "/") {
		parts := strings.Split(tableName, "/")
		tableName = parts[0]
	}

	if tableName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Table name required"})
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
	}

	if !allowedTables[tableName] {
		c.JSON(http.StatusNotFound, gin.H{"error": "Table not found"})
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
		c.JSON(http.StatusMethodNotAllowed, gin.H{"error": "Method not allowed"})
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

	// Supabase-style OR conditions: or=col.eq.value,col2.ilike.%term%
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

	// Handle ORDER BY (PostgREST: col.asc / col.desc — not valid raw SQL in PostgreSQL)
	if order := c.Query("order"); order != "" {
		if s, ok := parseSupabaseOrderClause(order, ""); ok {
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var results []map[string]interface{}
	columns, _ := rows.Columns()
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}

		if err := rows.Scan(valuePtrs...); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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

	c.JSON(http.StatusOK, gin.H{"data": results})
}

// upsertInsertQuery returns INSERT ... ON CONFLICT for tables the frontend calls via .upsert().
// Plain INSERT would fail on duplicate keys; Supabase resolves this server-side.
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
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := normalizeJSONValuesForDB(data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if upsertQuery, upsertArgs, useUpsert := upsertInsertQuery(tableName, data); useUpsert {
		rows, err := h.db.Query(upsertQuery, upsertArgs...)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		if !rows.Next() {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "No rows returned"})
			return
		}
		result, err := scanRowToMap(rows)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": result})
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
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "No rows returned"})
		return
	}

	result, err := scanRowToMap(rows)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if tableName == "profile_wall_posts" {
		if h.hub != nil {
			fmt.Printf("[WebSocket DEBUG] Publishing wall post event for %s\n", result["id"])
			if err := h.hub.PublishNewWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post event for post %s\n", result["id"])
			}
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
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *UniversalHandler) handlePut(c *gin.Context, tableName string) {
	data, err := parseJSONObjectBody(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := normalizeJSONValuesForDB(data); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
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
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one filter is required for PUT operation"})
		return
	}

	query += joinStrings(updates, ", ") + " WHERE " + strings.Join(clauses, " AND ") + " RETURNING *"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusNotFound, gin.H{"error": "Record not found"})
		return
	}

	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	if err := rows.Scan(valuePtrs...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		if h.hub != nil {
			fmt.Printf("[WebSocket DEBUG] Publishing wall post update event for %s\n", result["id"])
			if err := h.hub.PublishUpdateWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post update event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post update event for post %s\n", result["id"])
			}
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
	c.JSON(http.StatusOK, gin.H{"data": result})
}

func (h *UniversalHandler) handleDelete(c *gin.Context, tableName string) {
	query := "DELETE FROM " + tableName
	var args []interface{}
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

	if len(clauses) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "At least one filter is required for DELETE operation"})
		return
	}

	query += " WHERE " + strings.Join(clauses, " AND ") + " RETURNING *"
	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusNotFound, gin.H{"error": "Record not found"})
		return
	}

	columns, _ := rows.Columns()
	values := make([]interface{}, len(columns))
	valuePtrs := make([]interface{}, len(columns))
	for i := range columns {
		valuePtrs[i] = &values[i]
	}

	if err := rows.Scan(valuePtrs...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
		if h.hub != nil {
			fmt.Printf("[WebSocket DEBUG] Publishing wall post delete event for %s\n", result["id"])
			if err := h.hub.PublishDeleteWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post delete event: %v\n", err)
			} else {
				fmt.Printf("[WebSocket] Published wall post delete event for post %s\n", result["id"])
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
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
