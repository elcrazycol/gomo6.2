package middleware

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func AuthMiddleware(authService *auth.AuthService) gin.HandlerFunc {
	return AuthMiddlewareWithDB(authService, nil)
}

func AuthMiddlewareWithDB(authService *auth.AuthService, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// If BotAuthMiddleware already set claims, skip JWT validation
		if _, exists := c.Get("claims"); exists {
			c.Next()
			return
		}

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

		rawToken := tokenParts[1]

		// Try bot auth first (only for gomo6_bot_ tokens)
		if db != nil && strings.HasPrefix(rawToken, "gomo6_bot_") {
			h := sha256.Sum256([]byte(rawToken))
			tokenHash := hex.EncodeToString(h[:])

			var botID, ownerID, userID string
			var isActive bool
			err := db.QueryRow(
				"SELECT id, owner_id, user_id, is_active FROM bots WHERE token_hash = $1", tokenHash,
			).Scan(&botID, &ownerID, &userID, &isActive)

			if err == nil && isActive {
				c.Set("claims", &auth.Claims{UserID: userID})
				c.Set("bot_id", botID)
				c.Set("bot_owner_id", ownerID)
				c.Set("is_bot", true)
				c.Next()
				return
			}
		}

		// Validate JWT token
		claims, err := authService.ValidateToken(rawToken)
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
	return OptionalAuthMiddlewareWithDB(authService, nil)
}

func OptionalAuthMiddlewareWithDB(authService *auth.AuthService, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// If already set claims, skip
		if _, exists := c.Get("claims"); exists {
			c.Next()
			return
		}

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

		rawToken := tokenParts[1]

		// Try bot auth first
		if db != nil && strings.HasPrefix(rawToken, "gomo6_bot_") {
			h := sha256.Sum256([]byte(rawToken))
			tokenHash := hex.EncodeToString(h[:])

			var botID, ownerID, userID string
			var isActive bool
			err := db.QueryRow(
				"SELECT id, owner_id, user_id, is_active FROM bots WHERE token_hash = $1", tokenHash,
			).Scan(&botID, &ownerID, &userID, &isActive)

			if err == nil && isActive {
				c.Set("claims", &auth.Claims{UserID: userID})
				c.Set("bot_id", botID)
				c.Set("bot_owner_id", ownerID)
				c.Set("is_bot", true)
				c.Next()
				return
			}
		}

		claims, err := authService.ValidateToken(rawToken)
		if err != nil {
			c.Next()
			return
		}
		c.Set("claims", claims)
		c.Next()
	}
}
