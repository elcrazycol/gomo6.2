package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// AuthRateLimiter implements rate limiting for auth endpoints
type AuthRateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*authTokenBucket
	// Maximum requests per window
	maxRequests int
	// Time window duration
	window time.Duration
}

type authTokenBucket struct {
	tokens     int
	lastRefill time.Time
}

// NewAuthRateLimiter creates a new rate limiter for auth endpoints
func NewAuthRateLimiter(maxRequests int, window time.Duration) *AuthRateLimiter {
	rl := &AuthRateLimiter{
		buckets:     make(map[string]*authTokenBucket),
		maxRequests: maxRequests,
		window:      window,
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// Allow checks if a user is allowed to make a request
func (rl *AuthRateLimiter) Allow(userID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[userID]

	if !exists {
		// Create new bucket with full tokens
		rl.buckets[userID] = &authTokenBucket{
			tokens:     rl.maxRequests - 1,
			lastRefill: now,
		}
		return true
	}

	// Refill tokens based on time passed
	elapsed := now.Sub(bucket.lastRefill)
	if elapsed >= rl.window {
		// Full refill
		bucket.tokens = rl.maxRequests - 1
		bucket.lastRefill = now
		return true
	}

	// Check if tokens available
	if bucket.tokens > 0 {
		bucket.tokens--
		return true
	}

	// Rate limit exceeded
	return false
}

// cleanup removes old buckets periodically
func (rl *AuthRateLimiter) cleanup() {
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
