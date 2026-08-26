package crudengine

import (
	"database/sql"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/models"
)

// ─── Cache Invalidation ─────────────────────────────────────────────────────

// invalidateCacheForTableResult invalidates cache based on table and result
// data. Which tables need custom invalidation is declared in the table
// registry (TableMeta.InvalidateCache, implemented in table_hooks.go /
// wall_bridge.go) — tables without a hook fall back to the generic table
// invalidation keyed by the row id, so a new table can never silently skip
// invalidation entirely.
func (h *Engine) invalidateCacheForTableResult(c *gin.Context, tableName string, result map[string]interface{}) {
	if h.redis == nil {
		return
	}

	if meta := GenericTableByName(tableName); meta != nil && meta.InvalidateCache != nil {
		meta.InvalidateCache(h, c, result)
		return
	}

	// Generic invalidation: no registry hook — clear by table + row id.
	values := make(map[string]string)
	if id, ok := result["id"].(string); ok && id != "" {
		values["id"] = id
	}
	cache.InvalidateForTable(h.redis, tableName, values)
}

// ─── GET ────────────────────────────────────────────────────────────────────

func (h *Engine) handleGet(c *gin.Context, tableName string) {
	// Specialized GET queries (wall lists, the achievements catalog) are
	// registry-declared ReadHandler overrides — the generic surface has no
	// table-name branches left, so a new specialized read is wired in the
	// registry next to its table instead of extending this dispatcher.
	if meta := GenericTableByName(tableName); meta != nil && meta.ReadHandler != nil {
		meta.ReadHandler(h, c)
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
		if !crud.IsValidColumnName(key) {
			continue
		}

		for _, rawValue := range values {
			clause, nextArgs, nextIndex := crud.BuildFilterClause(key, rawValue, argIndex)
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
		parts := crud.SplitCSV(orRaw)
		var orClauses []string
		for _, part := range parts {
			col, op, value, ok := crud.ParseOrCondition(part)
			if !ok {
				continue
			}
			clause, nextArgs, nextIndex := crud.BuildFilterFromParts(col, op, value, argIndex)
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
	scopeClause, scopeArgs, _ = genericEmojiVisibility(c, tableName, argIndex)
	if scopeClause != "" {
		clauses = append(clauses, scopeClause)
		args = append(args, scopeArgs...)
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
		if s, ok := crud.ParseOrderClause(joined, ""); ok {
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
		httpx.ServerError(c, "database error", err)
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
			httpx.ServerError(c, "database error", err)
			return
		}

		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			b, ok := val.([]byte)
			if ok {
				row[col] = crud.DecodeColumnValue(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}

	// L6: read-time row sanitization (registry SanitizeReadRow) neutralizes
	// user-supplied customization CSS written before server-side sanitization
	// existed, for every viewer — defense-in-depth alongside the write-path
	// sanitizer. Registry-declared so the read surface stays declarative.
	if meta := GenericTableByName(tableName); meta != nil && meta.SanitizeReadRow != nil {
		for _, row := range results {
			meta.SanitizeReadRow(row)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// ─── POST ───────────────────────────────────────────────────────────────────

// upsertInsertQuery returns INSERT ... ON CONFLICT for tables the frontend
// calls via .upsert(). Which tables support upsert is declared in the table
// registry (TableMeta.Upsert) and the per-table statement is declared in
// TableMeta.BuildUpsert (implemented in table_write_hooks.go) — this function
// is just the registry dispatch, kept as a single hook point for the upsert
// write path (and pinned by crud_language_test).
func upsertInsertQuery(tableName string, data map[string]interface{}) (query string, args []interface{}, ok bool) {
	meta := GenericTableByName(tableName)
	if meta == nil || !meta.Upsert || meta.BuildUpsert == nil {
		return "", nil, false
	}
	return meta.BuildUpsert(data)
}

// enforceWallTargetPrivacy rejects interactions with walls that the caller may
// not view (private/hidden walls) on the write path. The whole gate, including
// the L5 fail-closed lookups, lives in the wall domain service
// (wall.Service.EnforceTargetPrivacy) — this forwarder keeps the registry
// dispatch in one place.
func (h *Engine) enforceWallTargetPrivacy(c *gin.Context, tableName string, data map[string]interface{}, userID string) bool {
	// Fail closed: without the wall service there is no way to check the
	// interaction target, so reject wall writes rather than risk an orphan.
	if h.wall == nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("wall service not configured"))
		return false
	}
	return h.wall.EnforceTargetPrivacy(c, tableName, data, userID)
}

// enforcePostOwnership forces ownership columns of user-owned tables to the
// authenticated user so a client can never impersonate another user on write.
// The ownership kind per table comes from the registry (TableMeta.PostOwner):
// OwnSingle forces user_id, OwnWallPost forces author_id (with the wall owner
// allowed when privacy permits), OwnWallRepost forces user_id AND wall_user_id.
// It writes the HTTP response and returns false when the request is rejected.
func (h *Engine) enforcePostOwnership(c *gin.Context, tableName string, data map[string]interface{}) bool {
	meta := GenericTableByName(tableName)
	if meta == nil {
		return true
	}
	switch meta.PostOwner {
	case OwnWallPost:
		userID := httpx.AuthenticatedUserID(c)
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
				httpx.ServerError(c, "check wall privacy", err)
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
		userID := httpx.AuthenticatedUserID(c)
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
		userID := httpx.AuthenticatedUserID(c)
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
		userID := httpx.AuthenticatedUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
			return clauses, args, argIndex, false
		}
		// The author or the wall owner may edit/delete a post.
		clauses = append(clauses, "(author_id = $"+strconv.Itoa(argIndex)+" OR user_id = $"+strconv.Itoa(argIndex)+")")
		args = append(args, userID)
		argIndex++
	case OwnSingle:
		userID := httpx.AuthenticatedUserID(c)
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

// afterWrite runs the shared post-write sequence for every method, with the
// per-table behavior declared in the registry:
//
//  1. the registry AfterWrite hook — wall notifications, WebSocket broadcasts,
//     unified profile stats and dependent-cache invalidations;
//  2. achievement events (POST only — handlePut/handleDelete never emitted
//     them, and this template preserves that contract);
//  3. cache invalidation for the written row (registry InvalidateCache hook
//     or the generic table invalidation);
//  4. the enriched wall response for wall tables (registry EnrichedResponse),
//     which replaces the raw row with the author embed + interaction counts;
//  5. the default SuccessResponse.
func (h *Engine) afterWrite(c *gin.Context, tableName, method string, result map[string]interface{}) {
	meta := GenericTableByName(tableName)

	if meta != nil && meta.AfterWrite != nil {
		meta.AfterWrite(h, c, method, result)
	}

	// Achievements fire on the insert/upsert paths only (the historical
	// contract — handlePut/handleDelete never emitted events).
	if method == "POST" {
		h.emitAchievementEvents(tableName, result)
	}

	// Invalidate cache for the written row.
	h.invalidateCacheForTableResult(c, tableName, result)

	// Wall-table writes respond with the enriched payload (author embed +
	// interaction counts) instead of the raw row. The historical order ran the
	// enrichment before the generic invalidation only by accident (it early-
	// returned for wall tables); always invalidating first is strictly safer —
	// an enrichment fetch failure can no longer skip the cache clear.
	if meta != nil && meta.EnrichedResponse && (method == "POST" || method == "PUT") {
		if h.wall != nil && h.wall.TryRespondEnriched(c, tableName, result) {
			return
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(result))
}

func (h *Engine) handlePost(c *gin.Context, tableName string) {
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
	if err := crud.ValidateBodyColumnNames(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// H2 (security audit): strip server-managed columns (counters, ownership
	// foreign keys) that must never be client-controlled. Runs after the C1
	// identifier gate and before ownership forcing re-adds user_id/author_id.
	filterWritableColumns(tableName, data)

	// Per-table body guards (registry PrepareBody): emoji/trigger validation,
	// pack ownership, self-join role rejection, board_id stripping, …
	meta := GenericTableByName(tableName)
	if meta != nil && meta.PrepareBody != nil {
		if !meta.PrepareBody(h, c, tableName, "POST", data) {
			return
		}
	}

	// K1: force ownership so writes cannot impersonate another user.
	if !h.enforcePostOwnership(c, tableName, data) {
		return
	}

	if upsertQuery, upsertArgs, useUpsert := upsertInsertQuery(tableName, data); useUpsert {
		rows, err := h.db.Query(upsertQuery, upsertArgs...)
		if err != nil {
			httpx.ServerError(c, "database error", err)
			return
		}
		defer rows.Close()
		if !rows.Next() {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
			return
		}
		result, err := crud.ScanRowToMap(rows)
		if err != nil {
			httpx.ServerError(c, "database error", err)
			return
		}
		h.afterWrite(c, tableName, "POST", result)
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

	query += crud.JoinStrings(columns, ", ") + ") VALUES (" + crud.JoinStrings(placeholders, ", ") + ") RETURNING *"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("No rows returned"))
		return
	}

	result, err := crud.ScanRowToMap(rows)
	if err != nil {
		httpx.ServerError(c, "database error", err)
		return
	}

	h.afterWrite(c, tableName, "POST", result)
}

// revokeSubscriptionsAfterPrivacyChange tears down live WebSocket
// subscriptions when a privacy_settings write restricts previously-public
// content. private_profile → both the wall and the now-playing room become
// friends-only; private_hide_wall alone → only the wall room becomes
// friends-only. Calls on other tables or without a hub are no-ops.
func (h *Engine) revokeSubscriptionsAfterPrivacyChange(tableName string, result map[string]interface{}) {
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

func (h *Engine) handlePut(c *gin.Context, tableName string) {
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
	if err := crud.ValidateBodyColumnNames(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}
	// H2 (security audit): strip server-managed columns (counters, ownership
	// foreign keys) that must never be client-controlled. Runs after the C1
	// identifier gate and before the ownership scope is applied.
	filterWritableColumns(tableName, data)

	// Per-table body guards (registry PrepareBody): emoji/trigger validation,
	// wall authorship locking (author_id = caller), comment tree locking
	// (post_id/parent_id stripped), membership role-board binding, board_id
	// stripping.
	meta := GenericTableByName(tableName)
	if meta != nil && meta.PrepareBody != nil {
		if !meta.PrepareBody(h, c, tableName, "PUT", data) {
			return
		}
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
		uid := httpx.AuthenticatedUserID(c)
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
		if !crud.IsValidColumnName(key) {
			continue
		}
		// H1: for gomosub management tables, board_id is consumed by the board
		// scope above — adding it again from the query would duplicate the clause
		// (and would be an undefined column on channel_permissions).
		if isGomosubManagementTable(tableName) && key == "board_id" {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := crud.BuildFilterClause(key, rawValue, argIndex)
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

	query += crud.JoinStrings(updates, ", ") + " WHERE " + strings.Join(clauses, " AND ") + " RETURNING *"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "database error", err)
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
		httpx.ServerError(c, "database error", err)
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = crud.DecodeColumnValue(b)
		} else {
			result[col] = val
		}
	}

	// Registry-declared side effects (wall WebSocket broadcasts, cache
	// invalidations), achievements, cache invalidation and the enriched wall
	// response — see afterWrite.
	h.afterWrite(c, tableName, "PUT", result)
}

// ─── DELETE ─────────────────────────────────────────────────────────────────

func (h *Engine) handleDelete(c *gin.Context, tableName string) {
	// Registry-declared delete semantics (TableMeta.SoftDeleteSQL): wall
	// comments are soft-deleted — the row must survive so the replies
	// underneath it (parent_id has ON DELETE CASCADE — a hard delete used to
	// wipe the whole subtree) and the thread structure stay intact. The content
	// is wiped server-side and the comment is flagged, so it renders as a
	// "Комментарий удалён" placeholder with an unknown author. The UPDATE
	// keeps the same WHERE scoping (enforceWallWriteScope → user_id = caller)
	// and RETURNING * contract as the generic DELETE path below.
	query := "DELETE FROM " + tableName
	if meta := GenericTableByName(tableName); meta != nil && meta.SoftDeleteSQL != "" {
		query = "UPDATE " + tableName + " SET " + meta.SoftDeleteSQL
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
		uid := httpx.AuthenticatedUserID(c)
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
		if !crud.IsValidColumnName(key) {
			continue
		}
		// H1: board_id is consumed by the board scope above (see handlePut).
		if isGomosubManagementTable(tableName) && key == "board_id" {
			continue
		}
		for _, rawValue := range values {
			clause, nextArgs, nextIndex := crud.BuildFilterClause(key, rawValue, argIndex)
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
		httpx.ServerError(c, "database error", err)
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
		httpx.ServerError(c, "database error", err)
		return
	}

	result := make(map[string]interface{})
	for i, col := range columns {
		val := values[i]
		b, ok := val.([]byte)
		if ok {
			result[col] = crud.DecodeColumnValue(b)
		} else {
			result[col] = val
		}
	}

	// Registry-declared side effects (wall cascade invalidations, WebSocket
	// deletion broadcasts, unified profile stats), cache invalidation and the
	// generic response — see afterWrite.
	h.afterWrite(c, tableName, "DELETE", result)
}
