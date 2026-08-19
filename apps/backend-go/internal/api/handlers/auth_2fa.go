package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// Verify2FA validates a TOTP code after password login.
// Expects a partial token from step 1 and a TOTP code.
// If device_id is provided, the device will be trusted for future logins.
//
// Verify2FA godoc
// @Summary      Verify 2FA code
// @Description  Validate a TOTP code during login (requires partial token)
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "2FA verification request"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/verify-2fa [post]
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

	// M4 (security audit): bound per-login-attempt throttling. The key is the
	// partial token's jti, so a brute force cannot exhaust the whole account and
	// a failed attempt can never be replayed against another login attempt.
	if h.redis != nil && claims.ID != "" {
		lockKey := fmt.Sprintf("2fa_lock:%s", claims.ID)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		attempts, _ := h.redis.Get(ctx, lockKey).Int()
		cancel()
		if attempts >= max2FAAttempts {
			c.JSON(http.StatusTooManyRequests, models.ErrorResponse("Too many attempts. Please log in again."))
			return
		}
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
		// M4: count this failed attempt against the partial token's lockout key.
		if h.redis != nil && claims.ID != "" {
			lockKey := fmt.Sprintf("2fa_lock:%s", claims.ID)
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			n, _ := h.redis.Incr(ctx, lockKey).Result()
			if n == 1 {
				h.redis.Expire(ctx, lockKey, 15*time.Minute)
			}
			cancel()
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalid2FACode, "Invalid 2FA code", nil))
		return
	}

	// M4: successful verification clears the attempt counter for this login.
	if h.redis != nil && claims.ID != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		h.redis.Del(ctx, fmt.Sprintf("2fa_lock:%s", claims.ID))
		cancel()
	}

	// Generate token pair bound to a new stable session
	tokenPair, err := h.createLoginSession(claims.UserID, claims.Username, claims.Domain, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}
	middleware.SetAuthCookies(c, claims.UserID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600)

	resp := gin.H{
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}

	// H2 (security audit): trusted devices are opaque tokens issued by the
	// server, never client-chosen strings. The plaintext token is returned once
	// so the client can store it; only its SHA-256 hash is persisted.
	if req.TrustDevice {
		if deviceToken, err := h.trustDevice(claims.UserID); err == nil && deviceToken != "" {
			resp["device_token"] = deviceToken
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}

// max2FAAttempts bounds TOTP guesses per login attempt before a lockout.
const max2FAAttempts = 5

// SetupTOTP generates a new TOTP secret for the authenticated user and returns the provisioning URI.
//
// SetupTOTP godoc
// @Summary      Setup TOTP
// @Description  Generate a new TOTP secret and provisioning URI for 2FA setup
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/2fa/setup [post]
// @Security     BearerAuth
func (h *AuthHandler) SetupTOTP(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	// M1 (security audit): enrolling a new authenticator must prove knowledge of
	// the current password when the account has one, and must not silently
	// replace an already-enabled 2FA with an unverified secret.
	var req struct {
		Password string `json:"password"`
	}
	_ = c.ShouldBindJSON(&req)

	var storedHash sql.NullString
	var totpEnabled bool
	if err := h.db.QueryRow(
		`SELECT password_hash, totp_enabled FROM users WHERE id = $1`, userClaims.UserID,
	).Scan(&storedHash, &totpEnabled); err != nil {
		serverError(c, "load account state", err)
		return
	}
	if totpEnabled {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("2FA is already enabled. Disable it first."))
		return
	}
	if storedHash.Valid && storedHash.String != "" {
		// M1 (security audit): the enrollment password check is a password
		// oracle for a session holder — throttle per account like login.
		if h.isAuthActionLocked(userClaims.UserID) {
			c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrWrongPassword, "Current password is incorrect", nil))
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(storedHash.String), []byte(req.Password)) != nil {
			h.recordAuthActionFailure(userClaims.UserID)
			c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrWrongPassword, "Current password is incorrect", nil))
			return
		}
		h.clearAuthActionLock(userClaims.UserID)
	}

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
//
// VerifyAndEnableTOTP godoc
// @Summary      Verify and enable TOTP
// @Description  Verify the TOTP code and enable 2FA for the authenticated user
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "TOTP verification code"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /auth/2fa/verify-and-enable [post]
// @Security     BearerAuth
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

	// M1 (security audit): throttle the enable-code endpoint with the same
	// per-account counter as setup/disable/password, so a session holder cannot
	// brute-force the verification code.
	if h.isAuthActionLocked(userClaims.UserID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrInvalid2FACode, "Invalid code. Please try again.", nil))
		return
	}
	// Validate the TOTP code
	valid, err := h.validateTOTP(*totpSecret, req.Code)
	if err != nil || !valid {
		h.recordAuthActionFailure(userClaims.UserID)
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrInvalid2FACode, "Invalid code. Please try again.", nil))
		return
	}
	h.clearAuthActionLock(userClaims.UserID)

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
//
// DisableTOTP godoc
// @Summary      Disable TOTP
// @Description  Disable 2FA for the authenticated user (requires a valid 2FA or recovery code)
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/2fa/disable [post]
// @Security     BearerAuth
func (h *AuthHandler) DisableTOTP(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	// M1 (security audit): disabling 2FA must prove possession of the current
	// authenticator (or a recovery code). A stolen session alone must never be
	// able to silently strip the account's strongest protection.
	var req struct {
		Code string `json:"code"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Current 2FA code is required"))
		return
	}

	var totpSecret *string
	var totpEnabled bool
	if err := h.db.QueryRow(
		`SELECT totp_secret, totp_enabled FROM users WHERE id = $1`, userClaims.UserID,
	).Scan(&totpSecret, &totpEnabled); err != nil {
		serverError(c, "load 2fa state", err)
		return
	}
	if !totpEnabled || totpSecret == nil || *totpSecret == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("2FA is not enabled for this account"))
		return
	}
	// M1 (security audit): same per-account throttle as the other sensitive
	// auth actions — a stolen session must not be able to brute-force the TOTP
	// or recovery code needed to strip 2FA.
	if h.isAuthActionLocked(userClaims.UserID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrInvalid2FACode, "Invalid 2FA code", nil))
		return
	}
	valid, err := h.validateTOTPWithRecovery(userClaims.UserID, *totpSecret, req.Code)
	if err != nil {
		// A DB failure inside recovery-code lookup is not a wrong code — do not
		// burn a lockout attempt on infrastructure errors.
		serverError(c, "validate 2fa code", err)
		return
	}
	if !valid {
		h.recordAuthActionFailure(userClaims.UserID)
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrInvalid2FACode, "Invalid 2FA code", nil))
		return
	}
	h.clearAuthActionLock(userClaims.UserID)

	_, err = h.db.Exec(
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
//
// Get2FAStatus godoc
// @Summary      Get 2FA status
// @Description  Returns whether 2FA is enabled and if there is a pending setup
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/2fa/status [get]
// @Security     BearerAuth
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

// hashDeviceID derives the storage key for a device token. Only the hash is
// ever persisted, so a database leak does not expose usable device tokens.
func hashDeviceID(deviceID string) string {
	h := sha256.Sum256([]byte(deviceID))
	return hex.EncodeToString(h[:])
}

// trustDevice issues an unpredictable device token (stored as a SHA-256 hash)
// so 2FA cannot be bypassed with a guessed, leaked or client-chosen string.
// Returns the plaintext token — the caller returns it to the client exactly once.
func (h *AuthHandler) trustDevice(userID string) (string, error) {
	token := randomHex(32) // 64 hex chars, ~256 bits of entropy
	deviceHash := hashDeviceID(token)

	var trustedDevicesJSON *string
	err := h.db.QueryRow(
		`SELECT trusted_devices FROM users WHERE id = $1`, userID,
	).Scan(&trustedDevicesJSON)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}

	trustedDevices := make(map[string]int64)
	if trustedDevicesJSON != nil && *trustedDevicesJSON != "" {
		json.Unmarshal([]byte(*trustedDevicesJSON), &trustedDevices)
	}

	// Prune expired entries and cap the map size.
	now := time.Now().Unix()
	for k, exp := range trustedDevices {
		if now >= exp {
			delete(trustedDevices, k)
		}
	}
	if len(trustedDevices) >= 20 {
		return "", fmt.Errorf("too many trusted devices")
	}

	// Trust for 30 days
	trustedDevices[deviceHash] = now + 30*24*60*60

	data, _ := json.Marshal(trustedDevices)
	if _, err := h.db.Exec(`UPDATE users SET trusted_devices = $1 WHERE id = $2`, string(data), userID); err != nil {
		return "", err
	}
	return token, nil
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
