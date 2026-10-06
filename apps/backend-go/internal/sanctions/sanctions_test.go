package sanctions

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

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

const activeQueryRe = `SELECT kind, reason, expires_at FROM user_sanctions`

func TestActiveBlocking_None(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(activeQueryRe).WithArgs("u1").WillReturnError(sql.ErrNoRows)

	a, err := ActiveBlocking(context.Background(), db, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if a != nil {
		t.Fatalf("expected no active sanction, got %+v", a)
	}
}

func TestActiveBlocking_Ban(t *testing.T) {
	db, mock := newMock(t)
	expires := time.Now().Add(time.Hour)
	mock.ExpectQuery(activeQueryRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "reason", "expires_at"}).AddRow("ban", "спам", expires))

	a, err := ActiveBlocking(context.Background(), db, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if a == nil || a.Kind != KindBan || a.Reason != "спам" || a.ExpiresAt == nil {
		t.Fatalf("unexpected sanction: %+v", a)
	}
}

func TestActiveBlocking_Error(t *testing.T) {
	db, mock := newMock(t)
	mock.ExpectQuery(activeQueryRe).WithArgs("u1").WillReturnError(errors.New("boom"))

	if _, err := ActiveBlocking(context.Background(), db, "u1"); err == nil {
		t.Fatal("expected the lookup error to propagate")
	}
}

func TestActiveBlocking_NilDB(t *testing.T) {
	a, err := ActiveBlocking(context.Background(), nil, "u1")
	if err != nil || a != nil {
		t.Fatalf("nil db must be a no-op, got %+v err=%v", a, err)
	}
}

func TestKindHelpers(t *testing.T) {
	if !KindBan.Blocking() || !KindMute.Blocking() || KindWarn.Blocking() {
		t.Fatal("Blocking() wrong")
	}
	if !KindWarn.Valid() || Kind("nope").Valid() {
		t.Fatal("Valid() wrong")
	}
}

func TestActiveBlockingCached_CachesTheLookup(t *testing.T) {
	db, mock := newMock(t)
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })

	// First call hits the database …
	mock.ExpectQuery(activeQueryRe).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"kind", "reason", "expires_at"}).AddRow("mute", "флуд", nil))

	first := ActiveBlockingCached(context.Background(), db, client, "u1")
	if first == nil || first.Kind != KindMute {
		t.Fatalf("expected a cached mute, got %+v", first)
	}
	// … the second is served from Redis (no second DB expectation is set, so a
	// DB round trip would fail ExpectationsWereMet).
	second := ActiveBlockingCached(context.Background(), db, client, "u1")
	if second == nil || second.Kind != KindMute {
		t.Fatalf("expected the cached mute, got %+v", second)
	}
}

func TestInvalidateBlockCache(t *testing.T) {
	mr := miniredis.RunT(t)
	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })

	client.Set(context.Background(), blockCacheKey("u1"), `{"kind":"ban"}`, time.Minute)
	InvalidateBlockCache(context.Background(), client, "u1")
	if mr.Exists(blockCacheKey("u1")) {
		t.Fatal("expected the cache key to be deleted")
	}
}
