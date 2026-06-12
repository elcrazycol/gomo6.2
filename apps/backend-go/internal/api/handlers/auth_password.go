package handlers

import (
	"fmt"
	"net/http"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// UpdatePassword sets a new password for the authenticated user (auth.updateUser compatibility).
func (h *AuthHandler) UpdatePassword(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var body struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Validate password strength
	if err := validatePassword(body.Password); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to hash password"))
		return
	}

	_, err = h.db.Exec(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(hashedPassword), userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

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
