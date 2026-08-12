package websocket

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newRedisHub creates a Hub backed by miniredis.
func newRedisHub(t *testing.T) (*Hub, *redis.Client) {
	t.Helper()
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })
	return NewHub(client, nil), client
}

// newRedisHubWithDB creates a Hub backed by miniredis + sqlmock.
func newRedisHubWithDB(t *testing.T) (*Hub, *redis.Client, sqlmock.Sqlmock) {
	t.Helper()
	hub, mock := setupHubWithDB(t)
	_, client := newRedisHub(t)
	hub.redis = client
	return hub, client, mock
}

// =============================================================================
// TouchPresence / GetPresenceStatus
// =============================================================================

func TestTouchPresence_AddsMember(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()

	hub.TouchPresence("user-1")

	score, err := client.ZScore(ctx, redisPresenceKey, "user-1").Result()
	if err != nil {
		t.Fatalf("member should exist after touch: %v", err)
	}
	if d := time.Since(time.Unix(int64(score), 0)); d > 5*time.Second || d < -5*time.Second {
		t.Errorf("score should be ~now, got %v", d)
	}
	if v, err := client.Get(ctx, fmt.Sprintf(redisPresenceLastSeenKey, "user-1")).Result(); err != nil || v == "" {
		t.Errorf("last_seen cache should be set, got %q err=%v", v, err)
	}
}

func TestTouchPresence_NilRedis_Noop(t *testing.T) {
	hub := NewHub(nil, nil)
	hub.TouchPresence("user-1") // must not panic
}

func TestGetPresenceStatus_Online(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "user-1"})

	online, lastSeen := hub.GetPresenceStatus("user-1")
	if !online {
		t.Fatal("expected online=true for a fresh score")
	}
	if lastSeen.IsZero() {
		t.Fatal("expected non-zero last_seen")
	}
}

func TestGetPresenceStatus_StaleScore_OfflineWithLastSeen(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()
	// Scores are unix seconds, so the expected time must be second-truncated.
	stale := time.Now().UTC().Add(-5 * time.Minute).Truncate(time.Second)
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(stale.Unix()), Member: "user-1"})

	online, lastSeen := hub.GetPresenceStatus("user-1")
	if online {
		t.Fatal("expected online=false for a stale score")
	}
	if !lastSeen.Equal(stale) {
		t.Fatalf("expected last_seen %v, got %v", stale, lastSeen)
	}
}

func TestGetPresenceStatus_AbsentButCached(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()
	// The cache stores RFC3339 (second precision), so truncate the expected time.
	cached := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	client.Set(ctx, fmt.Sprintf(redisPresenceLastSeenKey, "user-1"), cached.Format(time.RFC3339), 0)

	online, lastSeen := hub.GetPresenceStatus("user-1")
	if online {
		t.Fatal("expected online=false when absent from the set")
	}
	if !lastSeen.Equal(cached) {
		t.Fatalf("expected cached last_seen %v, got %v", cached, lastSeen)
	}
}

func TestGetPresenceStatus_AbsentNeverSeen(t *testing.T) {
	hub, _ := newRedisHub(t)
	online, lastSeen := hub.GetPresenceStatus("nobody")
	if online {
		t.Fatal("expected online=false")
	}
	if !lastSeen.IsZero() {
		t.Fatal("expected zero last_seen for a never-seen user")
	}
}

func TestGetPresenceStatus_NilRedis(t *testing.T) {
	hub := NewHub(nil, nil)
	online, lastSeen := hub.GetPresenceStatus("user-1")
	if online || !lastSeen.IsZero() {
		t.Fatal("nil redis must fail closed to offline with zero last_seen")
	}
}

// =============================================================================
// GetPresenceStatuses (bulk pipeline)
// =============================================================================

func TestGetPresenceStatuses(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()

	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "u1"})
	stale := time.Now().UTC().Add(-30 * time.Minute)
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(stale.Unix()), Member: "u2"})
	client.Set(ctx, fmt.Sprintf(redisPresenceLastSeenKey, "u3"), stale.Format(time.RFC3339), 0)

	statuses := hub.GetPresenceStatuses([]string{"u1", "u2", "u3", "u4"})

	if len(statuses) != 3 {
		t.Fatalf("expected 3 statuses, got %d", len(statuses))
	}
	if !statuses["u1"].Online {
		t.Error("u1 should be online")
	}
	if statuses["u2"].Online {
		t.Error("u2 should be offline (stale score)")
	}
	if statuses["u2"].LastSeen.IsZero() {
		t.Error("u2 should carry a last_seen")
	}
	if statuses["u3"].Online {
		t.Error("u3 should be offline (cached only)")
	}
	if _, ok := statuses["u4"]; ok {
		t.Error("u4 (never seen) must be omitted")
	}
}

