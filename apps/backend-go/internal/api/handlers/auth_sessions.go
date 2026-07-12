package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

const maxSessionsPerUser = 10

// ─── Session helpers ──────────────────────────────────────────────────────────

// SessionIDFromRefreshToken computes the session ID (64-char hex SHA-256) from a refresh token.
func SessionIDFromRefreshToken(refreshToken string) string {
	hash := sha256.Sum256([]byte(refreshToken))
	return hex.EncodeToString(hash[:])
}

// createSessionDB inserts a new session row and marks it as current in Redis.
func createSessionDB(db *sql.DB, rdb *redis.Client, userID, refreshToken, userAgent, ip string) {
	sessionID := SessionIDFromRefreshToken(refreshToken)
	osName, browserName, deviceType := parseUserAgent(userAgent)

	db.Exec(`INSERT INTO user_sessions (id, user_id, user_agent, os_name, browser_name, device_type, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (id) DO NOTHING`,
		sessionID, userID, userAgent, osName, browserName, deviceType, ip)

	if rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		rdb.Set(ctx, fmt.Sprintf("current:%s:%s", userID, sessionID), "1", 1*time.Hour)
	}

	cleanupOldSessionsDB(db, rdb, userID, sessionID)
}

// deleteSessionDB removes a session from DB and Redis.
func deleteSessionDB(db *sql.DB, rdb *redis.Client, userID, sessionID string) {
	db.Exec(`DELETE FROM user_sessions WHERE id = $1 AND user_id = $2`, sessionID, userID)

	if rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		rdb.Del(ctx, fmt.Sprintf("refresh:%s:%s", userID, sessionID))
		rdb.Del(ctx, fmt.Sprintf("current:%s:%s", userID, sessionID))
	}
}

// cleanupOldSessionsDB keeps at most maxSessionsPerUser sessions, removing the oldest.
func cleanupOldSessionsDB(db *sql.DB, rdb *redis.Client, userID, currentSessionID string) {
	rows, err := db.Query(`SELECT id FROM user_sessions WHERE user_id = $1 ORDER BY last_active_at DESC`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}

	if len(ids) <= maxSessionsPerUser {
		return
	}

	toDelete := ids[maxSessionsPerUser:]
	for _, id := range toDelete {
		deleteSessionDB(db, rdb, userID, id)
	}
}

// ─── AuthHandler methods (convenience wrappers) ──────────────────────────────

func (h *AuthHandler) createSession(userID, refreshToken, userAgent, ip string) {
	createSessionDB(h.db, h.redis, userID, refreshToken, userAgent, ip)
}

func (h *AuthHandler) deleteSession(userID, sessionID string) {
	deleteSessionDB(h.db, h.redis, userID, sessionID)
}

// ─── User-Agent parsing ───────────────────────────────────────────────────────

var uaMobileRe = regexp.MustCompile(`(?i)(mobile|android|iphone|ipad|windows phone)`)

func parseUserAgent(ua string) (osName, browserName, deviceType string) {
	ua = strings.TrimSpace(ua)
	if ua == "" {
		return "Unknown", "Unknown", "desktop"
	}

	switch {
	case strings.Contains(ua, "Windows"):
		osName = "Windows"
	case strings.Contains(ua, "Mac OS"):
		osName = "macOS"
	case strings.Contains(ua, "Linux") && !strings.Contains(ua, "Android"):
		osName = "Linux"
	case strings.Contains(ua, "Android"):
		osName = "Android"
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		osName = "iOS"
	default:
		osName = "Unknown"
	}

	switch {
	case strings.Contains(ua, "Edg/"):
		browserName = "Edge"
	case strings.Contains(ua, "OPR/") || strings.Contains(ua, "Opera"):
		browserName = "Opera"
	case strings.Contains(ua, "Chrome") && !strings.Contains(ua, "Edg/"):
		browserName = "Chrome"
	case strings.Contains(ua, "Firefox"):
		browserName = "Firefox"
	case strings.Contains(ua, "Safari") && !strings.Contains(ua, "Chrome"):
		browserName = "Safari"
	default:
		browserName = "Unknown"
	}

	if uaMobileRe.MatchString(ua) {
		if strings.Contains(ua, "iPad") {
			deviceType = "tablet"
		} else {
			deviceType = "mobile"
		}
	} else {
		deviceType = "desktop"
	}

	return osName, browserName, deviceType
}

