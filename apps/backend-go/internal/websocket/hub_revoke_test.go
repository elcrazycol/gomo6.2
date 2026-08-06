package websocket

import (
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newTestSessionClient creates a test client bound to a specific session.
func newTestSessionClient(hub *Hub, userID, username, sessionID string) *Client {
	c := newTestClient(hub, userID, username)
	c.SessionID = sessionID
	return c
}

// =============================================================================
// disconnectSession — per-device kick
// =============================================================================

func TestHub_DisconnectSession_KicksOnlyMatchingSession(t *testing.T) {
	hub := NewHub(nil, nil)
	victim := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	otherSession := newTestSessionClient(hub, "u1", "Alice", "sess-2")
	otherUser := newTestSessionClient(hub, "u2", "Bob", "sess-1")

	hub.mu.Lock()
	hub.clients[victim] = true
	hub.clients[otherSession] = true
	hub.clients[otherUser] = true
	hub.mu.Unlock()

	hub.disconnectSession("u1", "sess-1")

	hub.mu.RLock()
	_, victimStill := hub.clients[victim]
	_, otherStill := hub.clients[otherSession]
	_, otherUserStill := hub.clients[otherUser]
	hub.mu.RUnlock()

	if victimStill {
		t.Error("matching session must be disconnected")
	}
	if !otherStill {
		t.Error("user's other session must survive the kick")
	}
	if !otherUserStill {
		t.Error("other user's session must survive the kick")
	}
}

func TestHub_DisconnectSession_SendsRevokedMessage(t *testing.T) {
	hub := NewHub(nil, nil)
	victim := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[victim] = true
	hub.mu.Unlock()

	hub.disconnectSession("u1", "sess-1")

	select {
	case msg := <-victim.Send:
		if !strings.Contains(string(msg), "session_revoked") {
			t.Errorf("kicked client must receive a session_revoked message, got: %s", string(msg))
		}
	default:
		t.Error("kicked client must receive a final session_revoked message")
	}
}

func TestHub_DisconnectSession_EmptyIDsNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	client := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[client] = true
	hub.mu.Unlock()

	hub.disconnectSession("", "sess-1")
	hub.disconnectSession("u1", "")
	hub.disconnectSession("u2", "sess-1")

	hub.mu.RLock()
	_, still := hub.clients[client]
	hub.mu.RUnlock()
	if !still {
		t.Error("unrelated disconnect calls must not remove the client")
	}
}

func TestHub_DisconnectUser_StillRevokesAll(t *testing.T) {
	hub := NewHub(nil, nil)
	c1 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	c2 := newTestSessionClient(hub, "u1", "Alice", "sess-2")
	c3 := newTestSessionClient(hub, "u2", "Bob", "sess-9")
	hub.mu.Lock()
	hub.clients[c1] = true
	hub.clients[c2] = true
	hub.clients[c3] = true
	hub.mu.Unlock()

	hub.disconnectUser("u1")

	hub.mu.RLock()
	_, c1Still := hub.clients[c1]
	_, c2Still := hub.clients[c2]
	_, c3Still := hub.clients[c3]
	hub.mu.RUnlock()
	if c1Still || c2Still {
		t.Error("disconnectUser must remove every session of the user")
	}
	if !c3Still {
		t.Error("disconnectUser must not affect other users")
	}
}

// =============================================================================
// handleRevoke — payload parsing
// =============================================================================

func TestHub_HandleRevoke_SessionScopedPayload(t *testing.T) {
	hub := NewHub(nil, nil)
	victim := newTestSessionClient(hub, "u1", "Alice", "sess-7")
	other := newTestSessionClient(hub, "u1", "Alice", "sess-8")
	hub.mu.Lock()
	hub.clients[victim] = true
	hub.clients[other] = true
	hub.mu.Unlock()

	hub.handleRevoke(`{"user_id":"u1","session_id":"sess-7"}`)

	hub.mu.RLock()
	_, victimStill := hub.clients[victim]
	_, otherStill := hub.clients[other]
	hub.mu.RUnlock()
	if victimStill {
		t.Error("session-scoped revoke must disconnect the target session")
	}
	if !otherStill {
		t.Error("session-scoped revoke must keep the user's other sessions")
	}
}

