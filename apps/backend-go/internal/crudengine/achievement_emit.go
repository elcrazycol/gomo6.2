package crudengine

import (
	"github.com/gomo6/backend/internal/crud"
)

// emitAchievementEvents fires the achievement events implied by a
// generic CRUD write. It runs on both the upsert and the INSERT write paths.
// Which tables emit events is declared in the table registry
// (TableMeta.EmitAchievements, implemented in table_hooks.go); tables without
// a hook emit nothing.
//
// The unified content model: записи = threads + profile_wall_posts (by
// author_id — a post on someone else's wall counts for the AUTHOR), comments =
// posts + wall comments, likes = all four like tables. Threads/posts/boards
// are NOT reachable through the generic CRUD surface (they have dedicated
// handlers that emit through their RPC paths — CreateThreadRPC /
// CreatePostRPC / CreateGomoSub), so they carry no hooks.
func (h *Engine) emitAchievementEvents(tableName string, result map[string]interface{}) {
	e := h.achEngine
	if e == nil {
		return
	}
	if meta := GenericTableByName(tableName); meta != nil && meta.EmitAchievements != nil {
		meta.EmitAchievements(h, result)
	}
}

// wallPostHasImage reports whether a wall-post write carries an image
// (image_url set, or a non-empty attachments JSONB array).
func wallPostHasImage(result map[string]interface{}) bool {
	if s := crud.WallResultString(result["image_url"]); s != "" {
		return true
	}
	if v, ok := result["attachments"]; ok {
		if b, ok2 := v.([]byte); ok2 && len(b) > 2 {
			// "[]" is exactly 2 bytes; anything longer is a non-empty array.
			return true
		}
	}
	return false
}
