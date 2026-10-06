package messenger

import "github.com/gomo6/backend/internal/bg"

// publishPool bounds the best-effort realtime fan-out spawned after a messenger
// write commits: cache invalidation, the WebSocket publish and the Web Push
// delivery. Without it a message flood (or a mass retry) spawns three goroutines
// per message, each doing Redis/DB/HTTP work. Delivery is best-effort: a full
// queue drops the task (the client refetches on the next event) instead of
// piling up goroutines.
var publishPool = bg.New("messenger-publish", 8, 4096)