func TestHub_HandleRevoke_FullUserPayload(t *testing.T) {
	hub := NewHub(nil, nil)
	c1 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[c1] = true
	hub.mu.Unlock()

	hub.handleRevoke(`{"user_id":"u1"}`)

	hub.mu.RLock()
	_, still := hub.clients[c1]
	hub.mu.RUnlock()
	if still {
		t.Error("full-user revoke payload must disconnect the user")
	}
}

func TestHub_HandleRevoke_LegacyBareUserID(t *testing.T) {
	hub := NewHub(nil, nil)
	c1 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[c1] = true
	hub.mu.Unlock()

	hub.handleRevoke("u1") // old format: bare user id

	hub.mu.RLock()
	_, still := hub.clients[c1]
	hub.mu.RUnlock()
	if still {
		t.Error("legacy bare-user-id revoke must disconnect the user")
	}
}

func TestHub_HandleRevoke_EmptyPayloadNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	c1 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[c1] = true
	hub.mu.Unlock()

	hub.handleRevoke("")
	hub.handleRevoke("   ")

	hub.mu.RLock()
	_, still := hub.clients[c1]
	hub.mu.RUnlock()
	if !still {
		t.Error("empty revoke payload must be ignored")
	}
}

// =============================================================================
// Per-session online markers
// =============================================================================

func TestHub_MarkSessionOnline_OfflineLifecycle(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	hub := NewHub(client, nil)

	hub.markSessionOnline("u1", "sess-1")
	if !mr.Exists("ws:online:u1:sess-1") {
		t.Fatal("online marker must be set for the session")
	}

	// TTL must be present so a crash never leaves a ghost online device.
	if ttl := mr.TTL("ws:online:u1:sess-1"); ttl <= 0 || ttl > 6*time.Minute {
		t.Errorf("expected ~5m TTL, got %v", ttl)
	}

	hub.touchSessionOnline("u1", "sess-1")
	if !mr.Exists("ws:online:u1:sess-1") {
		t.Fatal("touch must keep the marker alive")
	}

	hub.markSessionOffline("u1", "sess-1")
	if mr.Exists("ws:online:u1:sess-1") {
		t.Fatal("offline marker must be cleared on disconnect")
	}
}

func TestHub_MarkSessionOnline_NilRedisNoop(t *testing.T) {
	hub := NewHub(nil, nil)
	// Must not panic.
	hub.markSessionOnline("u1", "sess-1")
	hub.touchSessionOnline("u1", "sess-1")
	hub.markSessionOffline("u1", "sess-1")
}

// A device may hold several connections (multiple tabs). Closing one must not
// clear the online marker while another connection of the same session lives.
func TestHub_RemoveClient_KeepsOnlineMarkerWhileOtherTabConnected(t *testing.T) {
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	hub := NewHub(client, nil)
	tab1 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	tab2 := newTestSessionClient(hub, "u1", "Alice", "sess-1")
	hub.mu.Lock()
	hub.clients[tab1] = true
	hub.clients[tab2] = true
	hub.mu.Unlock()

	if err := mr.Set("ws:online:u1:sess-1", "1"); err != nil {
		t.Fatalf("seed failed: %v", err)
	}

	// First tab closes — marker must survive because tab2 is still connected.
	hub.mu.Lock()
	hub.removeClientLocked(tab1)
	hub.mu.Unlock()
	if !mr.Exists("ws:online:u1:sess-1") {
		t.Fatal("online marker must survive while another tab of the same session is connected")
	}

	// Last connection closes — the marker must be cleared (async, so poll).
	hub.mu.Lock()
	hub.removeClientLocked(tab2)
	hub.mu.Unlock()
	deadline := time.Now().Add(2 * time.Second)
	for mr.Exists("ws:online:u1:sess-1") {
		if time.Now().After(deadline) {
			t.Fatal("online marker must be cleared after the last connection closes")
		}
		time.Sleep(10 * time.Millisecond)
	}
}
