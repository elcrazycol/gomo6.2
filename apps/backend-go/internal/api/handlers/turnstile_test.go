package handlers

import (
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
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

func TestCreatePostRPC_TurnstileRejected(t *testing.T) {
	h, mock := setupRPCHandler(t)
	_ = mock

	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return false }
	defer func() { turnstileVerify = old }()

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": "550e8400-e29b-41d4-a716-446655440000",
		"content":   "Test",
	}, &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"})
	h.CreatePostRPC(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Turnstile fails for human, got %d: %s", w.Code, w.Body.String())
	}
}

// Bots (gomo6_bot_ tokens, is_bot flag) are trusted service accounts and must
// NOT be blocked by the browser challenge.
func TestCreatePostRPC_BotSkipsTurnstile(t *testing.T) {
	h, mock := setupRPCHandlerWithSyncStats(t)

	// Force the real (failing) siteverify path — a bot must still succeed.
	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return false }
	defer func() { turnstileVerify = old }()

	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}
	threadID := "550e8400-e29b-41d4-a716-446655440000"
	now := time.Now()

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM threads WHERE id = \$1\)`).
		WithArgs(threadID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`(?s).*INSERT INTO posts.*RETURNING.*`).
		WithArgs(threadID, "u1", "Bot post content",
			nil, nil, sqlmock.AnyArg(), sqlmock.AnyArg(), nil, false, nil, "localhost:8080").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "thread_id", "user_id", "content", "content_json",
			"image_url", "image_urls", "attachments", "reply_to", "is_private",
			"private_recipient_id", "server_domain", "created_at", "is_remote",
		}).AddRow(
			"post-1", threadID, "u1", "Bot post content", nil,
			nil, nil, nil, nil, false,
			nil, "localhost:8080", now, false,
		))

	mock.ExpectExec(`UPDATE threads SET post_count = post_count \+ 1, updated_at = NOW\(\) WHERE id = \$1`).
		WithArgs(threadID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectExec(`(?s).*UPDATE users.*SET.*post_count.*FROM.*WHERE u.id = \$1`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newRPCPostContext(map[string]interface{}{
		"thread_id": threadID,
		"content":   "Bot post content",
	}, claims)
	c.Set("is_bot", true) // BotAuthMiddleware sets this for gomo6_bot_ tokens
	h.CreatePostRPC(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 for bot even when Turnstile fails, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCreateThreadRPC_TurnstileRejected(t *testing.T) {
	h, mock := setupRPCHandler(t)
	_ = mock

	old := turnstileVerify
	turnstileVerify = func(_ *gin.Context, _ string, _ string) bool { return false }
	defer func() { turnstileVerify = old }()

	c, w := newRPCPostContext(map[string]interface{}{
		"board_id": "550e8400-e29b-41d4-a716-446655440000",
		"title":    "Title",
		"content":  "Content",
	}, &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"})
	h.CreateThreadRPC(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when Turnstile fails for human, got %d: %s", w.Code, w.Body.String())
	}
}
