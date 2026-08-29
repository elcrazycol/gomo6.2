package actieye

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func newMockDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

func day(offset int) time.Time {
	return time.Now().UTC().AddDate(0, 0, offset).Truncate(24 * time.Hour)
}

func TestSeedFor_Stable(t *testing.T) {
	if SeedFor("user-1") != SeedFor("user-1") {
		t.Fatal("seed must be stable for the same user")
	}
	if SeedFor("user-1") == SeedFor("user-2") {
		t.Log("different users may rarely collide; not fatal")
	}
	if s := SeedFor("user-1"); s < 0 || s >= 360 {
		t.Fatalf("seed %d out of expected 0..359 range", s)
	}
}

func TestFetch_FullSummary(t *testing.T) {
	db, mock := newMockDB(t)

	// Registered six days ago → the road spans exactly those 6 + today = 7 days.
	mock.ExpectQuery(`SELECT COALESCE\(thread_count, 0\).*FROM users WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"posts", "comments", "likes", "created_at"}).AddRow(48, 56, 123, day(-6)))

	// Visits: today and the previous four days → current streak 5, best 5.
	visits := sqlmock.NewRows([]string{"visit_date"})
	for i := 0; i >= -4; i-- {
		visits.AddRow(day(i))
	}
	mock.ExpectQuery(`SELECT visit_date FROM user_daily_visits WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(visits)

	s, err := Fetch(context.Background(), db, "user-1")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}

	if s.Posts != 48 || s.Comments != 56 || s.Likes != 123 {
		t.Fatalf("counters mismatch: %+v", s)
	}
	if s.ActiveDays != 5 {
		t.Fatalf("active days = %d, want 5", s.ActiveDays)
	}
	if s.CurrentStreak != 5 {
		t.Fatalf("current streak = %d, want 5", s.CurrentStreak)
	}
	if s.BestStreak != 5 {
		t.Fatalf("best streak = %d, want 5", s.BestStreak)
	}
	// Road starts at registration (-6) and ends today: 7 entries.
	if len(s.Days) != 7 {
		t.Fatalf("road length = %d, want 7", len(s.Days))
	}
	if !s.Days[len(s.Days)-1].Active {
		t.Fatal("today should be active on the road")
	}
	if s.Days[0].Active || s.Days[1].Active {
		t.Fatal("days before the first visit must be inactive on the road")
	}
	if s.Seed != SeedFor("user-1") {
		t.Fatalf("seed mismatch: %d", s.Seed)
	}
}

func TestFetch_StreakAliveFromYesterday(t *testing.T) {
	db, mock := newMockDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(thread_count, 0\).*FROM users WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"posts", "comments", "likes", "created_at"}).AddRow(0, 0, 0, day(-2)))

	// Only yesterday — today not yet visited: the streak is still alive.
	mock.ExpectQuery(`SELECT visit_date FROM user_daily_visits WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"visit_date"}).AddRow(day(-1)))

	s, err := Fetch(context.Background(), db, "user-1")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if s.CurrentStreak != 1 {
		t.Fatalf("current streak = %d, want 1", s.CurrentStreak)
	}
}

func TestFetch_BrokenStreak(t *testing.T) {
	db, mock := newMockDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(thread_count, 0\).*FROM users WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"posts", "comments", "likes", "created_at"}).AddRow(1, 1, 1, day(-4)))

	// Visits: today, yesterday, and a loner four days ago (gap → run breaks).
	visits := sqlmock.NewRows([]string{"visit_date"}).
		AddRow(day(0)).AddRow(day(-1)).AddRow(day(-4))
	mock.ExpectQuery(`SELECT visit_date FROM user_daily_visits WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(visits)

	s, err := Fetch(context.Background(), db, "user-1")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if s.CurrentStreak != 2 {
		t.Fatalf("current streak = %d, want 2", s.CurrentStreak)
	}
	if s.BestStreak != 2 {
		t.Fatalf("best streak = %d, want 2", s.BestStreak)
	}
	if s.ActiveDays != 3 {
		t.Fatalf("active days = %d, want 3", s.ActiveDays)
	}
}

func TestFetch_NoVisits(t *testing.T) {
	db, mock := newMockDB(t)

	mock.ExpectQuery(`SELECT COALESCE\(thread_count, 0\).*FROM users WHERE id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"posts", "comments", "likes", "created_at"}).AddRow(0, 0, 0, day(-3)))

	mock.ExpectQuery(`SELECT visit_date FROM user_daily_visits WHERE user_id = \$1`).
		WithArgs("user-1").
		WillReturnRows(sqlmock.NewRows([]string{"visit_date"}))

	s, err := Fetch(context.Background(), db, "user-1")
	if err != nil {
		t.Fatalf("Fetch: %v", err)
	}
	if s.ActiveDays != 0 || s.CurrentStreak != 0 || s.BestStreak != 0 {
		t.Fatalf("expected zeroed streaks, got %+v", s)
	}
	for i, d := range s.Days {
		if d.Active {
			t.Fatalf("day %d should be inactive with no visits", i)
		}
	}
	// Registered three days ago → road covers exactly 4 days (-3..today).
	if len(s.Days) != 4 {
		t.Fatalf("road length = %d, want 4", len(s.Days))
	}
}
