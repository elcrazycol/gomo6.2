package authz

import (
	"context"
	"errors"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestIsModerator_True(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role IN \('moderator', 'admin'\)\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	got, err := IsModerator(context.Background(), db, "u1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("expected true")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIsAdmin_True(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS \(SELECT 1 FROM user_roles WHERE user_id = \$1 AND role = 'admin'\)`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	got, err := IsAdmin(context.Background(), db, "u2")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !got {
		t.Fatal("expected true")
	}
}

func TestRoleChecks_FailClosed(t *testing.T) {
	// nil DB and empty user id must not query and must report "no role".
	if ok, err := IsModerator(context.Background(), nil, "u1"); ok || err != nil {
		t.Fatalf("nil db: got (%v, %v), want (false, nil)", ok, err)
	}
	if ok, err := IsAdmin(context.Background(), nil, "u1"); ok || err != nil {
		t.Fatalf("nil db: got (%v, %v), want (false, nil)", ok, err)
	}

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	if ok, err := IsModerator(context.Background(), db, ""); ok || err != nil {
		t.Fatalf("empty user id: got (%v, %v), want (false, nil)", ok, err)
	}
}

func TestRoleChecks_QueryErrorFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(`SELECT EXISTS`).WillReturnError(errors.New("db down"))

	ok, err := IsAdmin(context.Background(), db, "u1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if ok {
		t.Fatal("must fail closed on query error")
	}
}
