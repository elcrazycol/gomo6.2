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
// Hooks must be nil-safe: h.redis / h.hub / h.notif may be nil in tests and
// in degraded deployments; every optional interaction is guarded.

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/profiles"
	"github.com/gomo6/backend/internal/textutil"
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

// prepareWallPostBody fixes a wall post's authorship on PUT: the author is
// always the caller, and the wall owner column must never be moved onto
// another user's wall through a generic update (that would bypass the POST
// privacy check allow_wall_posts_from_others).
func prepareWallPostBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "PUT" {
		return true
	}
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return false
	}
	data["author_id"] = userID
	if wall, ok := data["user_id"].(string); ok && wall != "" && wall != userID {
		delete(data, "user_id")
	}
	return true
}

// prepareWallCommentBody fixes a comment's tree position on PUT: post_id and
// parent_id are fixed at creation — re-pointing them would bypass the
// POST-time privacy check (enforceWallTargetPrivacy) and could forge orphan
// comments on a foreign wall or detach a reply subtree from the visible
// branch.
func prepareWallCommentBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "PUT" {
		return true
	}
	delete(data, "post_id")
	delete(data, "parent_id")
	return true
}

// ─── Upsert statement builders ──────────────────────────────────────────────
//
// Transferred from the upsertInsertQuery switch (crud.go). Each builder owns
// the ON CONFLICT semantics of its table; ok=false lets the dispatcher fall
// through to a plain INSERT.

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

// upsertProfileWallPostLikes inserts a like or turns the re-like into a
// no-op UPDATE; (xmax = 0) AS inserted tells the caller whether this was a
// genuinely new like (the only case that notifies the post author).
func upsertProfileWallPostLikes(data map[string]interface{}) (query string, args []interface{}, ok bool) {
	pid, hasPID := data["post_id"]
	uid, hasUID := data["user_id"]
	if !hasPID || !hasUID {
		return "", nil, false
	}
	q := `INSERT INTO profile_wall_post_likes (post_id, user_id) VALUES ($1, $2)
ON CONFLICT (post_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING *, (xmax = 0) AS inserted`
	return q, []interface{}{pid, uid}, true
}

// upsertProfileCustomization is a PARTIAL upsert: only the fields present in
// the request body are updated. The frontend fires separate .upsert() calls
// for the background, the theme toggle and the CSS editors — a naive
// full-row upsert would NULL-out every omitted column on each toggle,
// silently destroying the profile styling. All user-supplied CSS/background/
// theme values are sanitized here, before they reach the DB.
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

// afterWallPostWrite carries every side effect of a wall-post write: the
// wall-list / feed / cascade cache invalidations the generic invalidation
// cannot express, the wall_post notification, the WebSocket broadcast and the
// author's unified profile stats.
func afterWallPostWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	ownerID := crud.WallResultString(result["user_id"])
	switch method {
	case "POST":
		if ownerID != "" && h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, ownerID)
			// A new wall post is a candidate for the unified feed.
			cache.InvalidateCacheForFeed(h.redis)
		}
		// Wall notification: someone else posted on this wall.
		authorID := crud.WallResultString(result["author_id"])
		if ownerID != "" && authorID != "" && ownerID != authorID {
			postID := crud.WallResultString(result["id"])
			msg := textutil.TruncateRunes(crud.WallResultString(result["content"]), 100)
			h.createWallNotification(c, ownerID, authorID, "wall_post", msg, profiles.UsernameByID(h.db, authorID), crud.WallIDPtr(postID), nil, crud.WallIDPtr(ownerID))
		}
		if h.hub != nil {
			h.publishWallPostEvent(c, "new", result)
		}
		// Unified profile stats: wall content contributes to the AUTHOR's
		// counters (a post written on someone else's wall counts for the author).
		if uid := rowUserID(result["author_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(h.db, uid)
		}
	case "PUT":
		if ownerID != "" && h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, ownerID)
		}
		if h.hub != nil {
			h.publishWallPostEvent(c, "update", result)
		}
	case "DELETE":
		if ownerID != "" && h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, ownerID)
		}
		// Cascade: invalidate comments, likes and reposts of the deleted post.
		if postID := crud.WallResultString(result["id"]); postID != "" && h.redis != nil {
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
		if uid := rowUserID(result["author_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(h.db, uid)
		}
	}
}

