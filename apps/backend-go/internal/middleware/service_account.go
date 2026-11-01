package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/authz"
	"github.com/redis/go-redis/v9"
)

// DenyServiceAccount blocks the official notification account from every
// route it guards — first of all the whole messenger surface (reads, sends,
// notes, groups, receipts). Even a valid session of that account cannot read
// a single message or write anywhere in chat: there is simply no membership,
// no readable row, no subscribed room.
//
// The flag is cached in Redis for 5 minutes (key svcflag:<userID>); without
// Redis it falls back to a direct DB lookup, fail-closed to ALLOW only when
// the lookup itself errors — a service account can never log in anyway (see
// the login handlers), so this middleware is the second, not the first, wall.
func DenyServiceAccount(db *sql.DB, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsI, exists := c.Get("claims")
		if !exists {
			c.Next()
			return
		}
		claims, ok := claimsI.(*auth.Claims)
		if !ok || claims == nil || claims.UserID == "" {
			c.Next()
			return
		}
		if isServiceAccountCached(c.Request.Context(), db, redisClient, claims.UserID) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Service account: messenger is disabled"})
			c.Abort()
			return
		}
		c.Next()
	}
}

func isServiceAccountCached(ctx context.Context, db *sql.DB, redisClient *redis.Client, userID string) bool {
	if redisClient != nil {
		rctx, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
		val, err := redisClient.Get(rctx, "svcflag:"+userID).Result()
		cancel()
		if err == nil {
			return val == "1"
		}
	}
	ok, err := authz.IsServiceAccount(ctx, db, userID)
	if err != nil {
		return false
	}
	if redisClient != nil {
		v := "0"
		if ok {
			v = "1"
		}
		wctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		redisClient.Set(wctx, "svcflag:"+userID, v, 5*time.Minute)
		cancel()
	}
	return ok
}
