package crudengine

// ─── Table Write Hooks ──────────────────────────────────────────────────────
//
// Per-table write behavior referenced from the table registry
// (table_registry.go) via TableMeta.PrepareBody, TableMeta.BuildUpsert,
// TableMeta.AfterWrite and TableMeta.SoftDeleteSQL — the last block of
// per-table branch logic that used to live inline in handlePost / handlePut /
// handleDelete. The dispatchers in crud.go are now a pure template over the
// registry: pre-write body guards, the upsert statement shape, post-write
// side effects (wall notifications, WebSocket broadcasts, unified profile
// stats, dependent caches) and the delete semantics are all declared on the
// table entry, so adding a table cannot leave a hidden branch in the engine.
//
// The wall-table hooks (afterWallPostWrite, prepareWallPostBody,
// upsertProfileWallPostLikes, …) are delegated to the wall domain service via
// wall_bridge.go and are no longer implemented here.
//
// Hooks must be nil-safe: h.redis / h.hub / h.achEngine may be nil in tests and
// in degraded deployments; every optional interaction is guarded.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/profiles"
)

// ─── PrepareBody hooks ──────────────────────────────────────────────────────

// prepareCustomEmojisBody validates emoji assets and triggers on both POST and
// PUT, and on POST additionally requires a pack owned by the caller: the
// generic surface otherwise accepts any valid UUID/pack_id from the client.
func prepareCustomEmojisBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if err := crud.ValidateCustomEmojiTriggers(data); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return false
	}
	if err := crud.ValidateCustomEmojiAsset(data, httpx.AuthenticatedUserID(c)); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return false
	}
	if method == "POST" {
		uid := httpx.AuthenticatedUserID(c)
		packID, _ := data["pack_id"].(string)
		if uid == "" || packID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("pack_id is required"))
			return false
		}
		var ownsPack bool
		if err := h.db.QueryRowContext(c.Request.Context(), "SELECT EXISTS(SELECT 1 FROM emoji_packs WHERE id = $1 AND author_id = $2)", packID, uid).Scan(&ownsPack); err != nil || !ownsPack {
			c.JSON(http.StatusForbidden, models.ErrorResponse("You can only edit your own emoji pack"))
			return false
		}
	}
	return true
}

// prepareEmojiPacksBody forces the author of a new emoji pack to the
// authenticated user (the generic table surface otherwise accepts any valid
// author_id from the client).
func prepareEmojiPacksBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "POST" {
		return true
	}
	uid := httpx.AuthenticatedUserID(c)
	if uid == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return false
	}
	data["author_id"] = uid
	return true
}

