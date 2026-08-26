package httpx

import (
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ServerError logs the real error and returns a generic 500 to the client.
// NEVER leaks raw error messages to the client. Shared by handlers, crudengine
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

// AuthenticatedClaims returns the full claims attached by the auth middleware,
// or nil when the request is unauthenticated. Prefer AuthenticatedUserID when
// only the user ID is needed.
func AuthenticatedClaims(c *gin.Context) *auth.Claims {
	claimsValue, exists := c.Get("claims")
	claims, ok := claimsValue.(*auth.Claims)
	if !exists || !ok || claims == nil {
		return nil
	}
	return claims
}

// EnsureAuth returns the authenticated claims, aborting with 401 when the
// request carries no valid user. Shared by the messenger package and the
// dedicated handlers so the "auth required" contract lives in exactly one
// place.
func EnsureAuth(c *gin.Context) *auth.Claims {
	claims := AuthenticatedClaims(c)
	if claims == nil || claims.UserID == "" {
		c.AbortWithStatusJSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return nil
	}
	return claims
}

// BearerClaims returns the authenticated claims and whether a valid bearer
// identity is present. Unlike EnsureAuth it never writes to the response — it
// is for endpoints that treat auth as optional and branch on the result.
func BearerClaims(c *gin.Context) (*auth.Claims, bool) {
	claims := AuthenticatedClaims(c)
	if claims == nil || claims.UserID == "" {
		return nil, false
	}
	return claims, true
}
