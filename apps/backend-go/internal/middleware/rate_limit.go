package middleware

import (
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"golang.org/x/time/rate"
)

// RateLimiterConfig holds rate limiting configuration
type RateLimiterConfig struct {
	RequestsPerSecond float64
	BurstSize         int
	KeyPrefix         string
	SkipFailedRequests bool
}

// DefaultRateLimitConfigs defines rate limits for different endpoint categories
var DefaultRateLimitConfigs = map[string]RateLimiterConfig{
	"api": {
		RequestsPerSecond: 10,
		BurstSize:         20,
		KeyPrefix:         "rl:api:",
	},
	"auth": {
		RequestsPerSecond: 5,
		BurstSize:         10,
		KeyPrefix:         "rl:auth:",
	},
	"messenger": {
		RequestsPerSecond: 30,
		BurstSize:         50,
		KeyPrefix:         "rl:msg:",
	},
	"upload": {
		RequestsPerSecond: 2,
		BurstSize:         5,
		KeyPrefix:         "rl:upload:",
	},
	"rpc": {
		RequestsPerSecond: 20,
		BurstSize:         40,
		KeyPrefix:         "rl:rpc:",
	},
}

// RedisRateLimiter implements rate limiting using Redis
type RedisRateLimiter struct {
	redis  *redis.Client
	config RateLimiterConfig
}

// NewRedisRateLimiter creates a new Redis-based rate limiter
func NewRedisRateLimiter(redisClient *redis.Client, config RateLimiterConfig) *RedisRateLimiter {
	return &RedisRateLimiter{
		redis:  redisClient,
		config: config,
	}
}

// Allow checks if a request is allowed and returns remaining requests and reset time
func (rl *RedisRateLimiter) Allow(key string) (allowed bool, remaining int, resetAt int64) {
	ctx := rl.redis.Context()
	now := time.Now()
	windowEnd := now.Add(time.Second).Unix()

	// Use Redis INCR with EXPIRE for simple rate limiting
	redisKey := rl.config.KeyPrefix + key

	// Increment counter
	val, err := rl.redis.Incr(ctx, redisKey).Result()
	if err != nil {
		// If Redis fails, allow the request (fail open)
		return true, 0, 0
	}

	// Set expiry on first request
	if val == 1 {
		rl.redis.Expire(ctx, redisKey, time.Second)
	}

	// Calculate remaining
	remaining = int(float64(rl.config.BurstSize) - val)
	if remaining < 0 {
		remaining = 0
	}

	resetAt = windowEnd

	// Check if within burst limit
	if val <= int64(rl.config.BurstSize) {
		return true, remaining, resetAt
	}

	return false, 0, resetAt
}

// RateLimitMiddleware creates a rate limiting middleware for a specific category
func RateLimitMiddleware(category string, redisClient *redis.Client) gin.HandlerFunc {
	config, exists := DefaultRateLimitConfigs[category]
	if !exists {
		config = DefaultRateLimitConfigs["api"]
	}

	limiter := NewRedisRateLimiter(redisClient, config)

	return func(c *gin.Context) {
		// Get client identifier (user ID or IP)
		clientID := c.ClientIP()

		// Try to get user ID from context if authenticated
		if claimsInterface, exists := c.Get("claims"); exists {
			if claims, ok := claimsInterface.(interface{ GetUserID() string }); ok {
				if userID := claims.GetUserID(); userID != "" {
					clientID = userID
				}
			}
		}

		allowed, remaining, resetAt := limiter.Allow(clientID)

		// Set rate limit headers
		c.Header("X-RateLimit-Limit", strconv.Itoa(config.BurstSize))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))
		c.Header("X-RateLimit-Reset", strconv.FormatInt(resetAt, 10))

		if !allowed {
			c.Header("Retry-After", strconv.FormatInt(resetAt-time.Now().Unix(), 10))
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":         "Too many requests",
				"retry_after":   resetAt - time.Now().Unix(),
				"rate_limit":    config.BurstSize,
				"rate_remaining": remaining,
			})
			c.Abort()
			return
		}

		c.Next()
	}
}

// GlobalRateLimiter for in-memory fallback
type GlobalRateLimiter struct {
	limiters map[string]*rate.Limiter
	config   RateLimiterConfig
}

// NewGlobalRateLimiter creates an in-memory rate limiter (fallback when Redis unavailable)
func NewGlobalRateLimiter(config RateLimiterConfig) *GlobalRateLimiter {
	return &GlobalRateLimiter{
		limiters: make(map[string]*rate.Limiter),
		config:   config,
	}
}

// Allow checks if request is allowed
func (rl *GlobalRateLimiter) Allow(key string) bool {
	limiter, exists := rl.limiters[key]
	if !exists {
		limiter = rate.NewLimiter(rate.Limit(rl.config.RequestsPerSecond), rl.config.BurstSize)
		rl.limiters[key] = limiter
	}
	return limiter.Allow()
}
