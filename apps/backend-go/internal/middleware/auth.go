package middleware

import (
	"net/http"
	"os"
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
				"error": "Authorization header required",
			})
			c.Abort()
			return
		}

		// Check Bearer token
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid authorization header format",
			})
			c.Abort()
			return
		}

		// Validate token
		claims, err := authService.ValidateToken(tokenParts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "Invalid token",
			})
			c.Abort()
			return
		}

		// Set claims in context
		c.Set("claims", claims)
		c.Next()
	}
}

// Support for Supabase apikey header
func SupabaseAuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Try Authorization header first
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) == 2 && tokenParts[0] == "Bearer" {
				claims, err := authService.ValidateToken(tokenParts[1])
				if err == nil {
					c.Set("claims", claims)
					c.Next()
					return
				}
			}
		}

		// Try token from query parameter (for WebSocket connections)
		token := c.Query("token")
		if token != "" {
			claims, err := authService.ValidateToken(token)
			if err == nil {
				c.Set("claims", claims)
				c.Next()
				return
			}
		}

		// Try apikey header (Supabase compatibility)
		apiKey := c.GetHeader("apikey")
		if apiKey != "" && apiKey == getEnvFromOS("SUPABASE_ANON_KEY", "your-anon-key") {
			// Allow anonymous access with apikey
			c.Next()
			return
		}

		// No valid auth found
		c.JSON(http.StatusUnauthorized, gin.H{
			"error": "Authorization required",
		})
		c.Abort()
	}
}

func getEnvFromOS(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
