package middleware

import (
	"database/sql"
	"log"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// RLSSetConfigMiddleware sets the PostgreSQL session variable app.current_user_id
// before each request. RLS policies in the database use this variable to enforce
// row-level access control.
//
// Must run AFTER AuthMiddleware so claims are available in the context.
// The third parameter to set_config (true) means "local to transaction" —
// this prevents one user's ID from leaking to another request on a pooled connection.
func RLSSetConfigMiddleware(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		claimsInterface, exists := c.Get("claims")
		if exists {
			if claims, ok := claimsInterface.(*auth.Claims); ok && claims.UserID != "" {
				_, err := db.Exec("SELECT set_config('app.current_user_id', $1, true)", claims.UserID)
				if err != nil {
					log.Printf("[RLS] set_config failed for user %s: %v", claims.UserID, err)
				}
			}
		}
		c.Next()
	}
}
