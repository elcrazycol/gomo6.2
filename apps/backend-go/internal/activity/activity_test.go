package activity

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// waitFor polls cond until it holds or the deadline passes. Recorder writes are
// asynchronous (bg.Pool), so the mock expectation is verified by polling.
func waitFor(t *testing.T, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("condition not met within timeout")
}

func newMock(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
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

func TestRecord_InsertsEvent(t *testing.T) {
	db, mock := newMock(t)
	rec := New(db)

	mock.ExpectExec(`INSERT INTO user_activity_events`).
		WithArgs("user-1", "like_given", "post", "550e8400-e29b-41d4-a716-446655440000").
		WillReturnResult(sqlmock.NewResult(1, 1))

	rec.Record("user-1", "like_given", "post", "550e8400-e29b-41d4-a716-446655440000")

	waitFor(t, func() bool { return mock.ExpectationsWereMet() == nil })
}

func TestRecord_NullTargetsForUntargetedEvent(t *testing.T) {
	db, mock := newMock(t)
	rec := New(db)

	// Empty target columns must bind as NULL, not "" (which would fail the
	// target_id uuid cast).
	mock.ExpectExec(`INSERT INTO user_activity_events`).
		WithArgs("user-1", "daily_visit", nil, nil).
		WillReturnResult(sqlmock.NewResult(1, 1))

	rec.Record("user-1", "daily_visit", "", "")

	waitFor(t, func() bool { return mock.ExpectationsWereMet() == nil })
}

func TestRecord_NilRecorderAndEmptyArgsAreNoOps(t *testing.T) {
	var nilRec *Recorder
	nilRec.Record("u1", "x", "", "") // must not panic

	if New(nil) != nil {
		t.Fatal("New(nil) must return a nil recorder")
	}

	db, _ := newMock(t)
	rec := New(db)
	rec.Record("", "x", "", "")  // no user id
	rec.Record("u1", "", "", "") // no event type
	if rec.QueueLen() != 0 {
		t.Fatalf("empty args must not enqueue, queue=%d", rec.QueueLen())
	}
}

func TestMaintainPartitions_CallsEnsureAndDrop(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectExec(`SELECT ensure_activity_partitions`).WithArgs(3).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`SELECT drop_old_activity_partitions`).WithArgs(6).
		WillReturnResult(sqlmock.NewResult(0, 0))

	if err := MaintainPartitions(context.Background(), db, 6); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestMaintainPartitions_NilDBIsNoOp(t *testing.T) {
	if err := MaintainPartitions(context.Background(), nil, 6); err != nil {
		t.Fatalf("nil db must be a no-op, got %v", err)
	}
}
