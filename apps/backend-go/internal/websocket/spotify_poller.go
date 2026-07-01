package websocket

import (
	"context"
	"crypto/md5"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/gomo6/backend/internal/integrations"
	"github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

const (
	spotifyPollInterval    = 30 * time.Second
	spotifyMaxConcurrency  = 10
	spotifyDedupTTL        = 60 * time.Second
	spotifyBackoffDuration = 5 * time.Minute
	spotifyLastTrackPrefix = "spotify:last_track:"
)

// SpotifyPoller periodically polls Spotify for currently playing tracks,
// but only for online users and users whose profiles are currently being viewed.
// Results are deduplicated — only changed tracks trigger a publish.
type SpotifyPoller struct {
	hub     *Hub
	spotify *integrations.SpotifyService
	db      *sql.DB
	redis   *redis.Client
	sem     chan struct{} // concurrency limiter for Spotify API calls
	backoff sync.Map      // userID -> time.Time (backoff until)
}

// NewSpotifyPoller creates a new optimized Spotify poller.
func NewSpotifyPoller(hub *Hub, spotify *integrations.SpotifyService) *SpotifyPoller {
	return &SpotifyPoller{
		hub:     hub,
		spotify: spotify,
		db:      hub.db,
		redis:   hub.redis,
		sem:     make(chan struct{}, spotifyMaxConcurrency),
	}
}

// Start begins the background polling loop. Runs until the Hub's context is cancelled.
func (p *SpotifyPoller) Start() {
	if p.db == nil || p.spotify == nil || !p.spotify.IsConfigured() {
		log.Println("[SpotifyPoller] Disabled — no DB or Spotify not configured")
		return
	}

	log.Println("[SpotifyPoller] Started — polling every 30s (online + viewed profiles only)")
	ticker := time.NewTicker(spotifyPollInterval)
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

// poll fetches currently playing for relevant users only.
func (p *SpotifyPoller) poll() {
	// Build set of user IDs we actually need to poll
	relevantUsers := p.getRelevantUserIDs()
	if len(relevantUsers) == 0 {
		return
	}

	// Filter to only users who have Spotify connected
	spotifyUsers := p.filterSpotifyUsers(relevantUsers)
	if len(spotifyUsers) == 0 {
		return
	}

	log.Printf("[SpotifyPoller] Polling %d relevant users", len(spotifyUsers))

	var wg sync.WaitGroup
	for _, userID := range spotifyUsers {
		// Check per-user backoff (skip users recently rate-limited)
		if until, ok := p.backoff.Load(userID); ok {
			if time.Now().Before(until.(time.Time)) {
				continue
			}
			p.backoff.Delete(userID)
		}

		wg.Add(1)
		p.sem <- struct{}{} // acquire concurrency slot
		go func(uid string) {
			defer wg.Done()
			defer func() { <-p.sem }() // release
			p.pollUser(uid)
		}(userID)
	}
	wg.Wait()
}

// getRelevantUserIDs returns the union of:
// 1. Users who have an active WebSocket connection (online)
// 2. Users whose profile_now_playing room has at least one viewer
func (p *SpotifyPoller) getRelevantUserIDs() map[string]struct{} {
	users := make(map[string]struct{})

	// 1. Online users (have the app open)
	for _, uid := range p.hub.GetOnlineUsers() {
		users[uid] = struct{}{}
	}

	// 2. Users whose profiles are being viewed right now
	p.hub.mu.RLock()
	for room, clients := range p.hub.rooms {
		if strings.HasPrefix(room, "profile_now_playing_") && len(clients) > 0 {
			userID := strings.TrimPrefix(room, "profile_now_playing_")
			users[userID] = struct{}{}
		}
	}
	p.hub.mu.RUnlock()

	return users
}

// filterSpotifyUsers queries DB to keep only users with Spotify connected.
func (p *SpotifyPoller) filterSpotifyUsers(userIDs map[string]struct{}) []string {
	if len(userIDs) == 0 {
		return nil
	}

	ids := make([]string, 0, len(userIDs))
	for uid := range userIDs {
		ids = append(ids, uid)
	}

	rows, err := p.db.Query(`
		SELECT user_id FROM user_integrations
		WHERE provider = 'spotify' AND is_connected = true
		AND user_id = ANY($1)`, pq.Array(ids))
	if err != nil {
		log.Printf("[SpotifyPoller] Query error: %v", err)
		return nil
	}
	defer rows.Close()

	var result []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			continue
		}
		result = append(result, uid)
	}
	return result
}

// pollUser fetches and publishes now-playing for a single user.
func (p *SpotifyPoller) pollUser(userID string) {
	accessToken, err := p.spotify.GetValidAccessToken(userID)
	if err != nil {
		return
	}

	playing, err := p.spotify.GetCurrentlyPlaying(accessToken)
	if err != nil {
		// Back off on rate limit (HTTP 429)
		if strings.Contains(err.Error(), "HTTP 429") {
			p.backoff.Store(userID, time.Now().Add(spotifyBackoffDuration))
			log.Printf("[SpotifyPoller] Rate limited for user %s, backing off 5m", userID)
		}
		return
	}

	resp := integrations.BuildNowPlayingResponse(playing)

	// Deduplication: only publish if the track state actually changed
	trackHash := p.computeTrackHash(resp)
	trackKey := spotifyLastTrackPrefix + userID

	if p.redis != nil {
		ctx := context.Background()
		lastHash, getErr := p.redis.Get(ctx, trackKey).Result()
		if getErr == nil && lastHash == trackHash {
			return // Same state — skip
		}
		// Store new hash with TTL so we don't repeat
		p.redis.Set(ctx, trackKey, trackHash, spotifyDedupTTL)
	}

	payload := map[string]interface{}{
		"user_id":  userID,
		"response": resp,
	}

	if err := p.hub.PublishNowPlaying(payload); err != nil {
		log.Printf("[SpotifyPoller] Publish error for user %s: %v", userID, err)
	}
}

// computeTrackHash returns a short hash that changes when the track changes.
// "not_playing" for idle users, md5 of track identity otherwise.
func (p *SpotifyPoller) computeTrackHash(resp *integrations.NowPlayingResponse) string {
	if !resp.IsPlaying {
		return "not_playing"
	}
	sum := md5.Sum([]byte(resp.TrackName + "|" + resp.ArtistName + "|" + resp.TrackURL))
	return fmt.Sprintf("%x", sum)
}
