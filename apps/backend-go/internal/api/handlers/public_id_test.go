package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// Public numbers are handed out by exactly one writer: the admin endpoint in
// public_id.go. public_id is absent from every writable-column allow-list and
// from the typed update structs, so these tests also pin the swap semantics —
// a number that changes hands must release its previous owner in the same
// transaction (the UNIQUE index would otherwise fire).

const (
	pidTarget = "11111111-1111-1111-1111-111111111111"
	pidHolder = "22222222-2222-2222-2222-222222222222"
	pidAdmin  = "33333333-3333-3333-3333-333333333333"
)

func setupPublicIDHandler(t *testing.T) (*PublicIDHandler, sqlmock.Sqlmock) {
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
	// redis and hub stay nil: cache invalidation is best-effort and guarded.
	return NewPublicIDHandler(db, nil, nil), mock
}

func assignBody(userID string, publicID int64) map[string]interface{} {
	return map[string]interface{}{"user_id": userID, "public_id": publicID}
}

// TestAssignPublicID_FreeNumber hands out an unallocated number (the reserved
// 1..9 band): nobody is re-numbered and the ledger records a NULL origin.
func TestAssignPublicID_FreeNumber(t *testing.T) {
	h, mock := setupPublicIDHandler(t)
	c, w := newPOSTContext("/api/v1/admin/public-id/assign", assignBody(pidTarget, 5), &auth.Claims{UserID: pidAdmin}, nil)

	mock.ExpectBegin()
	// Nobody holds 5.
	mock.ExpectQuery(`SELECT id FROM users WHERE public_id = \$1 FOR UPDATE`).
		WithArgs(int64(5)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	// The target currently holds 42.
	mock.ExpectQuery(`SELECT public_id FROM users WHERE id = \$1 FOR UPDATE`).
		WithArgs(pidTarget).
		WillReturnRows(sqlmock.NewRows([]string{"public_id"}).AddRow(int64(42)))
	mock.ExpectExec(`UPDATE users SET public_id = \$1, updated_at = NOW\(\) WHERE id = \$2`).
		WithArgs(int64(5), pidTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO public_id_transfers`).
		WithArgs(int64(5), nil, pidTarget, pidAdmin, "").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	h.AssignPublicID(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

// TestAssignPublicID_Swap re-numbers the previous holder in the same
// transaction: they receive the target's old number, and both movements are
// written to the ledger.
func TestAssignPublicID_Swap(t *testing.T) {
	h, mock := setupPublicIDHandler(t)
	c, w := newPOSTContext("/api/v1/admin/public-id/assign",
		map[string]interface{}{"user_id": pidTarget, "public_id": 1337, "note": "sold"},
		&auth.Claims{UserID: pidAdmin}, nil)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM users WHERE public_id = \$1 FOR UPDATE`).
		WithArgs(int64(1337)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(pidHolder))
	mock.ExpectQuery(`SELECT public_id FROM users WHERE id = \$1 FOR UPDATE`).
		WithArgs(pidTarget).
		WillReturnRows(sqlmock.NewRows([]string{"public_id"}).AddRow(int64(42)))
	// The target is parked on the sentinel so both numbers are free, then the
	// holder takes 42 (the target's old number) before the requested assign.
	mock.ExpectExec(`UPDATE users SET public_id = -1 WHERE id = \$1`).
		WithArgs(pidTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE users SET public_id = \$1, updated_at = NOW\(\) WHERE id = \$2`).
		WithArgs(int64(42), pidHolder).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO public_id_transfers`).
		WithArgs(int64(42), pidTarget, pidHolder, pidAdmin, "released by transfer").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(`UPDATE users SET public_id = \$1, updated_at = NOW\(\) WHERE id = \$2`).
		WithArgs(int64(1337), pidTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO public_id_transfers`).
		WithArgs(int64(1337), pidHolder, pidTarget, pidAdmin, "sold").
		WillReturnResult(sqlmock.NewResult(2, 1))
	mock.ExpectCommit()

	h.AssignPublicID(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			UserID                   string `json:"user_id"`
			PublicID                 int64  `json:"public_id"`
			PreviousOwnerID          string `json:"previous_owner_id"`
			PreviousOwnerNewPublicID *int64 `json:"previous_owner_new_public_id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if resp.Data.PublicID != 1337 || resp.Data.PreviousOwnerID != pidHolder {
		t.Fatalf("unexpected result: %+v", resp.Data)
	}
	if resp.Data.PreviousOwnerNewPublicID == nil || *resp.Data.PreviousOwnerNewPublicID != 42 {
		t.Fatalf("the previous owner must receive the target's old number, got %v", resp.Data.PreviousOwnerNewPublicID)
	}
}

// TestAssignPublicID_AlreadyHolds is idempotent: no update, no ledger row.
func TestAssignPublicID_AlreadyHolds(t *testing.T) {
	h, mock := setupPublicIDHandler(t)
	c, w := newPOSTContext("/api/v1/admin/public-id/assign", assignBody(pidTarget, 42), &auth.Claims{UserID: pidAdmin}, nil)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM users WHERE public_id = \$1 FOR UPDATE`).
		WithArgs(int64(42)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(pidTarget))
	mock.ExpectQuery(`SELECT public_id FROM users WHERE id = \$1 FOR UPDATE`).
		WithArgs(pidTarget).
		WillReturnRows(sqlmock.NewRows([]string{"public_id"}).AddRow(int64(42)))
	mock.ExpectCommit()

	h.AssignPublicID(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if body := w.Body.String(); !strings.Contains(body, `"unchanged":true`) {
		t.Fatalf("expected an unchanged result, got %s", body)
	}
}

func TestAssignPublicID_Validation(t *testing.T) {
	tests := []struct {
		name string
		body map[string]interface{}
		want int
	}{
		{"bad user id", assignBody("not-a-uuid", 5), http.StatusBadRequest},
		{"zero number", assignBody(pidTarget, 0), http.StatusBadRequest},
		{"negative number", assignBody(pidTarget, -1), http.StatusBadRequest},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h, _ := setupPublicIDHandler(t)
			c, w := newPOSTContext("/api/v1/admin/public-id/assign", tc.body, &auth.Claims{UserID: pidAdmin}, nil)
			h.AssignPublicID(c)
			if w.Code != tc.want {
				t.Fatalf("expected %d, got %d: %s", tc.want, w.Code, w.Body.String())
			}
		})
	}
}

func TestAssignPublicID_UserNotFound(t *testing.T) {
	h, mock := setupPublicIDHandler(t)
	c, w := newPOSTContext("/api/v1/admin/public-id/assign", assignBody(pidTarget, 5), &auth.Claims{UserID: pidAdmin}, nil)

	mock.ExpectBegin()
	mock.ExpectQuery(`SELECT id FROM users WHERE public_id = \$1 FOR UPDATE`).
		WithArgs(int64(5)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`SELECT public_id FROM users WHERE id = \$1 FOR UPDATE`).
		WithArgs(pidTarget).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	h.AssignPublicID(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}
