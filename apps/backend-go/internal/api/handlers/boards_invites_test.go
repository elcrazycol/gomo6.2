package handlers

import (
	"database/sql"
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

func TestGetInvites_OwnerSeesList(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	now := time.Now()
	mock.ExpectQuery(`(?s)FROM gomosub_invites.*WHERE board_id.*`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "board_id", "code", "created_by", "max_uses", "current_uses", "expires_at", "created_at", "is_active",
		}).AddRow("inv-1", boardID, "ABC123", "owner-9", 0, 0, nil, now, true))

	c, w := newGETContextWithParams("/api/v1/boards/"+boardID+"/invites", nil, map[string]string{"id": boardID})
	c.Set("claims", &auth.Claims{UserID: "owner-9"})
	handler.GetInvites(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetInvites_StrangerForbidden(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(boardID, "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(boardID, "stranger").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}))

	c, w := newGETContextWithParams("/api/v1/boards/"+boardID+"/invites", nil, map[string]string{"id": boardID})
	c.Set("claims", &auth.Claims{UserID: "stranger"})
	handler.GetInvites(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteInvite_OwnerDeletes(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectExec(`UPDATE gomosub_invites SET is_active = FALSE`).
		WithArgs("inv-1", boardID).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := newDELETEPContextWithClaims("/api/v1/boards/"+boardID+"/invites/inv-1", nil,
		map[string]string{"id": boardID, "inviteId": "inv-1"}, &auth.Claims{UserID: "owner-9"})
	handler.DeleteInvite(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteInvite_NotFound(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("owner-9"))
	mock.ExpectExec(`UPDATE gomosub_invites SET is_active = FALSE`).
		WithArgs("inv-9", boardID).
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := newDELETEPContextWithClaims("/api/v1/boards/"+boardID+"/invites/inv-9", nil,
		map[string]string{"id": boardID, "inviteId": "inv-9"}, &auth.Claims{UserID: "owner-9"})
	handler.DeleteInvite(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func inviteRow(boardID string, now time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "board_id", "code", "created_by", "max_uses", "current_uses", "expires_at", "created_at", "is_active",
	}).AddRow("inv-1", boardID, "ABC123", "owner-9", 0, 0, nil, now, true)
}

func expectInviteLookup(mock sqlmock.Sqlmock, boardID string, now time.Time) {
	mock.ExpectQuery(`(?s)FROM gomosub_invites.*WHERE code = \$1.*`).
		WithArgs("ABC123").
		WillReturnRows(inviteRow(boardID, now))
}

func TestAcceptInvite_BannedDenied(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	expectInviteLookup(mock, boardID, time.Now())
	mock.ExpectQuery(`SELECT user_id FROM gomosub_memberships WHERE board_id = \$1 AND user_id = \$2`).
		WithArgs(boardID, "banned-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_bans WHERE board_id`).
		WithArgs(boardID, "banned-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	c, w := newPOSTContext("/api/v1/invites/ABC123/accept", nil,
		&auth.Claims{UserID: "banned-1"}, map[string]string{"code": "ABC123"})
	handler.AcceptInvite(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for banned joiner, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAcceptInvite_Success(t *testing.T) {
	handler, mock := setupBoardsHandler(t)

	boardID := "550e8400-e29b-41d4-a716-446655440000"
	expectInviteLookup(mock, boardID, time.Now())
	mock.ExpectQuery(`SELECT user_id FROM gomosub_memberships WHERE board_id = \$1 AND user_id = \$2`).
		WithArgs(boardID, "newbie").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM gomosub_bans WHERE board_id`).
		WithArgs(boardID, "newbie").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)UPDATE gomosub_invites.*RETURNING TRUE.*`).
		WithArgs("inv-1").
		WillReturnRows(sqlmock.NewRows([]string{"ok"}).AddRow(true))
	mock.ExpectExec(`INSERT INTO gomosub_memberships \(board_id, user_id\)`).
		WithArgs(boardID, "newbie").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT slug FROM boards WHERE id = \$1`).
		WithArgs(boardID).
		WillReturnRows(sqlmock.NewRows([]string{"slug"}).AddRow("wiz"))

	c, w := newPOSTContext("/api/v1/invites/ABC123/accept", nil,
		&auth.Claims{UserID: "newbie"}, map[string]string{"code": "ABC123"})
	handler.AcceptInvite(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
