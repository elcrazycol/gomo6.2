package websocket

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// RateLimiter implements Redis-backed fixed-window rate limiting per user for
// WebSocket messages. The budget is shared across all server instances (the
// previous in-memory token bucket was per-process only).
type RateLimiter struct {
	redis       *redis.Client
	maxMessages int
	window      time.Duration
}

// NewRateLimiter creates a new Redis-backed rate limiter.
// maxMessages: maximum number of messages allowed per window
// window: time window for rate limiting (e.g., 1 minute)
func NewRateLimiter(redisClient *redis.Client, maxMessages int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		redis:       redisClient,
		maxMessages: maxMessages,
		window:      window,
	}
}

// Allow checks if a user is allowed to send a message.
// Uses Redis INCR with TTL for a distributed fixed window. Fails open
// (allows) when Redis is unavailable, matching the middleware limiters.
func (rl *RateLimiter) Allow(key string) bool {
	if rl.redis == nil {
		return true // no Redis, allow all (fail open)
	}
	if rl.maxMessages <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	redisKey := fmt.Sprintf("ratelimit:ws:%s", key)

	// INCR + EXPIRE atomically in one Lua script so a lost TTL can never leave
	// a permanently-stuck counter (a key without a TTL grows forever and would
	// lock the user out until the key is manually deleted).
	count, err := incrWithTTLRedis(ctx, rl.redis, redisKey, rl.window)
	if err != nil {
		return true // fail open on Redis errors
	}

	return count <= int64(rl.maxMessages)
}

// incrWithTTLRedis atomically increments a fixed-window counter and sets its
// TTL in one Lua script, so a crash or Redis error between the two calls can
// never leave a counter key without a TTL (which would grow forever and
// permanently lock the user out once it crosses the budget).
func incrWithTTLRedis(ctx context.Context, rdb *redis.Client, key string, window time.Duration) (int64, error) {
	script := redis.NewScript(`
local c = redis.call('INCR', KEYS[1])
if c == 1 or redis.call('TTL', KEYS[1]) < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`)
	return script.Run(ctx, rdb, []string{key}, int64(window.Seconds())).Int64()
}

// Reset clears the rate limit for a specific user.
func (rl *RateLimiter) Reset(key string) {
	if rl.redis == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	rl.redis.Del(ctx, fmt.Sprintf("ratelimit:ws:%s", key))
}
