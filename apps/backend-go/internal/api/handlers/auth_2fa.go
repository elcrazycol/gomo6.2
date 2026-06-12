package handlers

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/pquerna/otp/totp"
)

// Verify2FA validates a TOTP code after password login.
// Expects a partial token from step 1 and a TOTP code.
// If device_id is provided, the device will be trusted for future logins.
func (h *AuthHandler) Verify2FA(c *gin.Context) {
	var req struct {
		Token       string `json:"token"`
		Code        string `json:"code"`
		DeviceID    string `json:"device_id,omitempty"`
		TrustDevice bool   `json:"trust_device,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Validate the partial token
	claims, err := h.authService.ValidateToken(req.Token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid or expired token"))
		return
	}

	// Verify user has 2FA enabled
	var totpSecret *string
	var totpEnabled bool
	err = h.db.QueryRow(
		`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, claims.UserID,
	).Scan(&totpSecret, &totpEnabled)
	if err != nil || !totpEnabled || totpSecret == nil || *totpSecret == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("2FA is not enabled for this account"))
		return
	}

	// Validate TOTP code (also try recovery codes)
	valid, err := h.validateTOTPWithRecovery(claims.UserID, *totpSecret, req.Code)
	if err != nil || !valid {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid 2FA code"))
		return
	}

	// Generate token pair (access + refresh)
	tokenPair, err := h.authService.GenerateTokenPair(claims.UserID, claims.Username, claims.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	// Optionally trust the device
	if req.TrustDevice && req.DeviceID != "" {
		h.trustDevice(claims.UserID, req.DeviceID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
}

// SetupTOTP generates a new TOTP secret for the authenticated user and returns the provisioning URI.
func (h *AuthHandler) SetupTOTP(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	// Generate a new TOTP key
	key, err := totp.Generate(totp.GenerateOpts{
		Issuer:      "gomo6",
		AccountName: userClaims.Username,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate TOTP secret"))
		return
	}

	// Store the secret temporarily (not enabled until verified)
	_, err = h.db.Exec(
		`UPDATE users SET totp_secret = $1, totp_enabled = false WHERE id = $2`,
		key.Secret(), userClaims.UserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to store TOTP secret"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"secret": key.Secret(),
		"uri":    key.URL(),
	}))
}

// VerifyAndEnableTOTP verifies the TOTP code and enables 2FA for the user.
func (h *AuthHandler) VerifyAndEnableTOTP(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Get stored secret
	var totpSecret *string
	err := h.db.QueryRow(
		`SELECT totp_secret FROM users WHERE id = $1`, userClaims.UserID,
	).Scan(&totpSecret)
	if err != nil || totpSecret == nil || *totpSecret == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("TOTP not set up. Call setup first."))
		return
	}

	// Validate the TOTP code
	valid, err := h.validateTOTP(*totpSecret, req.Code)
	if err != nil || !valid {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid code. Please try again."))
		return
	}

	// Enable 2FA
	_, err = h.db.Exec(
		`UPDATE users SET totp_enabled = true WHERE id = $1`,
		userClaims.UserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to enable 2FA"))
		return
	}

	// Generate real recovery codes (8 codes), store hashes in DB
	recoveryCodes := h.generateAndStoreRecoveryCodes(userClaims.UserID)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"enabled":        true,
		"recovery_codes": recoveryCodes,
	}))
}

// DisableTOTP disables 2FA for the authenticated user.
func (h *AuthHandler) DisableTOTP(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	_, err := h.db.Exec(
		`UPDATE users SET totp_secret = NULL, totp_enabled = false, trusted_devices = '{}'::jsonb WHERE id = $1`,
		userClaims.UserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to disable 2FA"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// Get2FAStatus returns the current 2FA status for the authenticated user.
func (h *AuthHandler) Get2FAStatus(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var totpEnabled bool
	var totpSecret *string
	err := h.db.QueryRow(
		`SELECT totp_enabled, totp_secret FROM users WHERE id = $1`, userClaims.UserID,
	).Scan(&totpEnabled, &totpSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get 2FA status"))
		return
	}

	hasPendingSecret := !totpEnabled && totpSecret != nil && *totpSecret != ""

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"enabled":            totpEnabled,
		"has_pending_secret": hasPendingSecret,
	}))
}

// ─── Internal 2FA helpers ────────────────────────────────────────────────────

// validateTOTP verifies a TOTP code, and also checks recovery codes if applicable.
func (h *AuthHandler) validateTOTP(secret, code string) (bool, error) {
	result := totp.Validate(code, secret)
	return result, nil
}

// validateTOTPWithRecovery verifies a TOTP code or a recovery code for the given user.
func (h *AuthHandler) validateTOTPWithRecovery(userID, secret, code string) (bool, error) {
	// Try recovery code first if it looks like one (longer format)
	if len(code) > 10 {
		valid, err := h.validateRecoveryCode(userID, code)
		if err != nil {
			return false, err
		}
		if valid {
			return true, nil
		}
	}

	// Validate as standard TOTP
	result := totp.Validate(code, secret)
	return result, nil
}

func (h *AuthHandler) trustDevice(userID, deviceID string) {
	// Read current trusted devices
	var trustedDevicesJSON *string
	err := h.db.QueryRow(
		`SELECT trusted_devices FROM users WHERE id = $1`, userID,
	).Scan(&trustedDevicesJSON)
	if err != nil {
		return
	}

	trustedDevices := make(map[string]int64)
	if trustedDevicesJSON != nil && *trustedDevicesJSON != "" {
		json.Unmarshal([]byte(*trustedDevicesJSON), &trustedDevices)
	}

	// Trust for 30 days
	trustedDevices[deviceID] = time.Now().Add(30 * 24 * time.Hour).Unix()

	data, _ := json.Marshal(trustedDevices)
	h.db.Exec(`UPDATE users SET trusted_devices = $1 WHERE id = $2`, string(data), userID)
}

// generateAndStoreRecoveryCodes creates 8 recovery codes, stores their hashes in the DB,
// and returns the plaintext codes (only time they're shown).
func (h *AuthHandler) generateAndStoreRecoveryCodes(userID string) []string {
	codes := make([]string, 8)
	for i := 0; i < 8; i++ {
		code := fmt.Sprintf("%s-%s-%s", randomHex(4), randomHex(4), randomHex(4))
		codes[i] = code

		// Hash and store
		hash := sha256.Sum256([]byte(code))
		codeHash := hex.EncodeToString(hash[:])
		h.db.Exec(`
			INSERT INTO user_recovery_codes (user_id, code_hash, used)
			VALUES ($1, $2, FALSE)
		`, userID, codeHash)
	}
	return codes
}

// validateRecoveryCode checks a recovery code against the database.
// If valid, marks it as used so it cannot be reused.
func (h *AuthHandler) validateRecoveryCode(userID, code string) (bool, error) {
	hash := sha256.Sum256([]byte(code))
	codeHash := hex.EncodeToString(hash[:])

	var id string
	err := h.db.QueryRow(`
		UPDATE user_recovery_codes
		SET used = TRUE
		WHERE user_id = $1 AND code_hash = $2 AND used = FALSE
		RETURNING id
	`, userID, codeHash).Scan(&id)

	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}
