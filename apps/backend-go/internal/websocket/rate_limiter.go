package websocket

import (
	"sync"
	"time"
)

// RateLimiter implements a simple token bucket rate limiter per user
type RateLimiter struct {
	mu      sync.RWMutex
	buckets map[string]*tokenBucket
	// Maximum messages per window
	maxMessages int
	// Time window duration
	window time.Duration
	// Cleanup interval
	cleanupInterval time.Duration
}

type tokenBucket struct {
	tokens     int
	lastRefill time.Time
}

// NewRateLimiter creates a new rate limiter
// maxMessages: maximum number of messages allowed per window
// window: time window for rate limiting (e.g., 1 minute)
func NewRateLimiter(maxMessages int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		buckets:         make(map[string]*tokenBucket),
		maxMessages:     maxMessages,
		window:          window,
		cleanupInterval: window * 2,
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// Allow checks if a user is allowed to send a message
func (rl *RateLimiter) Allow(userID string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	bucket, exists := rl.buckets[userID]

	if !exists {
		// Create new bucket with full tokens
		rl.buckets[userID] = &tokenBucket{
			tokens:     rl.maxMessages - 1,
			lastRefill: now,
		}
		return true
	}

	// Refill tokens based on time passed
	elapsed := now.Sub(bucket.lastRefill)
	if elapsed >= rl.window {
		// Full refill
		bucket.tokens = rl.maxMessages - 1
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
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(rl.cleanupInterval)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		now := time.Now()
		for userID, bucket := range rl.buckets {
			if now.Sub(bucket.lastRefill) > rl.cleanupInterval {
				delete(rl.buckets, userID)
			}
		}
		rl.mu.Unlock()
	}
}

// Reset resets the rate limit for a specific user
func (rl *RateLimiter) Reset(userID string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	delete(rl.buckets, userID)
}
