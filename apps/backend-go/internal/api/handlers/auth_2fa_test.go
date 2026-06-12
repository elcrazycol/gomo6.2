package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/pquerna/otp/totp"
)

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
