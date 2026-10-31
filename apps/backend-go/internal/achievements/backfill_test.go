package achievements

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// The full backfill streams user ids in keyset pages: the first page has no
// cursor, every next page continues after the last id of the previous one,
// and an empty page ends the pass.
func TestListUserPage_Keyset(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	u1, u2, u3 := "00000000-0000-0000-0000-000000000001",
		"00000000-0000-0000-0000-000000000002",
		"00000000-0000-0000-0000-000000000003"
	mock.ExpectQuery("FROM users ORDER BY id LIMIT").WithArgs(2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(u1).AddRow(u2))
	mock.ExpectQuery("FROM users WHERE id >").WithArgs(u2, 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(u3))
	mock.ExpectQuery("FROM users WHERE id >").WithArgs(u3, 2).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	p1, err := e.listUserPage(t.Context(), "", 2)
	if err != nil {
		t.Fatalf("page 1: %v", err)
	}
	if len(p1) != 2 || p1[0] != u1 || p1[1] != u2 {
		t.Fatalf("page 1 = %v, want [%s %s]", p1, u1, u2)
	}
	p2, err := e.listUserPage(t.Context(), p1[len(p1)-1], 2)
	if err != nil {
		t.Fatalf("page 2: %v", err)
	}
	if len(p2) != 1 || p2[0] != u3 {
		t.Fatalf("page 2 = %v, want [%s]", p2, u3)
	}
	p3, err := e.listUserPage(t.Context(), p2[len(p2)-1], 2)
	if err != nil {
		t.Fatalf("page 3: %v", err)
	}
	if len(p3) != 0 {
		t.Fatalf("page 3 = %v, want empty (end of pass)", p3)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// An empty users table ends the backfill after the first page with no
// per-user work.
func TestRecomputeAll_Empty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	mock.ExpectQuery("FROM users ORDER BY id LIMIT").WithArgs(200).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	e.RecomputeAll(t.Context())
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
