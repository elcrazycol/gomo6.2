package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/logsafe"
	"github.com/gomo6/backend/internal/metrics"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/sanctions"
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
		logsafe.Printf("[Honeypot] Bot detected on register from IP %s (website=%q)", clientIP, req.Website)
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

	// Hash password (SHA-256 pre-hash + bcrypt cost 12 — see hashPassword)
	hashedPassword, err := hashPassword(req.Password)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to hash password"))
		return
	}

	// Insert user
	displayName := req.Username
	if req.DisplayName != nil && *req.DisplayName != "" {
		displayName = *req.DisplayName
	}

	// Generate wallet address: GM6-XXXX-XXXX (4 base36 chars ×2 ≈ 41 bits,
	// up from 32 with hex). The length and charset are pinned by the
	// wallet_address column (VARCHAR(14)) and the client-side regex.
	walletAddr := fmt.Sprintf("GM6-%s-%s", randomBase36(4), randomBase36(4))

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
		// A unique_violation must NOT surface as a 500 with the raw driver
		// error: the text names the constraint and confirms which value exists.
		// Answer with a 409 instead and log the detail server-side.
		if constraint := httpx.UniqueViolationConstraint(err); constraint != "" {
			log.Printf("[Auth] register unique violation (%s): %v", constraint, err)
			switch {
			case strings.Contains(constraint, "username"):
				c.JSON(http.StatusConflict, models.ErrorResponseWithCode(
					models.ErrUsernameTaken, "This username is already taken", nil))
			case strings.Contains(constraint, "wallet_address"):
				// 32-bit address space (see L6 in the security audit): a
				// collision is rare but retryable.
				c.JSON(http.StatusConflict, models.ErrorResponse(
					"Could not allocate a wallet address, please try again"))
			default:
				c.JSON(http.StatusConflict, models.ErrorResponse(
					"Registration conflict, please try again"))
			}
			return
		}
		httpx.ServerError(c, "register user", err)
		return
	}

	// Generate token pair bound to a new stable session
	tokenPair, err := h.createLoginSession(user.ID, user.Username, user.Domain, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}
	if err := middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to establish session"))
		return
	}

	metrics.App.RegistrationCreated()
	// Index the new profile (best-effort, off the request path).
	h.searchIndexer.SyncUser(user.ID)
	// The refresh token lives in the HttpOnly cookie only — see authTokensResponse.
	c.JSON(http.StatusCreated, models.SuccessResponse(authTokensResponse(tokenPair, user, req.IncludeTokens)))
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
		IncludeTokens  bool   `json:"include_tokens,omitempty"`        // Cookieless API clients: echo raw tokens in JSON
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
		logsafe.Printf("[Honeypot] Bot detected on login from IP %s (website=%q)", clientIP, req.Website)
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
		SELECT id, username, display_name, email, domain, password_hash, totp_enabled, totp_secret, trusted_devices, created_at,
			COALESCE(is_service, false)
		FROM users
		WHERE username = $1 OR email = $1
	`

	var user models.User
	var passwordHash string
	var totpEnabled bool
	var totpSecret *string
	var trustedDevicesJSON *string
	var isService bool
	err := h.db.QueryRow(query, loginIdentifier).Scan(
		&user.ID, &user.Username, &user.DisplayName, &user.Email, &user.Domain, &passwordHash,
		&totpEnabled, &totpSecret, &trustedDevicesJSON, &user.CreatedAt, &isService,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			// Timing-oracle defense: a real password check costs ~250ms of
			// hash. Answering "no such user" instantly would let anyone
			// enumerate registered usernames/emails by response time, so burn
			// the same CPU before the generic 401.
			dummyPasswordCompare(req.Password)
			c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	// The service account never logs in interactively — it operates through
	// the admin panel only. Refusing here (rather than failing auth) keeps the
	// reason explicit in logs without leaking it to the caller.
	if isService {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Service account login is disabled"))
		return
	}

	// M3 (security audit): account lockout applies only to real accounts and
	// its response is indistinguishable from a wrong password. Checking before
	// the user lookup let anyone freeze an arbitrary identifier (even a
	// non-existent one) and revealed which identifiers had been locked via the
	// 429/401 difference — i.e. username enumeration.
	if h.redis != nil {
		lockKey := normalizeLockoutKey(loginIdentifier)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		attempts, err := h.redis.Get(ctx, lockKey).Int()
		cancel()
		if err == nil && attempts >= 5 {
			c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
			return
		}
	}

	// Check password (SHA-256 pre-hash scheme with transparent upgrade from
	// legacy plain-bcrypt hashes — see verifyPassword).
	err = verifyPassword(passwordHash, req.Password)
	if err != nil {
		// Record failed attempt
		if h.redis != nil {
			h.recordFailedAttempt(normalizeLockoutKey(loginIdentifier))
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponseWithCode(models.ErrInvalidCredentials, "Invalid credentials", nil))
		return
	}

	// Transparent upgrade: legacy plain-bcrypt rows are re-hashed to the
	// pre-hash scheme on first successful login (best-effort, never fails auth).
	if isLegacyPasswordHash(passwordHash, req.Password) {
		if upgraded, err := hashPassword(req.Password); err == nil {
			h.db.Exec(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, upgraded, user.ID)
		}
	}

	// Reset lockout counter on successful password verification
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		h.redis.Del(ctx, normalizeLockoutKey(loginIdentifier))
		cancel()
	}

	// Sanctions: a ban refuses login outright. A mute only blocks writes, which
	// the sanction gate middleware enforces per request.
	if block, err := sanctions.ActiveBlocking(context.Background(), h.db, user.ID); err == nil && block != nil && block.Kind == sanctions.KindBan {
		c.JSON(http.StatusForbidden, gin.H{
			"success": false,
			"error":   "Аккаунт заблокирован",
			"code":    "user_banned",
			"reason":  block.Reason,
		})
		return
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
						if err := middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600); err != nil {
							c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to establish session"))
							return
						}

						resp := authTokensResponse(tokenPair, user, req.IncludeTokens)
						resp["needs_2fa"] = false
						c.JSON(http.StatusOK, models.SuccessResponse(resp))
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
	if err := middleware.SetAuthCookies(c, user.ID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to establish session"))
		return
	}

	resp := authTokensResponse(tokenPair, user, req.IncludeTokens)
	resp["needs_2fa"] = false
	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}
