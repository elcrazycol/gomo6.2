package handlers

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/geo"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

const maxSessionsPerUser = 10

// ─── Session identity helpers ────────────────────────────────────────────────

// sessionRow is the DB-backed identity of one logged-in device.
type sessionRow struct {
	ID          string
	RefreshHash string
	AccessJTI   string
}

// sha256hex returns the hex SHA-256 of a refresh token — the stable key used in
// both user_sessions.refresh_hash and the Redis refresh-token store.
func sha256hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// newSessionID returns a fresh opaque session id (32 hex chars). It is
// deliberately unrelated to any token, so the device identity survives token
// rotation for the whole session lifetime.
func newSessionID() string {
	return randomHex(32)
}

// createLoginSession mints a fresh token pair bound to a NEW stable session and
// persists the session row. This is the single entry point for every login
// path (password, 2FA, passkey, trusted device, registration).
func createLoginSession(db *sql.DB, rdb *redis.Client, authService *auth.AuthService, userID, username, domain, userAgent, ip string) (*auth.TokenPair, error) {
	sessionID := newSessionID()
	pair, err := authService.GenerateTokenPair(userID, username, domain, sessionID)
	if err != nil {
		return nil, err
	}
	insertSessionRow(db, userID, sessionID, sha256hex(pair.RefreshToken), pair.AccessJTI, userAgent, ip)
	cleanupOldSessions(db, rdb, authService, userID)
	return pair, nil
}

// insertSessionRow persists a session row. Errors are logged-away: session
// tracking is best-effort and must never break the login itself.
func insertSessionRow(db *sql.DB, userID, sessionID, refreshHash, accessJTI, userAgent, ip string) {
	osName, browserName, deviceType := parseUserAgent(userAgent)
	countryCode, countryName := geo.Lookup(ip)
	if _, err := db.Exec(`INSERT INTO user_sessions
		(id, user_id, refresh_hash, access_jti, user_agent, os_name, browser_name, device_type, ip_address, country_code, country_name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::inet, $10, $11)
		ON CONFLICT (id) DO NOTHING`,
		sessionID, userID, refreshHash, accessJTI, userAgent, osName, browserName, deviceType, ip, countryCode, countryName); err != nil {
		log.Printf("[sessions] failed to insert session row for user %s: %v", userID, err)
	}
}

// cleanupOldSessions keeps at most maxSessionsPerUser sessions per user. Only
// sessions whose refresh token is ALREADY dead (expired / revoked / missing)
// are reaped: a live refresh token means the device is still in use, and the
// cap must never log a working device out just because the user logged in on
// another one. Dead rows are fully revoked (refresh token + access token +
// row + live websockets) so they cannot resurrect on their next refresh.
func cleanupOldSessions(db *sql.DB, rdb *redis.Client, authSvc *auth.AuthService, userID string) {
	rows, err := db.Query(`SELECT id, refresh_hash, access_jti FROM user_sessions WHERE user_id = $1 ORDER BY last_active_at DESC`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	var all []sessionRow
	for rows.Next() {
		var s sessionRow
		if rows.Scan(&s.ID, &s.RefreshHash, &s.AccessJTI) == nil {
			all = append(all, s)
		}
	}

	if len(all) <= maxSessionsPerUser {
		return
	}

	for _, s := range all[maxSessionsPerUser:] {
		// Never reap a session with a live refresh token — the device is
		// actively usable even if it is the oldest beyond the cap. Only rows
		// whose token is already gone are dead weight.
		if s.RefreshHash == "" || authSvc == nil || !authSvc.RefreshTokenExistsByHash(userID, s.RefreshHash) {
			revokeSession(db, rdb, authSvc, userID, s)
		}
	}
}

// revokeSession kills a single session everywhere at once:
//  1. blacklists its current access token  → REST requests die immediately;
//  2. deletes its refresh token            → it can never refresh again;
//  3. deletes the row                      → it disappears from the list;
//  4. publishes a realtime kick            → live WebSockets are closed.
func revokeSession(db *sql.DB, rdb *redis.Client, authSvc *auth.AuthService, userID string, s sessionRow) {
	if authSvc != nil {
		if s.AccessJTI != "" {
			// Any access token issued for this session expires within 1h of its
			// own issuance, so blacklisting for 1h is airtight.
			authSvc.BlacklistToken(s.AccessJTI, time.Now().Add(time.Hour))
		}
		if s.RefreshHash != "" {
			authSvc.DeleteRefreshTokenByHash(userID, s.RefreshHash)
		}
	}
	if db != nil {
		db.Exec(`DELETE FROM user_sessions WHERE id = $1 AND user_id = $2`, s.ID, userID)
	}
	publishSessionRevoke(rdb, userID, s.ID)
}

// publishSessionRevoke tells every backend instance to disconnect the live
// WebSockets belonging to this exact session.
func publishSessionRevoke(rdb *redis.Client, userID, sessionID string) {
	if rdb == nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"user_id": userID, "session_id": sessionID})
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	rdb.Publish(ctx, "user:revoke", payload)
}

