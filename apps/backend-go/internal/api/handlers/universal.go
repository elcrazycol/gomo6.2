package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// ─── Handler ────────────────────────────────────────────────────────────────

// UniversalHandler handles generic CRUD operations for any table
type UniversalHandler struct {
	db        *sql.DB
	hub       *websocket.Hub
	redis     *redis.Client
	achEngine *achievements.Engine

	// achievementRecomputeAt debounces per-user achievement reconciliation
	// (M-02/M-03): reconciling on EVERY page open would run 20+ source-count
	// queries synchronously per request. We run it in the background and at
	// most once per achievementRecomputeWindow per user, so frequent visits
	// cost nothing extra while a user's own page still catches up quickly.
	achievementRecomputeMu sync.Mutex
	achievementRecomputeAt map[string]time.Time
}

func NewUniversalHandler(db *sql.DB, hub *websocket.Hub) *UniversalHandler {
	return &UniversalHandler{
		db:                     db,
		hub:                    hub,
		achievementRecomputeAt: make(map[string]time.Time),
	}
}

// SetRedis sets the Redis client for cache invalidation
func (h *UniversalHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// SetAchievementEngine wires the achievements engine for auto-unlock events.
func (h *UniversalHandler) SetAchievementEngine(e *achievements.Engine) {
	h.achEngine = e
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

	// Only allow specific tables for security. The allow-list lives in the
	// declarative table registry (GenericTables) — the same registry that
	// generates the routes in routes.go, so a table can never be routable
	// without being allow-listed here.
	meta := GenericTableByName(tableName)
	if meta == nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Table not found"))
		return
	}

	// Check gomosub management permissions for write operations
	if c.Request.Method != "GET" && meta.GomosubManagement {
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

	if c.Request.Method == http.MethodGet && meta.ReadDenied {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Generic access to this table is disabled"))
		return
	}

	// H2 (security audit): server-managed tables must never be written through
	// the generic CRUD surface. Without this guard, any authenticated user could
	// INSERT/PUT into user_roles and grant themselves the admin/moderator role
	// (privilege escalation) or forge achievements/polls. Reads stay allowed.
	if c.Request.Method != http.MethodGet && meta.WriteDenied {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Writes to this table are not allowed"))
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

// writableColumnsForTable returns the columns a client may write for tables
// whose remaining columns are server-managed (counters, ownership foreign
// keys). An empty result means the table is only restricted by ownership
// forcing, not by column allow-listing. Source of truth: the table registry
// (TableMeta.WritableColumns).
func writableColumnsForTable(tableName string) map[string]bool {
	meta := GenericTableByName(tableName)
	if meta == nil {
		return nil
	}
	return meta.WritableColumns
}

// filterWritableColumns strips client-supplied columns that are not in the
// table's writable allowlist. This is the mass-assignment guard (CWE-915): the
// generic write handlers interpolate body keys into INSERT/SET clauses, so any
// column that exists in the table but is server-managed must be unreachable
// from the client. Columns forced by ownership handling (user_id, author_id)
// are re-added server-side after this filter runs.
func filterWritableColumns(tableName string, data map[string]interface{}) {
	allowed := writableColumnsForTable(tableName)
	if allowed == nil {
		return
	}
	for key := range data {
		if !allowed[key] {
			delete(data, key)
		}
	}
}

// authenticatedUserID returns the authenticated user ID from the request
// context, or "" when the request is unauthenticated.
func authenticatedUserID(c *gin.Context) string {
	claimsValue, exists := c.Get("claims")
	claims, ok := claimsValue.(*auth.Claims)
	if !exists || !ok || claims == nil || claims.UserID == "" {
		return ""
	}
	return claims.UserID
}

// genericReadScopeUser returns the authenticated user ID for tables where the
// compatibility read endpoint must be user-scoped (TableMeta.UserScopedRead).
// An unscoped table is left untouched so public-ish compatibility queries
// (channels, roles, etc.) keep their existing semantics.
func genericReadScopeUser(c *gin.Context, table string) string {
	meta := GenericTableByName(table)
	if meta == nil || !meta.UserScopedRead {
		return ""
	}
	claimsValue, claimsExists := c.Get("claims")
	claims, claimsOK := claimsValue.(*auth.Claims)
	if !claimsExists || !claimsOK || claims == nil {
		return ""
	}
	return claims.UserID
}

// genericGomosubVisibility returns a WHERE predicate that restricts reads of
// gomosub structure tables (channels, gomosub_roles, channel_permissions) to
// rows belonging to boards the caller may actually see. Public boards are
// readable by everyone — guests included. Rows of private boards are only
// readable by the board owner and its members, mirroring the board-level
// visibility gate (GetBoard), so anonymous browsing cannot enumerate a private
// gomosub's internal structure by guessing UUIDs — and the pre-existing
// exposure of that structure to any logged-in non-member is closed as well.
// Returns an empty clause for tables not gated by the registry
// (TableMeta.GomosubVisibility).
func genericGomosubVisibility(c *gin.Context, tableName string, argIndex int) (string, []interface{}, int) {
	meta := GenericTableByName(tableName)
	if meta == nil || !meta.GomosubVisibility {
		return "", nil, argIndex
	}
	viewerID := authenticatedUserID(c)
	var clause string
	var args []interface{}

	switch tableName {
	case "channels", "gomosub_roles":
		clause = "board_id IN (SELECT b.id FROM boards b WHERE b.visibility IS DISTINCT FROM 'private'"
	case "channel_permissions":
		clause = "channel_id IN (SELECT ch.id FROM channels ch JOIN boards b ON b.id = ch.board_id WHERE b.visibility IS DISTINCT FROM 'private'"
	}

	if viewerID != "" {
		clause += " OR b.owner_id = $" + strconv.Itoa(argIndex)
		args = append(args, viewerID)
		argIndex++
		clause += " OR b.id IN (SELECT gm.board_id FROM gomosub_memberships gm WHERE gm.user_id = $" + strconv.Itoa(argIndex) + ")"
		args = append(args, viewerID)
		argIndex++
	}
	clause += ")"
	return clause, args, argIndex
}

// genericEmojiVisibility returns a WHERE predicate that restricts reads of
// emoji_packs / custom_emojis through the generic CRUD surface to content the
// caller may actually see: public packs are readable by everyone (guests
// included), private packs only by their author and subscribers. Without this
// the generic surface exposed private packs and their emoji lists to strangers
// by guessing ids, defeating the by-slug gate in GetPackBySlug.
// Returns an empty clause for tables not gated by the registry
// (TableMeta.EmojiVisibility).
func genericEmojiVisibility(c *gin.Context, tableName string, argIndex int) (string, []interface{}, int) {
	meta := GenericTableByName(tableName)
	if meta == nil || !meta.EmojiVisibility {
		return "", nil, argIndex
	}
	viewerID := authenticatedUserID(c)
	switch tableName {
	case "emoji_packs":
		if viewerID == "" {
			return "is_public = TRUE", nil, argIndex
		}
		clause := "(is_public = TRUE OR author_id = $" + strconv.Itoa(argIndex) +
			" OR EXISTS (SELECT 1 FROM user_emoji_subscriptions s WHERE s.user_id = $" + strconv.Itoa(argIndex) +
			" AND s.pack_id = emoji_packs.id))"
		return clause, []interface{}{viewerID}, argIndex + 1
	case "custom_emojis":
		if viewerID == "" {
			return "EXISTS (SELECT 1 FROM emoji_packs ep WHERE ep.id = custom_emojis.pack_id AND ep.is_public = TRUE)", nil, argIndex
		}
		clause := "EXISTS (SELECT 1 FROM emoji_packs ep WHERE ep.id = custom_emojis.pack_id AND (ep.is_public = TRUE OR ep.author_id = $" +
			strconv.Itoa(argIndex) + " OR EXISTS (SELECT 1 FROM user_emoji_subscriptions s WHERE s.user_id = $" +
			strconv.Itoa(argIndex) + " AND s.pack_id = ep.id)))"
		return clause, []interface{}{viewerID}, argIndex + 1
	default:
		return "", nil, argIndex
	}
}

// ─── Filter Helpers ─────────────────────────────────────────────────────────

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

func isValidColumnName(name string) bool {
	if len(name) == 0 || len(name) > 63 {
		return false
	}
	for i, c := range name {
		if i == 0 {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '_') {
				return false
			}
		} else {
			if !((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_') {
				return false
			}
		}
	}
	return true
}

// validateBodyColumnNames rejects any JSON body key that is not a safe SQL
// identifier (CWE-89, C1 regression guard). The generic write handlers
// interpolate body keys directly into INSERT column lists and UPDATE SET
// clauses, so an unvalidated key could smuggle arbitrary SQL into the
// statement (e.g. `accepted_at = (SELECT password_hash FROM users), updated_at`
// produced a working expression because the trailing ` = $N` absorbed the
// bind parameter). Values are parameterized, but the identifier itself must
// still be constrained: a valid column name can never contain SQL syntax, so
// enforcing the same shape as isValidColumnName is sufficient.
func validateBodyColumnNames(data map[string]interface{}) error {
	for key := range data {
		if !isValidColumnName(key) {
			return fmt.Errorf("invalid column name %q in request body", key)
		}
	}
	return nil
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
	if !isValidColumnName(parts[0]) {
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

// gomosubBoardIDFromRequest extracts the board_id that authorized a gomosub
// management write (query param first, then JSON body). Returns "" when
// absent — self-join/self-leave flows legitimately omit it.
func gomosubBoardIDFromRequest(c *gin.Context) string {
	boardID := strings.TrimPrefix(c.Query("board_id"), "eq.")
	if boardID == "" && c.Request.Body != nil {
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err == nil {
			c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
			var body map[string]interface{}
			if json.Unmarshal(bodyBytes, &body) == nil {
				if bid, ok := body["board_id"].(string); ok {
					boardID = strings.TrimPrefix(bid, "eq.")
				}
			}
		}
	}
	return boardID
}

// gomosubBoardScopeClause returns the WHERE fragment that confines a gomosub
// management write to the board that granted the permission (H1). Most gomosub
// tables carry their own board_id column; channel_permissions does not, so it
// is scoped through the board of the channel it references.
func gomosubBoardScopeClause(tableName, boardID string, argIndex int) (string, interface{}) {
	ph := "$" + strconv.Itoa(argIndex)
	if tableName == "channel_permissions" {
		return "channel_id IN (SELECT id FROM channels WHERE board_id = " + ph + ")", boardID
	}
	return "board_id = " + ph, boardID
}

// isGomosubManagementTable returns true if the table requires gomosub
// permission checks (TableMeta.GomosubManagement).
func isGomosubManagementTable(table string) bool {
	meta := GenericTableByName(table)
	return meta != nil && meta.GomosubManagement
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
	// Strip eq. prefix if present (PostgREST-style filter format)
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
		serverError(c, "handler error", err)
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
