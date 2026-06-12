package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── GetMe ───────────────────────────────────────────────────────────────────

func TestGetMe_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "avatar_url", "bio", "garma", "post_count", "thread_count", "created_at", "is_remote"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", nil, nil, int64(0), int64(0), int64(0), time.Now(), false))

	c, w := newGETContextWithClaims("/auth/v1/me", nil, claims)
	h.GetMe(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestGetMe_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newGETContextWithClaims("/auth/v1/me", nil, nil)
	h.GetMe(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGetMe_UserNotFound(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "avatar_url", "bio", "garma", "post_count", "thread_count", "created_at", "is_remote"}))

	c, w := newGETContextWithClaims("/auth/v1/me", nil, claims)
	h.GetMe(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

func TestRefresh_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// RefreshAccessToken will try to validate the refresh token against Redis.
	// Without Redis, it returns an error. So we test the "no redis" path.
	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{
		"refresh_token": "some-refresh-token",
	}, claims, nil)
	h.Refresh(c)
	_ = mock

	// Without Redis, refresh always fails (which is the secure default)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without Redis, got %d: %s", w.Code, w.Body.String())
	}
}

func TestRefresh_NoClaims(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{
		"refresh_token": "some-token",
	}, nil, nil)
	h.Refresh(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestRefresh_MissingToken(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newPOSTContext("/auth/v1/refresh", map[string]string{}, claims, nil)
	h.Refresh(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing refresh_token, got %d", w.Code)
	}
}

func TestRefresh_InvalidBody(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newPOSTContext("/auth/v1/refresh", "not json", claims, nil)
	h.Refresh(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── Logout ──────────────────────────────────────────────────────────────────

func TestLogout_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{
		UserID:   "u1",
		Username: "testuser",
		Domain:   "localhost:8080",
	}

	c, w := newPOSTContext("/auth/v1/logout", nil, claims, nil)
	h.Logout(c)
	_ = mock

	// Logout should succeed even without Redis (blacklist is best-effort)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestLogout_NoClaims(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/logout", nil, nil, nil)
	h.Logout(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestLogout_NoExpiry(t *testing.T) {
	// Logout should still work when token has no ExpiresAt
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{
		UserID:   "u1",
		Username: "testuser",
		Domain:   "localhost:8080",
		// No RegisteredClaims, so no jti and no ExpiresAt
	}

	c, w := newPOSTContext("/auth/v1/logout", nil, claims, nil)
	h.Logout(c)
	_ = mock

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 even without expiry, got %d: %s", w.Code, w.Body.String())
	}
}
