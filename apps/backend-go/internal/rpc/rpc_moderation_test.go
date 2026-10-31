package rpc

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const (
	modBoard  = "550e8400-e29b-41d4-a716-446655440000"
	modActor  = "770e8400-e29b-41d4-a716-446655443333"
	modTarget = "660e8400-e29b-41d4-a716-446655442222"
	modOwner  = "880e8400-e29b-41d4-a716-446655440000"
)

func modClaims() *auth.Claims { return &auth.Claims{UserID: modActor, Username: "mod"} }

func expectModOwner(mock sqlmock.Sqlmock, owner string) {
	mock.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(modBoard).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(owner))
}

func expectModMember(mock sqlmock.Sqlmock, user string, member bool) {
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(modBoard, user).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(member))
}

func expectModRoles(mock sqlmock.Sqlmock, user, perms string, pos int) {
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(modBoard, user).
		WillReturnRows(sqlmock.NewRows([]string{"permissions", "position", "is_everyone"}).
			AddRow([]byte(perms), pos, false))
}

// expectModGateOK mocks a passing gate: actor (kick-capable, top 5) vs target (top 2).
func expectModGateOK(mock sqlmock.Sqlmock, perm string) {
	expectModOwner(mock, modOwner)
	expectModMember(mock, modActor, true)
	expectModRoles(mock, modActor, `{"`+perm+`": true}`, 5)
	expectModMember(mock, modTarget, true)
	expectModRoles(mock, modTarget, `{}`, 2)
}

func TestKickMember_Success(t *testing.T) {
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

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.KickMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestKickMember_NotMember(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "kick_members")
	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM gomosub_member_roles`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`DELETE FROM gomosub_memberships`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.KickMember(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestKickMember_HierarchyDenial(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModOwner(mock, modOwner)
	expectModMember(mock, modActor, true)
	expectModRoles(mock, modActor, `{"kick_members": true}`, 2)
	expectModMember(mock, modTarget, true)
	expectModRoles(mock, modTarget, `{}`, 9)

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.KickMember(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestKickMember_SelfAndOwnerDenied(t *testing.T) {
	h, _ := setupRPCHandler(t)
	// Self-target: rejected before any DB touch.
	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modActor}, modClaims())
	h.KickMember(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for self-kick, got %d", w.Code)
	}

	h2, mock2 := setupRPCHandler(t)
	expectModOwner(mock2, modOwner)
	c2, w2 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modOwner}, modClaims())
	h2.KickMember(c2)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for owner target, got %d", w2.Code)
	}
}

func TestBanMember_SuccessWithMessagePurge(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "ban_members")
	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO gomosub_bans`).
		WithArgs(modBoard, modTarget, "spam", modActor, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM gomosub_member_roles`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM gomosub_memberships`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE channel_messages SET deleted_at`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 3))
	mock.ExpectCommit()

	c, w := testutil.NewRPCPostContext(map[string]interface{}{
		"board_id": modBoard, "user_id": modTarget, "reason": "spam", "delete_messages": true,
	}, modClaims())
	h.BanMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestTimeoutMember_SuccessAndCap(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "timeout_members")
	mock.ExpectExec(`UPDATE gomosub_memberships SET timed_out_until`).
		WithArgs(modBoard, modTarget, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	dur := 60
	c, w := testutil.NewRPCPostContext(map[string]interface{}{
		"board_id": modBoard, "user_id": modTarget, "duration_minutes": dur,
	}, modClaims())
	h.TimeoutMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Over the 28-day cap: rejected without touching the DB.
	tooLong := maxTimeoutMinutes + 1
	h2, mock2 := setupRPCHandler(t)
	expectModGateOK(mock2, "timeout_members")
	c2, w2 := testutil.NewRPCPostContext(map[string]interface{}{
		"board_id": modBoard, "user_id": modTarget, "duration_minutes": tooLong,
	}, modClaims())
	h2.TimeoutMember(c2)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for over-cap timeout, got %d: %s", w2.Code, w2.Body.String())
	}
}

func TestListBans_OwnerSeesBans(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModOwner(mock, modOwner)
	now := time.Now()
	mock.ExpectQuery(`(?s)FROM gomosub_bans b.*`).
		WithArgs(modBoard).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "username", "reason", "created_by", "expires_at", "created_at"}).
			AddRow(modTarget, "spammer", "spam", modActor, nil, now))

	c, w := testutil.NewRPCGETContext(map[string]string{"_board_id": modBoard})
	c.Set("claims", &auth.Claims{UserID: modOwner})
	h.ListBans(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
