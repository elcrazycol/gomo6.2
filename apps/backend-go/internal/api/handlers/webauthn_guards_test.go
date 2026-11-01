package handlers

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/gomo6/backend/internal/auth"
	"golang.org/x/crypto/bcrypt"
)

// ─── DeleteCredential re-authentication + last-key guard ─────────────────────

func newWebAuthnHandlerWithMock(t *testing.T) (*WebAuthnHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	h := &WebAuthnHandler{db: db, redis: setupTestRedis(t), authService: auth.NewAuthService()}
	return h, mock
}

func newDeleteCredentialContext(t *testing.T, credB64 string, body interface{}, userID string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		reader = bytes.NewReader(raw)
	}
	c.Request = httptest.NewRequest(http.MethodDelete, "/api/v1/auth/webauthn/credentials/"+credB64, reader)
	c.Request.Header.Set("Content-Type", "application/json")
	c.Set("claims", &auth.Claims{UserID: userID, Username: "testuser", Domain: "localhost:8080"})
	c.Params = gin.Params{{Key: "credentialId", Value: credB64}}
	return c, w
}

func TestDeleteCredential_LastPasskeyWithoutPassword_Refused(t *testing.T) {
	h, mock := newWebAuthnHandlerWithMock(t)
	credB64 := base64.RawURLEncoding.EncodeToString([]byte("cred-1"))

	// Passkey-only account: no password hash, 2FA off.
	mock.ExpectQuery(`SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash", "totp_secret", "totp_enabled"}).
			AddRow(nil, nil, false))
	// ... holding a single passkey.
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_webauthn_credentials WHERE user_id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newDeleteCredentialContext(t, credB64, nil, "u1")
	h.DeleteCredential(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for last passkey without password, got %d: %s", w.Code, w.Body.String())
	}
	// ExpectationsWereMet (cleanup) proves no DELETE ran.
}

func TestDeleteCredential_WrongPassword_Rejected(t *testing.T) {
	h, mock := newWebAuthnHandlerWithMock(t)
	credB64 := base64.RawURLEncoding.EncodeToString([]byte("cred-1"))

	legacyHash, err := bcrypt.GenerateFromPassword([]byte("right-password"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("bcrypt: %v", err)
	}
	mock.ExpectQuery(`SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash", "totp_secret", "totp_enabled"}).
			AddRow(string(legacyHash), nil, false))

	c, w := newDeleteCredentialContext(t, credB64, map[string]string{
		"current_password": "wrong-password",
	}, "u1")
	h.DeleteCredential(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for wrong password, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteCredential_PasskeyOnlyTwoKeys_Allowed(t *testing.T) {
	h, mock := newWebAuthnHandlerWithMock(t)
	credB64 := base64.RawURLEncoding.EncodeToString([]byte("cred-1"))

	mock.ExpectQuery(`SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"password_hash", "totp_secret", "totp_enabled"}).
			AddRow(nil, nil, false))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_webauthn_credentials WHERE user_id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectExec(`DELETE FROM user_webauthn_credentials`).
		WithArgs("u1", []byte("cred-1")).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newDeleteCredentialContext(t, credB64, nil, "u1")
	h.DeleteCredential(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestFinishRegistration_PasskeyCap_Refused(t *testing.T) {
	h, mock := newWebAuthnHandlerWithMock(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Seed a registration ceremony in Redis.
	h.storeSession("u1", "register", &webauthn.SessionData{
		Challenge: "test-challenge",
		UserID:    []byte("u1"),
	})

	// Account already holds 10 passkeys → refuse before touching the ceremony.
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_webauthn_credentials WHERE user_id`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(10))

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/webauthn/register/finish", nil)
	c.Set("claims", claims)
	h.FinishRegistration(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 at passkey cap, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── FinishLogin reads the ceremony token from the JSON body ────────────────

func TestFinishLogin_SessionTokenViaBody(t *testing.T) {
	h := newTestHandler(t)
	gin.SetMode(gin.TestMode)

	// Body token, no query param: must get past the "token required" check and
	// fail on the (absent) ceremony — proving the body was read.
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	raw, _ := json.Marshal(map[string]string{"session_token": "abc123"})
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/webauthn/login/finish", bytes.NewReader(raw))
	c.Request.Header.Set("Content-Type", "application/json")
	h.FinishLogin(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if got := w.Body.String(); got == `{"success":false,"error":"session_token is required"}` {
		t.Fatalf("body session_token was not picked up: %s", got)
	}

	// Neither body nor query: the required-token error.
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	c2.Request = httptest.NewRequest(http.MethodPost, "/api/v1/auth/webauthn/login/finish", bytes.NewReader([]byte(`{}`)))
	c2.Request.Header.Set("Content-Type", "application/json")
	h.FinishLogin(c2)

	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w2.Code, w2.Body.String())
	}
}
