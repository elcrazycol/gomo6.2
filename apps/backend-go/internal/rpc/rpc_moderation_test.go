package rpc

import (
	"database/sql"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

var errBoomMod = errors.New("boom")

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

// expectKernelGrant mocks one LoadEffective call: the membership check
// followed by the shared 5-column union.
func expectKernelGrant(mock sqlmock.Sqlmock, user, perms string, pos int, member bool, name string) {
	if name == "" {
		name = "role"
	}
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(modBoard, user).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(member))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(modBoard, user).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "permissions", "position", "is_everyone"}).
			AddRow("role-1", name, []byte(perms), pos, false))
}

// expectModGateOK mocks a passing gate: actor (kick-capable, top 5) vs target (top 2).
func expectModGateOK(mock sqlmock.Sqlmock, perm string) {
	expectModOwner(mock, modOwner)
	expectKernelGrant(mock, modActor, `{"`+perm+`": true}`, 5, true, "")
	expectKernelGrant(mock, modTarget, `{}`, 2, true, "")
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
	expectKernelGrant(mock, modActor, `{"kick_members": true}`, 2, true, "")
	expectKernelGrant(mock, modTarget, `{}`, 9, true, "")

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

func TestUnbanMember_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "ban_members")
	mock.ExpectExec(`DELETE FROM gomosub_bans WHERE board_id`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.UnbanMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestUnbanMember_NotBanned(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "ban_members")
	mock.ExpectExec(`DELETE FROM gomosub_bans WHERE board_id`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.UnbanMember(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUntimeoutMember_Success(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "timeout_members")
	mock.ExpectExec(`UPDATE gomosub_memberships SET timed_out_until = NULL`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 1))

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.UntimeoutMember(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestUntimeoutMember_NotMember(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModGateOK(mock, "timeout_members")
	mock.ExpectExec(`UPDATE gomosub_memberships SET timed_out_until = NULL`).
		WithArgs(modBoard, modTarget).
		WillReturnResult(sqlmock.NewResult(0, 0))

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	h.UntimeoutMember(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorizeMod_Guards(t *testing.T) {
	// No claims: 401 without touching the DB.
	h, mock := setupRPCHandler(t)
	c, w := testutil.NewRPCGETContext(nil)
	if h.authorizeMod(c, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial without claims")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}

	// Missing ids: 400.
	h2, _ := setupRPCHandler(t)
	c2, w2 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard}, modClaims())
	if h2.authorizeMod(c2, "", modTarget, "kick_members") {
		t.Fatal("expected denial without board_id")
	}
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w2.Code)
	}

	// Self-target: 400.
	h3, _ := setupRPCHandler(t)
	c3, w3 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modActor}, modClaims())
	if h3.authorizeMod(c3, modBoard, modActor, "kick_members") {
		t.Fatal("expected denial for self-target")
	}
	if w3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w3.Code)
	}

	// Unknown board: 404.
	h4, mock4 := setupRPCHandler(t)
	mock4.ExpectQuery(`SELECT owner_id FROM boards WHERE id = \$1`).
		WithArgs(modBoard).
		WillReturnError(sql.ErrNoRows)
	c4, w4 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	if h4.authorizeMod(c4, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial for unknown board")
	}
	if w4.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w4.Code)
	}

	// Owner target: 403.
	h5, mock5 := setupRPCHandler(t)
	expectModOwner(mock5, modTarget)
	c5, w5 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	if h5.authorizeMod(c5, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial for owner target")
	}
	if w5.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w5.Code)
	}

	// Actor is owner: allowed with no further queries.
	h6, mock6 := setupRPCHandler(t)
	expectModOwner(mock6, modActor)
	c6, _ := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget},
		&auth.Claims{UserID: modActor, Username: "owner"})
	if !h6.authorizeMod(c6, modBoard, modTarget, "kick_members") {
		t.Fatal("expected owner bypass")
	}

	// Non-member actor: 403.
	h7, mock7 := setupRPCHandler(t)
	expectModOwner(mock7, modOwner)
	expectKernelGrant(mock7, modActor, `{}`, 0, false, "")
	c7, w7 := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	if h7.authorizeMod(c7, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial for non-member")
	}
	if w7.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w7.Code)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAuthorizeMod_MemberWithoutPermDenied(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModOwner(mock, modOwner)
	// Actor is a member but holds no kick grant: denied before the target
	// profile is even loaded.
	expectKernelGrant(mock, modActor, `{"send_messages": true}`, 5, true, "")

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	if h.authorizeMod(c, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial without the needed permission")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestAuthorizeMod_UnionErrorSurfaces(t *testing.T) {
	h, mock := setupRPCHandler(t)
	expectModOwner(mock, modOwner)
	mock.ExpectQuery(`EXISTS\(SELECT 1 FROM gomosub_memberships WHERE board_id`).
		WithArgs(modBoard, modActor).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`(?s)FROM gomosub_roles gr.*`).
		WithArgs(modBoard, modActor).
		WillReturnError(errBoomMod)

	c, w := testutil.NewRPCPostContext(map[string]string{"board_id": modBoard, "user_id": modTarget}, modClaims())
	if h.authorizeMod(c, modBoard, modTarget, "kick_members") {
		t.Fatal("expected denial on kernel error")
	}
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
