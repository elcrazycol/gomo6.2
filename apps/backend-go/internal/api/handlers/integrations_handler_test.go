package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/integrations"
)

// setSpotifyUnconfigured forces the Spotify service to see empty credentials,
// regardless of what the developer/CI shell exports.
func setSpotifyUnconfigured(t *testing.T) {
	t.Helper()
	t.Setenv("SPOTIFY_CLIENT_ID", "")
	t.Setenv("SPOTIFY_CLIENT_SECRET", "")
}

// TestGetSpotifyNowPlaying_NotConfigured_ReturnsNotConnected pins the public
// profile-widget contract: with no server credentials the endpoint must answer
// "not connected" and must not touch the DB or Spotify (nil DB proves the
// guard runs before either).
func TestGetSpotifyNowPlaying_NotConfigured_ReturnsNotConnected(t *testing.T) {
	setSpotifyUnconfigured(t)
	handler := NewIntegrationsHandler(nil)

	c, w := newGETContextWithParams(
		"/api/v1/integrations/spotify/now-playing/u1",
		nil,
		map[string]string{"user_id": "u1"},
	)
	handler.GetSpotifyNowPlaying(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var resp integrations.NowPlayingResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.IsConnected {
		t.Errorf("is_connected = true, want false when Spotify is not configured")
	}
}

// TestGetSpotifyPlayerState_NotConfigured_ReturnsNotConnected pins that the
// author-side polling endpoint reports a plain idle player state instead of a
// 5xx (the client stops polling once nothing is connected).
func TestGetSpotifyPlayerState_NotConfigured_ReturnsNotConnected(t *testing.T) {
	setSpotifyUnconfigured(t)
	handler := NewIntegrationsHandler(nil)

	c, w := newGETContextWithClaims(
		"/api/v1/integrations/spotify/me/state",
		nil,
		&auth.Claims{UserID: "u1"},
	)
	handler.GetSpotifyPlayerState(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a not-connected player state must not be a 5xx (body: %s)", w.Code, w.Body.String())
	}
	var resp integrations.NowPlayingResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.IsConnected {
		t.Errorf("is_connected = true, want false when Spotify is not configured")
	}
}

// TestGetSpotifyStatus_NotConfigured_ReturnsNotConnected pins that the settings
// page never sees a 5xx just because the server lacks Spotify credentials.
func TestGetSpotifyStatus_NotConfigured_ReturnsNotConnected(t *testing.T) {
	setSpotifyUnconfigured(t)
	handler := NewIntegrationsHandler(nil)

	c, w := newGETContextWithClaims(
		"/api/v1/integrations/spotify/status",
		nil,
		&auth.Claims{UserID: "u1"},
	)
	handler.GetSpotifyStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", w.Code, w.Body.String())
	}
	var resp integrations.IntegrationStatusResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Connected {
		t.Errorf("connected = true, want false when Spotify is not configured")
	}
	if resp.Provider != "spotify" {
		t.Errorf("provider = %q, want %q", resp.Provider, "spotify")
	}
}

// TestGetSpotifyAuthURL_NotConfigured_ServiceUnavailable documents the one
// case that still needs an error: the user explicitly asked to start OAuth but
// the server cannot issue an authorization URL.
func TestGetSpotifyAuthURL_NotConfigured_ServiceUnavailable(t *testing.T) {
	setSpotifyUnconfigured(t)
	handler := NewIntegrationsHandler(nil)

	c, w := newGETContextWithClaims(
		"/api/v1/integrations/spotify/auth-url",
		nil,
		&auth.Claims{UserID: "u1"},
	)
	handler.GetSpotifyAuthURL(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", w.Code)
	}
}
