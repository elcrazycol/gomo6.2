package drops

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
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
	handler := &DropsHandler{db: db}
	return handler, mock
}

func TestGetDropsBalance_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("user-123").WillReturnRows(sqlmock.NewRows([]string{"gems", "drops"}).AddRow(100, 250))

	c, w := testutil.NewPOSTContext("/api/v1/user/drops", nil, claims, nil)
	c.Request.Method = "GET"
	handler.GetDropsBalance(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"gems":100`) || !strings.Contains(body, `"drops":250`) {
		t.Errorf("expected gems and drops balances in body, got: %s", body)
	}
}

func TestGetDropsBalance_DBError(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("user-123").WillReturnError(sqlmock.ErrCancelled)

	c, w := testutil.NewPOSTContext("/api/v1/user/drops", nil, claims, nil)
	c.Request.Method = "GET"
	handler.GetDropsBalance(c)

	if w.Code != 500 {
		t.Errorf("expected 500, got %d", w.Code)
	}
}

func TestGetDropsHistory_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "amount", "balance_after", "reference_id", "reference_type",
		"description", "blockchain", "tx_hash", "created_at"})
	mock.ExpectQuery("SELECT (.+) FROM drops_transactions").WillReturnRows(rows)

	c, w := testutil.NewGETContextWithClaims("/api/v1/drops/history", nil, claims)
	handler.GetDropsHistory(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d, body: %s", w.Code, w.Body.String())
	}
}

// TestGetDropsHistory_ExcludesEarnedDropsByDefault guards the currency
// split: the wallet is the paid-gems surface, so earned drops (quest rewards,
// daily rewards, streak restores — which never touch the gems balance) must
// not leak into the default history.
func TestGetDropsHistory_ExcludesEarnedDropsByDefault(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "amount", "balance_after", "reference_id", "reference_type",
		"description", "blockchain", "tx_hash", "created_at"})
	mock.ExpectQuery(`FROM drops_transactions\s+WHERE user_id = \$1\s+AND type NOT IN \('quest_reward', 'daily_reward', 'daily_restore'\)`).
		WillReturnRows(rows)

	c, w := testutil.NewGETContextWithClaims("/api/v1/drops/history", nil, claims)
	handler.GetDropsHistory(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

// TestGetDropsHistory_ExplicitTypeFilterKeepsQuestRewards: an explicit
// ?type= filter still reaches quest rows (only the default view excludes).
func TestGetDropsHistory_ExplicitTypeFilterKeepsQuestRewards(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	rows := sqlmock.NewRows([]string{"id", "user_id", "type", "amount", "balance_after", "reference_id", "reference_type",
		"description", "blockchain", "tx_hash", "created_at"})
	mock.ExpectQuery(`FROM drops_transactions\s+WHERE user_id = \$1\s+AND type = ANY`).
		WithArgs("user-123", 20, 0, "quest_reward").
		WillReturnRows(rows)

	c, w := testutil.NewGETContextWithClaims("/api/v1/drops/history", map[string]string{"type": "quest_reward"}, claims)
	handler.GetDropsHistory(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

func TestGetWalletInfo_Success(t *testing.T) {
	handler, mock := setupDropsHandler(t)
	claims := &auth.Claims{UserID: "user-123"}

	mock.ExpectQuery("SELECT wallet_address").WithArgs("user-123").
		WillReturnRows(sqlmock.NewRows([]string{"wallet_address", "gems", "drops"}).AddRow("0xabc", 50, 70))

	c, w := testutil.NewPOSTContext("/api/v1/drops/wallet", nil, claims, nil)
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

	c, w := testutil.NewPOSTContext("/api/v1/drops/transfer", map[string]interface{}{
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

	c, w := testutil.NewPOSTContext("/api/v1/drops/transfer", map[string]interface{}{
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

	c, w := testutil.NewGETContextWithClaims("/api/v1/drops/users/search", nil, claims)
	handler.SearchUsers(c)

	if w.Code != 200 {
		t.Errorf("expected 200, got %d", w.Code)
	}
}
