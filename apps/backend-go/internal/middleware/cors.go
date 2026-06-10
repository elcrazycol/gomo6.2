package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// CORS returns a middleware that restricts cross-origin requests to the
// configured list of allowed origins. If allowedOrigins is empty or contains
// "*", the middleware falls back to allowing all origins (development mode).
func CORS(allowedOrigins []string) gin.HandlerFunc {
	allowAll := len(allowedOrigins) == 0 || (len(allowedOrigins) == 1 && allowedOrigins[0] == "*")

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		if allowAll {
			// Development / no restrictions
			c.Header("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			// Strict origin check: reflect the origin only if it's in the allowed list
			allowed := false
			for _, o := range allowedOrigins {
				if strings.EqualFold(o, origin) {
					allowed = true
					break
				}
			}
			if allowed {
				c.Header("Access-Control-Allow-Origin", origin)
				c.Header("Vary", "Origin")
			} else {
				// Origin not allowed — still set the first allowed origin so the
				// browser shows a clear CORS error instead of a generic network error
				c.Header("Access-Control-Allow-Origin", allowedOrigins[0])
			}
		} else {
			// No Origin header (same-origin request, server-to-server, etc.) — pass through
		}

		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Accept, Authorization")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
