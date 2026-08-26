package httpx

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ServerError logs the real error and returns a generic 500 to the client.
// NEVER leaks raw error messages to the client. Shared by handlers, universal
// and backup so the "generic 500" contract lives in exactly one place.
func ServerError(c *gin.Context, context string, err error) {
	log.Printf("[HTTP] %s: %v", context, err)
	_ = c.Error(err)
	c.AbortWithStatusJSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
}

// AuthenticatedUserID returns the authenticated user ID from the request
// context, or "" when the request is unauthenticated.
func AuthenticatedUserID(c *gin.Context) string {
	claimsValue, exists := c.Get("claims")
	claims, ok := claimsValue.(*auth.Claims)
	if !exists || !ok || claims == nil || claims.UserID == "" {
		return ""
	}
	return claims.UserID
}
