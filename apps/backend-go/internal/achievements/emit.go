package achievements

import "github.com/gomo6/backend/internal/bg"

// emitPool runs achievement processing off the request path. Deliberately a
// bounded pool, not `go HandleEvent(...)`: one goroutine per emitted event (a
// like flood, a reconnect storm) is unbounded and each can hold a DB connection,
// which is exactly what bg.Pool exists to prevent. When the queue is full the
// event is dropped and counted — an achievement event is safe to drop, the next
// action re-emits and counters are reconciled from live data anyway.
var emitPool = bg.New("achievements", 4, 4096)

// EmitAchievement schedules an achievement event for a user. It is async and
// best-effort: the engine logs and swallows its own errors, so an emission can
// never break the action that triggered it. Empty user IDs are no-ops.
func EmitAchievement(e *Engine, userID string, evt EventType) {
	EmitAchievementTarget(e, userID, evt, "", "")
}

// EmitAchievementTarget is EmitAchievement with the object the action touched.
// The target is carried into the activity ledger for moderation ("what did
// user X do"), so call sites should pass the post/thread/comment id they
// already have at hand. targetID must be a UUID string or "".
func EmitAchievementTarget(e *Engine, userID string, evt EventType, targetType, targetID string) {
	if e == nil || userID == "" {
		return
	}
	emitPool.Go(func() {
		e.HandleEvent(Event{UserID: userID, Type: evt, TargetType: targetType, TargetID: targetID})
	})
}
