package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// authenticatedUserID returns the authenticated user ID from the request
// context, or "" when the request is unauthenticated. The universal subsystem
// (internal/universal) carries its own copy; this one serves the handlers that
// stay in this package.
func authenticatedUserID(c *gin.Context) string {
	claimsValue, exists := c.Get("claims")
	claims, ok := claimsValue.(*auth.Claims)
	if !exists || !ok || claims == nil || claims.UserID == "" {
		return ""
	}
	return claims.UserID
}
