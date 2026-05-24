package middleware

import (
	"log"
	"net/http"
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

