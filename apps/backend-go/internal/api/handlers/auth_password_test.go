package handlers

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── Password Validation ─────────────────────────────────────────────────────

func TestValidatePassword_TooShort(t *testing.T) {
	err := validatePassword("Ab1")
	if err == nil {
		t.Fatal("expected error for short password")
	}
}

func TestValidatePassword_NoLetter(t *testing.T) {
	err := validatePassword("12345678")
	if err == nil {
		t.Fatal("expected error for password without letters")
	}
}

func TestValidatePassword_NoDigit(t *testing.T) {
	err := validatePassword("abcdefgh")
	if err == nil {
		t.Fatal("expected error for password without digits")
	}
}

func TestValidatePassword_Valid(t *testing.T) {
	err := validatePassword("Xm4kP9vL2nR7qW5")
	if err != nil {
		t.Fatalf("expected valid password, got error: %v", err)
	}
}

func TestValidatePassword_Exactly8Chars(t *testing.T) {
	err := validatePassword("Tq8mKp3x")
	if err != nil {
		t.Fatalf("expected exactly-8-char password to be valid, got: %v", err)
	}
}

func TestValidatePassword_Unicode(t *testing.T) {
	// Unicode letters and digits should count
	err := validatePassword("тестX7kM2pN")
	if err != nil {
		t.Fatalf("unicode password should be valid: %v", err)
	}
}

// ─── UpdatePassword ──────────────────────────────────────────────────────────

func TestUpdatePassword_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectExec(`(?s).*UPDATE users SET password_hash.*WHERE id.*`).
		WithArgs(sqlmock.AnyArg(), "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newPOSTContext("/auth/v1/update-password", map[string]string{
		"password": "vE7xKp2mNq9rLw5t",
	}, claims, nil)
	h.UpdatePassword(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdatePassword_TooShort(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newPOSTContext("/auth/v1/update-password", map[string]string{
		"password": "abc",
	}, claims, nil)
	h.UpdatePassword(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUpdatePassword_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/update-password", map[string]string{
		"password": "newpassword123",
	}, nil, nil)
	h.UpdatePassword(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
