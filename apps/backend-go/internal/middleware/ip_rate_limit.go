package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// IPRateLimitMiddleware applies a rate limit keyed by IP for anonymous callers
// and by user ID for authenticated ones. AuthRateLimitMiddleware is only
// effective after an auth middleware has populated claims — anonymous requests
// pass straight through it — so endpoints reachable without a token (e.g. the
// public /api/v1/search enumeration surface) need this IP-keyed variant.
func IPRateLimitMiddleware(limiter *AuthRateLimiter) gin.HandlerFunc {
	return func(c *gin.Context) {
		key := c.ClientIP()
		if claimsValue, exists := c.Get("claims"); exists {
			if claims, ok := claimsValue.(interface{ GetUserID() string }); ok && claims.GetUserID() != "" {
				key = claims.GetUserID()
			}
		}

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
