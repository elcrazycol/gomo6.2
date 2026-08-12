package handlers

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

func setupSearchHandler(t *testing.T) (*SearchHandler, sqlmock.Sqlmock) {
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
	return NewSearchHandler(db), mock
}

func TestSearch_EmptyQuery(t *testing.T) {
	handler, _ := setupSearchHandler(t)
	c, w := newGETContext("/api/v1/search", map[string]string{"q": ""})

	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSearch_ShortQuery(t *testing.T) {
	handler, _ := setupSearchHandler(t)
	c, w := newGETContext("/api/v1/search", map[string]string{"q": "a"})

	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestSearch_NoQuery(t *testing.T) {
	handler, _ := setupSearchHandler(t)
	c, w := newGETContext("/api/v1/search", nil)

	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// L1: anonymous search must exclude private profiles — the users query must
// carry the COALESCE(private_profile, false) = false gate and pass a NULL
// viewer id ($2) so no friendship/owner branch can open it up.
func TestSearch_AnonymousExcludesPrivateProfiles(t *testing.T) {
	handler, mock := setupSearchHandler(t)

	// The users query must contain the private-profile exclusion and receive a
	// NULL viewer id for anonymous callers.
	mock.ExpectQuery(`SELECT u\.id, u\.username, u\.display_name[\s\S]*COALESCE\(ps\.private_profile, false\) = false`).
		WithArgs("admin", nil).
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "avatar_url"}))
	mock.ExpectQuery(`SELECT id, slug, name, description, cover_image_url, is_gomosub`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "slug", "name", "description", "cover_image_url", "is_gomosub"}))
	mock.ExpectQuery(`SELECT t\.id, t\.title, t\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "content", "created_at", "updated_at", "board_id", "board_slug", "board_name", "board_is_gomosub"}))
	mock.ExpectQuery(`SELECT p\.id, p\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "content", "created_at", "thread_id", "thread_title", "board_id", "board_slug", "board_name", "board_is_gomosub", "username", "avatar_url"}))

	c, w := newGETContext("/api/v1/search", map[string]string{"q": "admin"})
	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

// L1: an authenticated owner/friend search passes the viewer id as $2 so the
// privacy gate can admit their own private profile (and friends' profiles).
func TestSearch_AuthenticatedPassesViewerID(t *testing.T) {
	handler, mock := setupSearchHandler(t)

	// Private-profile user "admin" is returned for the owner viewer "user-1"
	// (the WHERE gate admits u.id = $2::uuid), proving the viewer id is wired.
	mock.ExpectQuery(`SELECT u\.id, u\.username, u\.display_name[\s\S]*u\.id = \$2::uuid`).
		WithArgs("admin", "user-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "username", "display_name", "avatar_url"}).
			AddRow("user-a", "admin", "Admin", nil))
	mock.ExpectQuery(`SELECT id, slug, name, description, cover_image_url, is_gomosub`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "slug", "name", "description", "cover_image_url", "is_gomosub"}))
	mock.ExpectQuery(`SELECT t\.id, t\.title, t\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "content", "created_at", "updated_at", "board_id", "board_slug", "board_name", "board_is_gomosub"}))
	mock.ExpectQuery(`SELECT p\.id, p\.content`).
		WithArgs("admin").
		WillReturnRows(sqlmock.NewRows([]string{"id", "content", "created_at", "thread_id", "thread_title", "board_id", "board_slug", "board_name", "board_is_gomosub", "username", "avatar_url"}))

	c, w := newGETContextWithClaims("/api/v1/search", map[string]string{"q": "admin"}, &auth.Claims{UserID: "user-1"})
	handler.Search(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "admin") {
		t.Fatalf("expected the owner's private profile in the response, got: %s", w.Body.String())
	}
}