// publishWallPostEvent enriches the written row with author data and
// broadcasts the new/update event to the wall rooms.
func (h *Engine) publishWallPostEvent(c *gin.Context, op string, result map[string]interface{}) {
	var wsPayload map[string]interface{}
	if idStr := fmt.Sprint(result["id"]); idStr != "" {
		if enriched, enrichErr := h.fetchProfileWallPostWithAuthor(idStr, httpx.AuthenticatedUserID(c)); enrichErr == nil && enriched != nil {
			wsPayload = enriched
		} else {
			wsPayload = result
		}
	} else {
		wsPayload = result
	}
	var err error
	if op == "new" {
		err = h.hub.PublishNewWallPost(wsPayload)
	} else {
		err = h.hub.PublishUpdateWallPost(wsPayload)
	}
	if err != nil {
		fmt.Printf("[WebSocket] Error publishing wall post %s event: %v\n", op, err)
	} else {
		fmt.Printf("[WebSocket] Published wall post %s event for post %s\n", op, result["id"])
	}
}

// afterWallCommentWrite carries the comment-write side effects: the post's
// comments list + wall-list cache invalidation, the comment/reply
// notifications and the comment author's unified profile stats.
func afterWallCommentWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	postID, _ := result["post_id"].(string)
	if method == "POST" {
		if postID != "" && h.redis != nil {
			commentID, _ := result["id"].(string)
			cache.InvalidateCacheForWallComment(h.redis, commentID, postID)
			h.invalidateWallListCache(c, postID)
		}
		// Wall notifications: comment → post author; reply → parent comment author.
		h.notifyWallComment(c, result)
		if uid := rowUserID(result["user_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(h.db, uid)
		}
		return
	}
	// PUT / DELETE: the comments list of the touched post changed.
	if postID != "" && h.redis != nil {
		commentID, _ := result["id"].(string)
		cache.InvalidateCacheForWallComment(h.redis, commentID, postID)
		h.invalidateWallListCache(c, postID)
	}
}

// afterWallRepostWrite invalidates the original post and the reposter's wall
// list, and notifies the original post's author.
func afterWallRepostWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	switch method {
	case "POST":
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			cache.InvalidateCacheForWallPost(h.redis, postID, "")
			h.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, userID)
		}
		// Wall notification: the original post's author gets a repost notice.
		h.notifyWallRepost(c, result)
	case "DELETE":
		if postID, ok := result["post_id"].(string); ok && h.redis != nil {
			cache.InvalidateCacheForWallPost(h.redis, postID, "")
			h.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && h.redis != nil {
			cache.InvalidateCacheForProfileWall(h.redis, userID)
		}
	}
}

// afterWallCommentLikeWrite clears the caches embedding comment like counts
// and refreshes the unified stats of the comment author and the liker.
func afterWallCommentLikeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	commentID, ok := result["comment_id"].(string)
	if !ok {
		return
	}
	if method != "PUT" {
		h.invalidateCommentLikesCache(c, commentID)
	}
	if method == "DELETE" || method == "POST" {
		h.recomputeStatsForWallCommentLike(c, commentID, rowUserID(result["user_id"]))
	}
}

// afterWallPostLikeWrite refreshes the unified stats of the post author and
// the liker; on a genuinely NEW like (xmax = 0) it also notifies the author.
// DELETE additionally clears the like-list caches (the registry invalidation
// hook covers the standalone post page, list patterns and the feed).
func afterWallPostLikeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	postID, ok := result["post_id"].(string)
	if !ok {
		return
	}
	likerID := rowUserID(result["user_id"])
	switch method {
	case "POST":
		h.recomputeStatsForWallPostLike(c, postID, likerID)
		if inserted, _ := result["inserted"].(bool); inserted {
			h.notifyWallPostLike(c, postID, crud.WallResultString(result["user_id"]))
		}
	case "DELETE":
		if h.redis != nil {
			cache.InvalidateCacheForWallPost(h.redis, postID, "")
			cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
			cache.InvalidateByPattern(h.redis, "data:/api/v1/profile_wall_post_likes*")
			h.invalidateWallListCache(c, postID)
		}
		h.recomputeStatsForWallPostLike(c, postID, likerID)
	}
}

// afterUserSessionTimeWrite keeps the unified profile stats in sync when
// session minutes accumulate via upsert or are corrected via PUT.
func afterUserSessionTimeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	if uid := rowUserID(result["user_id"]); uid != "" {
		profiles.RecomputeUserProfileStats(h.db, uid)
	}
}

// afterPrivacySettingsWrite tears down live WebSocket subscriptions when a
// privacy_settings write restricts previously-public content (see
// revokeSubscriptionsAfterPrivacyChange).
func afterPrivacySettingsWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.revokeSubscriptionsAfterPrivacyChange("privacy_settings", result)
}
