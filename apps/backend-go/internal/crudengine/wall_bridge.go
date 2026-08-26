package crudengine

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/wall"
)

// ─── Wall delegation bridge ─────────────────────────────────────────────────
//
// The profile-wall subsystem lives in the internal/wall domain package. The
// engine keeps its registry and its HTTP entry points, so every wall-facing
// hook here is a thin forwarder to the injected *wall.Service (SetWall).
// These names are what table_registry.go references; the actual wall logic is
// no longer in this package, and the engine picks up a new wall capability
// only by wiring the service. Nil safety: every forwarder must tolerate a nil
// h.wall (tests / degraded deployments) — the target methods are nil-safe
// themselves, and the generic dispatchers guard the enrichment/privacy paths.

// ReadHandler overrides (specialized wall queries).
func (h *Engine) handleProfileWallPostsGet(c *gin.Context)        { h.wall.HandlePostsGet(c) }
func (h *Engine) handleProfileWallPostCommentsGet(c *gin.Context) { h.wall.HandlePostCommentsGet(c) }

// AfterWrite hooks (notifications, WebSocket, stats, dependent caches).
func afterWallPostWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.wall.AfterPostWrite(c, method, result)
}

func afterWallCommentWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.wall.AfterCommentWrite(c, method, result)
}

func afterWallRepostWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.wall.AfterRepostWrite(c, method, result)
}

func afterWallCommentLikeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.wall.AfterCommentLikeWrite(c, method, result)
}

func afterWallPostLikeWrite(h *Engine, c *gin.Context, method string, result map[string]interface{}) {
	h.wall.AfterPostLikeWrite(c, method, result)
}

// InvalidateCache hooks.
func invalidateProfileWallPostsCache(h *Engine, c *gin.Context, result map[string]interface{}) {
	h.wall.InvalidatePostsCache(c, result)
}

func invalidateProfileWallPostCommentsCache(h *Engine, c *gin.Context, result map[string]interface{}) {
	h.wall.InvalidatePostCommentsCache(c, result)
}

func invalidateProfileWallPostLikesCache(h *Engine, c *gin.Context, result map[string]interface{}) {
	h.wall.InvalidatePostLikesCache(c, result)
}

// Achievement hooks.
func emitProfileWallPostsAchievements(h *Engine, result map[string]interface{}) {
	h.wall.EmitPostsAchievements(result)
}

func emitProfileWallPostCommentsAchievements(h *Engine, result map[string]interface{}) {
	h.wall.EmitPostCommentsAchievements(result)
}

func emitProfileWallPostLikesAchievements(h *Engine, result map[string]interface{}) {
	h.wall.EmitPostLikesAchievements(result)
}

func emitProfileWallCommentLikesAchievements(h *Engine, result map[string]interface{}) {
	h.wall.EmitCommentLikesAchievements(result)
}

func emitProfileWallPostRepostsAchievements(h *Engine, result map[string]interface{}) {
	h.wall.EmitPostRepostsAchievements(result)
}

// PrepareBody hooks.
func prepareWallPostBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	return h.wall.PreparePostBody(c, tableName, method, data)
}

func prepareWallCommentBody(h *Engine, c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	return h.wall.PrepareCommentBody(c, tableName, method, data)
}

// Upsert statement builder.
func upsertProfileWallPostLikes(data map[string]interface{}) (query string, args []interface{}, ok bool) {
	return wall.UpsertPostLikes(data)
}
