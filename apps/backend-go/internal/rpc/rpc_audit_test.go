package rpc

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func auditInsertMock(mock sqlmock.Sqlmock, board, actor, action, target string) {
	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs(board, actor, action, target, nil, nil, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func TestKickMember_WritesAuditLog(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "kick_members")
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM gomosub_member_roles`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM gomosub_memberships`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	auditInsertMock(mock, modBoard, modActor, "kick", modTarget)

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.KickMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled (audit insert missing?): %v", err)
	}
}

func TestBanMember_DeleteMessageDays1(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "ban_members")
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO gomosub_bans`).
		WithArgs(modBoard, modTarget, nil, modActor, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM gomosub_member_roles`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM gomosub_memberships`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE channel_messages SET deleted_at`).
		WithArgs(modBoard, modTarget, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()
	auditInsertMock(mock, modBoard, modActor, "ban", modTarget)

	days := 1
	c, w := testutil.NewRPCPostContext(map[string]interface{}{
		"board_id": modBoard, "user_id": modTarget, "delete_message_days": days,
	}, modClaims())
	h.BanMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unfulfilled: %v", err)
	}
}

func TestListAuditLog_OwnerSeesEntries(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModOwner(mock, modOwner)
	now := time.Now()
	mock.ExpectQuery(`(?s)FROM gomosub_audit_log a.*`).
		WithArgs(modBoard, 100).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "actor_id", "actor_username", "action", "target_user_id",
			"target_username", "target_role_id", "target_channel_id", "reason", "created_at",
		}).AddRow("a1", modActor, "mod", "kick", modTarget, "spammer", nil, nil, "spam", now))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	c.Set("claims", &auth.Claims{UserID: modOwner})
	h.ListAuditLog(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListAuditLog_StrangerDenied(t *testing.T) {
	h, mock := setupRPCHandler(t)
	stranger := "660e8400-e29b-41d4-a716-446655442222"
	expectModOwner(mock, modOwner)
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(modBoard, stranger).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(modBoard, stranger).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	c.Set("claims", &auth.Claims{UserID: stranger})
	h.ListAuditLog(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}
