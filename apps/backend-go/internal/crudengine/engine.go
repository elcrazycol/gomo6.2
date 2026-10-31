package crudengine

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gomo6/backend/internal/gomosubperms"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/search"
	"github.com/gomo6/backend/internal/wall"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// ─── Handler ────────────────────────────────────────────────────────────────

// Engine handles generic CRUD operations for any table. It is pure table
// plumbing: the registry (table_registry.go) declares every per-table fact,
// and domain behavior that does not belong in the generic layer (the
// profile-wall subsystem) lives in injected domain services — see wall.
type Engine struct {
	db        *sql.DB
	hub       *websocket.Hub
	redis     *redis.Client
	achEngine *achievements.Engine
	wall      *wall.Service
	// searchIndexer mirrors generic-table writes into Meilisearch (e.g. a
	// privacy_settings change must drop the user from the index). Nil disables
	// the sync path.
	searchIndexer *search.Indexer

	// achievementRecomputeAt debounces per-user achievement reconciliation
	// (M-02/M-03): reconciling on EVERY page open would run 20+ source-count
	// queries synchronously per request. We run it in the background and at
	// most once per achievementRecomputeWindow per user, so frequent visits
	// cost nothing extra while a user's own page still catches up quickly.
	achievementRecomputeMu sync.Mutex
	achievementRecomputeAt map[string]time.Time
}

func New(db *sql.DB, hub *websocket.Hub) *Engine {
	return &Engine{
		db:                     db,
		hub:                    hub,
		achievementRecomputeAt: make(map[string]time.Time),
	}
}

// SetRedis sets the Redis client for cache invalidation
func (h *Engine) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// SetAchievementEngine wires the achievements engine for auto-unlock events.
func (h *Engine) SetAchievementEngine(e *achievements.Engine) {
	h.achEngine = e
}

// SetWall wires the profile-wall domain service. Every wall-facing registry
// hook (reads, write side effects, cache invalidation, achievement events,
// privacy gates) delegates to it. Nil-safe: a nil wall service disables the
// wall-specific paths (degraded deployments/tests), but the generic CRUD
// surface keeps working.
func (h *Engine) SetWall(s *wall.Service) {
	h.wall = s
}

// SetSearchIndexer wires the best-effort search indexer for generic-table
// writes that affect the search index (currently privacy_settings). Nil
// disables the sync path.
func (h *Engine) SetSearchIndexer(idx *search.Indexer) {
	h.searchIndexer = idx
}

// ─── Main Router ────────────────────────────────────────────────────────────

