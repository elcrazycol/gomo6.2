package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/pquerna/otp/totp"
	"golang.org/x/crypto/bcrypt"
)

// ─── Register ────────────────────────────────────────────────────────────────

func TestRegister_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO users.*RETURNING.*`).
		WithArgs("testuser", "test@example.com", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", time.Now()))

	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    "test@example.com",
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
		WithArgs("testuser", "test@example.com", sqlmock.AnyArg()).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    "test@example.com",
		Password: "vE7xKp2mNq9rLw5t",
	}, nil, nil)
	h.Register(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
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

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", hashedPassword, false, nil, nil, time.Now()))

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

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("unknown@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}))

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

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
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

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
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

// ─── SetupTOTP ───────────────────────────────────────────────────────────────

func TestSetupTOTP_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectExec(`(?s).*UPDATE users SET totp_secret.*WHERE id.*`).
		WithArgs(sqlmock.AnyArg(), "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newPOSTContext("/auth/v1/setup-totp", nil, claims, nil)
	h.SetupTOTP(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSetupTOTP_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/setup-totp", nil, nil, nil)
	h.SetupTOTP(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── DisableTOTP ─────────────────────────────────────────────────────────────

func TestDisableTOTP_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectExec(`(?s).*UPDATE users SET totp_secret.*WHERE id.*`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newPOSTContext("/auth/v1/disable-totp", nil, claims, nil)
	h.DisableTOTP(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDisableTOTP_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/disable-totp", nil, nil, nil)
	h.DisableTOTP(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── Get2FAStatus ────────────────────────────────────────────────────────────

func TestGet2FAStatus_Enabled(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	secret := "JBSWY3DPEHPK3PXP"
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_enabled", "totp_secret"}).
			AddRow(true, &secret))

	c, w := newGETContextWithClaims("/auth/v1/2fa-status", nil, claims)
	h.Get2FAStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGet2FAStatus_PendingSecret(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	secret := "JBSWY3DPEHPK3PXP"
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_enabled", "totp_secret"}).
			AddRow(false, &secret))

	c, w := newGETContextWithClaims("/auth/v1/2fa-status", nil, claims)
	h.Get2FAStatus(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGet2FAStatus_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newGETContextWithClaims("/auth/v1/2fa-status", nil, nil)
	h.Get2FAStatus(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestGet2FAStatus_DBError(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newGETContextWithClaims("/auth/v1/2fa-status", nil, claims)
	h.Get2FAStatus(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── Verify2FA ───────────────────────────────────────────────────────────────

func TestVerify2FA_BadRequest(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/verify-2fa", "not json", nil, nil)
	h.Verify2FA(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestVerify2FA_InvalidToken(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/verify-2fa", map[string]string{
		"token": "invalid-token",
		"code":  "123456",
	}, nil, nil)
	h.Verify2FA(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── VerifyAndEnableTOTP ─────────────────────────────────────────────────────

func TestVerifyAndEnableTOTP_Unauthenticated(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/verify-enable-totp", map[string]string{
		"code": "123456",
	}, nil, nil)
	h.VerifyAndEnableTOTP(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestVerifyAndEnableTOTP_BadRequest(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	c, w := newPOSTContext("/auth/v1/verify-enable-totp", "not json", claims, nil)
	h.VerifyAndEnableTOTP(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestVerifyAndEnableTOTP_NoSecret(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_secret"}).AddRow(nil))

	c, w := newPOSTContext("/auth/v1/verify-enable-totp", map[string]string{
		"code": "123456",
	}, claims, nil)
	h.VerifyAndEnableTOTP(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

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

// ─── Register — Password Validation ──────────────────────────────────────────

func TestRegister_WeakPassword_TooShort(t *testing.T) {
	h, mock := setupAuthHandler(t)

	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    "test@example.com",
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

	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    "test@example.com",
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

	c, w := newPOSTContext("/auth/v1/register", models.RegisterRequest{
		Username: "testuser",
		Email:    "test@example.com",
		Password: "abcdefgh",
	}, nil, nil)
	h.Register(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for password without digits, got %d", w.Code)
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
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "test-jti",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(1 * time.Hour)),
		},
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

// ─── Login — wrong password ───────────────────────────────────────────────────

func TestLogin_WrongPassword(t *testing.T) {
	h, mock := setupAuthHandler(t)

	realHashBytes, err := bcrypt.GenerateFromPassword([]byte("vE7xKp2mNq9rLw5t"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("failed to generate bcrypt hash: %v", err)
	}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), false, nil, nil, time.Now()))

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

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, nil, time.Now()))

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

	// Trust this device for 30 days from now
	futureExpiry := time.Now().Add(30 * 24 * time.Hour).Unix()
	trustedDevices := map[string]int64{"my-device-1": futureExpiry}
	trustedJSON, _ := json.Marshal(trustedDevices)
	trustedStr := string(trustedJSON)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, &trustedStr, time.Now()))

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

	// Device was trusted but expired
	expiredExpiry := time.Now().Add(-1 * time.Hour).Unix()
	trustedDevices := map[string]int64{"old-device": expiredExpiry}
	trustedJSON, _ := json.Marshal(trustedDevices)
	trustedStr := string(trustedJSON)

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE email.*`).
		WithArgs("test@example.com").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "email", "domain", "password_hash", "totp_enabled", "totp_secret", "trusted_devices", "created_at"}).
			AddRow("u1", "testuser", "test@example.com", "localhost:8080", string(realHashBytes), true, nil, &trustedStr, time.Now()))

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

