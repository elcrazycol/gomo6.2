package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// UpdatePassword sets a new password for the authenticated user (auth.updateUser compatibility).
//
// UpdatePassword godoc
// @Summary      Update password
// @Description  Set a new password for the authenticated user
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "New password"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/password [post]
// @Security     BearerAuth
func (h *AuthHandler) UpdatePassword(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var body struct {
		Password        string `json:"password"`
		CurrentPassword string `json:"current_password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Changing a password without proving knowledge of the current one would
	// let a stolen session permanently lock the owner out. Require the current
	// password whenever the account already has one.
	if body.CurrentPassword == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("current_password is required"))
		return
	}

	// Validate password strength
	if err := validatePassword(body.Password); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var storedHash sql.NullString
	err := h.db.QueryRow(`SELECT password_hash FROM users WHERE id = $1`, userClaims.UserID).Scan(&storedHash)
	if err != nil {
		serverError(c, "load password hash", err)
		return
	}

	// Accounts without a password (OAuth / passkey-only) may set a first
	// password; accounts with one must prove knowledge of it first.
	if storedHash.Valid && storedHash.String != "" {
		// M1 (security audit): this endpoint is a password oracle for a session
		// holder — bound the guesses per account like the login path so a stolen
		// session cannot brute-force the current password.
		if h.isAuthActionLocked(userClaims.UserID) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Текущий пароль неверен"))
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(storedHash.String), []byte(body.CurrentPassword)) != nil {
			h.recordAuthActionFailure(userClaims.UserID)
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Текущий пароль неверен"))
			return
		}
		h.clearAuthActionLock(userClaims.UserID)
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to hash password"))
		return
	}

	_, err = h.db.Exec(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(hashedPassword), userClaims.UserID)
	if err != nil {
		serverError(c, "update password hash", err)
		return
	}

	// M2 (security audit): a password change must terminate every other
	// session. The current device keeps working — its HttpOnly refresh cookie
	// identifies the current session row (session id = SHA-256 of the refresh
	// token), so only refresh tokens and session rows of the other devices are
	// revoked. Without a refresh cookie (API/bot caller using a bearer token)
	// every session is revoked and the caller re-authenticates.
	currentSessionID := ""
	if rt, err := c.Cookie(middleware.RefreshTokenCookie); err == nil && rt != "" {
		currentSessionID = SessionIDFromRefreshToken(rt)
	}
	if currentSessionID != "" {
		h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1 AND id != $2`, userClaims.UserID, currentSessionID)
		if h.redis != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			defer cancel()
			for _, pattern := range []string{"refresh:%s:*", "current:%s:*"} {
				iter := h.redis.Scan(ctx, 0, fmt.Sprintf(pattern, userClaims.UserID), 100).Iterator()
				for iter.Next(ctx) {
					parts := strings.Split(iter.Val(), ":")
					if len(parts) == 3 && parts[2] != currentSessionID {
						h.redis.Del(ctx, iter.Val())
					}
				}
			}
		}
	} else {
		h.authService.RevokeAllRefreshTokens(userClaims.UserID)
		h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, userClaims.UserID)
	}
	middleware.InvalidateAuthCache(h.redis, userClaims.UserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// validatePassword checks that the password meets minimum requirements:
// - At least 8 characters
// - At least one letter and one digit
// - Not found in known data breaches (uses HIBP k-anonymity API)
func validatePassword(password string) error {
	if len(password) < 8 {
		return fmt.Errorf("password must be at least 8 characters")
	}

	hasLetter := false
	hasDigit := false
	for _, ch := range password {
		if unicode.IsLetter(ch) {
			hasLetter = true
		}
		if unicode.IsDigit(ch) {
			hasDigit = true
		}
	}

	if !hasLetter || !hasDigit {
		return fmt.Errorf("password must contain at least one letter and one digit")
	}

	// Check against Have I Been Pwned (k-anonymity — only first 5 chars of SHA-1 sent)
	if isPwned(password) {
		return fmt.Errorf("password has been exposed in a data breach — choose a different one")
	}

	return nil
}
