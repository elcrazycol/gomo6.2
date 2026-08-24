// Package push implements Web Push (RFC 8030/8291) for the PWA: per-user
// browser subscriptions (PushManager) and delivery of notifications to them.
//
// VAPID keys are read from the environment (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT). When they are missing the service is disabled — New returns a
// nil disabled service and nothing is sent, so a fresh dev checkout works
// without configuration while production must set the keys (they must stay
// stable, otherwise existing subscriptions are rejected by the push service).
package push

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/SherClockHolmes/webpush-go"
)

// Service sends Web Push notifications to a user's subscribed devices, filtered
// by the user's per-type push preferences.
type Service struct {
	db   *sql.DB
	opts *webpush.Options
}

// New creates a push Service. Returns (nil, nil) when VAPID keys are not
// configured so callers can treat push as an optional, disabled feature.
func New(db *sql.DB) *Service {
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	privateKey := os.Getenv("VAPID_PRIVATE_KEY")
	subject := os.Getenv("VAPID_SUBJECT")
	if publicKey == "" || privateKey == "" || subject == "" {
		log.Println("[push] VAPID keys not configured (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT) — push notifications disabled")
		return nil
	}
	return &Service{
		db: db,
		opts: &webpush.Options{
			Subscriber:      subject,
			VAPIDPublicKey:  publicKey,
			VAPIDPrivateKey: privateKey,
			TTL:             300, // seconds; enough for a burst without queue buildup
			HTTPClient: &http.Client{
				Timeout: 10 * time.Second,
			},
		},
	}
}

// PublicKey returns the VAPID public key the frontend must pass to
// PushManager.subscribe as the applicationServerKey. Empty when disabled.
func (s *Service) PublicKey() string {
	if s == nil || s.opts == nil {
		return ""
	}
	return s.opts.VAPIDPublicKey
}

// ── Subscription storage ───────────────────────────────────────────────────

// Subscription is the persisted browser push subscription. Keys are the
// base64url values from PushSubscription.getKey().
type Subscription struct {
	ID        string
	UserID    string
	Endpoint  string
	P256dh    string
	Auth      string
	UserAgent string
}

// UpsertSubscription registers (or refreshes) a subscription for a user.
// Duplicate (user, endpoint) rows are replaced.
func (s *Service) UpsertSubscription(ctx context.Context, userID, endpoint, p256dh, auth, userAgent string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("push service not available")
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, endpoint)
		DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
		              user_agent = EXCLUDED.user_agent,
		              updated_at = NOW()
	`, userID, endpoint, p256dh, auth, userAgent)
	return err
}

// DeleteSubscription removes a single subscription for a user by endpoint.
func (s *Service) DeleteSubscription(ctx context.Context, userID, endpoint string) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("push service not available")
	}
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
		userID, endpoint)
	return err
}

// SubscriptionsForUser lists a user's active subscriptions.
func (s *Service) SubscriptionsForUser(ctx context.Context, userID string) ([]Subscription, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, user_id, endpoint, p256dh, auth, user_agent
		FROM push_subscriptions WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []Subscription
	for rows.Next() {
		var sub Subscription
		if err := rows.Scan(&sub.ID, &sub.UserID, &sub.Endpoint, &sub.P256dh, &sub.Auth, &sub.UserAgent); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}

// ── Per-type preferences ───────────────────────────────────────────────────

// SetPreferences stores the user's per-type {type: bool} map. Any notification
// type not present (and any type from a user with no row at all) defaults to
// enabled.
func (s *Service) SetPreferences(ctx context.Context, userID string, typeMap map[string]bool) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("push service not available")
	}
	raw, err := json.Marshal(typeMap)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO push_preferences (user_id, type_map, updated_at)
		VALUES ($1, $2::jsonb, NOW())
		ON CONFLICT (user_id)
		DO UPDATE SET type_map = EXCLUDED.type_map, updated_at = NOW()
	`, userID, string(raw))
	return err
}

