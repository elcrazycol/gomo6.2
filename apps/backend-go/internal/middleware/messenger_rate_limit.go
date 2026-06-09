package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// MessengerRateLimiter implements per-user rate limiting for messenger endpoints.
// Uses token bucket algorithm with per-user buckets.
type MessengerRateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*tokenBucket
	// Maximum requests per window
	maxRequests int
	// Time window duration
	window time.Duration
}

type tokenBucket struct {
	tokens     int
	lastRefill time.Time
}

// NewMessengerRateLimiter creates a new rate limiter for messenger endpoints.
// Typical values: 120 messages per minute for sends, higher for reads.
func NewMessengerRateLimiter(maxRequests int, window time.Duration) *MessengerRateLimiter {
	rl := &MessengerRateLimiter{
		buckets:     make(map[string]*tokenBucket),
		maxRequests: maxRequests,
		window:      window,
	}
	go rl.cleanup()
	return rl
}

func (rl *MessengerRateLimiter) Allow(userID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[userID]

	if !exists {
		rl.buckets[userID] = &tokenBucket{
			tokens:     rl.maxRequests - 1,
			lastRefill: now,
		}
		return true
	}

	elapsed := now.Sub(bucket.lastRefill)
	if elapsed >= rl.window {
		bucket.tokens = rl.maxRequests - 1
		bucket.lastRefill = now
		return true
	}

	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}

	return false
}

func (rl *MessengerRateLimiter) cleanup() {
	ticker := time.NewTicker(rl.window * 2)
	defer ticker.Stop()
	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for userID, bucket := range rl.buckets {
			if now.Sub(bucket.lastRefill) > rl.window*2 {
				delete(rl.buckets, userID)
			}
		}
		rl.mu.Unlock()
	}
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
		// Directly type-assert to *auth.Claims — the only type stored in context.
		// Fall back to IP if claims type is unexpected.
		if claims, ok := claimsInterface.(interface{ GetUserID() string }); ok {
			userID = claims.GetUserID()
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
