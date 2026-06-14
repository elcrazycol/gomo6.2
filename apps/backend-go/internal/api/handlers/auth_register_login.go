package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

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

	// Validate password strength
	if err := validatePassword(req.Password); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Hash password (cost=12, ~250ms on modern hardware)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
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

	// Generate token pair (access + refresh)
	tokenPair, err := h.authService.GenerateTokenPair(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"user":          user,
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
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
		Website  string `json:"website,omitempty"` // Honeypot field — must be empty
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// ── Honeypot check ──
	if req.Website != "" {
		clientIP := c.ClientIP()
		log.Printf("[Honeypot] Bot detected on login from IP %s (website=%q)", clientIP, req.Website)
		// Silently succeed to mislead the bot — generic invalid credentials
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid credentials"))
		return
	}

	// Check account lockout
	if h.redis != nil {
		lockKey := fmt.Sprintf("lockout:%s", req.Email)
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		attempts, err := h.redis.Get(ctx, lockKey).Int()
		cancel()
		if err == nil && attempts >= 5 {
			c.JSON(http.StatusTooManyRequests, models.ErrorResponse("Account temporarily locked. Try again in 15 minutes."))
			return
		}
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
		// Record failed attempt
		if h.redis != nil {
			h.recordFailedAttempt(req.Email)
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid credentials"))
		return
	}

	// Reset lockout counter on successful password verification
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		h.redis.Del(ctx, fmt.Sprintf("lockout:%s", req.Email))
		cancel()
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
						tokenPair, err := h.authService.GenerateTokenPair(user.ID, user.Username, user.Domain)
						if err != nil {
							c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
							return
						}

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

	// No 2FA, generate token pair directly
	tokenPair, err := h.authService.GenerateTokenPair(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user":          user,
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
		"needs_2fa":     false,
	}))
}
