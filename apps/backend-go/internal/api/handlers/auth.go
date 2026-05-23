package handlers

import (
	"crypto/rand"
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
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	db          *sql.DB
	authService *auth.AuthService
}

func NewAuthHandler(db *sql.DB) *AuthHandler {
	return &AuthHandler{
		db:          db,
		authService: auth.NewAuthService(),
	}
}

func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to hash password"))
		return
	}

	// Insert user
	query := `
		INSERT INTO users (username, email, password_hash, domain) 
		VALUES ($1, $2, $3, 'localhost:8080')
		RETURNING id, username, email, domain, created_at
	`

	var user models.User
	err = h.db.QueryRow(query, req.Username, req.Email, string(hashedPassword)).Scan(
		&user.ID, &user.Username, &user.Email, &user.Domain, &user.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to create user"))
		return
	}

	// Generate JWT token
	token, err := h.authService.GenerateToken(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"user":  user,
		"token": token,
	}))
}

// Login checks password and returns either a full token (no 2FA) or
// a partial token (needs 2FA verification).
// If device_id is provided and is trusted, 2FA is skipped.
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
		DeviceID string `json:"device_id,omitempty"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Get user from database
	query := `
		SELECT id, username, email, domain, password_hash, totp_enabled, totp_secret, trusted_devices, created_at
		FROM users
		WHERE email = $1
	`

	var user models.User
	var passwordHash string
	var totpEnabled bool
	var totpSecret *string
	var trustedDevicesJSON *string
	err := h.db.QueryRow(query, req.Email).Scan(
		&user.ID, &user.Username, &user.Email, &user.Domain, &passwordHash,
		&totpEnabled, &totpSecret, &trustedDevicesJSON, &user.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid credentials"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid credentials"))
		return
	}

	// Check if 2FA is enabled and device is trusted
	if totpEnabled {
		// Check if device is trusted
		if req.DeviceID != "" && trustedDevicesJSON != nil && *trustedDevicesJSON != "" {
			var trustedDevices map[string]int64
			if err := json.Unmarshal([]byte(*trustedDevicesJSON), &trustedDevices); err == nil {
				if expiresAt, ok := trustedDevices[req.DeviceID]; ok {
					if time.Now().Unix() < expiresAt {
						// Device is trusted, skip 2FA
						token, err := h.authService.GenerateToken(user.ID, user.Username, user.Domain)
						if err != nil {
							c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
							return
						}

						c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
							"user":      user,
							"token":     token,
							"needs_2fa": false,
						}))
						return
					}
				}
			}
		}

		// Generate a partial token (short-lived, marks that password was verified)
		partialToken, err := h.authService.GeneratePartialToken(user.ID, user.Username, user.Domain)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate partial token"))
			return
		}

		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"user":      user,
			"token":     partialToken,
			"needs_2fa": true,
		}))
		return
	}

	// No 2FA, generate full token directly
	token, err := h.authService.GenerateToken(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user":      user,
		"token":     token,
		"needs_2fa": false,
	}))
}

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

	// Validate TOTP code
	valid, err := h.validateTOTP(*totpSecret, req.Code)
	if err != nil || !valid {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid 2FA code"))
		return
	}

	// Generate full token
	token, err := h.authService.GenerateToken(claims.UserID, claims.Username, claims.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	// Optionally trust the device
	if req.TrustDevice && req.DeviceID != "" {
		h.trustDevice(claims.UserID, req.DeviceID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"token": token,
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

	// Generate recovery codes (5 codes)
	recoveryCodes := h.generateRecoveryCodes(userClaims.UserID)

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

// internal helpers

func (h *AuthHandler) validateTOTP(secret, code string) (bool, error) {
	// First try as recovery code
	if len(code) > 10 {
		valid, err := h.validateRecoveryCode(secret, code)
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

func (h *AuthHandler) generateRecoveryCodes(userID string) []string {
	codes := make([]string, 5)
	for i := 0; i < 5; i++ {
		code := fmt.Sprintf("RC-%s-%s", userID[:8], randomHex(10))
		codes[i] = code
	}
	return codes
}

func (h *AuthHandler) validateRecoveryCode(secret, code string) (bool, error) {
	// For now, recovery codes are not stored separately - use the main totp secret
	// In production, store recovery codes in a separate table and check them here
	return false, nil
}

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
		SELECT id, username, email, domain, avatar_url, bio, garma, post_count, thread_count, created_at, is_remote
		FROM users
		WHERE id = $1
	`

	var user models.User
	err := h.db.QueryRow(query, userClaims.UserID).Scan(
		&user.ID, &user.Username, &user.Email, &user.Domain,
		&user.AvatarURL, &user.Bio, &user.Garma, &user.PostCount, &user.ThreadCount,
		&user.CreatedAt, &user.IsRemote,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("User not found"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(user))
}

// UpdatePassword sets a new password for the authenticated user (Supabase auth.updateUser compatibility).
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
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Password) < 6 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Password must be at least 6 characters"))
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
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

func randomHex(length int) string {
	b := make([]byte, (length+1)/2)
	rand.Read(b)
	hexStr := hex.EncodeToString(b)
	if len(hexStr) > length {
		return hexStr[:length]
	}
	return hexStr
}
