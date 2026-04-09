package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
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
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to hash password"),
		})
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to create user"),
		})
		return
	}

	// Generate JWT token
	token, err := h.authService.GenerateToken(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to generate token"),
		})
		return
	}

	c.JSON(http.StatusCreated, models.SupabaseResponse{
		Data: gin.H{
			"user":  user,
			"token": token,
		},
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var req models.LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	// Get user from database
	query := `
		SELECT id, username, email, domain, password_hash, created_at 
		FROM users 
		WHERE email = $1
	`

	var user models.User
	var passwordHash string
	err := h.db.QueryRow(query, req.Email).Scan(
		&user.ID, &user.Username, &user.Email, &user.Domain, &passwordHash, &user.CreatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
				Error: stringPtr("Invalid credentials"),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Database error"),
		})
		return
	}

	// Check password
	err = bcrypt.CompareHashAndPassword([]byte(passwordHash), []byte(req.Password))
	if err != nil {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Invalid credentials"),
		})
		return
	}

	// Generate JWT token
	token, err := h.authService.GenerateToken(user.ID, user.Username, user.Domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to generate token"),
		})
		return
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: gin.H{
			"user":  user,
			"token": token,
		},
	})
}

func (h *AuthHandler) GetMe(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Not authenticated"),
		})
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("User not found"),
		})
		return
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: user,
	})
}

// UpdatePassword sets a new password for the authenticated user (Supabase auth.updateUser compatibility).
func (h *AuthHandler) UpdatePassword(c *gin.Context) {
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Not authenticated"),
		})
		return
	}
	userClaims := claims.(*auth.Claims)

	var body struct {
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || len(body.Password) < 6 {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr("Password must be at least 6 characters"),
		})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr("Failed to hash password"),
		})
		return
	}

	_, err = h.db.Exec(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, string(hashedPassword), userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: gin.H{"ok": true},
	})
}

func stringPtr(s string) *string {
	return &s
}
