package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

var botUsernameRegex = regexp.MustCompile(`^[a-zA-Z0-9_]+_bot$`)

type BotsHandler struct {
	db *sql.DB
}

func NewBotsHandler(db *sql.DB) *BotsHandler {
	return &BotsHandler{db: db}
}

func generateBotToken() (rawToken string, hash string, err error) {
	bytes := make([]byte, 32)
	if _, err = rand.Read(bytes); err != nil {
		return
	}
	rawToken = "gomo6_bot_" + hex.EncodeToString(bytes)
	hashBytes := sha256.Sum256([]byte(rawToken))
	hash = hex.EncodeToString(hashBytes[:])
	return
}

// GET /api/v1/bots
func (h *BotsHandler) ListBots(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	rows, err := h.db.Query(`
		SELECT id, owner_id, user_id, username, display_name, description, is_active, created_at, updated_at
		FROM bots WHERE owner_id = $1 ORDER BY created_at DESC`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to fetch bots"))
		return
	}
	defer rows.Close()

	bots := []models.Bot{}
	for rows.Next() {
		var b models.Bot
		if err := rows.Scan(&b.ID, &b.OwnerID, &b.UserID, &b.Username, &b.DisplayName, &b.Description, &b.IsActive, &b.CreatedAt, &b.UpdatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to scan bot"))
			return
		}
		bots = append(bots, b)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(bots))
}

// POST /api/v1/bots
func (h *BotsHandler) CreateBot(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	var req models.CreateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request: "+err.Error()))
		return
	}

	req.Username = strings.TrimSpace(req.Username)
	if !botUsernameRegex.MatchString(req.Username) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Username must end with _bot and contain only letters, numbers, and underscores"))
		return
	}

	// Check bot limit
	var count int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM bots WHERE owner_id = $1", claims.UserID).Scan(&count); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check bot limit"))
		return
	}
	if count >= 5 {
		c.JSON(http.StatusConflict, models.ErrorResponse("Maximum 5 bots per account"))
		return
	}

	// Check username uniqueness in users table
	var exists bool
	if err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1)", req.Username).Scan(&exists); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check username"))
		return
	}
	if exists {
		c.JSON(http.StatusConflict, models.ErrorResponse("Username already taken"))
		return
	}

	rawToken, tokenHash, err := generateBotToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to start transaction"))
		return
	}
	defer tx.Rollback()

	// Create user account for bot
	var botUserID string
	botEmail := req.Username + "@bot.gomo6"
	err = tx.QueryRow(`
		INSERT INTO users (id, username, email, password_hash, domain, is_anonymous)
		VALUES (gen_random_uuid(), $1, $2, $3, 'bot.gomo6', false)
		RETURNING id`, req.Username, botEmail, hex.EncodeToString([]byte(randHex(32)))).Scan(&botUserID)
	if err != nil {
		log.Printf("[CreateBot] INSERT users failed: %v", err)
		if strings.Contains(err.Error(), "duplicate key") {
			c.JSON(http.StatusConflict, models.ErrorResponse("Username already taken"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to create bot user"))
		return
	}

	// Create bot record
	var botID string
	err = tx.QueryRow(`
		INSERT INTO bots (id, owner_id, user_id, username, display_name, description, token_hash)
		VALUES ($1, $2, $1, $3, $4, $5, $6)
		RETURNING id`, botUserID, claims.UserID, req.Username, req.DisplayName, req.Description, tokenHash).Scan(&botID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to create bot"))
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to commit transaction"))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(models.BotWithToken{
		Bot: models.Bot{
			ID:          botID,
			OwnerID:     claims.UserID,
			UserID:      botUserID,
			Username:    req.Username,
			DisplayName: req.DisplayName,
			Description: req.Description,
			IsActive:    true,
		},
		Token: rawToken,
	}))
}

// GET /api/v1/bots/:id
func (h *BotsHandler) GetBot(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	botID := c.Param("id")

	var b models.Bot
	err := h.db.QueryRow(`
		SELECT id, owner_id, user_id, username, display_name, description, is_active, created_at, updated_at
		FROM bots WHERE id = $1 AND owner_id = $2`, botID, claims.UserID).Scan(
		&b.ID, &b.OwnerID, &b.UserID, &b.Username, &b.DisplayName, &b.Description, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Bot not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to fetch bot"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(b))
}

// PUT /api/v1/bots/:id
func (h *BotsHandler) UpdateBot(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	botID := c.Param("id")

	var req struct {
		DisplayName *string `json:"display_name"`
		Description *string `json:"description"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request"))
		return
	}

	result, err := h.db.Exec(`
		UPDATE bots SET display_name = $1, description = $2, updated_at = NOW()
		WHERE id = $3 AND owner_id = $4`, req.DisplayName, req.Description, botID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to update bot"))
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Bot not found"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// DELETE /api/v1/bots/:id
func (h *BotsHandler) DeleteBot(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	botID := c.Param("id")

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to start transaction"))
		return
	}
	defer tx.Rollback()

	// Get bot's user_id before deleting
	var botUserID string
	err = tx.QueryRow("SELECT user_id FROM bots WHERE id = $1 AND owner_id = $2", botID, claims.UserID).Scan(&botUserID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Bot not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to fetch bot"))
		return
	}

	// Delete bot record first
	if _, err := tx.Exec("DELETE FROM bots WHERE id = $1 AND owner_id = $2", botID, claims.UserID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to delete bot"))
		return
	}

	// Delete bot's user account
	if _, err := tx.Exec("DELETE FROM users WHERE id = $1", botUserID); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to delete bot user"))
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to commit transaction"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// POST /api/v1/bots/:id/toggle
func (h *BotsHandler) ToggleBot(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	botID := c.Param("id")

	var isActive bool
	err := h.db.QueryRow(`
		UPDATE bots SET is_active = NOT is_active, updated_at = NOW()
		WHERE id = $1 AND owner_id = $2
		RETURNING is_active`, botID, claims.UserID).Scan(&isActive)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Bot not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to toggle bot"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"is_active": isActive}))
}

// POST /api/v1/bots/:id/regenerate-token
func (h *BotsHandler) RegenerateToken(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	botID := c.Param("id")

	rawToken, tokenHash, err := generateBotToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	var b models.Bot
	err = h.db.QueryRow(`
		UPDATE bots SET token_hash = $1, updated_at = NOW()
		WHERE id = $2 AND owner_id = $3
		RETURNING id, owner_id, user_id, username, display_name, description, is_active, created_at, updated_at`,
		tokenHash, botID, claims.UserID).Scan(
		&b.ID, &b.OwnerID, &b.UserID, &b.Username, &b.DisplayName, &b.Description, &b.IsActive, &b.CreatedAt, &b.UpdatedAt)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Bot not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to regenerate token"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(models.BotWithToken{
		Bot:   b,
		Token: rawToken,
	}))
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}
