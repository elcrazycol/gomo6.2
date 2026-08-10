package middleware

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// Default rate limits for the generic REST surface:
//   - Per user: generous, because a logged-in user legitimately fires a burst
//     of ~20 requests when a page mounts (profile: roles, achievements, gifts,
//     privacy, customization, RPC counts...). 900/min ≈ 15 pages/min.
//   - Per IP (anonymous): the shared anti-abuse bucket. Unauthenticated traffic
//     cannot be attributed to a person, so everyone on one IP shares it.
const (
	DefaultRateLimitPerUser = 900
	DefaultRateLimitPerIP   = 300
)

// GlobalRateLimiter implements a Redis-backed fixed-window rate limiter for the
// generic REST surface. Authenticated requests are keyed by user ID (each user
// gets its own budget), anonymous requests by IP (a shared bucket).
//
// Both limits are configurable via environment variables so ops can tune
// without a rebuild:
//
//	RATE_LIMIT_PER_USER  (default 900) — authenticated requests per minute
//	RATE_LIMIT_PER_IP    (default 300) — anonymous requests per minute per IP
type GlobalRateLimiter struct {
	redis              *redis.Client
	maxRequestsPerUser int
	maxRequestsPerIP   int
	window             time.Duration
}

func NewGlobalRateLimiter(redisClient *redis.Client, maxRequestsPerUser, maxRequestsPerIP int, window time.Duration) *GlobalRateLimiter {
	return &GlobalRateLimiter{
		redis:              redisClient,
		maxRequestsPerUser: maxRequestsPerUser,
		maxRequestsPerIP:   maxRequestsPerIP,
		window:             window,
	}
}

// NewGlobalRateLimiterFromEnv builds a limiter using the RATE_LIMIT_PER_USER /
// RATE_LIMIT_PER_IP environment variables with sane defaults.
func NewGlobalRateLimiterFromEnv(redisClient *redis.Client, window time.Duration) *GlobalRateLimiter {
	return NewGlobalRateLimiter(
		redisClient,
		envInt("RATE_LIMIT_PER_USER", DefaultRateLimitPerUser),
		envInt("RATE_LIMIT_PER_IP", DefaultRateLimitPerIP),
		window,
	)
}

func envInt(name string, def int) int {
	if v := os.Getenv(name); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

// Allow checks whether the given key may make another request within the
// current window. Fail-open when Redis is unavailable so the API never goes
// down because the limiter store is unreachable.
func (rl *GlobalRateLimiter) Allow(key string, maxRequests int) bool {
	if rl.redis == nil {
		return true
	}
	if maxRequests <= 0 {
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

	return count <= int64(maxRequests)
}

// GlobalRateLimitMiddleware applies rate limiting to REST endpoints.
//
// Ordering requirements (see routes.go):
//   - It MUST run AFTER OptionalAuthMiddleware so authenticated requests are
//     keyed by the caller's user ID instead of sharing a per-IP bucket.
//   - It runs AFTER DataCacheMiddleware: cache hits short-circuit before the
//     limiter, so repeated reads within the cache TTL are free (no rate-limit
//     budget burned, no DB hit) — the limiter only guards cache misses and
//     write requests.
func GlobalRateLimitMiddleware(limiter *GlobalRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := "ip:" + c.ClientIP()
		max := limiter.maxRequestsPerIP
		if claimsValue, ok := c.Get("claims"); ok {
			if claims, ok2 := claimsValue.(*auth.Claims); ok2 && claims != nil && claims.UserID != "" {
				key = "user:" + claims.UserID
				max = limiter.maxRequestsPerUser
			}
		}
		if !limiter.Allow(key, max) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded. Please slow down.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
