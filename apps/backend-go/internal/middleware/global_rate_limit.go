package middleware

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

type GlobalRateLimiter struct {
	redis       *redis.Client
	maxRequests int
	window      time.Duration
}

func NewGlobalRateLimiter(redisClient *redis.Client, maxRequests int, window time.Duration) *GlobalRateLimiter {
	return &GlobalRateLimiter{
		redis:       redisClient,
		maxRequests: maxRequests,
		window:      window,
	}
}

func (rl *GlobalRateLimiter) Allow(key string) bool {
	if rl.redis == nil {
		return true
	}
	if rl.maxRequests <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	k := fmt.Sprintf("ratelimit:global:%s", key)

	count, err := rl.redis.Incr(ctx, k).Result()
	if err != nil {
		return true
	}

	if count == 1 {
		rl.redis.Expire(ctx, k, rl.window)
	}

	return count <= int64(rl.maxRequests)
}

func GlobalRateLimitMiddleware(limiter *GlobalRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if !limiter.Allow(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