// =============================================================================
// expirePresenceUsers / sweepExpiredPresence
// =============================================================================

func TestExpirePresenceUsers_OnlyStale(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()

	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Add(-5 * time.Minute).Unix()), Member: "stale"})
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "fresh"})

	expired := hub.expirePresenceUsers(time.Now(), PresenceTTL)

	foundStale, foundFresh := false, false
	for _, id := range expired {
		if id == "stale" {
			foundStale = true
		}
		if id == "fresh" {
			foundFresh = true
		}
	}
	if !foundStale {
		t.Error("stale member must be expired")
	}
	if foundFresh {
		t.Error("fresh member must not be expired")
	}
}

func TestSweepExpiredPresence_RemovesStaleKeepsFresh(t *testing.T) {
	hub, client := newRedisHub(t)
	ctx := context.Background()

	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Add(-5 * time.Minute).Unix()), Member: "stale-user"})
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "fresh-user"})

	hub.sweepExpiredPresence(time.Now())

	if _, err := client.ZScore(ctx, redisPresenceKey, "stale-user").Result(); err != redis.Nil {
		t.Error("stale-user must be removed from the presence set")
	}
	if _, err := client.ZScore(ctx, redisPresenceKey, "fresh-user").Result(); err != nil {
		t.Error("fresh-user must remain in the presence set")
	}
	if v, err := client.Get(ctx, fmt.Sprintf(redisPresenceLastSeenKey, "stale-user")).Result(); err != nil || v == "" {
		t.Error("last_seen must be cached for the swept user")
	}
}

// =============================================================================
// markUserOffline / flushOfflineToDB
// =============================================================================

func TestMarkUserOffline_RemovesCachesAndFlushesDB(t *testing.T) {
	hub, client, mock := newRedisHubWithDB(t)
	ctx := context.Background()

	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Add(-3 * time.Minute).Unix()), Member: "user-1"})

	mock.ExpectExec(`UPDATE users SET is_online = false, last_seen_at = \$1 WHERE id = \$2 AND is_online = true`).
		WithArgs(sqlmock.AnyArg(), "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	hub.markUserOffline("user-1", "alice", false)

	if _, err := client.ZScore(ctx, redisPresenceKey, "user-1").Result(); err != redis.Nil {
		t.Error("member must be removed from the presence set")
	}
	if v, err := client.Get(ctx, fmt.Sprintf(redisPresenceLastSeenKey, "user-1")).Result(); err != nil || v == "" {
		t.Error("last_seen must be cached after offline")
	}
}

func TestMarkUserOffline_NilRedis_FlushesDB(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectExec(`UPDATE users SET is_online = false, last_seen_at = \$1 WHERE id = \$2 AND is_online = true`).
		WithArgs(sqlmock.AnyArg(), "user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	hub.markUserOffline("user-1", "alice", false)
}

func TestFlushOfflineToDB_SkipsWhenUserBackOnline(t *testing.T) {
	hub, client, mock := newRedisHubWithDB(t)
	ctx := context.Background()
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "user-1"})

	// Reconnect race: the presence store says online → no DB write may happen.
	hub.flushOfflineToDB("user-1", time.Now())
	_ = mock // no expectations means no Exec was allowed
}

// Reconnect race (regression): when a fresh connection of the same user is
// already registered, markUserOffline must not remove the presence marker or
// broadcast user_offline — the marker was just re-added by the reconnect and
// ZRem would leave the UI stuck offline.
func TestMarkUserOffline_SkipsWhenLiveConnectionExists(t *testing.T) {
	hub, client, mock := newRedisHubWithDB(t)
	ctx := context.Background()
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "user-1"})

	connected := newTestClient(hub, "user-1", "Alice")
	hub.mu.Lock()
	hub.clients[connected] = true
	hub.mu.Unlock()

	hub.markUserOffline("user-1", "alice", true)

	if _, err := client.ZScore(ctx, redisPresenceKey, "user-1").Result(); err != nil {
		t.Error("presence marker must survive when a live connection exists")
	}
	_ = mock // no DB expectations: the offline flush must not run
}

// =============================================================================
// hasLiveConnections (multi-tab fix)
// =============================================================================

func TestHasLiveConnections(t *testing.T) {
	hub := NewHub(nil, nil)
	c1 := newTestClient(hub, "user-1", "Alice")
	c2 := newTestClient(hub, "user-1", "Alice") // second tab of the same user
	c3 := newTestClient(hub, "user-2", "Bob")

	hub.mu.Lock()
	hub.clients[c1] = true
	hub.clients[c2] = true
	hub.clients[c3] = true
	hub.mu.Unlock()

	if !hub.hasLiveConnections("user-1") {
		t.Fatal("user-1 has a live second connection")
	}

	hub.mu.Lock()
	delete(hub.clients, c1)
	delete(hub.clients, c2)
	hub.mu.Unlock()

	if hub.hasLiveConnections("user-1") {
		t.Fatal("user-1 has no live connections anymore")
	}
	if !hub.hasLiveConnections("user-2") {
		t.Fatal("user-2 is still connected")
	}
	if hub.hasLiveConnections("") {
		t.Fatal("empty user id must report false")
	}
}