// prepareGomosubMembershipsBody guards both membership write paths: a
// self-join (POST) cannot assign itself a role (a client-supplied role_id
// would let anyone promote themselves to a privileged role or inherit
// another board's permission set), and a PUT role_id must belong to the board
// of the membership being modified (a cross-board role reference would
// inherit another board's permission set).
func prepareGomosubMembershipsBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method == "POST" {
		if uid, _ := data["user_id"].(string); uid != "" && uid == httpx.AuthenticatedUserID(c) {
			if rid, ok := data["role_id"]; ok && rid != nil && fmt.Sprint(rid) != "" {
				c.JSON(http.StatusForbidden, models.ErrorResponse("Joining a board cannot assign a role"))
				return false
			}
		}
		return true
	}
	if method == "PUT" {
		if rid, ok := data["role_id"]; ok && rid != nil && fmt.Sprint(rid) != "" {
			if boardID := gomosubBoardIDFromRequest(c); boardID != "" {
				var valid bool
				if err := h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM gomosub_roles WHERE id = $1 AND board_id = $2)`, fmt.Sprint(rid), boardID).Scan(&valid); err != nil || !valid {
					c.JSON(http.StatusForbidden, models.ErrorResponse("Role does not belong to this board"))
					return false
				}
			}
		}
	}
	return true
}

// stripChannelPermissionsBoardID removes the request board_id before the
// statement build: channel_permissions has no board_id column — the value is
// only consumed by the permission check and the board scope, never stored.
func stripChannelPermissionsBoardID(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	delete(data, "board_id")
	return true
}

// ─── Upsert statement builders ──────────────────────────────────────────────
//
// Transferred from the upsertInsertQuery switch (crud.go). Each builder owns
// the ON CONFLICT semantics of its table; ok=false lets the dispatcher fall
// through to a plain INSERT. The wall post-likes upsert builder lives in the
// wall domain service (wall_bridge.go).

// upsertUserDailyVisits is a plain UNIQUE(user_id, visit_date) upsert.
func upsertUserDailyVisits(data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
}

// upsertUserTermsAcceptance must be idempotent: the client fires the insert
// on every TermsOfService accept, and multiple tabs / retries race on the
// UNIQUE(user_id) constraint — a plain INSERT 500'd on the second write, so a
// user could "accept" forever without a stored row.
func upsertUserTermsAcceptance(data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
}

// upsertUserSessionTime accumulates time atomically: flushes fire from timers
// + visibility/unload handlers and can overlap — a plain INSERT 500'd on the
// duplicate key, and a naive read-then-write raced into lost updates.
func upsertUserSessionTime(data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
}

// upsertThreadCustomMessageVisits tracks per-thread custom message
// acknowledgements.
func upsertThreadCustomMessageVisits(data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
}

// upsertGomosubRulesAcceptance refreshes accepted_at on the same
// UNIQUE(user_id, board_id) row.
func upsertGomosubRulesAcceptance(data map[string]interface{}) (query string, args []interface{}, ok bool) {
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
}

// upsertProfileCustomization is a PARTIAL upsert: only the fields present in
// the request body are updated. The frontend fires separate .upsert() calls
// for the background, the theme toggle and the CSS editors — a naive
// full-row upsert would NULL-out every omitted column on each toggle,
// silently destroying the profile styling. All user-supplied CSS/background/
// theme values are sanitized here, before they reach the DB (the sanitizers
// live in the profiles domain package).
func upsertProfileCustomization(data map[string]interface{}) (query string, args []interface{}, ok bool) {
	uid, hasUID := data["user_id"]
	if !hasUID {
		return "", nil, false
	}
	cols := []string{"user_id"}
	vals := []interface{}{uid}
	var sets []string
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
	if v, ok := data["username_css"]; ok {
		s, _ := v.(string)
		add("username_css", profiles.SanitizeProfileCSS(s), "")
	}
	if v, ok := data["profile_badge_text"]; ok {
		s, _ := v.(string)
		add("profile_badge_text", profiles.SanitizeProfileBadgeText(s), "")
	}
	if v, ok := data["profile_badge_css"]; ok {
		s, _ := v.(string)
		add("profile_badge_css", profiles.SanitizeProfileCSS(s), "")
	}
	if v, ok := data["background_url"]; ok {
		s, _ := v.(string)
		add("background_url", profiles.SanitizeProfileBackgroundURL(s), "")
	}
	if v, ok := data["background_variant"]; ok {
		s, _ := v.(string)
		add("background_variant", profiles.SanitizeProfileBackgroundVariant(s), "")
	}
	if v, ok := data["theme_enabled"]; ok {
		b, _ := v.(bool)
		add("theme_enabled", b, "")
	}
	if v, ok := data["theme_tokens"]; ok {
		themeTokens := profiles.SanitizeProfileThemeTokens(v)
		themeTokensJSON := "{}"
		if len(themeTokens) > 0 {
			if b, err := json.Marshal(themeTokens); err == nil {
				themeTokensJSON = string(b)
			}
		}
		add("theme_tokens", themeTokensJSON, "::jsonb")
	}
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
}

// ─── AfterWrite hooks ───────────────────────────────────────────────────────

// afterUserSessionTimeWrite keeps the unified profile stats in sync when
// session minutes accumulate via upsert or are corrected via PUT.
func afterUserSessionTimeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		profiles.RecomputeUserProfileStats(h.db, uid)
	}
}

// afterPrivacySettingsWrite tears down live WebSocket subscriptions when a
// privacy_settings write restricts previously-public content (see
// revokeSubscriptionsAfterPrivacyChange — the wall/now-playing room teardown
// belongs to the generic write surface, which is why it stays here while the
// wall write domain lives in the wall service).
func afterPrivacySettingsWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.revokeSubscriptionsAfterPrivacyChange("privacy_settings", result)
}
