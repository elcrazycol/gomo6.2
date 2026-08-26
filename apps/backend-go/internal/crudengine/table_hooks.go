package crudengine

import (
	"fmt"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/profiles"
)

// ─── Table Write Hooks ──────────────────────────────────────────────────────
//
// Per-table side effects of generic CRUD writes, referenced from the table
// registry (table_registry.go) via TableMeta.InvalidateCache and
// TableMeta.EmitAchievements. The registry is the single source of truth: a
// table's cache invalidation and achievement events are declared on its
// entry, so adding a table means adding ONE entry — the old design kept these
// behaviors in switch statements (invalidateCacheForTableResult /
// emitAchievementEvents) that had to be kept in sync with the
// registry by hand, and a forgotten case silently served stale data.
//
// Hooks live in this file so the registry stays declarative while the logic
// is only reachable through a registry entry. Hooks must be safe to call with
// nil h.redis / nil h.achEngine: the dispatchers guard those before invoking.
//
// The profile-wall hooks (invalidation, achievement events, AfterWrite,
// PrepareBody, the wall read overrides) are no longer implemented here — they
// forward to the injected wall domain service via the delegation bridge
// (wall_bridge.go).

// ─── Cache invalidation hooks ───────────────────────────────────────────────

// invalidateMyEmojiLists clears the cached /my-emoji-subscriptions and
// /my-emoji-packs responses. Those handlers embed pack metadata, emoji counts
// and the full emoji lists, so any emoji-pack write must invalidate them too,
// otherwise the data cache keeps serving the pre-change list for the whole
// TTL (a freshly installed pack was invisible for up to 2 minutes — the "pack
// appears with a delay" bug).
func invalidateMyEmojiLists(h *Engine) {
	cache.InvalidateByPattern(h.redis, "data:/api/v1/my-emoji-subscriptions*")
	cache.InvalidateByPattern(h.redis, "data:/api/v1/my-emoji-packs*")
}

// invalidateEmojiPacksCache clears every response embedding emoji pack data.
func invalidateEmojiPacksCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
	cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
	invalidateMyEmojiLists(h)
}

// invalidateCustomEmojisCache clears emoji responses and the pack lists they
// are grouped under (custom emojis never exist without their pack).
func invalidateCustomEmojisCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	cache.InvalidateByPattern(h.redis, "data:/api/v1/custom_emojis*")
	cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
	cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs/by-slug*")
	invalidateMyEmojiLists(h)
}

// invalidateChannelsCache clears the board's channels list.
func invalidateChannelsCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	boardID := crud.WallResultString(result["board_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/channels*board_id=eq.%s*", boardID))
}

// invalidateGomosubRolesCache clears the board's roles list.
func invalidateGomosubRolesCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	boardID := crud.WallResultString(result["board_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_roles*board_id=eq.%s*", boardID))
}

// invalidateChannelPermissionsCache clears the channel's permission list.
func invalidateChannelPermissionsCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	channelID := crud.WallResultString(result["channel_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/channel_permissions*channel_id=eq.%s*", channelID))
}

// invalidateGomosubMembershipsCache clears the board's memberships list.
func invalidateGomosubMembershipsCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	boardID := crud.WallResultString(result["board_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_memberships*board_id=eq.%s*", boardID))
}

// invalidateProfileCustomizationCache clears the profile's customization keys
// and the hover-card / profiles responses that embed them.
func invalidateProfileCustomizationCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	userID := crud.WallResultString(result["user_id"])
	if userID == "" {
		return
	}
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=eq.%s*", userID))
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_customization*user_id=%s*", userID))
	// Also invalidate profile hover card cache (contains customization)
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
}

// invalidatePrivacySettingsCache clears the privacy keys and every response
// whose visibility depends on them (profiles, walls, friends, the public
// visibility-flags endpoint).
func invalidatePrivacySettingsCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	userID := crud.WallResultString(result["user_id"])
	if userID == "" {
		return
	}
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/privacy_settings*user_id=eq.%s*", userID))
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profiles*id=eq.%s*", userID))
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/profile_wall_posts*user_id=eq.%s*", userID))
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/friends*user_id=%s*", userID))
	// The public visibility-flags endpoint (GET /api/v1/users/:id/privacy)
	// caches per viewer under data:/api/v1/users/<id>/privacy?|viewer=… —
	// without this, a settings change would keep serving stale hide flags
	// (tabs that were just unhidden stay missing for the cache TTL).
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/users/%s/privacy*", userID))
}

// invalidateUserEmojiSubscriptionsCache clears the caller's subscription list
// plus the pack lists whose counts it embeds.
func invalidateUserEmojiSubscriptionsCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	userID := crud.WallResultString(result["user_id"])
	if userID != "" {
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_emoji_subscriptions*user_id=eq.%s*", userID))
	}
	cache.InvalidateByPattern(h.redis, "data:/api/v1/emoji_packs*")
	invalidateMyEmojiLists(h)
}

// invalidateGomosubRulesAcceptanceCache clears the rules-acceptance keys so a
// freshly accepted rules dialog does not re-appear from cache.
func invalidateGomosubRulesAcceptanceCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	uid := fmt.Sprint(result["user_id"])
	bid := fmt.Sprint(result["board_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_rules_acceptance*user_id=eq.%s*", uid))
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/gomosub_rules_acceptance*board_id=eq.%s*", bid))
	cache.InvalidateByPattern(h.redis, "data:/api/v1/gomosub_rules_acceptance?*")
}

// invalidateUserTermsAcceptanceCache clears the terms-acceptance keys so a
// freshly accepted TermsOfService does not re-appear from cache.
func invalidateUserTermsAcceptanceCache(h *Engine, _ *gin.Context, result map[string]interface{}) {
	uid := fmt.Sprint(result["user_id"])
	cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/user_terms_acceptance*user_id=eq.%s*", uid))
	cache.InvalidateByPattern(h.redis, "data:/api/v1/user_terms_acceptance?*")
}

// ─── Achievement hooks ──────────────────────────────────────────────────────
//
// Fired by emitAchievementEvents on the INSERT and upsert write
// paths. The unified content model: записи = threads + profile_wall_posts (by
// author_id — a post on someone else's wall counts for the AUTHOR), comments =
// posts + wall comments, likes = all four like tables. Threads/posts/boards
// are NOT reachable through the generic CRUD surface (they have dedicated
// handlers that emit through their RPC paths), so they carry no hooks here.
// The wall-table emitters live in the wall domain service (wall_bridge.go).

func emitUserDailyVisitsAchievements(h *Engine, result map[string]interface{}) {
	e := h.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievement(e, uid, achievements.EventDailyVisit)
	}
}

func emitGomosubMembershipsAchievements(h *Engine, result map[string]interface{}) {
	e := h.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievement(e, uid, achievements.EventSubJoined)
	}
}

func emitGomosubRulesAcceptanceAchievements(h *Engine, result map[string]interface{}) {
	e := h.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievement(e, uid, achievements.EventSubRulesAccepted)
	}
}

func emitProfileCustomizationAchievements(h *Engine, result map[string]interface{}) {
	e := h.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievement(e, uid, achievements.EventProfileStyled)
	}
}
