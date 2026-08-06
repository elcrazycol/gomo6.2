package handlers

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func setupDropsHandler(t *testing.T) (*DropsHandler, sqlmock.Sqlmock) {
	t.Helper()
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
	// Don't call NewDropsHandler (it tries to load env keys).
	// Construct directly with nil keys for testing.
	handler := &DropsHandler{db: db}
	return handler, mock
}

// setupDropsHandlerSigned returns a handler with a DePay public key loaded so
// the fail-closed signature gate (C1) can be exercised, plus a signer for the
// matching private key.
func setupDropsHandlerSigned(t *testing.T) (*DropsHandler, sqlmock.Sqlmock, func([]byte) string) {
	t.Helper()
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
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("failed to generate RSA key: %v", err)
	}
	handler := &DropsHandler{db: db, publicKey: &priv.PublicKey}
	sign := func(body []byte) string {
		hash := sha256.Sum256(body)
		sig, err := rsa.SignPSS(rand.Reader, priv, crypto.SHA256, hash[:], &rsa.PSSOptions{SaltLength: 64, Hash: crypto.SHA256})
		if err != nil {
			t.Fatalf("failed to sign: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(sig)
	}
	return handler, mock, sign
}

func TestGetDropsBalance_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("user-123").WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(100))

	c, w := newPOSTContext("/api/v1/user/drops", nil, claims, nil)
	c.Request.Method = "GET"
	handler.GetDropsBalance(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetDropsBalance_DBError(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("user-123").WillReturnError(sqlmock.ErrCancelled)

	c, w := newPOSTContext("/api/v1/user/drops", nil, claims, nil)
	c.Request.Method = "GET"
	handler.GetDropsBalance(c)

	if w.Code != 500 {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestGetDropsPackages_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)

	rows := sqlmock.NewRows([]string{"id", "name", "drops_amount", "price_usd", "is_active", "sort_order"})
	mock.ExpectQuery("SELECT (.+) FROM drops_packages").WillReturnRows(rows)

	c, w := newGETContext("/api/v1/drops/packages", nil)
	handler.GetDropsPackages(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidBody(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/config", "invalid json", nil, nil)
	c.Request.Header.Set("Content-Type", "application/json")
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_RequiresAuth(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "user-123",
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 without auth, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_MissingUserID(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidAmount_Zero(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 0,
		"user_id":      "user-123",
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidAmount_TooHigh(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 200000,
		"user_id":      "user-123",
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidUser(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "nonexistent"}

	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "nonexistent",
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_RejectsForeignUserID(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	// C2 (security audit): an unsigned pending payment must be bound to the
	// authenticated session — an attacker cannot create a payment intent for
	// another user.
	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "victim-456",
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for foreign user_id, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_AuthenticatedOwnUser_Allowed(t *testing.T) {
	t.Setenv("DEPAY_RECEIVER_ETH", "0xReceiver")
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	// C2 positive path (browser flow): an authenticated user creates a pending
	// payment for themselves — this is the legitimate DePay widget flow.
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("INSERT INTO drops_pending").
		WithArgs("user-123", 100, 2.0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("pending-1"))

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "user-123",
	}, claims, nil)
	handler.DropsConfig(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for authenticated own user, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_UnsignedWithoutAuth_Rejected(t *testing.T) {
	handler, _, _ := setupDropsHandlerSigned(t)

	// C2: an unsigned config request without a browser session must be rejected
	// (no anonymous pending minting for arbitrary users).
	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "user-123",
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unsigned anonymous config, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_SignedForeignUser_Allowed(t *testing.T) {
	t.Setenv("DEPAY_RECEIVER_ETH", "0xReceiver")
	handler, mock, sign := setupDropsHandlerSigned(t)

	// C2: a properly signed config request (server-to-server from the DePay
	// platform) is trusted — the payload user_id may differ from any browser
	// session because the DePay platform holds the signing key.
	body := `{"drops_amount":100,"user_id":"victim-456"}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/config", body, sign)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs("victim-456").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery("INSERT INTO drops_pending").
		WithArgs("victim-456", 100, 2.0).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("pending-1"))

	handler.DropsConfig(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for signed config, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_BadSignature_RejectedWithoutAuth(t *testing.T) {
	handler, _, _ := setupDropsHandlerSigned(t)

	// C2: a bad signature is NOT a valid auth channel — without a session it
	// must be rejected (fail-closed), not silently accepted.
	c, w := signPOSTWithHeader(t, "/api/v1/drops/config", `{"drops_amount":100,"user_id":"user-123"}`, func([]byte) string {
		return "bm90LWEtcmVhbC1zaWduYXR1cmU"
	})
	handler.DropsConfig(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for bad signature without auth, got %d, body: %s", w.Code, w.Body.String())
	}
}

// signPOSTWithHeader builds a signed POST request to the given URL with body.
func signPOSTWithHeader(t *testing.T, url, body string, sign func([]byte) string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, url, bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Request.Header.Set("x-signature", sign([]byte(body)))
	return c, w
}

func TestDropsCallback_RejectsMissingSignature(t *testing.T) {
	handler, _, _ := setupDropsHandlerSigned(t)

	// C1: fail closed — a callback without x-signature is rejected outright.
	body := `{"blockchain":"ethereum","transaction":"0xabc","payload":{"user_id":"user-123","drops_amount":100}}`
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/drops/callback", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

	handler.DropsCallback(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing signature, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_RejectsBadSignature(t *testing.T) {
	handler, _, _ := setupDropsHandlerSigned(t)

	body := `{"blockchain":"ethereum","transaction":"0xabc","payload":{"user_id":"user-123","drops_amount":100}}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, func([]byte) string {
		return "bm90LWEtcmVhbC1zaWduYXR1cmU"
	})

	handler.DropsCallback(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for bad signature, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_RejectsWhenKeyMissing(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	// C1: no DEPAY_PUBLIC_KEY configured → the webhook must be rejected, not
	// processed without verification.
	body := `{"blockchain":"ethereum","transaction":"0xabc","payload":{"user_id":"user-123","drops_amount":100}}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, func([]byte) string {
		return "dummy"
	})

	handler.DropsCallback(c)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when key missing, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_ValidSignature_CreditsDrops(t *testing.T) {
	handler, mock, sign := setupDropsHandlerSigned(t)

	// C1: a properly signed callback still works end-to-end (fail-closed must
	// not break the legitimate flow).
	body := `{"blockchain":"ethereum","transaction":"0xvalid","payload":{"user_id":"user-123","drops_amount":100}}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, sign)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM drops_transactions WHERE tx_hash = \$1\)`).
		WithArgs("0xvalid").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectBegin()
	mock.ExpectExec("UPDATE users SET drops").WithArgs(100, "user-123").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(`SELECT COALESCE\(drops, 0\) FROM users WHERE id = \$1`).
		WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(150))
	mock.ExpectExec("INSERT INTO drops_transactions").WithArgs(
		"user-123", 100, 150, "Purchased 100 drops", "ethereum", "0xvalid",
	).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE drops_pending").WithArgs("ethereum", "0xvalid", "user-123", 100).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	handler.DropsCallback(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for valid signed callback, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_ValidSignature_RejectsDuplicateTx(t *testing.T) {
	handler, mock, sign := setupDropsHandlerSigned(t)

	// C1: duplicate tx_hash (already processed) short-circuits after signature
	// verification — no double crediting.
	body := `{"blockchain":"ethereum","transaction":"0xdup","payload":{"user_id":"user-123","drops_amount":100}}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, sign)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM drops_transactions WHERE tx_hash = \$1\)`).
		WithArgs("0xdup").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	handler.DropsCallback(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for duplicate, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_InvalidBody(t *testing.T) {
	handler, _, sign := setupDropsHandlerSigned(t)

	// Signed request with an unparseable body → 400 after signature passes.
	body := "not json"
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, sign)
	handler.DropsCallback(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_MissingPayloadUserID(t *testing.T) {
	handler, _, sign := setupDropsHandlerSigned(t)

	body := `{"blockchain":"ethereum","transaction":"0xabc","payload":{}}`
	c, w := signPOSTWithHeader(t, "/api/v1/drops/callback", body, sign)
	handler.DropsCallback(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetDropsHistory_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "amount", "balance_after", "reference_id", "reference_type",
		"description", "blockchain", "tx_hash", "created_at"})
	mock.ExpectQuery("SELECT (.+) FROM drops_transactions").WillReturnRows(rows)

	c, w := newGETContextWithClaims("/api/v1/drops/history", nil, claims)
	handler.GetDropsHistory(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestManualVerify_RequiresAdmin(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	// C2: manual crediting is an admin action — a regular user gets 403.
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles WHERE user_id = \$1 AND role = 'admin'`).
		WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))

	c, w := newPOSTContext("/api/v1/drops/manual-verify", nil, claims, nil)
	handler.ManualVerify(c)

	if w.Code != http.StatusForbidden {
		t.Errorf("expected 403 for non-admin, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestManualVerify_MissingFields(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM user_roles WHERE user_id = \$1 AND role = 'admin'`).
		WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))

	c, w := newPOSTContext("/api/v1/drops/manual-verify", nil, claims, nil)
	handler.ManualVerify(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestGetWalletInfo_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT wallet_address").WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"wallet_address", "drops"}).AddRow("0xabc", 50))

	c, w := newPOSTContext("/api/v1/drops/wallet", nil, claims, nil)
	c.Request.Method = "GET"
	handler.GetWalletInfo(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestTransferDrops_SelfTransfer(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT id, username FROM users").WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username"}).AddRow("user-123", "user-123"))

	c, w := newPOSTContext("/api/v1/drops/transfer", map[string]interface{}{
		"recipient_username": "user-123",
		"amount":             10,
	}, claims, nil)
	handler.TransferDrops(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestTransferDrops_MissingRecipient(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newPOSTContext("/api/v1/drops/transfer", map[string]interface{}{
		"amount": 10,
	}, claims, nil)
	handler.TransferDrops(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestSearchUsers_EmptyQuery(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	c, w := newGETContextWithClaims("/api/v1/drops/users/search", nil, claims)
	handler.SearchUsers(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