// ─── Verify2FA — TOTP not enabled ────────────────────────────────────────────

func TestVerify2FA_No2FAEnabled(t *testing.T) {
	h, mock := setupAuthHandler(t)
	partialToken, err := h.authService.GeneratePartialToken("u1", "testuser", "localhost:8080")
	if err != nil {
		t.Fatalf("failed to generate partial token: %v", err)
	}

	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_secret", "totp_enabled"}).
			AddRow(nil, false))

	c, w := newPOSTContext("/auth/v1/verify-2fa", map[string]string{
		"token": partialToken,
		"code":  "123456",
	}, nil, nil)
	h.Verify2FA(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Verify2FA — with recovery code ──────────────────────────────────────────

func TestVerify2FA_WithRecoveryCode(t *testing.T) {
	h, mock := setupAuthHandler(t)
	partialToken, err := h.authService.GeneratePartialToken("u1", "testuser", "localhost:8080")
	if err != nil {
		t.Fatalf("failed to generate partial token: %v", err)
	}

	recoveryCode := "abcd-ef01-2345-test" // > 10 chars → recovery code path
	codeHashBytes := sha256.Sum256([]byte(recoveryCode))
	codeHash := hex.EncodeToString(codeHashBytes[:])

	secret := "JBSWY3DPEHPK3PXP"
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_secret", "totp_enabled"}).
			AddRow(secret, true))

	// Mock recovery code found
	mock.ExpectQuery(`(?s).*UPDATE user_recovery_codes.*RETURNING id.*`).
		WithArgs("u1", codeHash).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rc-1"))

	c, w := newPOSTContext("/auth/v1/verify-2fa", map[string]string{
		"token": partialToken,
		"code":  recoveryCode,
	}, nil, nil)
	h.Verify2FA(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			Token        string `json:"token"`
			RefreshToken string `json:"refresh_token"`
			ExpiresIn    int64  `json:"expires_in"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if resp.Data.Token == "" {
		t.Fatal("expected non-empty access token")
	}
	if resp.Data.RefreshToken == "" {
		t.Fatal("expected non-empty refresh token")
	}
	if resp.Data.ExpiresIn != 3600 {
		t.Fatalf("expected expires_in=3600, got %d", resp.Data.ExpiresIn)
	}
}

// ─── VerifyAndEnableTOTP — success ───────────────────────────────────────────

func TestVerifyAndEnableTOTP_Success(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	secret := "JBSWY3DPEHPK3PXP"
	// Generate a valid TOTP code for this secret
	code, err := totp.GenerateCode(secret, time.Now())
	if err != nil {
		t.Fatalf("failed to generate TOTP code: %v", err)
	}

	// Mock: get stored secret
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_secret"}).AddRow(secret))

	// Mock: enable 2FA
	mock.ExpectExec(`(?s).*UPDATE users SET totp_enabled.*WHERE id.*`).
		WithArgs("u1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	// Mock: 8 recovery code INSERTs
	for i := 0; i < 8; i++ {
		mock.ExpectExec(`(?s).*INSERT INTO user_recovery_codes.*`).
			WithArgs("u1", sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(0, 1))
	}

	c, w := newPOSTContext("/auth/v1/verify-enable-totp", map[string]string{
		"code": code,
	}, claims, nil)
	h.VerifyAndEnableTOTP(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data struct {
			Enabled       bool     `json:"enabled"`
			RecoveryCodes []string `json:"recovery_codes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse response: %v", err)
	}
	if !resp.Data.Enabled {
		t.Fatal("expected enabled=true")
	}
	if len(resp.Data.RecoveryCodes) != 8 {
		t.Fatalf("expected 8 recovery codes, got %d", len(resp.Data.RecoveryCodes))
	}
}

// ─── VerifyAndEnableTOTP — invalid code ──────────────────────────────────────

func TestVerifyAndEnableTOTP_InvalidCode(t *testing.T) {
	h, mock := setupAuthHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	secret := "JBSWY3DPEHPK3PXP"
	mock.ExpectQuery(`(?s).*SELECT.*FROM users.*WHERE id.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"totp_secret"}).AddRow(secret))

	c, w := newPOSTContext("/auth/v1/verify-enable-totp", map[string]string{
		"code": "000000",
	}, claims, nil)
	h.VerifyAndEnableTOTP(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid code, got %d: %s", w.Code, w.Body.String())
	}
}
