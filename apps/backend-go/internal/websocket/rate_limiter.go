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
	count, err := rl.redis.Incr(ctx, redisKey).Result()
	if err != nil {
		return true // fail open on Redis errors
	}
	if count == 1 {
		rl.redis.Expire(ctx, redisKey, rl.window)
	}

	return count <= int64(rl.maxMessages)
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
