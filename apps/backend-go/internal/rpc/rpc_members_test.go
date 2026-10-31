package rpc

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func TestListGomoSubMembers_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	owner := "880e8400-e29b-41d4-a716-446655440000"
	viewer := "770e8400-e29b-41d4-a716-446655443333"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(owner))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_memberships m LEFT JOIN users u.*`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "username", "avatar_url", "role_id", "timed_out", "timed_out_until"}).
			AddRow(owner, "owner", nil, nil, false, nil).
			AddRow(viewer, "member", "pic.png", nil, false, nil))
	mock.ExpectQuery(`(?s)FROM gomosub_roles WHERE board_id = \$1.*`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "color", "position", "is_everyone"}).
			AddRow("r-mod", "Мод", "#f00", 5, false).
			AddRow("r-ev", "@everyone", "#999", 0, true))
	mock.ExpectQuery(`(?s)FROM gomosub_member_roles WHERE board_id = \$1.*`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "role_id"}).
			AddRow(viewer, "r-mod"))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: viewer})
	h.ListGomoSubMembers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data GomoSubMembersResponse `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data.Members) != 2 || len(resp.Data.Roles) != 2 {
		t.Fatalf("expected 2 members + 2 roles, got %+v", resp.Data)
	}
	if !resp.Data.Members[0].IsOwner {
		t.Fatal("owner flag must be set on the owner row")
	}
	if len(resp.Data.Members[1].RoleIDs) != 1 || resp.Data.Members[1].RoleIDs[0] != "r-mod" {
		t.Fatalf("member grants must merge, got %+v", resp.Data.Members[1].RoleIDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

func TestListGomoSubMembers_StrangerDenied(t *testing.T) {
	h, mock := setupRPCHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	owner := "880e8400-e29b-41d4-a716-446655440000"
	stranger := "660e8400-e29b-41d4-a716-446655442222"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(owner))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, stranger).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: stranger})
	h.ListGomoSubMembers(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListGomoSubMembers_Guards(t *testing.T) {
	// No claims: 401.
	h, _ := setupRPCHandler(t)
	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	h.ListGomoSubMembers(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	// Missing _board_id: 400.
	h2, _ := setupRPCHandler(t)
	c2, w2 := testutil.NewRPCGETContext(nil)
	c2.Set("claims", &auth.Claims{UserID: modActor})
	h2.ListGomoSubMembers(c2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w2.Code)
	}
}

func TestListGomoSubMembers_NotFoundAndStranger(t *testing.T) {
	// Unknown board: 404.
	h, mock := setupRPCHandler(t)
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(modBoard).
		WillReturnError(sql.ErrNoRows)
	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	c.Set("claims", &auth.Claims{UserID: modActor})
	h.ListGomoSubMembers(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	// Non-member, non-owner: 403.
	h2, mock2 := setupRPCHandler(t)
	mock2.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(modBoard).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(modOwner))
	mock2.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(modBoard, modActor).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	c2, w2 := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	c2.Set("claims", &auth.Claims{UserID: modActor})
	h2.ListGomoSubMembers(c2)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w2.Code, w2.Body.String())
	}
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