// =============================================================================
// canAccessRoom — presence_<userID> ACL (same rules as now-playing)
// =============================================================================

func TestCanAccessRoom_Presence_PublicProfile(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(false))

	if !hub.canAccessRoom("user-b", "presence_user-a") {
		t.Fatal("expected access to a public profile's presence room")
	}
}

func TestCanAccessRoom_Presence_PrivateProfile_StrangerDenied(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-b", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	if hub.canAccessRoom("user-b", "presence_user-a") {
		t.Fatal("stranger must be denied access to a private profile's presence room")
	}
}

func TestCanAccessRoom_Presence_PrivateProfile_FriendAllowed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnRows(sqlmock.NewRows([]string{"private_profile"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM friendships`).
		WithArgs("user-b", "user-a").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	if !hub.canAccessRoom("user-b", "presence_user-a") {
		t.Fatal("friend must be allowed access to a private profile's presence room")
	}
}

func TestCanAccessRoom_Presence_OwnerAllowed(t *testing.T) {
	hub, _ := setupHubWithDB(t)
	if !hub.canAccessRoom("user-a", "presence_user-a") {
		t.Fatal("owner must be allowed access to their own presence room")
	}
}

func TestCanAccessRoom_Presence_NoPrivacyRow_Allowed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnError(sql.ErrNoRows)

	if !hub.canAccessRoom("user-b", "presence_user-a") {
		t.Fatal("expected access when no privacy settings row exists (public default)")
	}
}

func TestCanAccessRoom_Presence_DBError_FailClosed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(private_profile, false\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-a").
		WillReturnError(sqlmock.ErrCancelled)

	if hub.canAccessRoom("user-b", "presence_user-a") {
		t.Fatal("expected fail-closed denial on DB error")
	}
}

func TestCanAccessRoom_Presence_EmptyTarget_Denied(t *testing.T) {
	hub, _ := setupHubWithDB(t)
	if hub.canAccessRoom("user-b", "presence_") {
		t.Fatal("expected denial for empty target id")
	}
}

// =============================================================================
// SendPresenceSnapshot
// =============================================================================

func TestSendPresenceSnapshot_Online(t *testing.T) {
	hub, client, mock := newRedisHubWithDB(t)
	ctx := context.Background()
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "user-42"})

	viewer := newTestClient(hub, "viewer", "Viewer")

	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-42").
		WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(true))

	hub.SendPresenceSnapshot(viewer, "user-42")

	select {
	case msg := <-viewer.Send:
		if !containsStr(string(msg), "presence_snapshot") {
			t.Errorf("expected 'presence_snapshot', got: %s", string(msg))
		}
		if !containsStr(string(msg), `"is_online":true`) {
			t.Errorf("expected is_online:true in snapshot, got: %s", string(msg))
		}
	default:
		t.Fatal("client should receive a presence snapshot")
	}
}

func TestSendPresenceSnapshot_PrivacyHidden(t *testing.T) {
	hub, client, mock := newRedisHubWithDB(t)
	ctx := context.Background()
	client.ZAdd(ctx, redisPresenceKey, redis.Z{Score: float64(time.Now().Unix()), Member: "user-42"})

	viewer := newTestClient(hub, "viewer", "Viewer")

	mock.ExpectQuery(`SELECT COALESCE\(show_online_status, true\) FROM privacy_settings WHERE user_id = \$1`).
		WithArgs("user-42").
		WillReturnRows(sqlmock.NewRows([]string{"show"}).AddRow(false))

	hub.SendPresenceSnapshot(viewer, "user-42")

	select {
	case msg := <-viewer.Send:
		if !containsStr(string(msg), `"is_online":false`) {
			t.Errorf("expected is_online:false when status is hidden, got: %s", string(msg))
		}
		if strings.Contains(string(msg), "last_seen") {
			t.Errorf("hidden status must not include last_seen, got: %s", string(msg))
		}
	default:
		t.Fatal("client should receive a presence snapshot")
	}
}

func TestSendPresenceSnapshot_NoClientOrUser_Noop(t *testing.T) {
	hub, _ := newRedisHub(t)
	hub.SendPresenceSnapshot(nil, "user-42") // must not panic
	hub.SendPresenceSnapshot(newTestClient(hub, "v", "V"), "")
}
