package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

var validUsername = regexp.MustCompile(`^[a-zA-Z0-9]+$`)

// Register godoc
// @Summary      Register a new user
// @Description  Create a new account with username, password, and optional email
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body models.RegisterRequest true "Registration request"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /auth/register [post]
func (h *AuthHandler) Register(c *gin.Context) {
	var req models.RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// ── Honeypot check: if "website" field is filled, silently reject (bot detected) ──
	if req.Website != "" {
		// Log the event but return success to mislead the bot
		clientIP := c.ClientIP()
		log.Printf("[Honeypot] Bot detected on register from IP %s (website=%q)", clientIP, req.Website)
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
			"message": "Registration successful. Please check your email for confirmation.",
		}))
		return
	}

	// ── Cloudflare Turnstile check (server-side siteverify, fail closed) ──
	// Browser submissions must carry a valid token minted for the "signup"
	// action on an approved frontend hostname. Missing/misconfigured secret or
	// hostname allowlist rejects the request.
	if !verifyTurnstileForRequest(c, req.TurnstileToken, "signup") {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Turnstile verification failed"))
		return
	}

	// Validate password strength
	if err := validatePassword(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Validate username: a-z, A-Z, 0-9 only, 3-20 chars
	if len(req.Username) < 3 || len(req.Username) > 20 {
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrUsernameLength, "Username must be 3-20 characters", nil))
		return
	}
	if !validUsername.MatchString(req.Username) {
		c.JSON(http.StatusBadRequest, models.ErrorResponseWithCode(models.ErrUsernameChars, "Username may contain only Latin letters and digits (a-z, A-Z, 0-9)", nil))
		return
	}

	// Hash password (cost=12, ~250ms on modern hardware)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to hash password"))
		return
	}

	// Insert user
	displayName := req.Username
	if req.DisplayName != nil && *req.DisplayName != "" {
		displayName = *req.DisplayName
	}

	// Generate wallet address: GM6-XXXX-XXXX (2 bytes from crypto/rand → 4 hex chars each)
	walletAddr := fmt.Sprintf("GM6-%s-%s", randomHex(4), randomHex(4))

	query := `
		INSERT INTO users (username, display_name, email, password_hash, domain, wallet_address) 
		VALUES ($1, $2, $3, $4, 'localhost:8080', $5)
		RETURNING id, username, display_name, email, domain, created_at
	`

	var user models.User
	var emailVal *string
	if req.Email != nil && *req.Email != "" {
		emailVal = req.Email
	}
	err = h.db.QueryRow(query, req.Username, displayName, emailVal, string(hashedPassword), walletAddr).Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.Domain, &user.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to create user: "+err.Error()))
		return
	}

	// Generate token pair bound to a new stable session
	tokenPair, err := h.createLoginSession(user.ID, user.Username, user.Domain, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}
	middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600)

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"user":          user,
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
}

// Login checks password and returns either a full token (no 2FA) or
// a partial token (needs 2FA verification).
// If device_token is provided and is trusted (an opaque token previously
// issued by Verify2FA), 2FA is skipped.
// Login godoc
// @Summary      Log in
// @Description  Authenticate with username and password. Returns tokens or partial token if 2FA is enabled.
// @Tags         Auth
// @Accept       json
// @Produce      json
// @Param        request body object true "Login credentials"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/login [post]
func (h *AuthHandler) Login(c *gin.Context) {
	var req struct {
		Username       string `json:"username"`
		Email          string `json:"email"` // backward compat: old frontend sends email
		Password       string `json:"password"`
		DeviceToken    string `json:"device_token,omitempty"`
		Website        string `json:"website,omitempty"`               // Honeypot field — must be empty
		TurnstileToken string `json:"cf_turnstile_response,omitempty"` // Cloudflare Turnstile token
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Backward compat: old frontend sends email, new sends username
	loginIdentifier := req.Username
	if loginIdentifier == "" {
		loginIdentifier = req.Email
	}

	// ── Honeypot check ──
	if req.Website != "" {
		clientIP := c.ClientIP()
		log.Printf("[Honeypot] Bot detected on login from IP %s (website=%q)", clientIP, req.Website)
		// Silently succeed to mislead the bot — generic invalid credentials
		c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
		return
	}

	// ── Cloudflare Turnstile check (server-side siteverify, fail closed) ──
	// Browser submissions must carry a valid token minted for the "login"
	// action on an approved frontend hostname.
	if !verifyTurnstileForRequest(c, req.TurnstileToken, "login") {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Turnstile verification failed"))
		return
	}

	// Get user from database
	query := `
		SELECT id, username, display_name, email, domain, password_hash, totp_enabled, totp_secret, trusted_devices, created_at
		FROM users
		WHERE username = $1 OR email = $1
	`

	var user models.User
	var passwordHash string
	var totpEnabled bool
	var totpSecret *string
	var trustedDevicesJSON *string
	err := h.db.QueryRow(query, loginIdentifier).Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.Domain, &passwordHash,
		&totpEnabled, &totpSecret, &trustedDevicesJSON, &user.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	// M3 (security audit): account lockout applies only to real accounts and
	// its response is indistinguishable from a wrong password. Checking before
	// the user lookup let anyone freeze an arbitrary identifier (even a
	// non-existent one) and revealed which identifiers had been locked via the
	// 429/401 difference — i.e. username enumeration.
	if h.redis != nil {
		lockKey := fmt.Sprintf("lockout:%s", loginIdentifier)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		attempts, err := h.redis.Get(ctx, lockKey).Int()
		cancel()
		if err == nil && attempts >= 5 {
			c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
			return
		}
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		// Record failed attempt
		if h.redis != nil {
			h.recordFailedAttempt(loginIdentifier)
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
		return
	}

	// Reset lockout counter on successful password verification
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		h.redis.Del(ctx, fmt.Sprintf("lockout:%s", loginIdentifier))
		cancel()
	}

	// Check if 2FA is enabled and device is trusted
	if totpEnabled {
		// H2 (security audit): trusted devices are server-issued opaque tokens.
		// The map is keyed by SHA-256 of the token, so a client-chosen string
		// can never match and a leaked DB dump does not expose usable tokens.
		if req.DeviceToken != "" && trustedDevicesJSON != nil && *trustedDevicesJSON != "" {
			var trustedDevices map[string]int64
			if err := json.Unmarshal([]byte(*trustedDevicesJSON), &trustedDevices); err == nil {
				deviceHash := hashDeviceID(req.DeviceToken)
				if expiresAt, ok := trustedDevices[deviceHash]; ok {
					if time.Now().Unix() < expiresAt {
						// Device is trusted, skip 2FA
						tokenPair, err := h.createLoginSession(user.ID, user.Username, user.Domain, c.GetHeader("User-Agent"), c.ClientIP())
						if err != nil {
							c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
							return
						}
						middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600)

						c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
							"user":          user,
							"token":         tokenPair.AccessToken,
							"refresh_token": tokenPair.RefreshToken,
							"expires_in":    tokenPair.ExpiresIn,
							"needs_2fa":     false,
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

	// No 2FA, generate token pair bound to a new stable session
	tokenPair, err := h.createLoginSession(user.ID, user.Username, user.Domain, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}
	middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user":          user,
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"needs_2fa":     false,
	}))
}
