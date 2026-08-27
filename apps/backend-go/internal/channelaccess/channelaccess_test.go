package channelaccess

import (
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const testChannel = "10000000-0000-0000-0000-0000000000aa"
const testUser = "20000000-0000-0000-0000-0000000000bb"

func newAccessDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

func expectExists(t *testing.T, mock sqlmock.Sqlmock, queryPattern string, allowed bool) {
	t.Helper()
	mock.ExpectQuery(queryPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(allowed))
}

func TestCanReadChannel_Allowed(t *testing.T) {
	db, mock := newAccessDB(t)
	expectExists(t, mock, `SELECT EXISTS\(\s*SELECT 1 FROM channels ch`, true)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected read access")
	}
}

func TestCanReadChannel_Denied(t *testing.T) {
	db, mock := newAccessDB(t)
	expectExists(t, mock, `SELECT EXISTS\(\s*SELECT 1 FROM channels ch`, false)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("expected read denial")
	}
}

func TestCanReadChannel_DBErrorFailsClosed(t *testing.T) {
	db, mock := newAccessDB(t)
	mock.ExpectQuery(`SELECT EXISTS\(\s*SELECT 1 FROM channels ch`).
		WithArgs(testChannel, testUser).
		WillReturnError(sql.ErrConnDone)

	ok, err := CanReadChannel(db, testUser, testChannel)
	if err == nil {
		t.Fatal("expected error to propagate")
	}
	if ok {
		t.Error("must fail closed on DB error")
	}
}

func TestCanWriteChannel_Allowed(t *testing.T) {
	db, mock := newAccessDB(t)
	mock.ExpectQuery(`SELECT b\.owner_id::text = \$2\s*OR\s*\(\s*EXISTS\(`).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(true))

	ok, err := CanWriteChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected write access")
	}
}

// A channel that vanished between route and check must deny — never panic.
func TestCanWriteChannel_MissingChannelDenies(t *testing.T) {
	db, mock := newAccessDB(t)
	mock.ExpectQuery(`SELECT b\.owner_id::text = \$2\s*OR\s*\(\s*EXISTS\(`).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"})) // zero rows → ErrNoRows

	ok, err := CanWriteChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("ErrNoRows must be mapped to a clean denial, got error: %v", err)
	}
	if ok {
		t.Error("missing channel must deny")
	}
}

func TestCanModerateChannel_RoleGranted(t *testing.T) {
	db, mock := newAccessDB(t)
	expectExists(t, mock, `SELECT EXISTS\(\s*SELECT 1 FROM channels ch`, true)

	ok, err := CanModerateChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok {
		t.Error("expected moderation rights")
	}
}

func TestCanModerateChannel_Denied(t *testing.T) {
	db, mock := newAccessDB(t)
	expectExists(t, mock, `SELECT EXISTS\(\s*SELECT 1 FROM channels ch`, false)

	ok, err := CanModerateChannel(db, testUser, testChannel)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ok {
		t.Error("expected no moderation rights")
	}
}