// HandleTableRequest handles requests to any table
func (h *Engine) HandleTableRequest(c *gin.Context) {
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
	viewerID := httpx.AuthenticatedUserID(c)
	var clause string
	var args []interface{}

	switch tableName {
	case "channels", "gomosub_roles", "channel_categories":
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
	viewerID := httpx.AuthenticatedUserID(c)
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
func (h *Engine) isSelfJoin(c *gin.Context) bool {
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
func (h *Engine) isSelfLeave(c *gin.Context) bool {
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
func (h *Engine) checkGomosubWritePermission(c *gin.Context, tableName string) bool {
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
		httpx.ServerError(c, "handler error", err)
		c.Abort()
		return false
	}

	// Owner always has full access
	if ownerID == claims.UserID {
		return true
	}

	// Resolve membership first: @everyone counts only for actual members, and
	// non-members (outside self-join/self-leave, handled by the caller) are
	// denied here.
	var memberExists bool
	_ = h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2)`,
		boardID, claims.UserID).Scan(&memberExists)

	allowGrants, denyGrants, actorTop, err := loadActorGrants(h.db, boardID, claims.UserID, memberExists)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		c.Abort()
		return false
	}
	perms := gomosubperms.Resolve(allowGrants, denyGrants)
	if len(perms) == 0 && !memberExists {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
		c.Abort()
		return false
	}

	// Check table-specific permissions.
	needed := gomosubTablePermission(tableName)
	hasPerm := needed == "" || perms[needed] || perms["administrator"]
	// Role assignment sits at the intersection of the two management
	// domains: holders of either can_manage_roles or can_manage_members may
	// grant/revoke roles (Discord's Manage Roles covers it; our
	// can_manage_members explicitly documents role assignment too).
	if tableName == "gomosub_member_roles" && (perms["can_manage_roles"] || perms["can_manage_members"]) {
		hasPerm = true
	}
	if !hasPerm {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You don't have permission to perform this action"))
		c.Abort()
		return false
	}
	// Hierarchy (Discord rule): role-affecting writes may only touch roles
	// strictly below the actor's top role and may never grant permissions
	// the actor lacks. Owners bypassed earlier, administrators here.
	if perms["administrator"] {
		return true
	}
	return h.checkRoleHierarchy(c, tableName, boardID, perms, actorTop)
}

// loadActorGrants unions the user's server-level permission grants on a board
// (@everyone for members only, plus every assigned role) and reports the top
// role position (@everyone counts as 0, outsiders get -1). Grants come back
// partitioned into explicit allows and denies (tri-state role model).
func loadActorGrants(db *sql.DB, boardID, userID string, isMember bool) (allow, deny map[string]bool, top int, err error) {
	rows, err := db.Query(`
		SELECT gr.permissions, gr.position, COALESCE(gr.is_everyone, false)
		FROM gomosub_roles gr
		WHERE gr.board_id = $1 AND (
			(COALESCE(gr.is_everyone, false) = TRUE)
			OR EXISTS(SELECT 1 FROM gomosub_member_roles mr
				WHERE mr.role_id = gr.id AND mr.user_id = $2 AND mr.board_id = $1)
			OR EXISTS(SELECT 1 FROM gomosub_memberships gm
				WHERE gm.role_id = gr.id AND gm.user_id = $2 AND gm.board_id = $1)
		)
	`, boardID, userID)
	if err != nil {
		return nil, nil, -1, err
	}
	defer rows.Close()
	allow = map[string]bool{}
	deny = map[string]bool{}
	top = -1
	for rows.Next() {
		var raw json.RawMessage
		var pos int
		var everyone bool
		if err := rows.Scan(&raw, &pos, &everyone); err != nil {
			continue
		}
		if everyone && !isMember {
			continue
		}
		if everyone {
			if top < 0 {
				top = 0
			}
		} else if pos > top {
			top = pos
		}
		m := map[string]bool{}
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &m)
		}
		for k, v := range m {
			if v {
				allow[k] = true
			} else {
				deny[k] = true
			}
		}
	}
	return allow, deny, top, rows.Err()
}

// roleTarget describes a gomosub role referenced by a management write.
type roleTarget struct {
	boardID    string
	position   int
	isEveryone bool
}

// fetchRoleTarget loads the board, position and @everyone flag of a role.
// sql.ErrNoRows means the role does not exist.
func fetchRoleTarget(db *sql.DB, roleID string) (*roleTarget, error) {
	var t roleTarget
	err := db.QueryRow(`SELECT board_id, position, COALESCE(is_everyone, false) FROM gomosub_roles WHERE id = $1`,
		roleID).Scan(&t.boardID, &t.position, &t.isEveryone)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

// gomosubRequestRoleID extracts the role a member_roles write targets: the
// role_id query filter (DELETE) first, then the JSON body (POST).
func gomosubRequestRoleID(c *gin.Context) string {
	if rid := strings.TrimPrefix(c.Query("role_id"), "eq."); rid != "" {
		return rid
	}
	if body := gomosubRequestBody(c); body != nil {
		if rid, _ := body["role_id"].(string); rid != "" {
			return rid
		}
	}
	return ""
}

// gomosubRequestBody parses the JSON body and restores it for downstream
// handlers (the body reader is single-use).
func gomosubRequestBody(c *gin.Context) map[string]interface{} {
	if c.Request.Body == nil {
		return nil
	}
	bodyBytes, err := io.ReadAll(c.Request.Body)
	if err != nil {
		return nil
	}
	c.Request.Body = io.NopCloser(bytes.NewReader(bodyBytes))
	if len(bodyBytes) == 0 {
		return nil
	}
	var body map[string]interface{}
	if json.Unmarshal(bodyBytes, &body) != nil {
		return nil
	}
	return body
}

// gomosubTargetID extracts the row id a PUT/DELETE addresses: the id query
// filter (PostgREST style) first, then the URL path form.
func gomosubTargetID(c *gin.Context, tableName string) string {
	if id := strings.TrimPrefix(c.Query("id"), "eq."); id != "" {
		return id
	}
	return extractRecordID(c.Request.URL.Path, tableName)
}

// checkRoleHierarchy enforces the Discord hierarchy rule on role-affecting
// writes: only roles strictly below the actor's top role may be touched, only
// permissions the actor holds may be granted, and @everyone can never be
// renamed, moved, deleted or explicitly granted. A missing or foreign-board
// target is left to the downstream board-scoped statement (which naturally
// matches nothing), so existence is never leaked. Returns false after
// writing the denial response.
func (h *Engine) checkRoleHierarchy(c *gin.Context, tableName, boardID string, actorPerms map[string]bool, actorTop int) bool {
	deny := func(msg string) bool {
		c.JSON(http.StatusForbidden, models.ErrorResponse(msg))
		c.Abort()
		return false
	}

	switch tableName {
	case "gomosub_roles":
		if c.Request.Method == "POST" {
			body := gomosubRequestBody(c)
			if body == nil {
				return deny("Invalid request body")
			}
			if v, _ := body["is_everyone"].(bool); v {
				return deny("The @everyone role is managed by the system")
			}
			if name, _ := body["name"].(string); name == "@everyone" {
				return deny("That role name is reserved")
			}
			pos := 0
			if p, ok := body["position"].(float64); ok {
				pos = int(p)
			}
			if pos >= actorTop {
				return deny("You cannot create roles at or above your own top role")
			}
			return checkGrantedPerms(c, body, actorPerms)
		}
		targetID := gomosubTargetID(c, tableName)
		if targetID == "" {
			return deny("Role id is required")
		}
		target, err := fetchRoleTarget(h.db, targetID)
		if err == sql.ErrNoRows {
			return true // downstream board-scoped statement matches nothing
		}
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			c.Abort()
			return false
		}
		if target.boardID != boardID {
			return true // cross-board: downstream matches nothing (no leak)
		}
		if c.Request.Method == "DELETE" {
			if target.isEveryone {
				return deny("The @everyone role cannot be deleted")
			}
			if target.position >= actorTop {
				return deny("You cannot delete roles at or above your own top role")
			}
			return true
		}
		// PUT
		if target.isEveryone {
			body := gomosubRequestBody(c)
			if body != nil {
				if _, hasName := body["name"]; hasName {
					return deny("The @everyone role cannot be renamed")
				}
				if _, hasPos := body["position"]; hasPos {
					return deny("The @everyone role cannot be moved")
				}
				if _, hasFlag := body["is_everyone"]; hasFlag {
					return deny("The @everyone role is managed by the system")
				}
			}
			return checkGrantedPerms(c, body, actorPerms)
		}
		if target.position >= actorTop {
			return deny("You cannot edit roles at or above your own top role")
		}
		if pos, ok := gomosubRequestPosition(c); ok && pos >= actorTop {
			return deny("You cannot move roles to or above your own top role")
		}
		return checkGrantedPerms(c, gomosubRequestBody(c), actorPerms)

	case "gomosub_member_roles":
		roleID := gomosubRequestRoleID(c)
		if roleID == "" {
			return deny("role_id is required")
		}
		target, err := fetchRoleTarget(h.db, roleID)
		if err == sql.ErrNoRows {
			return true // downstream matches nothing
		}
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			c.Abort()
			return false
		}
		if target.boardID != boardID {
			return true // cross-board: downstream matches nothing
		}
		if target.isEveryone {
			return deny("The @everyone role applies to everyone implicitly")
		}
		if target.position >= actorTop {
			return deny("You cannot assign roles at or above your own top role")
		}
		return true

	case "gomosub_memberships":
		// Legacy single-role assignment on PUT (and exotic POST with a role).
		body := gomosubRequestBody(c)
		if body == nil {
			return true
		}
		rid, _ := body["role_id"].(string)
		if rid == "" || rid == "<nil>" {
			return true
		}
		target, err := fetchRoleTarget(h.db, rid)
		if err == sql.ErrNoRows {
			return true // PrepareBody already rejects unknown-board roles
		}
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			c.Abort()
			return false
		}
		if target.boardID != boardID || target.isEveryone {
			return true // handled downstream / nothing to escalate to
		}
		if target.position >= actorTop {
			return deny("You cannot assign roles at or above your own top role")
		}
		return true
	}
	return true
}

// gomosubRequestPosition reads an optional position from the JSON body.
func gomosubRequestPosition(c *gin.Context) (int, bool) {
	body := gomosubRequestBody(c)
	if body == nil {
		return 0, false
	}
	p, ok := body["position"].(float64)
	if !ok {
		return 0, false
	}
	return int(p), true
}

// checkGrantedPerms ensures every permission the write turns on is one the
// actor holds (nil body = nothing granted). Discord parity: you cannot hand
// out what you lack — in particular, administrator.
func checkGrantedPerms(c *gin.Context, body map[string]interface{}, actorPerms map[string]bool) bool {
	if body == nil {
		return true
	}
	raw, ok := body["permissions"]
	if !ok || raw == nil {
		return true
	}
	granted, _ := raw.(map[string]interface{})
	for key, val := range granted {
		on, _ := val.(bool)
		if on && !actorPerms[key] {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You cannot grant permissions you don't have ("+key+")"))
			c.Abort()
			return false
		}
	}
	return true
}

// gomosubTablePermission returns the permission key needed to write to a gomosub table.
func gomosubTablePermission(table string) string {
	switch table {
	case "channels", "channel_permissions", "channel_categories":
		return "can_manage_channels"
	case "gomosub_roles", "gomosub_member_roles":
		return "can_manage_roles"
	case "gomosub_memberships", "gomosub_bans":
		return "can_manage_members"
	default:
		return ""
	}
}
