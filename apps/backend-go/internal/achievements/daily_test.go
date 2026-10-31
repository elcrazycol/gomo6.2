package achievements

import (
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// exactMatcher matches sqlmock expectations by query text with whitespace
// collapsed, as a substring: the daily set order is date-shuffled but the
// test builds expectations by iterating the same set, so ordered matching
// disambiguates templates sharing a table (comments vs media both read
// posts), while fragments stay immune to query indentation.
func exactMatcher() sqlmock.QueryMatcher {
	squash := func(s string) string {
		out := []byte{}
		space := false
		for i := 0; i < len(s); i++ {
			c := s[i]
			if c == ' ' || c == '\n' || c == '\t' || c == '\r' {
				if !space {
					out = append(out, ' ')
				}
				space = true
				continue
			}
			space = false
			out = append(out, c)
		}
		n := len(out)
		for n > 0 && out[n-1] == ' ' {
			n--
		}
		start := 0
		for start < n && out[start] == ' ' {
			start++
		}
		return string(out[start:n])
	}
	return sqlmock.QueryMatcherFunc(func(expected, actual string) error {
		want, got := squash(expected), squash(actual)
		if want == got || (want != "" && strings.Contains(got, want)) {
			return nil
		}
		return fmt.Errorf("query mismatch:\nwant: %s\ngot:  %s", expected, actual)
	})
}

// The day's set is a pure function of the date: it exists the moment the
// server answers, with no scheduler, no midnight wait and no seeding.
func TestDailySetFor_AvailableImmediately(t *testing.T) {
	set := DailySetFor(dailyNow())
	if len(set) != DailyQuestCount {
		t.Fatalf("today has %d quests, want %d", len(set), DailyQuestCount)
	}
	for _, q := range set {
		if q.Threshold < 1 {
			t.Errorf("%s: non-positive threshold %d", q.Key, q.Threshold)
		}
		if len(q.Rewards) == 0 {
			t.Errorf("%s: no rewards", q.Key)
		}
		if _, ok := dailyProgressQueries[q.Key]; !ok {
			t.Errorf("%s: no day counter query", q.Key)
		}
	}
}

func TestDailySetFor_Deterministic(t *testing.T) {
	day := mustParseDay("2026-10-31")
	a := DailySetFor(day)
	b := DailySetFor(day)
	if len(a) != DailyQuestCount {
		t.Fatalf("expected %d quests, got %d", DailyQuestCount, len(a))
	}
	for i := range a {
		if a[i].Key != b[i].Key {
			t.Fatalf("same day gave different sets: %v vs %v", a, b)
		}
	}
	seen := map[string]bool{}
	for _, q := range a {
		if seen[q.Key] {
			t.Fatalf("duplicate quest in one day: %s", q.Key)
		}
		seen[q.Key] = true
	}
	other := DailySetFor(mustParseDay("2026-11-01"))
	same := len(other) == len(a)
	if same {
		for i := range a {
			if a[i].Key != other[i].Key {
				same = false
			}
		}
	}
	if same {
		t.Errorf("two different days drew the identical set in the identical order")
	}
}

func TestDailyRestorePrice(t *testing.T) {
	for streak, want := range map[int]int{0: 20, 1: 20, 5: 100, 25: 500, 100: 500} {
		if got := DailyRestorePrice(streak); got != want {
			t.Errorf("streak %d: price = %d, want %d", streak, got, want)
		}
	}
}

func TestClaimDaily_NotCompleted(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(exactMatcher()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	tmpl := DailySetFor(dailyNow())[0]
	day := DailyDayString(dailyNow())
	mock.ExpectBegin()
	mock.ExpectQuery(dailyProgressQueries[tmpl.Key]).WithArgs("u1", day).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectRollback()

	if _, err := e.ClaimDaily(t.Context(), "u1", tmpl.Key); err != ErrQuestNotCompleted {
		t.Fatalf("expected ErrQuestNotCompleted, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestRestoreStreak_NothingRestorable(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(exactMatcher()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	mock.ExpectBegin()
	mock.ExpectExec("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)").
		WithArgs("achievements:daily-restore:u1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT current_streak, longest_streak, last_completed_day::text FROM daily_streaks WHERE user_id = $1").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"current_streak", "longest_streak", "last_completed_day"}).
			AddRow(4, 9, "2020-01-01")) // long ago — no single day to buy back
	mock.ExpectRollback()

	if _, _, err := e.RestoreStreak(t.Context(), "u1"); err != ErrDailyNothingRestorable {
		t.Fatalf("expected ErrDailyNothingRestorable, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// Yesterday fully completed but never claimed: settle auto-grants every
// quest plus the day chest (автозачёт) and starts the streak at 1.
func TestSettleDailyDay_AutoGrants(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(exactMatcher()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	day := DailyDayString(dailyNow().AddDate(0, 0, -1))
	set := DailySetFor(mustParseDay(day))

	mock.ExpectBegin()
	mock.ExpectExec("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)").
		WithArgs("achievements:daily:u1:" + day).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT quest_key FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date").
		WithArgs("u1", day).
		WillReturnRows(sqlmock.NewRows([]string{"quest_key"}))

	balance := 100
	for _, tmpl := range set {
		amount := tmpl.Rewards[0].Amount
		mock.ExpectQuery(dailyProgressQueries[tmpl.Key]).WithArgs("u1", day).
			WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(tmpl.Threshold))
		balance += amount
		mock.ExpectQuery("UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2 RETURNING COALESCE(drops, 0)").
			WithArgs(amount, "u1").
			WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(balance))
		mock.ExpectExec("INSERT INTO drops_transactions").
			WithArgs("u1", amount, balance, "daily_auto", fmt.Sprintf("Daily quest: +%d drops", amount)).
			WillReturnResult(sqlmock.NewResult(1, 1))
		mock.ExpectExec("INSERT INTO daily_quest_claims").
			WithArgs("u1", day, tmpl.Key, sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))
	}
	// The full day closes: chest granted in the same pass.
	mock.ExpectQuery("INSERT INTO daily_chests").
		WithArgs("u1", day, "rarity_chest").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("00000000-0000-0000-0000-000000000001"))
	mock.ExpectExec("INSERT INTO daily_quest_claims").
		WithArgs("u1", day, "__full__", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// No streak row yet → series starts at 1.
	mock.ExpectQuery("SELECT current_streak, longest_streak, last_completed_day::text FROM daily_streaks WHERE user_id = $1").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"current_streak", "longest_streak", "last_completed_day"}))
	mock.ExpectExec("INSERT INTO daily_streaks").
		WithArgs("u1", 1, 1, day).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if got, err := e.settleDailyDay(t.Context(), "u1", day); err != nil {
		t.Fatalf("settle: %v", err)
	} else if len(got) != len(set)+1 {
		t.Fatalf("expected %d auto-grants (quests + day chest), got %+v", len(set)+1, got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// Claiming the last open quest of today drops the day chest in the same
// transaction.
func TestClaimDaily_ClosesSetWithChest(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(exactMatcher()))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	day := DailyDayString(dailyNow())
	set := DailySetFor(dailyNow())
	last := set[len(set)-1]
	amount := last.Rewards[0].Amount

	mock.ExpectBegin()
	mock.ExpectQuery(dailyProgressQueries[last.Key]).WithArgs("u1", day).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(last.Threshold))
	mock.ExpectQuery("SELECT TRUE FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date AND quest_key = $3").
		WithArgs("u1", day, last.Key).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}))
	mock.ExpectQuery("UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2 RETURNING COALESCE(drops, 0)").
		WithArgs(amount, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(200))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", amount, 200, "daily", fmt.Sprintf("Daily quest: +%d drops", amount)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO daily_quest_claims").
		WithArgs("u1", day, last.Key, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// The earlier quests are already claimed in this tx → set closes.
	claimedRows := sqlmock.NewRows([]string{"quest_key"})
	for _, tmpl := range set {
		claimedRows.AddRow(tmpl.Key)
	}
	mock.ExpectQuery("SELECT quest_key FROM daily_quest_claims WHERE user_id = $1 AND quest_day = $2::date").
		WithArgs("u1", day).
		WillReturnRows(claimedRows)
	mock.ExpectQuery("INSERT INTO daily_chests").
		WithArgs("u1", day, "rarity_chest").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("00000000-0000-0000-0000-000000000002"))
	mock.ExpectExec("INSERT INTO daily_quest_claims").
		WithArgs("u1", day, "__full__", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	granted, err := e.ClaimDaily(t.Context(), "u1", last.Key)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if len(granted) != 2 {
		t.Fatalf("expected quest reward + day chest, got %+v", granted)
	}
	if granted[1].ChestID == "" {
		t.Errorf("day chest must report the chest id")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
