package rpc

import (
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
