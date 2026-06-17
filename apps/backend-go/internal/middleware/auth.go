package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Get token from header
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Authorization header required",
			})
			c.Abort()
			return
		}

		// Check Bearer token
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Invalid authorization header format",
			})
			c.Abort()
			return
		}

		// Validate token
		claims, err := authService.ValidateToken(tokenParts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Invalid token",
			})
			c.Abort()
			return
		}

		// Set claims in context
		c.Set("claims", claims)
		c.Next()
	}
}

// OptionalAuthMiddleware parses the Authorization header if present and sets
// "claims" in context. Does NOT reject unauthenticated requests.
func OptionalAuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.Next()
			return
		}
		claims, err := authService.ValidateToken(tokenParts[1])
		if err != nil {
			c.Next()
			return
		}
		c.Set("claims", claims)
		c.Next()
	}
}
