package handlers

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
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
