package push

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func setupPush(t *testing.T) (*Service, sqlmock.Sqlmock) {
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
	// Construct directly to avoid env dependency on VAPID keys (set via New in
	// production). For storage tests only the DB is needed.
	return &Service{db: db, opts: nil}, mock
}

func mustNilService(t *testing.T) *Service {
	t.Helper()
	// Disabled service (opts nil). SendToUser must be a safe no-op.
	return &Service{db: nil, opts: nil}
}

func TestNormalizeSubject(t *testing.T) {
	// A value already carrying a mailto: prefix must be stripped so webpush-go's
	// own prepend doesn't yield a double "mailto:mailto:..." (Apple rejects that
	// as BadJwtToken).
	cases := []struct {
		in   string
		want string
	}{
		{"admin@gomo6.wtf", "admin@gomo6.wtf"},
		{"mailto:admin@gomo6.wtf", "admin@gomo6.wtf"},
		{"MAILTO:admin@gomo6.wtf", "admin@gomo6.wtf"},
		{" https://example.com/contact ", "https://example.com/contact"},
		{"", ""},
	}
	for _, c := range cases {
		if got := normalizeSubject(c.in); got != c.want {
			t.Errorf("normalizeSubject(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestUpsertSubscription(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectExec(`INSERT INTO push_subscriptions .*ON CONFLICT .*DO UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))

	if err := s.UpsertSubscription(context.Background(), "u1", "https://push.example/x", "p256dh", "auth", "iPhone"); err != nil {
		t.Fatalf("UpsertSubscription: %v", err)
	}
}

func TestDeleteSubscription(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectExec(`DELETE FROM push_subscriptions WHERE user_id = \$1 AND endpoint = \$2`).
		WithArgs("u1", "https://push.example/x").
		WillReturnResult(sqlmock.NewResult(0, 1))

	if err := s.DeleteSubscription(context.Background(), "u1", "https://push.example/x"); err != nil {
		t.Fatalf("DeleteSubscription: %v", err)
	}
}

func TestSetAndGetPreferences(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectExec(`INSERT INTO push_preferences .*ON CONFLICT .*DO UPDATE`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	if err := s.SetPreferences(context.Background(), "u1", map[string]bool{"like": false}); err != nil {
		t.Fatalf("SetPreferences: %v", err)
	}

	// Reading the same prefs back.
	s2, mock2 := setupPush(t)
	mock2.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"type_map"}).AddRow([]byte(`{"like":false,"reply":true}`)))

	prefs, err := s2.Preferences(context.Background(), "u1")
	if err != nil {
		t.Fatalf("Preferences: %v", err)
	}
	if !prefs["like"] == false || prefs["reply"] != true {
		t.Fatalf("unexpected prefs: %+v", prefs)
	}
}

func TestPreferencesNoRow_DefaultsToEmpty(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnError(sql.ErrNoRows)

	prefs, err := s.Preferences(context.Background(), "u1")
	if err != nil {
		t.Fatalf("Preferences: %v", err)
	}
	if len(prefs) != 0 {
		t.Fatalf("expected empty prefs, got %+v", prefs)
	}
}

func TestEnabledForType_DefaultsEnabled(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnError(sql.ErrNoRows)

	if !s.EnabledForType(context.Background(), "u1", "like") {
		t.Fatalf("expected 'like' enabled by default")
	}
}

func TestEnabledForType_RespectsMute(t *testing.T) {
	s, mock := setupPush(t)
	mock.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"type_map"}).AddRow([]byte(`{"like":false}`)))

	if s.EnabledForType(context.Background(), "u1", "like") {
		t.Fatalf("expected muted 'like' to be disabled")
	}
	if !s.EnabledForType(context.Background(), "u1", "reply") {
		t.Fatalf("expected unmuted 'reply' to stay enabled")
	}
}

func TestSendToUser_DisabledServiceNoop(t *testing.T) {
	// No DB, no opts — must not panic.
	s := mustNilService(t)
	s.SendToUser(context.Background(), "u1", "like", Notification{Title: "t", Body: "b"})
}

func TestSendToUser_MutedTypeNoSend(t *testing.T) {
	// Nothing to assert beyond no crash when the type is muted and there are no
	// subscriptions — the preferences check returns early.
	s, mock := setupPush(t)
	mock.ExpectQuery(`SELECT type_map FROM push_preferences WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"type_map"}).AddRow([]byte(`{"like":false}`)))

	s.SendToUser(context.Background(), "u1", "like", Notification{Title: "t"})
}
