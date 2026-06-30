package integrations

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// ─── Spotify API Client ─────────────────────────────────────────────────────
// Handles server-side OAuth flow and API calls to Spotify Web API

type SpotifyService struct {
	db           *sql.DB
	clientID     string
	clientSecret string
	redirectURI  string
	frontendURL  string
}

// NewSpotifyService creates a new Spotify service.
// Pass nil db for read-only operations (e.g., from new-handler scope).
func NewSpotifyService(db *sql.DB) *SpotifyService {
	clientID := os.Getenv("SPOTIFY_CLIENT_ID")
	clientSecret := os.Getenv("SPOTIFY_CLIENT_SECRET")
	frontendURL := os.Getenv("FRONTEND_URL")
	if frontendURL == "" {
		if domain := os.Getenv("DOMAIN"); domain != "" {
			frontendURL = "https://" + domain
		} else {
			frontendURL = "http://localhost:8081"
		}
	}

	// Construct the redirect URI
	redirectBase := os.Getenv("BACKEND_URL")
	if redirectBase == "" {
		if domain := os.Getenv("DOMAIN"); domain != "" {
			redirectBase = "https://" + domain
		} else {
			redirectBase = "http://localhost:8080"
		}
	}
	redirectURI := redirectBase + "/api/v1/integrations/spotify/callback"

	return &SpotifyService{
		db:           db,
		clientID:     clientID,
		clientSecret: clientSecret,
		redirectURI:  redirectURI,
		frontendURL:  frontendURL,
	}
}

// IsConfigured checks if Spotify client credentials are set
func (s *SpotifyService) IsConfigured() bool {
	return s.clientID != "" && s.clientSecret != ""
}

// GetAuthURL generates the Spotify authorization URL
func (s *SpotifyService) GetAuthURL(state string) (string, error) {
	if !s.IsConfigured() {
		return "", fmt.Errorf("spotify integration is not configured on the server")
	}

	u, err := url.Parse("https://accounts.spotify.com/authorize")
	if err != nil {
		return "", err
	}

	q := u.Query()
	q.Set("client_id", s.clientID)
	q.Set("response_type", "code")
	q.Set("redirect_uri", s.redirectURI)
	q.Set("state", state)
	q.Set("scope", "user-read-currently-playing user-read-playback-state")
	u.RawQuery = q.Encode()

	return u.String(), nil
}

