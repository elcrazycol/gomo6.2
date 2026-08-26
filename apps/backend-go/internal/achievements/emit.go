package achievements

// EmitAchievement schedules an achievement event for a user. It is async and
// best-effort: the engine logs and swallows its own errors, so an emission can
// never break the action that triggered it. Empty user IDs are no-ops.
func EmitAchievement(e *Engine, userID string, evt EventType) {
	if e == nil || userID == "" {
		return
	}
	go e.HandleEvent(Event{UserID: userID, Type: evt})
}
