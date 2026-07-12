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
//
// Refresh godoc
// @Summary      Refresh access token
// @Description  Exchange a valid refresh token for a new token pair
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "Refresh token request"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/refresh [post]
// @Security     BearerAuth
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

	// Compute old session ID before rotation
	oldSessionID := SessionIDFromRefreshToken(req.RefreshToken)

	// Validate and rotate refresh token
	tokenPair, err := h.authService.RefreshAccessToken(claims.UserID, claims.Username, claims.Domain, req.RefreshToken)
	if err != nil {
		// Only revoke all sessions if the refresh token was found but generation
		// failed (potential token theft). "Not found" is benign (already used, expired).
		if !errors.Is(err, auth.ErrRefreshTokenNotFound) {
			h.authService.RevokeAllRefreshTokens(claims.UserID)
			// Also clean up all sessions from DB
			h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired refresh token. Please log in again."))
		return
	}

	// Update session in DB: delete old record, create new one with new refresh token
	h.db.Exec(`DELETE FROM user_sessions WHERE id = $1 AND user_id = $2`, oldSessionID, claims.UserID)
	h.createSession(claims.UserID, tokenPair.RefreshToken, c.GetHeader("User-Agent"), c.ClientIP())

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
}

// Logout blacklists the access token and revokes all refresh tokens.
// POST /api/v1/auth/logout
//
// Logout godoc
// @Summary      Log out
// @Description  Blacklist access token and revoke all refresh tokens
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/logout [post]
// @Security     BearerAuth
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

	// Delete all sessions from DB
	h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// GetMe returns the authenticated user's profile.
//
// GetMe godoc
// @Summary      Get current user
// @Description  Returns the authenticated user's profile
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/me [get]
// @Security     BearerAuth
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
