package handlers

import (
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCleanupOldClientErrors_DrainsInBatches(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	// First batch is full, so the loop must continue; second is partial, so it
	// must stop after exactly two DELETEs.
	mock.ExpectExec("DELETE FROM client_errors").
		WithArgs(sqlmock.AnyArg(), clientErrorRetentionBatch).
		WillReturnResult(sqlmock.NewResult(0, clientErrorRetentionBatch))
	mock.ExpectExec("DELETE FROM client_errors").
		WithArgs(sqlmock.AnyArg(), clientErrorRetentionBatch).
		WillReturnResult(sqlmock.NewResult(0, 10))

	NewClientErrorsHandler(db).cleanupOldClientErrors()

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCleanupOldClientErrors_SingleShortBatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectExec("DELETE FROM client_errors").
		WithArgs(sqlmock.AnyArg(), clientErrorRetentionBatch).
		WillReturnResult(sqlmock.NewResult(0, 3))

	NewClientErrorsHandler(db).cleanupOldClientErrors()

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestCleanupOldClientErrors_StopsOnError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectExec("DELETE FROM client_errors").
		WillReturnError(errors.New("db down"))

	// Must not panic and must not retry a failing statement.
	NewClientErrorsHandler(db).cleanupOldClientErrors()

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestStartClientErrorRetention_NilSafe(t *testing.T) {
	var nilHandler *ClientErrorsHandler
	nilHandler.StartClientErrorRetention() // must not panic

	(&ClientErrorsHandler{}).StartClientErrorRetention() // nil db: no-op
}

func TestClientErrorRetentionWindow_DefaultAndOverride(t *testing.T) {
	t.Setenv("CLIENT_ERRORS_RETENTION_DAYS", "")
	if got, want := clientErrorRetentionWindow(), time.Duration(clientErrorRetentionDays)*24*time.Hour; got != want {
		t.Fatalf("default window = %v, want %v", got, want)
	}

	t.Setenv("CLIENT_ERRORS_RETENTION_DAYS", "30")
	if got, want := clientErrorRetentionWindow(), 30*24*time.Hour; got != want {
		t.Fatalf("override window = %v, want %v", got, want)
	}

	// Invalid values fall back to the default rather than shortening retention.
	for _, bad := range []string{"abc", "0", "-5"} {
		t.Setenv("CLIENT_ERRORS_RETENTION_DAYS", bad)
		if got, want := clientErrorRetentionWindow(), time.Duration(clientErrorRetentionDays)*24*time.Hour; got != want {
			t.Fatalf("window for %q = %v, want default %v", bad, got, want)
		}
	}
}
