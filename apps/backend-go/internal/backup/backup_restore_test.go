package backup

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// ─── Restore fidelity: roles keep is_everyone, overwrites keep allow/deny,
// multi-role grants are remapped and unknown users/roles are skipped ─────────

func TestImportRoles_PreservesEveryoneFlag(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	archive := map[string]interface{}{
		"roles.json": []interface{}{
			map[string]interface{}{"id": "old-ev", "name": "@everyone", "color": "#99aab5", "position": float64(0), "permissions": map[string]interface{}{"view_channel": true}, "is_everyone": true},
			map[string]interface{}{"id": "old-mod", "name": "mods", "color": "#f00", "position": float64(5), "permissions": map[string]interface{}{"kick_members": true}, "is_everyone": false},
		},
	}

	mock.ExpectBegin()
	// @everyone row must carry is_everyone=true into the fresh board.
	mock.ExpectExec(`INSERT INTO gomosub_roles`).
		WithArgs(sqlmock.AnyArg(), "board-1", "@everyone", "#99aab5", 0, sqlmock.AnyArg(), true).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO gomosub_roles`).
		WithArgs(sqlmock.AnyArg(), "board-1", "mods", "#f00", 5, sqlmock.AnyArg(), false).
		WillReturnResult(sqlmock.NewResult(0, 1))

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	mapping, err := importRoles(tx, context.Background(), "board-1", archive)
	if err != nil {
		t.Fatalf("importRoles: %v", err)
	}
	if len(mapping) != 2 {
		t.Fatalf("expected 2 mapped roles, got %v", mapping)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestImportChannelPermissions_PreservesAllowDeny(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	archive := map[string]interface{}{
		"channel_permissions.json": []interface{}{
			map[string]interface{}{
				"channel_id": "old-ch", "role_id": "old-role",
				"can_read": true, "can_write": false,
				"allow": map[string]interface{}{"view_channel": true},
				"deny":  map[string]interface{}{"send_messages": true},
			},
		},
	}
	roleMapping := map[string]string{"old-role": "new-role"}
	channelMapping := map[string]string{"old-ch": "new-ch"}

	mock.ExpectBegin()
	mock.ExpectExec(`INSERT INTO channel_permissions`).
		WithArgs(sqlmock.AnyArg(), "new-ch", "new-role", true, false, `{"view_channel":true}`, `{"send_messages":true}`).
		WillReturnResult(sqlmock.NewResult(0, 1))

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := importChannelPermissions(tx, context.Background(), archive, channelMapping, roleMapping); err != nil {
		t.Fatalf("importChannelPermissions: %v", err)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestImportMemberRoles_RemapsAndSkipsUnknown(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	archive := map[string]interface{}{
		"member_roles.json": []interface{}{
			map[string]interface{}{"user_id": "old-u1", "role_id": "old-r1", "board_id": "old-b"},
			map[string]interface{}{"user_id": "ghost", "role_id": "old-r1", "board_id": "old-b"},
			map[string]interface{}{"user_id": "old-u1", "role_id": "gone", "board_id": "old-b"},
		},
	}
	userMapping := map[string]string{"old-u1": "new-u1"}
	roleMapping := map[string]string{"old-r1": "new-r1"}

	mock.ExpectBegin()
	// Exactly one insert: unknown user and unknown role rows are skipped.
	mock.ExpectExec(`INSERT INTO gomosub_member_roles`).
		WithArgs("board-1", "new-u1", "new-r1").
		WillReturnResult(sqlmock.NewResult(0, 1))

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := importMemberRoles(tx, context.Background(), archive, userMapping, roleMapping, "board-1"); err != nil {
		t.Fatalf("importMemberRoles: %v", err)
	}
	mock.ExpectCommit()
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
