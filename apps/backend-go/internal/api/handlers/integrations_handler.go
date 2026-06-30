package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/integrations"
)

// IntegrationsHandler handles third-party service integrations (Spotify, etc.)
type IntegrationsHandler struct {
	db      *sql.DB
	spotify *integrations.SpotifyService
}

// NewIntegrationsHandler creates a new integrations handler
func NewIntegrationsHandler(db *sql.DB) *IntegrationsHandler {
	return &IntegrationsHandler{
		db:      db,
		spotify: integrations.NewSpotifyService(db),
	}
}

// generateState creates a random state string for OAuth CSRF protection
func generateState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// ─── Spotify Handlers ───────────────────────────────────────────────────────

// GetSpotifyAuthURL returns the Spotify OAuth authorization URL
// @Summary Get Spotify authorization URL
// @Tags integrations
// @Security BearerAuth
// @Success 200 {object} integrations.AuthURLResponse
// @Router /api/v1/integrations/spotify/auth-url [get]
func (h *IntegrationsHandler) GetSpotifyAuthURL(c *gin.Context) {
	if !h.spotify.IsConfigured() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Spotify integration not configured"})
		return
	}

	state, err := generateState()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate state"})
		return
	}

	claims := c.MustGet("claims").(*auth.Claims)

	// Store the state in Redis with 10 minute expiry via DB (no Redis dependency in this handler)
	// We'll store it in the user_integrations table temporarily as a pending state
	_, err = h.db.Exec(`
		INSERT INTO user_integrations (user_id, provider, encrypted_access_token, is_connected)
		VALUES ($1, 'spotify_pending', $2, false)
		ON CONFLICT (user_id, provider) DO UPDATE SET encrypted_access_token = $2, updated_at = NOW()`,
		claims.UserID, state,
	)
	if err != nil {
		log.Printf("[Integrations] Failed to store OAuth state: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Internal error"})
		return
	}

	authURL, err := h.spotify.GetAuthURL(state)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, integrations.AuthURLResponse{AuthURL: authURL})
}

// SpotifyCallback handles the OAuth callback from Spotify
// @Summary Handle Spotify OAuth callback
// @Tags integrations
// @Param code query string true "Authorization code"
// @Param state query string true "State parameter"
// @Router /api/v1/integrations/spotify/callback [get]
func (h *IntegrationsHandler) SpotifyCallback(c *gin.Context) {
	code := c.Query("code")
	state := c.Query("state")
	errorParam := c.Query("error")

	if errorParam != "" {
		h.redirectToSettings(c, "error", "Spotify authorization denied")
		return
	}

	if code == "" || state == "" {
		h.redirectToSettings(c, "error", "Missing code or state")
		return
	}

	// Find the pending integration by state
	var userID string
	err := h.db.QueryRow(`
		DELETE FROM user_integrations
		WHERE provider = 'spotify_pending' AND encrypted_access_token = $1
		RETURNING user_id`,
		state,
	).Scan(&userID)
	if err == sql.ErrNoRows {
		h.redirectToSettings(c, "error", "Invalid or expired state")
		return
	}
	if err != nil {
		log.Printf("[Integrations] Failed to validate state: %v", err)
		h.redirectToSettings(c, "error", "Internal error")
		return
	}

	// Exchange code for tokens
	tokens, err := h.spotify.ExchangeCode(code)
	if err != nil {
		log.Printf("[Integrations] Token exchange failed: %v", err)
		h.redirectToSettings(c, "error", "Failed to exchange code")
		return
	}

	// Fetch Spotify user profile
	profile, err := h.spotify.GetUserProfile(tokens.AccessToken)
	if err != nil {
		log.Printf("[Integrations] Failed to get Spotify profile: %v", err)
		h.redirectToSettings(c, "error", "Failed to fetch Spotify profile")
		return
	}

	// Encrypt tokens
	encAccessToken, err := integrations.EncryptToken(tokens.AccessToken)
	if err != nil {
		log.Printf("[Integrations] Failed to encrypt access token: %v", err)
		h.redirectToSettings(c, "error", "Internal error")
		return
	}

	encRefreshToken, err := integrations.EncryptToken(tokens.RefreshToken)
	if err != nil {
		log.Printf("[Integrations] Failed to encrypt refresh token: %v", err)
		h.redirectToSettings(c, "error", "Internal error")
		return
	}

	// Extract avatar URL (largest image)
	var avatarURL *string
	if len(profile.Images) > 0 {
		avatarURL = &profile.Images[0].URL
	}

	displayName := profile.DisplayName
	if displayName == "" {
		displayName = profile.ID
	}

	expiresAt := time.Now().Add(time.Duration(tokens.ExpiresIn) * time.Second)

	// Upsert the integration
	_, err = h.db.Exec(`
		INSERT INTO user_integrations (user_id, provider, encrypted_access_token, encrypted_refresh_token, token_expires_at, spotify_username, spotify_avatar_url, is_connected)
		VALUES ($1, 'spotify', $2, $3, $4, $5, $6, true)
		ON CONFLICT (user_id, provider) DO UPDATE SET
			encrypted_access_token = $2,
			encrypted_refresh_token = $3,
			token_expires_at = $4,
			spotify_username = $5,
			spotify_avatar_url = $6,
			is_connected = true,
			updated_at = NOW()`,
		userID, encAccessToken, encRefreshToken, expiresAt, displayName, avatarURL,
	)
	if err != nil {
		log.Printf("[Integrations] Failed to save integration: %v", err)
		h.redirectToSettings(c, "error", "Failed to save integration")
		return
	}

	h.redirectToSettings(c, "success", "Spotify подключён!")
}

