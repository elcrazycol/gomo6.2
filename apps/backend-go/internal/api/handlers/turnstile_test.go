package handlers

import (
	"net/http"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// TestMain stubs the Cloudflare Turnstile siteverify check for the whole
// handlers test package: unit tests run without network access or real
// Cloudflare credentials, so the gate must pass for every existing handler
// test to keep exercising the handler logic below it. Dedicated tests for the
// reject path (turnstile_test.go) temporarily swap the var back.
func TestMain(m *testing.M) {
	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return true }
	code := m.Run()
	turnstileVerify = old
	os.Exit(code)
}

// ─── Turnstile reject paths ─────────────────────────────────────────────────

func TestRegister_TurnstileRejected(t *testing.T) {
	h, mock := setupAuthHandler(t)
	_ = mock

	// Isolate from an ambient TURNSTILE_DISABLED=1 (e.g. exported in the dev
	// shell): verifyTurnstileForRequest must call the swapped stub and reject.
	t.Setenv("TURNSTILE_DISABLED", "")

	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return false }
	defer func() { turnstileVerify = old }()

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Register(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Turnstile fails, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_TurnstileRejected(t *testing.T) {
	h, mock := setupAuthHandler(t)
	_ = mock

	// Isolate from an ambient TURNSTILE_DISABLED=1 (e.g. exported in the dev
	// shell): verifyTurnstileForRequest must call the swapped stub and reject.
	t.Setenv("TURNSTILE_DISABLED", "")

	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return false }
	defer func() { turnstileVerify = old }()

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "test@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Turnstile fails, got %d: %s", w.Code, w.Body.String())
	}
}
