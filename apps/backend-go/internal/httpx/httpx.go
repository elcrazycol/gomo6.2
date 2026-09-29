package httpx

import (
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
)

// UniqueViolationConstraint returns the constraint name for a PostgreSQL
// unique_violation (SQLSTATE 23505), or "" when err is not one.
//
// Callers use it to answer "already taken" with a 409 and a neutral message
// instead of leaking the driver error text — which names the constraint and
// confirms which value exists (a username-enumeration oracle) — or returning a
// 500 with raw DB internals.
func UniqueViolationConstraint(err error) string {
	var pgErr *pq.Error
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return pgErr.Constraint
	}
	return ""
}

// IsClientInputError reports whether err is a PostgreSQL data-exception
// (SQLSTATE class 22): the database rejected a value supplied in the request
// because it could not be parsed for the target column — a non-UUID string
// compared against a uuid column (22P02), a malformed timestamp (22007), an
// out-of-range number (22003), and friends. These are client input errors, not
// server faults, so callers should answer 400 rather than 500.
func IsClientInputError(err error) bool {
	var pgErr *pq.Error
	return errors.As(err, &pgErr) && strings.HasPrefix(string(pgErr.Code), "22")
}

// ServerError logs the real error and returns a generic response to the client.
// NEVER leaks raw error messages to the client. Shared by handlers, crudengine
// and backup so the generic error contract lives in exactly one place:
//
//   - PostgreSQL data exceptions (class 22, bad client-supplied value) → 400;
//   - everything else → 500.
func ServerError(c *gin.Context, context string, err error) {
	if IsClientInputError(err) {
		log.Printf("[HTTP] %s (invalid input): %v", context, err)
		c.AbortWithStatusJSON(http.StatusBadRequest, models.ErrorResponse("Invalid request value"))
		return
	}
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
