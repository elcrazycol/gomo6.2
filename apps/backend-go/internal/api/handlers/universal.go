package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// ─── Handler ────────────────────────────────────────────────────────────────

// UniversalHandler handles generic CRUD operations for any table
type UniversalHandler struct {
	db                 *sql.DB
	hub                *websocket.Hub
	redis              *redis.Client
	botEventPublisher  *BotEventPublisher
	achievementChecker *AchievementChecker
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

// SetAchievementChecker sets the achievement checker for auto-unlock
func (h *UniversalHandler) SetAchievementChecker(ac *AchievementChecker) {
	h.achievementChecker = ac
}

// ─── Main Router ────────────────────────────────────────────────────────────

// HandleTableRequest handles requests to any table
func (h *UniversalHandler) HandleTableRequest(c *gin.Context) {
	// Extract table name from URL path
	path := c.Request.URL.Path
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
		"achievements":                 true,
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

// ─── Filter Helpers ─────────────────────────────────────────────────────────

// decodeColumnValue converts a database column value to a JSON-safe representation.
// JSONB columns come as []byte from the driver — we parse them into proper JSON
// objects/arrays. Other []byte values (UUIDs, text) are returned as strings.
func decodeColumnValue(val interface{}) interface{} {
	b, ok := val.([]byte)
	if !ok {
		return val
	}
	// Only try JSON parsing for values that look like JSON objects or arrays.
	s := strings.TrimSpace(string(b))
	if len(s) > 0 && (s[0] == '{' || s[0] == '[') {
		var jsonVal interface{}
		if err := json.Unmarshal(b, &jsonVal); err == nil {
			return jsonVal
		}
	}
	return string(b)
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
func extractRecordID(urlPath string, tableName string) string {
	trimmed := strings.TrimPrefix(urlPath, "/api/v1/"+tableName+"/")
	if trimmed == "" || strings.Contains(trimmed, "/") {
		return ""
	}
	return trimmed
}
