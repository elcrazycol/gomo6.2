package handlers

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── Invite management permission gate ──────────────────────────────
// Invites used to be owner-only; managers holding can_manage_members (or
// administrators) may now manage them too, via the shared kernel.

func TestCreateInvite_ManagerAllowed(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT COALESCE\(visibility, 'public'\) FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"visibility"}).AddRow("private"))
	// canManageInvites: another owner, but the caller is a member with
	// can_manage_members through the shared union.
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, "u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("r-1", "mods", []byte(`{"can_manage_members": true}`), 5, false))
	mock.ExpectQuery(`(?s)INSERT INTO gomosub_invites.*RETURNING.*`).
		WithArgs(boardID, sqlmock.AnyArg(), "u2", 0, nil).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "board_id", "code", "created_by", "max_uses", "current_uses", "expires_at", "created_at", "is_active",
		}).AddRow("inv-1", boardID, "ABC123", "u2", 0, 0, nil, time.Now(), true))

	c, w := newPOSTContext("/api/v1/boards/"+boardID+"/invites",
		map[string]interface{}{"max_uses": 0},
		&auth.Claims{UserID: "u2"},
		map[string]string{"id": boardID})
	handler.CreateInvite(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var resp models.APIResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil || !resp.Success {
		t.Fatalf("expected success, got %+v err=%v", resp, err)
	}
}

func TestCreateInvite_StrangerDenied(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT COALESCE\(visibility, 'public'\) FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"visibility"}).AddRow("private"))
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}))

	c, w := newPOSTContext("/api/v1/boards/"+boardID+"/invites",
		map[string]interface{}{"max_uses": 0},
		&auth.Claims{UserID: "stranger"},
		map[string]string{"id": boardID})
	handler.CreateInvite(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}
