package middleware

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/authz"
	"github.com/gomo6/backend/internal/sanctions"
	"github.com/redis/go-redis/v9"
)

// SanctionGateMiddleware blocks MUTATING requests from users under an active
// mute or ban. Reads always pass, so a sanctioned user can still browse and
// reach their notifications. Moderators and admins bypass the gate.
//
// The blocking lookup is Redis-cached for a minute and invalidated whenever a
// sanction is applied or revoked (sanctions.InvalidateBlockCache), so the gate
// adds no database round trip to the common case. It is registered after the
// auth middleware on the protected groups.
func SanctionGateMiddleware(db *sql.DB, redisClient *redis.Client) gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}

		claimsValue, ok := c.Get("claims")
		if !ok {
			c.Next() // unauthenticated: the auth middleware decides
			return
		}
		claims, ok := claimsValue.(*auth.Claims)
		if !ok || claims == nil || claims.UserID == "" {
			c.Next()
			return
		}

		// A sanctioned user must always be able to appeal their sanction — that
		// single POST is exempt, or the gate would make appeals impossible.
		if isSanctionAppealSubmission(c) {
			c.Next()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()

		block := sanctions.ActiveBlockingCached(ctx, db, redisClient, claims.UserID)
		if block == nil {
			c.Next()
			return
		}
		// The staff check only runs when a sanction actually exists.
		if isStaff, err := authz.IsModerator(ctx, db, claims.UserID); err == nil && isStaff {
			c.Next()
			return
		}

		code, message := "user_muted", "Создание контента ограничено модератором."
		if block.Kind == sanctions.KindBan {
			code, message = "user_banned", "Аккаунт заблокирован."
		}
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{
			"success": false,
			"error":   message,
			"code":    code,
			"reason":  block.Reason,
		})
	}
}

// isSanctionAppealSubmission reports whether the request is the one mutating
// endpoint a sanctioned user must still reach: filing an appeal against their
// own sanction.
func isSanctionAppealSubmission(c *gin.Context) bool {
	return c.Request.Method == http.MethodPost &&
		strings.TrimSuffix(c.Request.URL.Path, "/") == "/api/v1/moderation/appeals"
}
