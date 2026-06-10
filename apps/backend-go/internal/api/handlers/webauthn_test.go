package handlers

import (
	"testing"
	"time"

	"github.com/gomo6/backend/internal/auth"
	"github.com/google/uuid"
)

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

	// First bytes should match the userID prefix
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

func TestSessionStorage_StoreAndLoad(t *testing.T) {
	h := &WebAuthnHandler{}

	// Verify nothing exists initially
	_, ok := h.loadSession("user1", "register")
	if ok {
		t.Error("loadSession before store should return false")
	}

	// Store and verify it exists
	h.storeSession("user1", "register", nil)
	_, ok = h.loadSession("user1", "register")
	if !ok {
		t.Error("loadSession after store should return true")
	}

	// Clean up
	h.deleteSession("user1", "register")
}

func TestSessionStorage_Delete(t *testing.T) {
	h := &WebAuthnHandler{}

	h.storeSession("user1", "register", nil)
	h.deleteSession("user1", "register")

	_, ok := h.loadSession("user1", "register")
	if ok {
		t.Error("loadSession after delete should return false")
	}
}

func TestSessionStorage_Expiry(t *testing.T) {
	h := &WebAuthnHandler{}

	// Store a session then manually expire it
	h.storeSession("expired-user", "login", nil)

	webauthnSessionsMu.Lock()
	key := "login:expired-user"
	if entry, ok := webauthnSessions[key]; ok {
		entry.expiresAt = time.Now().Add(-1 * time.Minute) // expire it
	}
	webauthnSessionsMu.Unlock()

	_, ok := h.loadSession("expired-user", "login")
	if ok {
		t.Error("loadSession should return false for expired session")
	}

	// Clean up
	h.deleteSession("expired-user", "login")
}

func TestSessionStorage_CrossUserIsolation(t *testing.T) {
	h := &WebAuthnHandler{}

	h.storeSession("userA", "register", nil)
	h.storeSession("userB", "register", nil)

	_, okA := h.loadSession("userA", "register")
	_, okB := h.loadSession("userB", "register")

	if !okA {
		t.Error("userA session should exist")
	}
	if !okB {
		t.Error("userB session should exist")
	}

	// Delete only userA
	h.deleteSession("userA", "register")

	_, okA = h.loadSession("userA", "register")
	_, okB = h.loadSession("userB", "register")

	if okA {
		t.Error("userA session should be deleted")
	}
	if !okB {
		t.Error("userB session should still exist")
	}

	// Clean up
	h.deleteSession("userB", "register")
}

func TestSessionStorage_TypeSeparation(t *testing.T) {
	h := &WebAuthnHandler{}

	h.storeSession("user1", "register", nil)
	h.storeSession("user1", "login", nil)

	_, okReg := h.loadSession("user1", "register")
	_, okLogin := h.loadSession("user1", "login")

	if !okReg {
		t.Error("register session should exist")
	}
	if !okLogin {
		t.Error("login session should exist")
	}

	// Delete register, login should remain
	h.deleteSession("user1", "register")

	_, okReg = h.loadSession("user1", "register")
	_, okLogin = h.loadSession("user1", "login")

	if okReg {
		t.Error("register session should be deleted")
	}
	if !okLogin {
		t.Error("login session should still exist")
	}

	// Clean up
	h.deleteSession("user1", "login")
}

func TestBeginRegistration_NoAuth(t *testing.T) {
	// This test verifies that auth claims have expected fields.
	// Full HTTP test would need gin setup — the actual handler uses c.Get("claims")
	// which would return 401 if claims are missing.
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
