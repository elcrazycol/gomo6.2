package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// MessengerRateLimiter implements Redis-backed per-user rate limiting for
// messenger endpoints. Uses a fixed-window INCR counter per key so the budget
// is shared across all server instances (the previous in-memory token bucket
// was per-process and could be bypassed by spreading requests over replicas).
type MessengerRateLimiter struct {
	redis       *redis.Client
	maxRequests int
	window      time.Duration
}

// NewMessengerRateLimiter creates a new Redis-backed rate limiter.
// Typical values: 300 per minute for reads, 120 per minute for writes.
func NewMessengerRateLimiter(redisClient *redis.Client, maxRequests int, window time.Duration) *MessengerRateLimiter {
	return &MessengerRateLimiter{
		redis:       redisClient,
		maxRequests: maxRequests,
		window:      window,
	}
}

// Allow checks if a request is allowed. Uses Redis INCR with TTL for a
// distributed fixed window. Fails open (allows) when Redis is unavailable,
// matching the other Redis-backed limiters in this package.
func (rl *MessengerRateLimiter) Allow(key string) bool {
	if rl.redis == nil {
		return true // no Redis, allow all (fail open)
	}
	if rl.maxRequests <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	redisKey := fmt.Sprintf("ratelimit:messenger:%s", key)

	// INCR + EXPIRE atomically in one Lua script so a lost TTL can never leave
	// a permanently-stuck counter (see incrWithTTL).
	count, err := incrWithTTL(ctx, rl.redis, redisKey, rl.window)
	if err != nil {
		return true // fail open on Redis errors
	}

	return count <= int64(rl.maxRequests)
}

// MessengerRateLimitMiddleware applies rate limiting to messenger endpoints.
// Extracts user ID from claims (must be called after auth middleware).
func MessengerRateLimitMiddleware(limiter *MessengerRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsInterface, exists := c.Get("claims")
		if !exists {
			c.Next()
			return
		}

		var userID string
		if claims, ok := claimsInterface.(*auth.Claims); ok && claims.UserID != "" {
			userID = claims.UserID
		} else {
			userID = c.ClientIP()
		}

		if userID == "" {
			userID = c.ClientIP()
		}

		if !limiter.Allow(userID) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please slow down.",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