// ─── API Handlers ─────────────────────────────────────────────────────────────

type sessionResponse struct {
	ID           string `json:"id"`
	UserAgent    string `json:"user_agent"`
	OSName       string `json:"os_name"`
	BrowserName  string `json:"browser_name"`
	DeviceType   string `json:"device_type"`
	IPAddress    string `json:"ip_address"`
	CreatedAt    string `json:"created_at"`
	LastActiveAt string `json:"last_active_at"`
	IsCurrent    bool   `json:"is_current"`
}

// ListSessions returns all sessions for the current user.
// GET /api/v1/auth/sessions
func (h *AuthHandler) ListSessions(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	rows, err := h.db.Query(`
		SELECT id, user_agent, os_name, browser_name, device_type,
			COALESCE(ip_address::text, '') as ip_address,
			created_at, last_active_at
		FROM user_sessions
		WHERE user_id = $1
		ORDER BY last_active_at DESC
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}
	defer rows.Close()

	var sessions []sessionResponse
	for rows.Next() {
		var s sessionResponse
		if err := rows.Scan(&s.ID, &s.UserAgent, &s.OSName, &s.BrowserName,
			&s.DeviceType, &s.IPAddress, &s.CreatedAt, &s.LastActiveAt); err != nil {
			continue
		}

		if h.redis != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			val, err := h.redis.Get(ctx, fmt.Sprintf("current:%s:%s", claims.UserID, s.ID)).Result()
			cancel()
			s.IsCurrent = err == nil && val != ""
		}

		sessions = append(sessions, s)
	}

	if sessions == nil {
		sessions = []sessionResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(sessions))
}

// DeleteSession removes a single session.
// DELETE /api/v1/auth/sessions/:id
func (h *AuthHandler) DeleteSession(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	sessionID := c.Param("id")
	if sessionID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("session id is required"))
		return
	}

	var sessionExists bool
	h.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM user_sessions WHERE id = $1 AND user_id = $2)`,
		sessionID, claims.UserID).Scan(&sessionExists)

	if !sessionExists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Session not found"))
		return
	}

	isCurrent := false
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
		val, err := h.redis.Get(ctx, fmt.Sprintf("current:%s:%s", claims.UserID, sessionID)).Result()
		cancel()
		isCurrent = err == nil && val != ""
	}

	h.deleteSession(claims.UserID, sessionID)

	if isCurrent && claims.ExpiresAt != nil {
		h.authService.BlacklistToken(claims.ID, claims.ExpiresAt.Time)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"ok":          true,
		"is_current":  isCurrent,
		"was_current": isCurrent,
	}))
}

// DeleteAllOtherSessions removes all sessions except the current one.
// DELETE /api/v1/auth/sessions
func (h *AuthHandler) DeleteAllOtherSessions(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	// Find current session ID by scanning Redis
	var currentSessionID string
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		iter := h.redis.Scan(ctx, 0, fmt.Sprintf("current:%s:*", claims.UserID), 100).Iterator()
		for iter.Next(ctx) {
			key := iter.Val()
			parts := strings.Split(key, ":")
			if len(parts) == 3 {
				currentSessionID = parts[2]
				break
			}
		}
		cancel()
	}

	if currentSessionID == "" {
		h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1`, claims.UserID)
		h.authService.RevokeAllRefreshTokens(claims.UserID)
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": 0}))
		return
	}

	result, err := h.db.Exec(`DELETE FROM user_sessions WHERE user_id = $1 AND id != $2`,
		claims.UserID, currentSessionID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}
	deleted, _ := result.RowsAffected()

	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()

		iter := h.redis.Scan(ctx, 0, fmt.Sprintf("refresh:%s:*", claims.UserID), 100).Iterator()
		for iter.Next(ctx) {
			key := iter.Val()
			parts := strings.Split(key, ":")
			if len(parts) == 3 && parts[2] != currentSessionID {
				h.redis.Del(ctx, key)
			}
		}

		iter2 := h.redis.Scan(ctx, 0, fmt.Sprintf("current:%s:*", claims.UserID), 100).Iterator()
		for iter2.Next(ctx) {
			key := iter2.Val()
			parts := strings.Split(key, ":")
			if len(parts) == 3 && parts[2] != currentSessionID {
				h.redis.Del(ctx, key)
			}
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": deleted}))
}
