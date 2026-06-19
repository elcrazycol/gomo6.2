package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
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
	achievementChecker *AchievementChecker
}

func NewUniversalHandler(db *sql.DB, hub *websocket.Hub) *UniversalHandler {
	return &UniversalHandler{db: db, hub: hub}
}

// SetRedis sets the Redis client for cache invalidation
func (h *UniversalHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
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
		"channels":                     true,
		"gomosub_roles":                true,
		"channel_permissions":          true,
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

	// Check gomosub management permissions for write operations
	if c.Request.Method != "GET" && isGomosubManagementTable(tableName) {
		if tableName == "gomosub_memberships" {
			// Allow self-join (POST) and self-leave (DELETE) without management permissions
			if (c.Request.Method == "POST" && h.isSelfJoin(c)) || (c.Request.Method == "DELETE" && h.isSelfLeave(c)) {
				// Fall through — no management permission needed
			} else if !h.checkGomosubWritePermission(c, tableName) {
				return
			}
		} else if !h.checkGomosubWritePermission(c, tableName) {
			return
		}
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

// isGomosubManagementTable returns true if the table requires gomosub permission checks.
func isGomosubManagementTable(table string) bool {
	switch table {
	case "channels", "gomosub_roles", "channel_permissions", "gomosub_memberships":
		return true
	default:
		return false
	}
}

// isSelfJoin checks if a POST to gomosub_memberships is a user joining a board themselves.
func (h *UniversalHandler) isSelfJoin(c *gin.Context) bool {
	claimsInterface, exists := c.Get("claims")
	if !exists {
		return false
	}
	claims := claimsInterface.(*auth.Claims)

	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return false
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))

	if len(bodyBytes) == 0 {
		return false
	}
	var body map[string]interface{}
	if json.Unmarshal(bodyBytes, &body) != nil {
		return false
	}
	uid, ok := body["user_id"].(string)
	return ok && uid == claims.UserID
}

// isSelfLeave checks if a DELETE on gomosub_memberships targets the user's own membership.
func (h *UniversalHandler) isSelfLeave(c *gin.Context) bool {
	claimsInterface, exists := c.Get("claims")
	if !exists {
		return false
	}
	claims := claimsInterface.(*auth.Claims)

	userIDParam := strings.TrimPrefix(c.Query("user_id"), "eq.")
	return userIDParam == claims.UserID
}

// checkGomosubWritePermission verifies the user has management permissions for the
// gomosub board. It extracts board_id from the request body or query params.
// Returns true if allowed, false if denied (response already sent).
func (h *UniversalHandler) checkGomosubWritePermission(c *gin.Context, tableName string) bool {
	claimsInterface, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		c.Abort()
		return false
	}
	claims := claimsInterface.(*auth.Claims)

	// Extract board_id from the request
	boardID := c.Query("board_id")
	if boardID == "" {
		if bf := c.Query("board_id"); bf != "" {
			boardID = bf
		}
	}
	// Strip eq. prefix if present (Supabase-style filter format)
	boardID = strings.TrimPrefix(boardID, "eq.")

	// For POST, board_id is typically in the JSON body
	if boardID == "" && c.Request.Method == "POST" && c.Request.Body != nil {
		bodyBytes, err := io.ReadAll(c.Request.Body)
		c.Request.Body.Close()
		if err == nil && len(bodyBytes) > 0 {
			var body map[string]interface{}
			if json.Unmarshal(bodyBytes, &body) == nil {
				if bid, ok := body["board_id"].(string); ok {
					boardID = bid
				}
			}
			// Restore body for downstream handlers
			c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
		}
	}

	if boardID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("board_id is required"))
		c.Abort()
		return false
	}

	// Check if user is the board owner
	var ownerID string
	err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&ownerID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		c.Abort()
		return false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		c.Abort()
		return false
	}

	// Owner always has full access
	if ownerID == claims.UserID {
		return true
	}

	// Get user's role permissions
	var permissionsRaw json.RawMessage
	err = h.db.QueryRow(`
		SELECT gr.permissions
		FROM gomosub_memberships gm
		JOIN gomosub_roles gr ON gm.role_id = gr.id
		WHERE gm.board_id = $1 AND gm.user_id = $2
	`, boardID, claims.UserID).Scan(&permissionsRaw)
	if err != nil {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
		c.Abort()
		return false
	}

	var perms map[string]bool
	if err := json.Unmarshal(permissionsRaw, &perms); err != nil {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
		c.Abort()
		return false
	}

	// Check table-specific permissions
	needed := gomosubTablePermission(tableName)
	if needed == "" || perms[needed] {
		return true
	}

	c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
	c.Abort()
	return false
}

// gomosubTablePermission returns the permission key needed to write to a gomosub table.
func gomosubTablePermission(table string) string {
	switch table {
	case "channels", "channel_permissions":
		return "can_manage_channels"
	case "gomosub_roles":
		return "can_manage_roles"
	case "gomosub_memberships":
		return "can_manage_members"
	default:
		return ""
	}
}
