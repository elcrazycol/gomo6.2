package profiles

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/lib/pq"
)

func newStatsMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})
	return db, mock
}

// resetDirty clears the package-level dirty set between tests.
func resetDirty() { _ = drainDirtyUsers() }

// The stats SQL fragment that identifies the batched snapshot statement.
const snapshotRe = `(?s)UPDATE users u SET.*IS DISTINCT FROM`

func TestRecomputeUserProfileStats_MarksDirty(t *testing.T) {
	resetDirty()
	RecomputeUserProfileStats(nil, "u1")
	if got := PendingStatsUsers(); got != 1 {
		t.Fatalf("expected 1 pending user, got %d", got)
	}
}

func TestMarkStatsDirty_IgnoresEmptyAndDeduplicates(t *testing.T) {
	resetDirty()
	MarkStatsDirty("")
	MarkStatsDirty("u1")
	MarkStatsDirty("u1")
	if got := PendingStatsUsers(); got != 1 {
		t.Fatalf("expected 1 pending user after dedupe, got %d", got)
	}
}

func TestRunStatsSweep_NoDirtyUsersIsNoOp(t *testing.T) {
	resetDirty()
	db, _ := newStatsMock(t) // no expectations: any query would be flagged

	n, err := RunStatsSweep(context.Background(), db)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 0 {
		t.Fatalf("expected 0 users swept, got %d", n)
	}
}

func TestRunStatsSweep_SweepsDirtyUsersInOneStatement(t *testing.T) {
	resetDirty()
	db, mock := newStatsMock(t)

	// Marked out of order → the sweep passes a sorted array.
	MarkStatsDirty("u2")
	MarkStatsDirty("u1")

	mock.ExpectExec(snapshotRe).
		WithArgs(pq.Array([]string{"u1", "u2"})).
		WillReturnResult(sqlmock.NewResult(0, 2))

	n, err := RunStatsSweep(context.Background(), db)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 2 {
		t.Fatalf("expected 2 users swept, got %d", n)
	}
	if got := PendingStatsUsers(); got != 0 {
		t.Fatalf("expected the dirty set to be drained, got %d", got)
	}
}

func TestSweepStats_FullSweepPassesNull(t *testing.T) {
	db, mock := newStatsMock(t)
	mock.ExpectExec(snapshotRe).
		WithArgs(nil).
		WillReturnResult(sqlmock.NewResult(0, 7))

	n, err := SweepStats(context.Background(), db, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if n != 7 {
		t.Fatalf("expected 7 rows written, got %d", n)
	}
}

func TestSweepStats_NilDBIsNoOp(t *testing.T) {
	n, err := SweepStats(context.Background(), nil, []string{"u1"})
	if err != nil || n != 0 {
		t.Fatalf("nil db must be a no-op, got n=%d err=%v", n, err)
	}
}

// A failed sweep must put the users back so the next tick retries instead of
// waiting for the hourly full reconciliation.
func TestRunStatsSweep_RestoresUsersOnError(t *testing.T) {
	resetDirty()
	db, mock := newStatsMock(t)

	MarkStatsDirty("u1")
	mock.ExpectExec(snapshotRe).
		WithArgs(pq.Array([]string{"u1"})).
		WillReturnError(errors.New("boom"))

	if _, err := RunStatsSweep(context.Background(), db); err == nil {
		t.Fatal("expected the sweep error to propagate")
	}
	if got := PendingStatsUsers(); got != 1 {
		t.Fatalf("expected the failed user to be re-marked, got %d pending", got)
	}
	resetDirty()
}
