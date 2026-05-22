package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// OAuthRateLimiter implements rate limiting for OAuth endpoints (token, revoke).
// Keyed by client IP since OAuth endpoints don't always carry a user identity.
type OAuthRateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*oauthTokenBucket
	// Maximum requests per window
	maxToken  int
	maxRevoke int
	// Time window duration
	window time.Duration
}

type oauthTokenBucket struct {
	tokens     int
	lastRefill time.Time
}

// NewOAuthRateLimiter creates a new rate limiter for OAuth endpoints.
// tokenPerWindow: max requests to /oauth/token per window.
// revokePerWindow: max requests to /oauth/revoke per window.
// window: time window for the limits.
func NewOAuthRateLimiter(tokenPerWindow, revokePerWindow int, window time.Duration) *OAuthRateLimiter {
	rl := &OAuthRateLimiter{
		buckets:    make(map[string]*oauthTokenBucket),
		maxToken:   tokenPerWindow,
		maxRevoke:  revokePerWindow,
		window:     window,
	}

	go rl.cleanup()

	return rl
}

// AllowToken checks if a request to /oauth/token is allowed.
func (rl *OAuthRateLimiter) AllowToken(key string) bool {
	return rl.allow(key, rl.maxToken)
}

// AllowRevoke checks if a request to /oauth/revoke is allowed.
func (rl *OAuthRateLimiter) AllowRevoke(key string) bool {
	return rl.allow(key, rl.maxRevoke)
}

func (rl *OAuthRateLimiter) allow(key string, max int) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[key]

	if !exists {
		rl.buckets[key] = &oauthTokenBucket{
			tokens:     max - 1,
			lastRefill: now,
		}
		return true
	}

	elapsed := now.Sub(bucket.lastRefill)
	if elapsed >= rl.window {
		bucket.tokens = max - 1
		bucket.lastRefill = now
		return true
	}

	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}

	return false
}

func (rl *OAuthRateLimiter) cleanup() {
	ticker := time.NewTicker(rl.window * 2)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		cutoff := now.Add(-rl.window * 2)
		for key, bucket := range rl.buckets {
			if bucket.lastRefill.Before(cutoff) {
				delete(rl.buckets, key)
			}
		}
		rl.mu.Unlock()
	}
}

// resolveKey extracts a rate-limit key from the request context.
// Prefers user ID if available (from auth middleware), otherwise falls back to client IP.
// OAuth token/revoke endpoints don't carry auth claims, so IP is the primary key.
func resolveKey(c *gin.Context) string {
	// Try auth claims first
	claimsInterface, exists := c.Get("claims")
	if exists {
		if claims, ok := claimsInterface.(interface{ GetUserID() string }); ok {
			if uid := claims.GetUserID(); uid != "" {
				return "user:" + uid
			}
		}
	}

	// Fallback to IP
	return "ip:" + c.ClientIP()
}

// OAuthTokenRateLimitMiddleware applies rate limiting to /oauth/token.
func OAuthTokenRateLimitMiddleware(limiter *OAuthRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := resolveKey(c)
		if !limiter.AllowToken(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":             "invalid_request",
				"error_description": "Rate limit exceeded. Too many token requests. Please wait before retrying.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}

// OAuthRevokeRateLimitMiddleware applies rate limiting to /oauth/revoke.
func OAuthRevokeRateLimitMiddleware(limiter *OAuthRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := resolveKey(c)
		if !limiter.AllowRevoke(key) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":             "invalid_request",
				"error_description": "Rate limit exceeded. Too many revocation requests. Please wait before retrying.",
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
