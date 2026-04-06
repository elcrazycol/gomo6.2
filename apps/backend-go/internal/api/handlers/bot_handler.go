package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

type BotHandler struct {
	DB         *sql.DB
	BotManager interface{}
}

func NewBotHandler(db *sql.DB) *BotHandler {
	return &BotHandler{DB: db}
}

// SetBotManager sets the bot manager for dynamic bot loading
func (h *BotHandler) SetBotManager(manager interface{}) {
	h.BotManager = manager
}

// generateBotToken generates a secure random token for bot authentication
func generateBotToken() (string, error) {
	bytes := make([]byte, 32)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return hex.EncodeToString(bytes), nil
}

// getUserIDFromContext extracts user ID from JWT claims
func getUserIDFromContext(c *gin.Context) (string, error) {
	claimsInterface, exists := c.Get("claims")
	if !exists {
		return "", fmt.Errorf("no claims in context")
	}

	claims, ok := claimsInterface.(*auth.Claims)
	if !ok {
		return "", fmt.Errorf("invalid claims type")
	}

	return claims.UserID, nil
}

// CreateBot creates a new bot
func (h *BotHandler) CreateBot(c *gin.Context) {
	log.Println("=== CreateBot CALLED ===")

	// Check what's in context
	claimsInterface, claimsExists := c.Get("claims")
	log.Printf("Claims exists: %v, value: %+v\n", claimsExists, claimsInterface)

	userID, err := getUserIDFromContext(c)
	if err != nil {
		log.Println("DEBUG: getUserIDFromContext failed:", err)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "HANDLER: Unauthorized"})
		return
	}
	log.Println("DEBUG: userID from context:", userID)

	var req models.CreateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if user already has 5 bots (limit)
	var botCount int
	err = h.DB.QueryRow("SELECT COUNT(*) FROM bots WHERE owner_id = $1", userID).Scan(&botCount)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check bot count"})
		return
	}
	if botCount >= 5 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Maximum 5 bots per user"})
		return
	}

	// Check if username is already taken
	var exists bool
	err = h.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM bots WHERE username = $1)", req.Username).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check username"})
		return
	}
	if exists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Username already taken"})
		return
	}

	// Check Lua code size (max 10KB)
	if len(req.LuaCode) > 10240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Lua code too large (max 10KB)"})
		return
	}

	// Generate bot token
	token, err := generateBotToken()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate token"})
		return
	}

	// Create bot
	var bot models.Bot
	err = h.DB.QueryRow(`
		INSERT INTO bots (owner_id, username, display_name, avatar_url, description, lua_code, token)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
	`, userID, req.Username, req.DisplayName, req.AvatarURL, req.Description, req.LuaCode, token).Scan(
		&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
		&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create bot"})
		return
	}

	// Load bot into BotManager if available
	if h.BotManager != nil {
		if bm, ok := h.BotManager.(interface{ LoadBot(*models.Bot) error }); ok {
			if err := bm.LoadBot(&bot); err != nil {
				log.Printf("Warning: Failed to load bot into manager: %v", err)
			} else {
				log.Printf("Bot loaded into manager: %s", bot.ID)
			}
		}
	}

	c.JSON(http.StatusCreated, bot)
}