// Preferences returns the user's per-type push preference map. Returns an
// empty map when the user has no explicit row (meaning: everything enabled).
func (s *Service) Preferences(ctx context.Context, userID string) (map[string]bool, error) {
	if s == nil || s.db == nil {
		return map[string]bool{}, nil
	}
	var raw []byte
	err := s.db.QueryRowContext(ctx,
		`SELECT type_map::bytea FROM push_preferences WHERE user_id = $1`, userID).Scan(&raw)
	if err == sql.ErrNoRows {
		return map[string]bool{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := map[string]bool{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out, nil
}

// EnabledForType reports whether a notification type should push for a user.
// The default is enabled; an explicit false in the preference map disables it.
func (s *Service) EnabledForType(ctx context.Context, userID, notifType string) bool {
	if s == nil {
		return false
	}
	prefs, err := s.Preferences(ctx, userID)
	if err != nil {
		// On a lookup error default to sending — the notification already happened,
		// better to deliver than silently drop.
		return true
	}
	if enabled, ok := prefs[notifType]; ok {
		return enabled
	}
	return true
}

// ── Delivery ───────────────────────────────────────────────────────────────

// Notification carries the display data delivered to the service worker.
type Notification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	// URL opens when the user taps the notification. Colleagues the existing
	// convention of landing on /notify for now; deep links come later.
	URL  string `json:"url"`
	Icon string `json:"icon,omitempty"`
	// Data is forwarded untouched (notifications list target, etc.).
	Data json.RawMessage `json:"data,omitempty"`
}

// availableNotificationTypes lists every notification type the engine can
// produce, surfaced to the Settings UI so users can toggle each one. Absent
// entries in mute maps are always enabled regardless.
var availableNotificationTypes = []string{
	"like", "reply", "thread_reply",
	"wall_post", "wall_post_like", "wall_comment", "wall_comment_reply", "wall_repost",
	"friend_request", "friend_accepted",
	"gift_received",
}

// NotificationTypes returns the catalog of notification types a user can toggle.
func (s *Service) NotificationTypes() []string {
	return availableNotificationTypes
}

// SendToUser delivers a push notification to all of the user's subscriptions,
// unless the notification type is muted in the user's preferences. Each device
// is sent independently; a permanent failure (410 Gone / 404) removes the
// stale subscription. Best-effort: a single bad device never blocks the rest.
func (s *Service) SendToUser(ctx context.Context, userID, notifType string, n Notification) {
	if s == nil || s.db == nil {
		return
	}
	if !s.EnabledForType(ctx, userID, notifType) {
		return
	}
	subs, err := s.SubscriptionsForUser(ctx, userID)
	if err != nil {
		log.Printf("[push] list subscriptions for %s: %v", userID, err)
		return
	}
	if len(subs) == 0 {
		return
	}

	payload, err := json.Marshal(n)
	if err != nil {
		log.Printf("[push] marshal payload: %v", err)
		return
	}

	for _, sub := range subs {
		if err := s.send(ctx, sub, payload); err != nil {
			// 410 Gone / 404: the subscription is dead — drop it.
			if isGone(err) {
				log.Printf("[push] removing stale subscription %s (endpoint gone)", sub.ID)
				_, _ = s.db.ExecContext(ctx,
					`DELETE FROM push_subscriptions WHERE id = $1`, sub.ID)
			} else {
				log.Printf("[push] send to %s failed: %v", sub.ID, err)
			}
		}
	}
}

func (s *Service) send(ctx context.Context, sub Subscription, payload []byte) error {
	ws := &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}
	resp, err := webpush.SendNotificationWithContext(ctx, payload, ws, s.opts)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
		return fmt.Errorf("endpoint gone (status %d)", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusCreated && resp.StatusCode != http.StatusOK {
		return fmt.Errorf("push service responded %d", resp.StatusCode)
	}
	return nil
}

func isGone(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "endpoint gone")
}
