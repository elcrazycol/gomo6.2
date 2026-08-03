package websocket

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// setupHubWithDB creates a Hub whose DB is backed by sqlmock.
func setupHubWithDB(t *testing.T) (*Hub, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	hub := NewHub(nil, nil)
	hub.SetDB(db)
	return hub, mock
}

// The membership check must run inside a transaction with SET LOCAL so the RLS
// binding is scoped to that transaction and cannot leak to other pooled
// connections (the previous set_config-via-Exec leaked session state).
func TestIsMemberOfConversation_TxScoped(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectCommit()

	if !hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected member=true")
	}
}

func TestIsMemberOfConversation_NotMember(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectCommit()

	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected member=false")
	}
}

func TestIsMemberOfConversation_DBError_FailClosed(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "user-1").
		WillReturnError(sqlmock.ErrCancelled)

	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected false on DB error (fail-closed)")
	}
}

func TestIsMemberOfConversation_NilDB_FailClosed(t *testing.T) {
	hub := NewHub(nil, nil) // db stays nil
	if hub.isMemberOfConversation("user-1", "conv-1") {
		t.Fatal("expected false with nil db (fail-closed)")
	}
}

func TestWithUserTx_SetConfigFailure(t *testing.T) {
	hub, mock := setupHubWithDB(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs("user-1").
		WillReturnError(sqlmock.ErrCancelled)

	err := hub.withUserTx("user-1", func(tx *sql.Tx) error {
		return nil
	})
	if err == nil {
		t.Fatal("expected error when set_config fails")
	}
}
