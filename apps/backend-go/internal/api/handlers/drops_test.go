package handlers

import (
	"bytes"
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

func TestDropsConfig_MissingUserID(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidAmount_Zero(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 0,
		"user_id":      "user-123",
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidAmount_TooHigh(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 200000,
		"user_id":      "user-123",
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsConfig_InvalidUser(t *testing.T) {
	handler, mock := setupDropsHandler(t)

	mock.ExpectQuery("SELECT EXISTS").WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := newPOSTContext("/api/v1/drops/config", map[string]interface{}{
		"drops_amount": 100,
		"user_id":      "nonexistent",
	}, nil, nil)
	handler.DropsConfig(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_InvalidBody(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	c, w := newPOSTContext("/api/v1/drops/callback", "not json", nil, nil)
	c.Request.Header.Set("Content-Type", "application/json")
	handler.DropsCallback(c)

	if w.Code != 400 {
		t.Errorf("expected 400, got %d, body: %s", w.Code, w.Body.String())
	}
}

func TestDropsCallback_MissingPayloadUserID(t *testing.T) {
	handler, _ := setupDropsHandler(t)

	body := `{"blockchain":"ethereum","transaction":"0xabc","payload":{}}`
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/drops/callback", bytes.NewBufferString(body))
	c.Request.Header.Set("Content-Type", "application/json")

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

func TestManualVerify_MissingFields(t *testing.T) {
	handler, _ := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

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
