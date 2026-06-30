package websocket

import (
	"database/sql"
	"log"
	"time"

	"github.com/gomo6/backend/internal/integrations"
)

// SpotifyPoller periodically polls Spotify for currently playing tracks
// and publishes now_playing events so visitors see live updates on profiles.
type SpotifyPoller struct {
	hub     *Hub
	spotify *integrations.SpotifyService
	db      *sql.DB
}

// NewSpotifyPoller creates a new Spotify poller.
// The poller shares the Hub's db connection.
func NewSpotifyPoller(hub *Hub, spotify *integrations.SpotifyService) *SpotifyPoller {
	return &SpotifyPoller{
		hub:     hub,
		spotify: spotify,
		db:      hub.db,
	}
}

// Start begins the background polling loop. Runs until the Hub's context is cancelled.
func (p *SpotifyPoller) Start() {
	if p.db == nil || p.spotify == nil || !p.spotify.IsConfigured() {
		log.Println("[SpotifyPoller] Disabled — no DB or Spotify not configured")
		return
	}

	log.Println("[SpotifyPoller] Started — polling every 15s")
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	// Run once immediately on startup
	p.poll()

	for {
		select {
		case <-p.hub.ctx.Done():
			log.Println("[SpotifyPoller] Stopped")
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

// poll fetches currently playing for every connected Spotify user.
func (p *SpotifyPoller) poll() {
	rows, err := p.db.Query(`
		SELECT user_id FROM user_integrations
		WHERE provider = 'spotify' AND is_connected = true`)
	if err != nil {
		log.Printf("[SpotifyPoller] Query error: %v", err)
		return
	}
	defer rows.Close()

	var userIDs []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			continue
		}
		userIDs = append(userIDs, uid)
	}

	if len(userIDs) == 0 {
		return
	}

	for _, userID := range userIDs {
		p.pollUser(userID)
	}
}

// pollUser fetches and publishes now-playing for a single user.
func (p *SpotifyPoller) pollUser(userID string) {
	accessToken, err := p.spotify.GetValidAccessToken(userID)
	if err != nil {
		// User's token is invalid/expired — skip silently
		return
	}

	playing, err := p.spotify.GetCurrentlyPlaying(accessToken)
	if err != nil {
		return
	}

	resp := integrations.BuildNowPlayingResponse(playing)

	payload := map[string]interface{}{
		"user_id":  userID,
		"response": resp,
	}

	if err := p.hub.PublishNowPlaying(payload); err != nil {
		log.Printf("[SpotifyPoller] Publish error for user %s: %v", userID, err)
	}
}
