package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// presenceThrottle rate-limits presence touches per user so a chatty client
// cannot turn last_seen updates into a Redis write on every request.
type presenceThrottle struct {
	mu   sync.Mutex
	last map[string]time.Time
}

func newPresenceThrottle() *presenceThrottle {
	return &presenceThrottle{last: make(map[string]time.Time)}
}

func (t *presenceThrottle) allow(userID string, every time.Duration) bool {
	now := time.Now()
	t.mu.Lock()
	defer t.mu.Unlock()
	if last, ok := t.last[userID]; ok && now.Sub(last) < every {
		return false
	}
	t.last[userID] = now
	// Opportunistically bound the map: entries older than 10 minutes are
	// dropped once the map grows past a threshold, so a long-running process
	// never accumulates one entry per historical user.
	if len(t.last) > 10_000 {
		for id, ts := range t.last {
			if now.Sub(ts) > 10*time.Minute {
				delete(t.last, id)
			}
		}
	}
	return true
}

// PresenceActivity refreshes the authenticated user's presence marker on
// requests that carry an identity (claims set by OptionalAuthMiddleware /
// AuthMiddleware). last_seen therefore tracks real activity, not just the
// WebSocket connection. Touches are throttled to once per user per `every`.
// A nil touch function makes the middleware a no-op.
func PresenceActivity(touch func(userID string), every time.Duration) gin.HandlerFunc {
	if touch == nil || every <= 0 {
		return func(c *gin.Context) { c.Next() }
	}
	throttle := newPresenceThrottle()
	return func(c *gin.Context) {
		if claimsValue, exists := c.Get("claims"); exists {
			if claims, ok := claimsValue.(*auth.Claims); ok && claims != nil && claims.UserID != "" {
				if throttle.allow(claims.UserID, every) {
					touch(claims.UserID)
				}
			}
		}
		c.Next()
	}
}