// ExchangeCode exchanges an authorization code for access + refresh tokens
func (s *SpotifyService) ExchangeCode(code string) (*SpotifyTokenResponse, error) {
	data := url.Values{}
	data.Set("grant_type", "authorization_code")
	data.Set("code", code)
	data.Set("redirect_uri", s.redirectURI)

	req, err := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.SetBasicAuth(s.clientID, s.clientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token exchange request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading token response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token exchange failed (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp SpotifyTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parsing token response: %w", err)
	}

	return &tokenResp, nil
}

// RefreshAccessToken refreshes an expired access token using a refresh token
func (s *SpotifyService) RefreshAccessToken(refreshToken string) (*SpotifyTokenResponse, error) {
	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", refreshToken)

	req, err := http.NewRequest("POST", "https://accounts.spotify.com/api/token", strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}

	req.SetBasicAuth(s.clientID, s.clientSecret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("refresh token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading refresh response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token refresh failed (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var tokenResp SpotifyTokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return nil, fmt.Errorf("parsing refresh response: %w", err)
	}

	return &tokenResp, nil
}

// GetUserProfile fetches a Spotify user's profile using an access token
func (s *SpotifyService) GetUserProfile(accessToken string) (*SpotifyUserProfile, error) {
	req, err := http.NewRequest("GET", "https://api.spotify.com/v1/me", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("user profile request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("access token expired")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading profile response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("spotify API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var profile SpotifyUserProfile
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, fmt.Errorf("parsing profile: %w", err)
	}

	return &profile, nil
}

// GetCurrentlyPlaying fetches the currently playing track for a valid access token
func (s *SpotifyService) GetCurrentlyPlaying(accessToken string) (*SpotifyCurrentlyPlaying, error) {
	req, err := http.NewRequest("GET", "https://api.spotify.com/v1/me/player/currently-playing", nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("currently-playing request failed: %w", err)
	}
	defer resp.Body.Close()

	// 204 No Content means nothing is playing
	if resp.StatusCode == http.StatusNoContent {
		return &SpotifyCurrentlyPlaying{IsPlaying: false}, nil
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return nil, fmt.Errorf("access token expired")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("reading currently-playing response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("spotify API error (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var playing SpotifyCurrentlyPlaying
	if err := json.Unmarshal(body, &playing); err != nil {
		return nil, fmt.Errorf("parsing currently-playing: %w", err)
	}

	return &playing, nil
}

// GetValidAccessToken retrieves a valid Spotify access token for a user, refreshing if needed.
// Returns the decrypted access token or an error.
func (s *SpotifyService) GetValidAccessToken(userID string) (string, error) {
	if s.db == nil {
		return "", fmt.Errorf("database not available")
	}

	var integration UserIntegration
	var encRefresh *string
	err := s.db.QueryRow(`
		SELECT encrypted_access_token, encrypted_refresh_token, token_expires_at
		FROM user_integrations
		WHERE user_id = $1 AND provider = 'spotify' AND is_connected = true`,
		userID,
	).Scan(&integration.EncryptedAccessToken, &encRefresh, &integration.TokenExpiresAt)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("no Spotify integration found")
	}
	if err != nil {
		return "", fmt.Errorf("querying integration: %w", err)
	}

	accessToken, err := DecryptToken(integration.EncryptedAccessToken)
	if err != nil {
		return "", fmt.Errorf("decrypting access token: %w", err)
	}

	// Check if token is expired (with 60s buffer)
	if integration.TokenExpiresAt != nil && time.Now().After(integration.TokenExpiresAt.Add(-60*time.Second)) {
		// Need to refresh
		if encRefresh == nil {
			return "", fmt.Errorf("token expired and no refresh token available")
		}

		refreshToken, err := DecryptToken(*encRefresh)
		if err != nil {
			return "", fmt.Errorf("decrypting refresh token: %w", err)
		}

		newTokens, err := s.RefreshAccessToken(refreshToken)
		if err != nil {
			// If refresh fails, mark as disconnected
			s.db.Exec(`UPDATE user_integrations SET is_connected = false WHERE user_id = $1 AND provider = 'spotify'`, userID)
			return "", fmt.Errorf("token refresh failed, integration disconnected: %w", err)
		}

		// Encrypt and store new tokens
		encAccess, err := EncryptToken(newTokens.AccessToken)
		if err != nil {
			return "", fmt.Errorf("encrypting new access token: %w", err)
		}

		expiresAt := time.Now().Add(time.Duration(newTokens.ExpiresIn) * time.Second)
		newRefresh := newTokens.RefreshToken
		if newRefresh == "" && encRefresh != nil {
			newRefresh = refreshToken // keep old refresh token if Spotify didn't return a new one
		}
		encNewRefresh, err := EncryptToken(newRefresh)
		if err != nil {
			return "", fmt.Errorf("encrypting new refresh token: %w", err)
		}

		_, err = s.db.Exec(`
			UPDATE user_integrations
			SET encrypted_access_token = $1, encrypted_refresh_token = $2, token_expires_at = $3, updated_at = NOW()
			WHERE user_id = $4 AND provider = 'spotify'`,
			encAccess, encNewRefresh, expiresAt, userID,
		)
		if err != nil {
			log.Printf("[Spotify] Failed to update refreshed tokens: %v", err)
		}

		return newTokens.AccessToken, nil
	}

	return accessToken, nil
}

// BuildNowPlayingResponse converts Spotify API data into a frontend-friendly response
func BuildNowPlayingResponse(playing *SpotifyCurrentlyPlaying) *NowPlayingResponse {
	resp := &NowPlayingResponse{
		IsPlaying:   false,
		IsConnected: true,
	}

	if playing == nil || !playing.IsPlaying || playing.Item == nil {
		return resp
	}

	resp.IsPlaying = true
	resp.TrackName = playing.Item.Name
	resp.TrackURL = playing.Item.ExternalURLs.Spotify
	resp.ProgressMs = playing.ProgressMs
	resp.DurationMs = playing.Item.DurationMs

	if len(playing.Item.Artists) > 0 {
		resp.ArtistName = playing.Item.Artists[0].Name
	}

	resp.AlbumName = playing.Item.Album.Name

	if len(playing.Item.Album.Images) > 0 {
		// Pick the medium-sized image (usually index 1)
		imgIdx := 1
		if imgIdx >= len(playing.Item.Album.Images) {
			imgIdx = len(playing.Item.Album.Images) - 1
		}
		resp.AlbumArtURL = playing.Item.Album.Images[imgIdx].URL
	}

	return resp
}