// DisconnectSpotify removes the Spotify integration for the authenticated user
// @Summary Disconnect Spotify
// @Tags integrations
// @Security BearerAuth
// @Success 200
// @Router /api/v1/integrations/spotify/disconnect [delete]
func (h *IntegrationsHandler) DisconnectSpotify(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	_, err := h.db.Exec(`
		UPDATE user_integrations SET is_connected = false, updated_at = NOW()
		WHERE user_id = $1 AND provider = 'spotify'`,
		claims.UserID,
	)
	if err != nil {
		log.Printf("[Integrations] Failed to disconnect: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to disconnect"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "disconnected"})
}

// GetSpotifyStatus returns the Spotify connection status for the authenticated user
// @Summary Get Spotify connection status
// @Tags integrations
// @Security BearerAuth
// @Success 200 {object} integrations.IntegrationStatusResponse
// @Router /api/v1/integrations/spotify/status [get]
func (h *IntegrationsHandler) GetSpotifyStatus(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	resp := &integrations.IntegrationStatusResponse{
		Connected: false,
		Provider:  "spotify",
	}

	var encAccessToken string
	var encRefreshToken *string
	var tokenExpiresAt *time.Time
	err := h.db.QueryRow(`
		SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at, spotify_username, spotify_avatar_url
		FROM user_integrations
		WHERE user_id = $1 AND provider = 'spotify' AND is_connected = true`,
		claims.UserID,
	).Scan(&encAccessToken, &encRefreshToken, &tokenExpiresAt, &resp.SpotifyName, &resp.SpotifyAvatar)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, resp)
		return
	}
	if err != nil {
		log.Printf("[Integrations] Failed to query status: %v", err)
		c.JSON(http.StatusOK, resp)
		return
	}

	// Check if token is valid
	accessToken, err := integrations.DecryptToken(encAccessToken)
	if err != nil || accessToken == "" {
		c.JSON(http.StatusOK, resp)
		return
	}

	// Check expiration
	if tokenExpiresAt != nil && time.Now().After(*tokenExpiresAt) {
		// Try refresh
		if encRefreshToken != nil {
			refreshToken, err := integrations.DecryptToken(*encRefreshToken)
			if err == nil && refreshToken != "" {
				_, err := h.spotify.RefreshAccessToken(refreshToken)
				if err != nil {
					// Mark as disconnected
					h.db.Exec(`UPDATE user_integrations SET is_connected = false WHERE user_id = $1 AND provider = 'spotify'`, claims.UserID)
					c.JSON(http.StatusOK, resp)
					return
				}
				// Token refreshed successfully
				resp.Connected = true
				c.JSON(http.StatusOK, resp)
				return
			}
		}
		// Couldn't refresh
		h.db.Exec(`UPDATE user_integrations SET is_connected = false WHERE user_id = $1 AND provider = 'spotify'`, claims.UserID)
		c.JSON(http.StatusOK, resp)
		return
	}

	resp.Connected = true
	c.JSON(http.StatusOK, resp)
}

// GetSpotifyNowPlaying returns the currently playing track for a user (public endpoint)
// @Summary Get user's currently playing Spotify track
// @Tags integrations
// @Param user_id path string true "User ID"
// @Success 200 {object} integrations.NowPlayingResponse
// @Router /api/v1/integrations/spotify/now-playing/{user_id} [get]
func (h *IntegrationsHandler) GetSpotifyNowPlaying(c *gin.Context) {
	userID := c.Param("user_id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id is required"})
		return
	}

	// Get a valid access token directly via the service
	accessToken, err := h.spotify.GetValidAccessToken(userID)
	if err != nil {
		c.JSON(http.StatusOK, &integrations.NowPlayingResponse{IsConnected: false})
		return
	}

	// Fetch currently playing
	playing, err := h.spotify.GetCurrentlyPlaying(accessToken)
	if err != nil {
		c.JSON(http.StatusOK, &integrations.NowPlayingResponse{IsConnected: true, IsPlaying: false})
		return
	}

	resp := integrations.BuildNowPlayingResponse(playing)
	c.JSON(http.StatusOK, resp)
}

// getFrontendURL returns the frontend URL for redirects
func getFrontendURL() string {
	url := os.Getenv("FRONTEND_URL")
	if url == "" {
		if domain := os.Getenv("DOMAIN"); domain != "" {
			url = "https://" + domain
		} else {
			url = "http://localhost:8081"
		}
	}
	return url
}

// redirectToSettings redirects the browser to the frontend settings page with a message
func (h *IntegrationsHandler) redirectToSettings(c *gin.Context, status, message string) {
	redirectURL := fmt.Sprintf("%s/settings/integrations?spotify_status=%s&spotify_message=%s", getFrontendURL(), status, message)
	c.Redirect(http.StatusFound, redirectURL)
}
