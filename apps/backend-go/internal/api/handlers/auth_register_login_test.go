package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/models"
	"golang.org/x/crypto/bcrypt"
)

// ─── Register ────────────────────────────────────────────────────────────────

func TestRegister_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO users.*RETURNING.*`).
		WithArgs("testuser", "testuser", "test@example.com", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", time.Now()))

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Register(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestRegister_InvalidBody(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/register", "not a json object", nil, nil)
	h.Register(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestRegister_DBError(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO users.*RETURNING.*`).
		WithArgs("testuser", "testuser", "test@example.com", sqlmock.AnyArg()).
		WillReturnError(sqlmock.ErrCancelled)

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Register(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── Register — Password Validation ──────────────────────────────────────────

func TestRegister_WeakPassword_TooShort(t *testing.T) {
	h, mock := setupAuthHandler(t)

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "Ab1",
	}, nil, nil)
	h.Register(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for short password, got %d", w.Code)
	}
}

func TestRegister_WeakPassword_NoLetter(t *testing.T) {
	h, mock := setupAuthHandler(t)

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "12345678",
	}, nil, nil)
	h.Register(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for password without letters, got %d", w.Code)
	}
}

func TestRegister_WeakPassword_NoDigit(t *testing.T) {
	h, mock := setupAuthHandler(t)

	email := "test@example.com"
	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    &email,
		Password: "abcdefgh",
	}, nil, nil)
	h.Register(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for password without digits, got %d", w.Code)
	}
}

// ─── Login ───────────────────────────────────────────────────────────────────

func TestLogin_Success_No2FA(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}
	hashedPassword := string(realHashBytes)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", hashedPassword, false, nil, nil, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "test@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

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

func TestLogin_InvalidCredentials_NoUser(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("unknown@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "unknown@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestLogin_DBError(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "test@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestLogin_InvalidBody(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/login", "not a json object", nil, nil)
	h.Login(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), false, nil, nil, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "test@example.com",
		"password": "wrongpassword",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong password, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Login — with 2FA (no trusted device) ────────────────────────────────────

func TestLogin_With2FA_NoTrustedDevice(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, nil, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":    "test@example.com",
		"password": "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			Needs2FA bool   `json:"needs_2fa"`
			Token    string `json:"token"`
			User     struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data.Needs2FA {
		t.Fatal("expected needs_2fa=true for 2FA-enabled login without trusted device")
	}
	if resp.Data.Token == "" {
		t.Fatal("expected non-empty partial token")
	}
}

// ─── Login — with 2FA (trusted device) ───────────────────────────────────────

func TestLogin_With2FA_TrustedDevice(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	futureExpiry := time.Now().Add(30 * 24 * time.Hour).Unix()
	trustedDevices := map[string]int64{"my-device-1": futureExpiry}
	trustedJSON, _ := json.Marshal(trustedDevices)
	trustedStr := string(trustedJSON)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, &trustedStr, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":     "test@example.com",
		"password":  "vE7xKp2mNq9rLw5t",
		"device_id": "my-device-1",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			Needs2FA bool   `json:"needs_2fa"`
			Token    string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data.Needs2FA {
		t.Fatal("expected needs_2fa=false for trusted device")
	}
	if resp.Data.Token == "" {
		t.Fatal("expected non-empty full token")
	}
}

// ─── Login — with 2FA (expired trusted device) ───────────────────────────────

func TestLogin_With2FA_ExpiredTrustedDevice(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	expiredExpiry := time.Now().Add(-1 * time.Hour).Unix()
	trustedDevices := map[string]int64{"old-device": expiredExpiry}
	trustedJSON, _ := json.Marshal(trustedDevices)
	trustedStr := string(trustedJSON)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE username.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, &trustedStr, time.Now()))

	c, w := newPOSTContext("/auth/v1/login", map[string]string{
		"email":     "test@example.com",
		"password":  "vE7xKp2mNq9rLw5t",
		"device_id": "old-device",
	}, nil, nil)
	h.Login(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			Needs2FA bool   `json:"needs_2fa"`
			Token    string `json:"token"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data.Needs2FA {
		t.Fatal("expected needs_2fa=true for expired trusted device")
	}
	if resp.Data.Token == "" {
		t.Fatal("expected non-empty partial token")
	}
}
