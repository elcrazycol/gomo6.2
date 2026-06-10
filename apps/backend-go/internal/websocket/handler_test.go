package websocket

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// =============================================================================
// NewHandler
// =============================================================================

func TestNewHandler(t *testing.T) {
	hub := NewHub(nil, nil)
	handler := NewHandler(hub, nil)

	if handler == nil {
		t.Fatal("handler should not be nil")
	}
	if handler.hub != hub {
		t.Error("handler.hub should be set")
	}
	if handler.authService != nil {
		t.Error("authService should be nil when nil passed")
	}
}

// =============================================================================
// HandleWebSocket — no longer requires pre-authentication.
// Auth is deferred to the first WebSocket message (type: "auth").
// The handler just upgrades the connection; invalid clients are disconnected
// by the readPump after the 5-second auth timeout.
// =============================================================================

func TestHandleWebSocket_NoAuthRequired(t *testing.T) {
	gin.SetMode(gin.TestMode)

	hub := NewHub(nil, nil)
	authService := auth.NewAuthService()
	handler := NewHandler(hub, authService)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/ws", nil)

	// HandleWebSocket should NOT return 401 — it defers auth to the WS message.
	// Since the test request has no Upgrade headers, the upgrader will fail,
	// but the handler itself should not reject based on missing claims.
	handler.HandleWebSocket(c)

	// The handler should have attempted the upgrade (no 401 rejection)
	if w.Code == http.StatusUnauthorized {
		t.Error("HandleWebSocket should NOT return 401 — auth is deferred to first WS message")
	}
}

// =============================================================================
// HandleWebSocket — valid claims (just checks it doesn't panic)
// =============================================================================

func TestHandleWebSocket_ValidClaims(t *testing.T) {
	gin.SetMode(gin.TestMode)

	hub := NewHub(nil, nil)
	handler := NewHandler(hub, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/ws", nil)
	c.Set("claims", &auth.Claims{
		UserID:   "user-1",
		Username: "Alice",
		Domain:   "web",
	})

	// Should attempt to upgrade; since Connection header is missing,
	// the upgrader will fail silently but handler should not panic
	handler.HandleWebSocket(c)
	// If we get here without panic, the test passes
}

// =============================================================================
// GetOnlineUsers
// =============================================================================

func TestHandleWebSocket_GetOnlineUsers_Empty(t *testing.T) {
	gin.SetMode(gin.TestMode)

	hub := NewHub(nil, nil)
	handler := NewHandler(hub, nil)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/ws/online", nil)

	handler.GetOnlineUsers(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Count int      `json:"count"`
		Users []string `json:"users"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp.Count != 0 {
		t.Errorf("expected 0 online users, got %d", resp.Count)
	}
	if len(resp.Users) != 0 {
		t.Errorf("expected empty users list, got %v", resp.Users)
	}
}

func TestHandleWebSocket_GetOnlineUsers_WithUsers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	hub := NewHub(nil, nil)
	handler := NewHandler(hub, nil)

	// Register a user (without starting Run() loop — we just check presence state)
	// Manually add to presence map for testing
	hub.mu.Lock()
	client := newTestClient(hub, "user-42", "Alice")
	hub.clients[client] = true
	hub.presence[client.UserID] = client
	hub.mu.Unlock()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/ws/online", nil)

	handler.GetOnlineUsers(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp struct {
		Count int      `json:"count"`
		Users []string `json:"users"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp.Count != 1 {
		t.Errorf("expected 1 online user, got %d", resp.Count)
	}
	if len(resp.Users) != 1 || resp.Users[0] != "user-42" {
		t.Errorf("expected ['user-42'], got %v", resp.Users)
	}
}
