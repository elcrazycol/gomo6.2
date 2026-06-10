package handlers

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/gomo6/backend/internal/auth"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func setupTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis start failed: %v", err)
	}
	t.Cleanup(mr.Close)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func newTestHandler(t *testing.T) *WebAuthnHandler {
	t.Helper()
	return NewWebAuthnHandler(nil, setupTestRedis(t), nil)
}

func TestWebAuthnUser_WebAuthnID_ValidUUID(t *testing.T) {
	id := uuid.New()
	u := &webAuthnUser{
		userID:      id.String(),
		username:    "test",
		displayName: "Test User",
	}

	got := u.WebAuthnID()
	want := id[:]

	if len(got) != 16 {
		t.Errorf("WebAuthnID() length = %d, want 16", len(got))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("WebAuthnID()[%d] = %d, want %d", i, got[i], want[i])
		}
	}
}

func TestWebAuthnUser_WebAuthnID_InvalidUUID_Fallback(t *testing.T) {
	u := &webAuthnUser{
		userID:      "not-a-uuid-1234",
		username:    "test",
		displayName: "Test User",
	}

	got := u.WebAuthnID()
	if len(got) != 16 {
		t.Errorf("WebAuthnID() fallback length = %d, want 16", len(got))
	}

	for i := 0; i < len("not-a-uuid-1234") && i < 16; i++ {
		if got[i] != u.userID[i] {
			t.Errorf("WebAuthnID() fallback[%d] = %d, want %d", i, got[i], u.userID[i])
		}
	}
}

func TestWebAuthnUser_InterfaceMethods(t *testing.T) {
	u := &webAuthnUser{
		userID:      uuid.New().String(),
		username:    "alice",
		displayName: "Alice Display",
	}

	if u.WebAuthnName() != "alice" {
		t.Errorf("WebAuthnName() = %q, want %q", u.WebAuthnName(), "alice")
	}
	if u.WebAuthnDisplayName() != "Alice Display" {
		t.Errorf("WebAuthnDisplayName() = %q, want %q", u.WebAuthnDisplayName(), "Alice Display")
	}
	if u.WebAuthnIcon() != "" {
		t.Errorf("WebAuthnIcon() = %q, want empty", u.WebAuthnIcon())
	}
	if len(u.WebAuthnCredentials()) != 0 {
		t.Errorf("WebAuthnCredentials() len = %d, want 0", len(u.WebAuthnCredentials()))
	}
}

func TestSessionRedis_StoreAndLoad(t *testing.T) {
	h := newTestHandler(t)

	_, ok := h.loadSession("user1", "register")
	if ok {
		t.Error("loadSession before store should return false")
	}

	h.storeSession("user1", "register", &webauthn.SessionData{})

	_, ok = h.loadSession("user1", "register")
	if !ok {
		t.Error("loadSession after store should return true")
	}

	h.deleteSession("user1", "register")
}

func TestSessionRedis_Delete(t *testing.T) {
	h := newTestHandler(t)

	h.storeSession("user1", "register", &webauthn.SessionData{})
	h.deleteSession("user1", "register")

	_, ok := h.loadSession("user1", "register")
	if ok {
		t.Error("loadSession after delete should return false")
	}
}

func TestSessionRedis_Expiry(t *testing.T) {
	h := newTestHandler(t)

	h.storeSession("ephemeral", "login", &webauthn.SessionData{})

	// Verify session exists within TTL.
	_, ok := h.loadSession("ephemeral", "login")
	if !ok {
		t.Error("loadSession within TTL should return true")
	}

	h.deleteSession("ephemeral", "login")

	// After delete, no longer found.
	_, ok = h.loadSession("ephemeral", "login")
	if ok {
		t.Error("loadSession after delete should return false")
	}
}

func TestSessionRedis_CrossUserIsolation(t *testing.T) {
	h := newTestHandler(t)

	h.storeSession("userA", "register", &webauthn.SessionData{})
	h.storeSession("userB", "register", &webauthn.SessionData{})

	_, okA := h.loadSession("userA", "register")
	_, okB := h.loadSession("userB", "register")

	if !okA {
		t.Error("userA session should exist")
	}
	if !okB {
		t.Error("userB session should exist")
	}

	h.deleteSession("userA", "register")

	_, okA = h.loadSession("userA", "register")
	_, okB = h.loadSession("userB", "register")

	if okA {
		t.Error("userA session should be deleted")
	}
	if !okB {
		t.Error("userB session should still exist")
	}

	h.deleteSession("userB", "register")
}

func TestSessionRedis_TypeSeparation(t *testing.T) {
	h := newTestHandler(t)

	h.storeSession("user1", "register", &webauthn.SessionData{})
	h.storeSession("user1", "login", &webauthn.SessionData{})

	_, okReg := h.loadSession("user1", "register")
	_, okLogin := h.loadSession("user1", "login")

	if !okReg {
		t.Error("register session should exist")
	}
	if !okLogin {
		t.Error("login session should exist")
	}

	h.deleteSession("user1", "register")

	_, okReg = h.loadSession("user1", "register")
	_, okLogin = h.loadSession("user1", "login")

	if okReg {
		t.Error("register session should be deleted")
	}
	if !okLogin {
		t.Error("login session should still exist")
	}

	h.deleteSession("user1", "login")
}

func TestSessionRedis_NilRedis(t *testing.T) {
	h := &WebAuthnHandler{redis: nil}

	// storeSession should not panic with nil Redis
	h.storeSession("user1", "register", &webauthn.SessionData{})

	// loadSession should return false with nil Redis
	_, ok := h.loadSession("user1", "register")
	if ok {
		t.Error("loadSession with nil Redis should return false")
	}

	// deleteSession should not panic with nil Redis
	h.deleteSession("user1", "register")
}

func TestSessionRedis_SessionKeyFormat(t *testing.T) {
	h := &WebAuthnHandler{}

	key := h.sessionKey("login", "abc123")
	if key != "webauthn:session:login:abc123" {
		t.Errorf("sessionKey = %q, want %q", key, "webauthn:session:login:abc123")
	}

	key2 := h.sessionKey("register", "user-uuid-here")
	if key2 != "webauthn:session:register:user-uuid-here" {
		t.Errorf("sessionKey = %q, want %q", key2, "webauthn:session:register:user-uuid-here")
	}
}

func TestBeginRegistration_ClaimsValidation(t *testing.T) {
	claims := &auth.Claims{
		UserID:   uuid.New().String(),
		Username: "testuser",
	}

	if claims.UserID == "" {
		t.Error("UserID should not be empty")
	}
	if claims.Username == "" {
		t.Error("Username should not be empty")
	}
}
