package rpc

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── GetBoardUserPermissions (roles v2: owner bypass + multi-role union) ────

func TestGetBoardUserPermissions_Owner(t *testing.T) {
	h, mock := setupRPCHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	owner := "770e8400-e29b-41d4-a716-446655443333"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(owner))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: owner})
	h.GetBoardUserPermissions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			IsOwner     bool            `json:"is_owner"`
			Permissions map[string]bool `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if !resp.Data.IsOwner || !resp.Data.Permissions["administrator"] || !resp.Data.Permissions["ban_members"] {
		t.Fatalf("owner must get full grant, got %+v", resp.Data.Permissions)
	}
}

func TestGetBoardUserPermissions_MultiRoleUnion(t *testing.T) {
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
	// Two roles: one grants manage_channels, the other manage_members.
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, viewer).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("role-1", "mods", []byte(`{"can_manage_channels": true}`), 5, false).
			AddRow("role-2", "helpers", []byte(`{"can_manage_members": true}`), 3, false))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": boardID})
	c.Set("claims", &auth.Claims{UserID: viewer})
	h.GetBoardUserPermissions(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Data struct {
			IsOwner     bool            `json:"is_owner"`
			Permissions map[string]bool `json:"permissions"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data.IsOwner {
		t.Fatal("viewer is not the owner")
	}
	if !resp.Data.Permissions["can_manage_channels"] || !resp.Data.Permissions["can_manage_members"] {
		t.Fatalf("union must contain both grants, got %+v", resp.Data.Permissions)
	}
	if resp.Data.Permissions["administrator"] {
		t.Fatal("administrator must not leak to regular members")
	}
}
