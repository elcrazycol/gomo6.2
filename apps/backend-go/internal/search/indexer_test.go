package search

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNewIndexerNilWhenDisabled(t *testing.T) {
	db, _ := newMockDB(t)
	if idx := NewIndexer(db, New(Config{})); idx != nil {
		t.Fatal("expected nil indexer when the engine is disabled")
	}
}

func TestIndexerSyncUpsertsWhenRowFound(t *testing.T) {
	db, mock := newMockDB(t)
	f, srv := newFakeMeili(t)
	idx := NewIndexer(db, New(Config{URL: srv.URL, IndexPrefix: "gomo6_"}))
	if idx == nil {
		t.Fatal("unexpected nil indexer")
	}

	mock.ExpectQuery("FROM users").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "username", "display_name", "avatar_url", "is_remote", "created_at",
		}).AddRow("u1", 7, "neo", "Neo", "", false, 1700000000))

	if err := syncNow(context.Background(), idx, IndexUsers, usersBaseQuery+" AND u.id = $1", scanUserDoc, "u1"); err != nil {
		t.Fatalf("syncNow: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	var upserted bool
	for _, c := range f.snapshot() {
		if c.method == "POST" && c.path == "/indexes/gomo6_users/documents" {
			upserted = true
			if !strings.Contains(c.body, `"username":"neo"`) {
				t.Errorf("upsert body = %s", c.body)
			}
		}
	}
	if !upserted {
		t.Fatal("expected a document upsert")
	}
}

func TestIndexerSyncDeletesWhenRowGone(t *testing.T) {
	db, mock := newMockDB(t)
	f, srv := newFakeMeili(t)
	idx := NewIndexer(db, New(Config{URL: srv.URL, IndexPrefix: "gomo6_"}))

	// No row: the profile turned private (or the post was deleted). The stale
	// document must be removed, not left behind.
	mock.ExpectQuery("FROM users").WithArgs("u1").WillReturnError(sql.ErrNoRows)

	if err := syncNow(context.Background(), idx, IndexUsers, usersBaseQuery+" AND u.id = $1", scanUserDoc, "u1"); err != nil {
		t.Fatalf("syncNow: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	var deleted bool
	for _, c := range f.snapshot() {
		if c.method == "DELETE" && c.path == "/indexes/gomo6_users/documents/u1" {
			deleted = true
		}
	}
	if !deleted {
		t.Fatal("expected the document to be deleted")
	}
}
