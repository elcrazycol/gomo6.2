package crudengine

// emitAchievementEvents fires the achievement events implied by a
// generic CRUD write. It runs on both the upsert and the INSERT write paths.
// Which tables emit events is declared in the table registry
// (TableMeta.EmitAchievements, implemented in table_hooks.go and, for the
// wall tables, delegated to the wall domain service via wall_bridge.go);
// tables without a hook emit nothing.
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