// GetBots returns all bots owned by the current user
func (h *BotHandler) GetBots(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	rows, err := h.DB.Query(`
		SELECT id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
		FROM bots
		WHERE owner_id = $1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bots"})
		return
	}
	defer rows.Close()

	var bots []models.Bot
	for rows.Next() {
		var bot models.Bot
		err := rows.Scan(
			&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
			&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
		)
		if err != nil {
			continue
		}
		bots = append(bots, bot)
	}

	c.JSON(http.StatusOK, bots)
}

// GetBot returns a specific bot
func (h *BotHandler) GetBot(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	var bot models.Bot
	err = h.DB.QueryRow(`
		SELECT id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
		FROM bots
		WHERE id = $1 AND owner_id = $2
	`, botID, userID).Scan(
		&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
		&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch bot"})
		return
	}

	c.JSON(http.StatusOK, bot)
}

// UpdateBot updates a bot
func (h *BotHandler) UpdateBot(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	var req models.UpdateBotRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if bot exists and belongs to user
	var exists bool
	err = h.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM bots WHERE id = $1 AND owner_id = $2)", botID, userID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	// Check Lua code size if provided
	if req.LuaCode != nil && len(*req.LuaCode) > 10240 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Lua code too large (max 10KB)"})
		return
	}

	// Build update query dynamically
	updates := []string{"updated_at = NOW()"}
	args := []interface{}{}
	argIndex := 1

	if req.DisplayName != nil {
		updates = append(updates, "display_name = $"+fmt.Sprint(argIndex))
		args = append(args, *req.DisplayName)
		argIndex++
	}
	if req.AvatarURL != nil {
		updates = append(updates, "avatar_url = $"+fmt.Sprint(argIndex))
		args = append(args, *req.AvatarURL)
		argIndex++
	}
	if req.Description != nil {
		updates = append(updates, "description = $"+fmt.Sprint(argIndex))
		args = append(args, *req.Description)
		argIndex++
	}
	if req.LuaCode != nil {
		updates = append(updates, "lua_code = $"+fmt.Sprint(argIndex))
		args = append(args, *req.LuaCode)
		argIndex++
	}
	if req.IsActive != nil {
		updates = append(updates, "is_active = $"+fmt.Sprint(argIndex))
		args = append(args, *req.IsActive)
		argIndex++
	}

	// Add WHERE clause parameters
	args = append(args, botID, userID)

	query := "UPDATE bots SET " + strings.Join(updates, ", ") +
		" WHERE id = $" + fmt.Sprint(argIndex) + " AND owner_id = $" + fmt.Sprint(argIndex+1) +
		" RETURNING id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at"

	var bot models.Bot
	err = h.DB.QueryRow(query, args...).Scan(
		&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
		&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update bot"})
		return
	}

	// Reload bot in BotManager if available
	if h.BotManager != nil {
		if bm, ok := h.BotManager.(interface{ ReloadBot(string) error }); ok {
			if err := bm.ReloadBot(botID); err != nil {
				log.Printf("Warning: Failed to reload bot in manager: %v", err)
			} else {
				log.Printf("Bot reloaded in manager: %s", botID)
			}
		}
	}

	c.JSON(http.StatusOK, bot)
}

// DeleteBot deletes a bot
func (h *BotHandler) DeleteBot(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	result, err := h.DB.Exec("DELETE FROM bots WHERE id = $1 AND owner_id = $2", botID, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete bot"})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	// Unload bot from BotManager if available
	if h.BotManager != nil {
		if bm, ok := h.BotManager.(interface{ UnloadBot(string) }); ok {
			bm.UnloadBot(botID)
			log.Printf("Bot unloaded from manager: %s", botID)
		}
	}

	c.JSON(http.StatusOK, gin.H{"message": "Bot deleted successfully"})
}

// ToggleBot toggles bot active status
func (h *BotHandler) ToggleBot(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	var bot models.Bot
	err = h.DB.QueryRow(`
		UPDATE bots
		SET is_active = NOT is_active, updated_at = NOW()
		WHERE id = $1 AND owner_id = $2
		RETURNING id, owner_id, username, display_name, avatar_url, description, lua_code, token, is_active, created_at, updated_at
	`, botID, userID).Scan(
		&bot.ID, &bot.OwnerID, &bot.Username, &bot.DisplayName, &bot.AvatarURL,
		&bot.Description, &bot.LuaCode, &bot.Token, &bot.IsActive, &bot.CreatedAt, &bot.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to toggle bot"})
		return
	}

	// Reload or unload bot based on new status
	if h.BotManager != nil {
		if bot.IsActive {
			if bm, ok := h.BotManager.(interface{ ReloadBot(string) error }); ok {
				if err := bm.ReloadBot(botID); err != nil {
					log.Printf("Warning: Failed to reload bot in manager: %v", err)
				} else {
					log.Printf("Bot reloaded in manager: %s", botID)
				}
			}
		} else {
			if bm, ok := h.BotManager.(interface{ UnloadBot(string) }); ok {
				bm.UnloadBot(botID)
				log.Printf("Bot unloaded from manager: %s", botID)
			}
		}
	}

	c.JSON(http.StatusOK, bot)
}

// GetBotLogs returns logs for a bot
func (h *BotHandler) GetBotLogs(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	// Check if bot belongs to user
	var exists bool
	err = h.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM bots WHERE id = $1 AND owner_id = $2)", botID, userID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	// Get logs (last 100)
	rows, err := h.DB.Query(`
		SELECT id, bot_id, level, message, context, created_at
		FROM bot_logs
		WHERE bot_id = $1
		ORDER BY created_at DESC
		LIMIT 100
	`, botID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch logs"})
		return
	}
	defer rows.Close()

	var logs []models.BotLog
	for rows.Next() {
		var log models.BotLog
		err := rows.Scan(&log.ID, &log.BotID, &log.Level, &log.Message, &log.Context, &log.CreatedAt)
		if err != nil {
			continue
		}
		logs = append(logs, log)
	}

	c.JSON(http.StatusOK, logs)
}

// GetBotStats returns statistics for a bot
func (h *BotHandler) GetBotStats(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	// Check if bot belongs to user
	var exists bool
	err = h.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM bots WHERE id = $1 AND owner_id = $2)", botID, userID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	// Get stats for last 30 days
	rows, err := h.DB.Query(`
		SELECT id, bot_id, messages_sent, messages_received, commands_processed, errors_count, date
		FROM bot_stats
		WHERE bot_id = $1 AND date >= $2
		ORDER BY date DESC
	`, botID, time.Now().AddDate(0, 0, -30))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch stats"})
		return
	}
	defer rows.Close()

	var stats []models.BotStats
	for rows.Next() {
		var stat models.BotStats
		err := rows.Scan(&stat.ID, &stat.BotID, &stat.MessagesSent, &stat.MessagesReceived,
			&stat.CommandsProcessed, &stat.ErrorsCount, &stat.Date)
		if err != nil {
			continue
		}
		stats = append(stats, stat)
	}

	c.JSON(http.StatusOK, stats)
}

// ClearBotLogs clears all logs for a bot
func (h *BotHandler) ClearBotLogs(c *gin.Context) {
	userID, err := getUserIDFromContext(c)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return
	}

	botID := c.Param("id")

	// Check if bot belongs to user
	var exists bool
	err = h.DB.QueryRow("SELECT EXISTS(SELECT 1 FROM bots WHERE id = $1 AND owner_id = $2)", botID, userID).Scan(&exists)
	if err != nil || !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Bot not found"})
		return
	}

	_, err = h.DB.Exec("DELETE FROM bot_logs WHERE bot_id = $1", botID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to clear logs"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Logs cleared successfully"})
}
