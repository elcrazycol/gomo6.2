package integrations

import "time"

// UserIntegration represents a connected third-party service account
type UserIntegration struct {
	ID                    string     `json:"id" db:"id"`
	UserID                string     `json:"user_id" db:"user_id"`
	Provider              string     `json:"provider" db:"provider"`
	EncryptedAccessToken  string     `json:"-" db:"encrypted_access_token"`
	EncryptedRefreshToken *string    `json:"-" db:"encrypted_refresh_token"`
	TokenExpiresAt        *time.Time `json:"token_expires_at" db:"token_expires_at"`
	SpotifyUsername       *string    `json:"spotify_username" db:"spotify_username"`
	SpotifyAvatarURL      *string    `json:"spotify_avatar_url" db:"spotify_avatar_url"`
	IsConnected           bool       `json:"is_connected" db:"is_connected"`
	CreatedAt             time.Time  `json:"created_at" db:"created_at"`
	UpdatedAt             time.Time  `json:"updated_at" db:"updated_at"`
}

// SpotifyTokenResponse is the OAuth token response from Spotify
type SpotifyTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
}

// SpotifyUserProfile is the user profile from Spotify API
type SpotifyUserProfile struct {
	ID           string              `json:"id"`
	DisplayName  string              `json:"display_name"`
	Images       []SpotifyImage      `json:"images"`
	ExternalURLs SpotifyExternalURLs `json:"external_urls"`
}

// SpotifyImage represents a Spotify user/album image
type SpotifyImage struct {
	URL    string `json:"url"`
	Height int    `json:"height"`
	Width  int    `json:"width"`
}

// SpotifyExternalURLs contains external URLs for a Spotify resource
type SpotifyExternalURLs struct {
	Spotify string `json:"spotify"`
}

// SpotifyCurrentlyPlaying is the response from GET /me/player/currently-playing
type SpotifyCurrentlyPlaying struct {
	IsPlaying            bool            `json:"is_playing"`
	Item                 *SpotifyTrack   `json:"item"`
	ProgressMs           int             `json:"progress_ms"`
	Timestamp            int64           `json:"timestamp"`
	Context              *SpotifyContext `json:"context"`
	CurrentlyPlayingType string          `json:"currently_playing_type"`
}

// SpotifyTrack is a track from Spotify
type SpotifyTrack struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	DurationMs   int                 `json:"duration_ms"`
	Artists      []SpotifyArtist     `json:"artists"`
	Album        SpotifyAlbum        `json:"album"`
	ExternalURLs SpotifyExternalURLs `json:"external_urls"`
	URI          string              `json:"uri"`
}

// SpotifyContext is the context of the currently playing track
type SpotifyContext struct {
	Type         string              `json:"type"`
	Href         string              `json:"href"`
	ExternalURLs SpotifyExternalURLs `json:"external_urls"`
	URI          string              `json:"uri"`
}

// SpotifyArtist is an artist from Spotify
type SpotifyArtist struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	ExternalURLs SpotifyExternalURLs `json:"external_urls"`
}

// SpotifyAlbum is an album from Spotify
type SpotifyAlbum struct {
	ID     string         `json:"id"`
	Name   string         `json:"name"`
	Images []SpotifyImage `json:"images"`
}

// NowPlayingResponse is the public response for the profile now-playing widget
type NowPlayingResponse struct {
	IsPlaying   bool   `json:"is_playing"`
	TrackName   string `json:"track_name,omitempty"`
	ArtistName  string `json:"artist_name,omitempty"`
	AlbumName   string `json:"album_name,omitempty"`
	AlbumArtURL string `json:"album_art_url,omitempty"`
	TrackURL    string `json:"track_url,omitempty"`
	ProgressMs  int    `json:"progress_ms,omitempty"`
	DurationMs  int    `json:"duration_ms,omitempty"`
	IsConnected bool   `json:"is_connected"`
}

// IntegrationStatusResponse returns the connection status for a user
type IntegrationStatusResponse struct {
	Connected     bool    `json:"connected"`
	Provider      string  `json:"provider"`
	SpotifyName   *string `json:"spotify_name,omitempty"`
	SpotifyAvatar *string `json:"spotify_avatar,omitempty"`
}

// AuthURLResponse returns the Spotify authorization URL
type AuthURLResponse struct {
	AuthURL string `json:"auth_url"`
}
