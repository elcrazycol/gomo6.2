package handlers

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// Refresh exchanges a valid refresh token for a new token pair.
// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(c *gin.Context) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("refresh_token is required"))
		return
	}

	// Get current user from access token (still valid or recently expired)
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	// Validate and rotate refresh token
	tokenPair, err := h.authService.RefreshAccessToken(claims.UserID, claims.Username, claims.Domain, req.RefreshToken)
	if err != nil {
		// Only revoke all sessions if the refresh token was found but generation
		// failed (potential token theft). "Not found" is benign (already used, expired).
		if !errors.Is(err, auth.ErrRefreshTokenNotFound) {
			h.authService.RevokeAllRefreshTokens(claims.UserID)
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
}

// Logout blacklists the access token and revokes all refresh tokens.
// POST /api/v1/auth/logout
func (h *AuthHandler) Logout(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	// Blacklist the current access token
	if claims.ExpiresAt != nil {
		h.authService.BlacklistToken(claims.ID, claims.ExpiresAt.Time)
	}

	// Revoke all refresh tokens for this user
	h.authService.RevokeAllRefreshTokens(claims.UserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GetMe returns the authenticated user's profile.
func (h *AuthHandler) GetMe(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// REMOVED: RecomputeUserProfileStats - too expensive for every auth check
	// Stats should be updated only when actual changes occur (new post, like, etc.)

	// Get user from database
	query := `
		SELECT id, username, display_name, email, domain, avatar_url, bio, garma, post_count, thread_count, created_at, is_remote
		FROM users
		WHERE id = $1
	`

	var user models.User
	err := h.db.QueryRow(query, userClaims.UserID).Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.Domain,
		&user.AvatarURL, &user.Bio, &user.Garma, &user.PostCount, &user.ThreadCount,
		&user.CreatedAt, &user.IsRemote,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(user))
}
