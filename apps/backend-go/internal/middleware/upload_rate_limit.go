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

// Defaults for the upload limiter. Tuned to bound storage abuse while leaving
// normal use untouched: a typical user uploads a handful of files per day.
const (
	// DefaultUploadsPerMinute caps upload requests per user per minute.
	DefaultUploadsPerMinute = 30
	// DefaultUploadBytesPerHour caps the total uploaded bytes per user per hour.
	// Note: image uploads additionally store a .preview.jpg derivative of
	// comparable size, so real storage consumed is higher than the charged bytes.
	DefaultUploadBytesPerHour = 100 * 1024 * 1024 // 100 MiB
	// uploadUnknownSizeCharge is charged when a request carries no usable
	// Content-Length (chunked transfer), so the byte quota cannot be bypassed
	// by simply omitting the header. Conservative: equals the maximum allowed
	// upload size (10 MiB) enforced by the storage handler.
	uploadUnknownSizeCharge = 10 * 1024 * 1024
)

// UploadRateLimiter enforces per-user limits on file uploads using Redis so the
// budget is shared across all server instances:
//   - a fixed-window request rate (uploads per minute)
//   - a fixed-window byte quota (total uploaded bytes per hour)
//
// Like the other limiters in this package, Redis errors fail open so a Redis
// outage never breaks uploads entirely.
type UploadRateLimiter struct {
	redis           *redis.Client
	maxPerMinute    int
	maxBytesPerHour int64
}

// NewUploadRateLimiter creates a Redis-backed upload limiter.
func NewUploadRateLimiter(redisClient *redis.Client, maxPerMinute int, maxBytesPerHour int64) *UploadRateLimiter {
	return &UploadRateLimiter{
		redis:           redisClient,
		maxPerMinute:    maxPerMinute,
		maxBytesPerHour: maxBytesPerHour,
	}
}

// AllowCount admits one upload request if the per-minute budget is not exhausted.
func (rl *UploadRateLimiter) AllowCount(userID string) bool {
	if rl.redis == nil {
		return true
	}
	if rl.maxPerMinute <= 0 {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("ratelimit:upload:count:%s", userID)

	// INCR + EXPIRE atomically in one Lua script so a lost TTL can never leave
	// a permanently-stuck counter (see incrWithTTL).
	count, err := incrWithTTL(ctx, rl.redis, key, time.Minute)
	if err != nil {
		return true // fail open on Redis errors
	}
	return count <= int64(rl.maxPerMinute)
}

// AllowBytes atomically charges size bytes against the hourly quota and reports
// whether the quota is still respected. A zero or negative size (no usable
// Content-Length) is charged the maximum upload size so the quota cannot be
// bypassed by omitting the header. Overcounting failed uploads is intentional:
// the quota exists to bound storage abuse, not to bill precisely.
func (rl *UploadRateLimiter) AllowBytes(userID string, size int64) bool {
	if rl.redis == nil {
		return true
	}
	if rl.maxBytesPerHour <= 0 {
		return false
	}
	if size <= 0 {
		size = uploadUnknownSizeCharge
	}

	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("ratelimit:upload:bytes:%s", userID)

	// Lua script keeps check-and-charge atomic across concurrent requests and
	// server instances: reject when current quota plus this charge exceeds the
	// cap, otherwise increment and set the TTL on first use.
	script := redis.NewScript(`
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local charge = tonumber(ARGV[1])
if current + charge > tonumber(ARGV[2]) then
  return 0
end
local next = redis.call('INCRBY', KEYS[1], charge)
if next == charge then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
end
return 1
`)

	ok, err := script.Run(ctx, rl.redis, []string{key}, size, rl.maxBytesPerHour, int64(time.Hour.Seconds())).Int()
	if err != nil {
		return true // fail open on Redis errors
	}
	return ok == 1
}

// UploadRateLimitMiddleware applies per-user request-rate and byte-quota limits
// to upload endpoints. It must run after an auth middleware so the claims are
// available; unauthenticated requests are left for the auth middleware to reject.
func UploadRateLimitMiddleware(limiter *UploadRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsInterface, exists := c.Get("claims")
		if !exists {
			c.Next()
			return
		}

		var userID string
		if claims, ok := claimsInterface.(*auth.Claims); ok && claims != nil && claims.UserID != "" {
			userID = claims.UserID
		} else {
			// No usable identity (should not happen on protected routes) — fall
			// back to the client IP so the limiter still does its job.
			userID = c.ClientIP()
		}

		if !limiter.AllowCount(userID) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Upload rate limit exceeded. Please slow down.",
			})
			c.Abort()
			return
		}

		// Charge the byte quota using the request Content-Length: the multipart
		// body size is a tight upper bound for the stored file size.
		if !limiter.AllowBytes(userID, c.Request.ContentLength) {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Upload quota exceeded for this hour. Try again later.",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
