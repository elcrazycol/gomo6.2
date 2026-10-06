package search

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func newMockDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

func TestReindexAllPushesEveryIndex(t *testing.T) {
	db, mock := newMockDB(t)
	f, srv := newFakeMeili(t)
	svc := New(Config{URL: srv.URL, IndexPrefix: "gomo6_"})

	mock.ExpectQuery("FROM users").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "username", "display_name", "avatar_url", "is_remote", "created_at",
		}).AddRow("u1", 7, "neo", "Neo", "", false, 1700000000))

	mock.ExpectQuery("FROM boards").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "slug", "name", "description", "cover_image_url", "is_gomosub", "created_at",
		}).AddRow("b1", "general", "General", "", "", false, 1700000000))

	mock.ExpectQuery("FROM threads t").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "content", "created_at", "updated_at",
			"board_id", "board_slug", "board_name", "board_is_gomosub", "board_visibility",
			"author_id", "author_username", "author_avatar_url",
		}).AddRow("t1", 11, "Hello", "world", 1700000000, 1700000000,
			"b1", "general", "General", false, "public", "u1", "neo", ""))

	mock.ExpectQuery("FROM posts p").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "content", "created_at", "thread_id", "thread_public_id", "thread_title",
			"board_id", "board_slug", "board_name", "board_is_gomosub", "board_visibility",
			"author_id", "author_username", "author_avatar_url",
		}).AddRow("p1", "reply", 1700000000, "t1", 11, "Hello",
			"b1", "general", "General", false, "public", "u1", "neo", ""))

	mock.ExpectQuery("FROM profile_wall_posts p").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "public_id", "title", "content", "created_at", "updated_at",
			"author_id", "author_username", "wall_user_id", "wall_username", "wall_visibility",
		}).AddRow("w1", 55, "", "wall note", 1700000000, 1700000000,
			"u1", "neo", "u2", "trinity", "public"))

	stats, err := svc.ReindexAll(context.Background(), db)
	if err != nil {
		t.Fatalf("ReindexAll: %v", err)
	}
	if stats != (ReindexStats{Users: 1, Boards: 1, Threads: 1, Posts: 1, WallPosts: 1}) {
		t.Fatalf("stats = %+v", stats)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}

	// Each index must have been cleared before it was repopulated.
	cleared := map[string]bool{}
	upserted := map[string]bool{}
	for _, c := range f.snapshot() {
		switch {
		case c.method == "DELETE" && c.path == "/indexes/gomo6_users/documents":
			cleared["users"] = true
		case c.method == "DELETE" && c.path == "/indexes/gomo6_boards/documents":
			cleared["boards"] = true
		case c.method == "DELETE" && c.path == "/indexes/gomo6_threads/documents":
			cleared["threads"] = true
		case c.method == "DELETE" && c.path == "/indexes/gomo6_posts/documents":
			cleared["posts"] = true
		case c.method == "POST" && c.path == "/indexes/gomo6_threads/documents":
			upserted["threads"] = true
		}
	}
	for _, key := range []string{"users", "boards", "threads", "posts"} {
		if !cleared[key] {
			t.Errorf("index %s was not cleared before reindex", key)
		}
	}
	if !upserted["threads"] {
		t.Error("threads documents were never upserted")
	}
}
