package middleware

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func BotAuthMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		// If claims already set (e.g. by a previous middleware), skip
		if _, exists := c.Get("claims"); exists {
			c.Next()
			return
		}

		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.Next()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.Next()
			return
		}

		rawToken := parts[1]

		// Only try bot auth for tokens that look like bot tokens
		if !strings.HasPrefix(rawToken, "gomo6_bot_") {
			c.Next()
			return
		}

		h := sha256.Sum256([]byte(rawToken))
		tokenHash := hex.EncodeToString(h[:])

		var botID, ownerID, userID string
		var isActive bool
		err := db.QueryRow(
			"SELECT id, owner_id, user_id, is_active FROM bots WHERE token_hash = $1", tokenHash,
		).Scan(&botID, &ownerID, &userID, &isActive)

		if err != nil || !isActive {
			c.Next()
			return
		}

		// Bot authenticated — set claims as the bot's own user
		c.Set("claims", &auth.Claims{UserID: userID})
		c.Set("bot_id", botID)
		c.Set("bot_owner_id", ownerID)
		c.Set("is_bot", true)
		c.Next()
	}
}
