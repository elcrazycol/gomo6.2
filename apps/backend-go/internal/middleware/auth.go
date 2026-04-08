package middleware

import (
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Println("=== AuthMiddleware START ===")
		log.Printf("Path: %s\n", c.Request.URL.Path)

		// Get token from header
		authHeader := c.GetHeader("Authorization")
		log.Printf("Authorization header: '%s'\n", authHeader)
		if authHeader == "" {
			log.Println("ERROR: No Authorization header")
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Authorization header required",
			})
			c.Abort()
			return
		}

		log.Println("DEBUG: Authorization header present")

		// Check Bearer token
		tokenParts := strings.Split(authHeader, " ")
		if len(tokenParts) != 2 || tokenParts[0] != "Bearer" {
			log.Println("DEBUG: Invalid authorization header format")
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Invalid authorization header format",
			})
			c.Abort()
			return
		}

		// Validate token
		claims, err := authService.ValidateToken(tokenParts[1])
		if err != nil {
			log.Println("DEBUG: Token validation failed:", err)
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "MIDDLEWARE: Invalid token",
			})
			c.Abort()
			return
		}

		log.Println("DEBUG: Token validated successfully, UserID:", claims.UserID)

		// Set claims in context
		c.Set("claims", claims)
		c.Next()
	}
}

// Support for Supabase apikey header
func SupabaseAuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		log.Printf("=== SupabaseAuthMiddleware: %s %s ===", c.Request.Method, c.Request.URL.Path)

		// Try Authorization header first
		authHeader := c.GetHeader("Authorization")
		log.Printf("Authorization header: '%s'", authHeader)
		if authHeader != "" {
			tokenParts := strings.Split(authHeader, " ")
			if len(tokenParts) == 2 && tokenParts[0] == "Bearer" {
				claims, err := authService.ValidateToken(tokenParts[1])
				if err == nil {
					log.Printf("Token validated successfully for user: %s", claims.UserID)
					c.Set("claims", claims)
					c.Next()
					return
				}
				log.Printf("Token validation failed: %v", err)
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
		log.Printf("apikey header: '%s'", apiKey)
		if apiKey != "" && apiKey == getEnvFromOS("SUPABASE_ANON_KEY", "your-anon-key") {
			// Allow anonymous access with apikey
			log.Printf("Allowing anonymous access with apikey")
			c.Next()
			return
		}

		// No valid auth found
		log.Printf("No valid auth found, returning 401")
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
