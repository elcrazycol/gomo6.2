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
//
// failClosed controls the Redis-down behavior: the default (false) is
// fail-open (availability first — search, uploads, generic API). Limiters that
// guard authentication (login, register, 2FA, passkey login) must be
// fail-CLOSED: without Redis there is no distributed budget, and silently
// allowing unlimited password/TOTP guesses is worse than a 503.
type AuthRateLimiter struct {
	redis       *redis.Client
	maxRequests int
	window      time.Duration
	prefix      string
	failClosed  bool
}

// NewAuthRateLimiter creates a new Redis-backed rate limiter for auth endpoints.
func NewAuthRateLimiter(redisClient *redis.Client, maxRequests int, window time.Duration) *AuthRateLimiter {
	return NewAuthRateLimiterWithPrefix("auth", redisClient, maxRequests, window)
}

// NewAuthRateLimiterWithPrefix creates a rate limiter whose Redis keys are
// namespaced under the given prefix. The prefix must be unique per endpoint
// family: every limiter built with NewAuthRateLimiter shares the "auth"
// namespace, so a non-auth limiter (e.g. the IP-keyed /search limiter) must
// use its own prefix — otherwise its INCR would deplete the login/register/
// auth-me budgets of the same IP or user.
func NewAuthRateLimiterWithPrefix(prefix string, redisClient *redis.Client, maxRequests int, window time.Duration) *AuthRateLimiter {
	return &AuthRateLimiter{
		redis:       redisClient,
		maxRequests: maxRequests,
		window:      window,
		prefix:      prefix,
	}
}

// NewStrictAuthRateLimiter creates a fail-CLOSED limiter for authentication
// endpoints. When Redis is unavailable or errors, requests are REJECTED (503)
// instead of allowed: an auth throttle that silently disappears together with
// Redis is not a throttle. Use this for login, register, verify-2fa and
// passkey login.
func NewStrictAuthRateLimiter(redisClient *redis.Client, maxRequests int, window time.Duration) *AuthRateLimiter {
	return NewStrictAuthRateLimiterWithPrefix("auth", redisClient, maxRequests, window)
}

// NewStrictAuthRateLimiterWithPrefix is the namespaced fail-closed variant.
func NewStrictAuthRateLimiterWithPrefix(prefix string, redisClient *redis.Client, maxRequests int, window time.Duration) *AuthRateLimiter {
	return &AuthRateLimiter{
		redis:       redisClient,
		maxRequests: maxRequests,
		window:      window,
		prefix:      prefix,
		failClosed:  true,
	}
}

// Allow checks if a user is allowed to make a request.
// Uses Redis INCR with TTL for distributed rate limiting.
// Without Redis (or on Redis errors) fail-open limiters allow the request,
// while strict (fail-closed) limiters deny it — the caller turns the denial
// into a 503 via Limited().
func (rl *AuthRateLimiter) Allow(userID string) bool {
	if rl.redis == nil {
		return !rl.failClosed
	}

	if rl.maxRequests <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("ratelimit:%s:%s", rl.prefix, userID)

	// INCR + EXPIRE atomically in one Lua script so a lost TTL can never leave
	// a permanently-stuck counter (see incrWithTTL).
	count, err := incrWithTTL(ctx, rl.redis, key, rl.window)
	if err != nil {
		return !rl.failClosed
	}

	return count <= int64(rl.maxRequests)
}

// NoBackend reports whether this limiter has no Redis backend at all, so the
// middleware can answer 503 (dependency down) instead of 429 (budget spent).
func (rl *AuthRateLimiter) NoBackend() bool {
	return rl.redis == nil
}

// AuthRateLimitMiddleware applies rate limiting to auth endpoints.
//
// Pre-auth endpoints (login, register, verify-2fa, passkey login) carry no
// claims — they are keyed by client IP. This used to be a no-op for them
// (missing claims → c.Next()), which silently disabled the login/register
// brute-force budgets. Post-auth endpoints keep the per-user key.
func AuthRateLimitMiddleware(limiter *AuthRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := ""
		// Get user ID from claims (must be called after auth middleware)
		if claimsInterface, exists := c.Get("claims"); exists {
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
			key = "user:" + userID
		} else {
			// Pre-auth request: no identity yet — throttle by IP so the
			// login/register/2FA budgets actually apply.
			key = "ip:" + c.ClientIP()
		}

		// Check rate limit
		if !limiter.Allow(key) {
			if limiter.failClosed && limiter.NoBackend() {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Authentication is temporarily unavailable. Please try again shortly.",
				})
			} else {
				c.JSON(http.StatusTooManyRequests, gin.H{
					"error": "Rate limit exceeded. Please slow down.",
				})
			}
			c.Abort()
			return
		}

		c.Next()
	}
}
