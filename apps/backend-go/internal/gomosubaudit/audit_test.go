package gomosubaudit

import (
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func strRef(s string) *string { return &s }

func TestNullString(t *testing.T) {
	if nullString(nil) != nil {
		t.Fatal("nil pointer must map to NULL")
	}
	empty := ""
	if nullString(&empty) != nil {
		t.Fatal("empty string must map to NULL")
	}
	if got := nullString(strRef("kick")); got != "kick" {
		t.Fatalf("value must pass through, got %v", got)
	}
}

func TestLog_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("board-1", "actor-1", ActionBan, "target-1", nil, nil, strRef("spam")).
		WillReturnResult(sqlmock.NewResult(0, 1))

	Log(db, Entry{
		BoardID:      "board-1",
		ActorID:      "actor-1",
		Action:       ActionBan,
		TargetUserID: strRef("target-1"),
		Reason:       strRef("spam"),
	})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLog_GuardsNeverTouchDB(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Nil DB, empty board and empty action are all no-ops (no expectations).
	Log(nil, Entry{BoardID: "b", Action: ActionKick})
	Log(db, Entry{BoardID: "", Action: ActionKick})
	Log(db, Entry{BoardID: "b", Action: ""})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestLog_DBErrorSwallowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec(`INSERT INTO gomosub_audit_log`).
		WithArgs("board-1", "actor-1", ActionKick, nil, nil, nil, nil).
		WillReturnError(errors.New("ledger down"))

	// Best-effort: the audited action must not fail when the ledger is down.
	Log(db, Entry{BoardID: "board-1", ActorID: "actor-1", Action: ActionKick})
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