// publishUserRevoke tells every backend instance to disconnect ALL live
// WebSockets of a user (legacy full logout paths).
func publishUserRevoke(rdb *redis.Client, userID string) {
	if rdb == nil {
		return
	}
	payload, _ := json.Marshal(map[string]string{"user_id": userID})
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()
	rdb.Publish(ctx, "user:revoke", payload)
}

// loadSessionRows returns every session row of a user.
func loadSessionRows(db *sql.DB, userID string) []sessionRow {
	rows, err := db.Query(`SELECT id, refresh_hash, access_jti FROM user_sessions WHERE user_id = $1`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var out []sessionRow
	for rows.Next() {
		var s sessionRow
		if rows.Scan(&s.ID, &s.RefreshHash, &s.AccessJTI) == nil {
			out = append(out, s)
		}
	}
	return out
}

// fetchSessionByID returns a session row owned by the user, or sql.ErrNoRows.
func fetchSessionByID(db *sql.DB, userID, sessionID string) (sessionRow, error) {
	var s sessionRow
	err := db.QueryRow(`SELECT id, refresh_hash, access_jti FROM user_sessions WHERE id = $1 AND user_id = $2`, sessionID, userID).
		Scan(&s.ID, &s.RefreshHash, &s.AccessJTI)
	return s, err
}

// findSessionByRefreshHash returns the session whose current refresh token has
// the given hash, or sql.ErrNoRows. This is how rotation keeps identity.
func findSessionByRefreshHash(db *sql.DB, userID, refreshHash string) (sessionRow, error) {
	var s sessionRow
	err := db.QueryRow(`SELECT id, refresh_hash, access_jti FROM user_sessions WHERE user_id = $1 AND refresh_hash = $2`, userID, refreshHash).
		Scan(&s.ID, &s.RefreshHash, &s.AccessJTI)
	return s, err
}

// ─── AuthHandler convenience wrappers ────────────────────────────────────────

func (h *AuthHandler) createLoginSession(userID, username, domain, userAgent, ip string) (*auth.TokenPair, error) {
	return createLoginSession(h.db, h.redis, h.authService, userID, username, domain, userAgent, ip)
}

func (h *AuthHandler) revokeSessions(userID string, rows []sessionRow) {
	for _, s := range rows {
		revokeSession(h.db, h.redis, h.authService, userID, s)
	}
}

// ─── User-Agent parsing ───────────────────────────────────────────────────────

var uaMobileRe = regexp.MustCompile(`(?i)(mobile|android|iphone|ipad|windows phone)`)

func parseUserAgent(ua string) (osName, browserName, deviceType string) {
	ua = strings.TrimSpace(ua)
	if ua == "" {
		return "Unknown", "Unknown", "desktop"
	}

	switch {
	// iPhone/iPad first: their user agents contain "Mac OS X" ("like Mac OS
	// X"), so the iOS check must win over the generic macOS match.
	case strings.Contains(ua, "iPhone") || strings.Contains(ua, "iPad"):
		osName = "iOS"
	case strings.Contains(ua, "Windows"):
		osName = "Windows"
	case strings.Contains(ua, "Mac OS"):
		osName = "macOS"
	case strings.Contains(ua, "Linux") && !strings.Contains(ua, "Android"):
		osName = "Linux"
	case strings.Contains(ua, "Android"):
		osName = "Android"
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
	CountryCode  string `json:"country_code"`
	CountryName  string `json:"country_name"`
	CreatedAt    string `json:"created_at"`
	LastActiveAt string `json:"last_active_at"`
	IsCurrent    bool   `json:"is_current"`
	Online       bool   `json:"online"`
}

// ListSessions returns all sessions for the current user.
// GET /api/v1/auth/sessions
// ListSessions godoc
// @Summary      List active sessions
// @Description  List all devices/sessions for the authenticated user
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/sessions [get]
// @Security     BearerAuth
func (h *AuthHandler) ListSessions(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)
	currentSessionID := claims.SessionID

	// Seeing the list is itself activity: keep the current device's
	// last_active_at honest so "последняя активность" is real.
	if currentSessionID != "" {
		h.db.Exec(`UPDATE user_sessions SET last_active_at = NOW() WHERE id = $1 AND user_id = $2`, currentSessionID, claims.UserID)
	}

	rows, err := h.db.Query(`
		SELECT id, user_agent, os_name, browser_name, device_type,
			COALESCE(ip_address::text, '') as ip_address,
			country_code, country_name,
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
			&s.DeviceType, &s.IPAddress, &s.CountryCode, &s.CountryName,
			&s.CreatedAt, &s.LastActiveAt); err != nil {
			continue
		}

		s.IsCurrent = currentSessionID != "" && s.ID == currentSessionID

		if h.redis != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			val, err := h.redis.Exists(ctx, fmt.Sprintf("ws:online:%s:%s", claims.UserID, s.ID)).Result()
			cancel()
			s.Online = err == nil && val > 0
		}

		sessions = append(sessions, s)
	}

	if sessions == nil {
		sessions = []sessionResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(sessions))
}

// DeleteSession removes a single session and instantly revokes it.
// DELETE /api/v1/auth/sessions/:id
// DeleteSession godoc
// @Summary      Revoke a session
// @Description  Revoke a single session — that device is logged out instantly
// @Tags         Auth
// @Produce      json
// @Param        id path string true "Session ID"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /auth/sessions/{id} [delete]
// @Security     BearerAuth
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

	row, err := fetchSessionByID(h.db, claims.UserID, sessionID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Session not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}

	wasCurrent := claims.SessionID != "" && claims.SessionID == sessionID

	revokeSession(h.db, h.redis, h.authService, claims.UserID, row)

	// If the caller just killed their own session, also blacklist the access
	// token they are using right now (it predates the row's stored jti only if
	// it was issued after the last rotation — blacklisting both is harmless).
	if wasCurrent && claims.ID != "" && claims.ExpiresAt != nil {
		h.authService.BlacklistToken(claims.ID, claims.ExpiresAt.Time)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"ok":          true,
		"is_current":  wasCurrent,
		"was_current": wasCurrent,
	}))
}

// DeleteAllOtherSessions removes every session except the current one.
// DELETE /api/v1/auth/sessions
// DeleteAllOtherSessions godoc
// @Summary      Revoke all other sessions
// @Description  Revoke every session except the current one
// @Tags         Auth
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/sessions [delete]
// @Security     BearerAuth
func (h *AuthHandler) DeleteAllOtherSessions(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	currentSessionID := claims.SessionID
	rows := loadSessionRows(h.db, claims.UserID)

	others := make([]sessionRow, 0, len(rows))
	for _, s := range rows {
		if s.ID != currentSessionID {
			others = append(others, s)
		}
	}

	h.revokeSessions(claims.UserID, others)

	// A pure-bearer/API caller has no session row of its own; the rows we found
	// belong to its other devices. Nothing further to revoke.
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": len(others)}))
}
