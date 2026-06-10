package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// AuthRateLimiter implements Redis-backed rate limiting for auth endpoints.
// Uses a fixed-window counter per key. Distributed across all server instances.
type AuthRateLimiter struct {
	redis       *redis.Client
	maxRequests int
	window      time.Duration
}

// NewAuthRateLimiter creates a new Redis-backed rate limiter for auth endpoints.
func NewAuthRateLimiter(redisClient *redis.Client, maxRequests int, window time.Duration) *AuthRateLimiter {
	return &AuthRateLimiter{
		redis:       redisClient,
		maxRequests: maxRequests,
		window:      window,
	}
}

// Allow checks if a user is allowed to make a request.
// Uses Redis INCR with TTL for distributed rate limiting.
func (rl *AuthRateLimiter) Allow(userID string) bool {
	if rl.redis == nil {
		return true // no Redis, allow all (fail open)
	}

	if rl.maxRequests <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("ratelimit:auth:%s", userID)

	// INCR atomically increments and returns the new value
	count, err := rl.redis.Incr(ctx, key).Result()
	if err != nil {
		return true // fail open on Redis errors
	}

	// Set expiry on first request in the window
	if count == 1 {
		rl.redis.Expire(ctx, key, rl.window)
	}

	return count <= int64(rl.maxRequests)
}

// AuthRateLimitMiddleware applies rate limiting to auth endpoints
func AuthRateLimitMiddleware(limiter *AuthRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get user ID from claims (must be called after auth middleware)
		claimsInterface, exists := c.Get("claims")
		if !exists {
			// No claims, let auth middleware handle it
			c.Next()
			return
		}

		// Extract user ID from claims
		var userID string
		if claims, ok := claimsInterface.(interface{ GetUserID() string }); ok {
			userID = claims.GetUserID()
		} else {
			// Try type assertion to common claim types
			type ClaimsWithUserID interface {
				GetUserID() string
			}
			if claimsTyped, ok := claimsInterface.(ClaimsWithUserID); ok {
				userID = claimsTyped.GetUserID()
			} else {
				// Fallback: use IP address for rate limiting
				userID = c.ClientIP()
			}
		}

		if userID == "" {
			userID = c.ClientIP()
		}

		// Check rate limit
		if !limiter.Allow(userID) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
