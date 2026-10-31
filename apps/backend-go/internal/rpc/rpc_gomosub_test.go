package rpc

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func TestCreateGomoSub_SeedsEveryoneAndDefaultChannel(t *testing.T) {
	h, mock := setupRPCHandler(t)

	now := time.Now()
	mock.ExpectQuery(`SELECT id FROM boards WHERE slug = \$1`).
		WithArgs("testsub").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(`(?s)INSERT INTO boards.*RETURNING.*`).
		WithArgs("testsub", "Test", "Desc", "u1", "public", nil, nil, "[]", nil).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "is_gomosub", "is_rules_board", "owner_id", "visibility",
			"gomosub_avatar_url", "cover_image_url", "gomosub_tags", "rules_markdown", "rules_updated_at", "created_at",
		}).AddRow(
			"board-1", "testsub", "Test", "Desc", true, false, "u1", "public",
			nil, nil, `[]`, nil, nil, now,
		))
	mock.ExpectExec(`INSERT INTO gomosub_memberships`).
		WithArgs("board-1", "u1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The default #general forum channel (migration 148 contract for new boards).
	mock.ExpectExec(`INSERT INTO channels`).
		WithArgs("board-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO gomosub_roles`).
		WithArgs("board-1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewRPCPostContext(map[string]interface{}{
		"slug": "testsub", "name": "Test", "description": "Desc",
	}, &auth.Claims{UserID: "u1", Username: "tester"})
	h.CreateGomoSub(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data.ID != "board-1" {
		t.Fatalf("expected board-1, got %q", resp.Data.ID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled (default channel insert missing?): %v", err)
	}
}
