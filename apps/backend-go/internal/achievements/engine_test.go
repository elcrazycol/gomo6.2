package achievements

import (
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// testCatalog covers both stat kinds and the event-derived groups.
func testCatalog(t *testing.T) *Catalog {
	t.Helper()
	cat, err := NewCatalog([]*Group{
		{
			Key: "entries", TitleKey: "t.entries", Category: CategoryContent,
			Icon: "message-square", Type: TypeProgressive, Stat: StatCounter, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "k1", DescriptionKey: "d1", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 50, NameKey: "k2", DescriptionKey: "d2", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
			},
		},
		{
			Key: "avatar", TitleKey: "t.avatar", Category: CategoryProfile,
			Icon: "camera", Type: TypeOneTime, Stat: StatCounter, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "ka", DescriptionKey: "da", Rarity: "common", RewardType: "garma", RewardValue: "20"},
			},
		},
		{
			Key: "daily_streak", TitleKey: "t.streak", Category: CategoryRetention,
			Icon: "calendar-check", Type: TypeProgressive, Stat: StatDerived, SortOrder: 3,
			Levels: []Level{
				{Level: 1, Threshold: 3, NameKey: "s1", DescriptionKey: "sd1", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 7, NameKey: "s2", DescriptionKey: "sd2", Rarity: "uncommon", RewardType: "garma", RewardValue: "50"},
			},
		},
		{
			Key: "session_time", TitleKey: "t.session", Category: CategoryRetention,
			Icon: "clock", Type: TypeProgressive, Stat: StatDerived, SortOrder: 4,
			Levels: []Level{
				{Level: 1, Threshold: 60, NameKey: "t1", DescriptionKey: "td1", Rarity: "common", RewardType: "garma", RewardValue: "10"},
				{Level: 2, Threshold: 600, NameKey: "t2", DescriptionKey: "td2", Rarity: "uncommon", RewardType: "garma", RewardValue: "100"},
			},
		},
		{
			Key: "secret_owl", TitleKey: "t.owl", Category: CategorySecret,
			Icon: "moon-star", Type: TypeOneTime, Stat: StatDerived, SortOrder: 5, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 10, NameKey: "o1", DescriptionKey: "od1", Rarity: "rare", RewardType: "garma", RewardValue: "300"},
			},
		},
		{
			Key: "secret_shower", TitleKey: "t.shower", Category: CategorySecret,
			Icon: "shower-head", Type: TypeOneTime, Stat: StatDerived, SortOrder: 6, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 720, NameKey: "sh1", DescriptionKey: "shd1", Rarity: "epic", RewardType: "garma", RewardValue: "1000"},
			},
		},
		{
			Key: "secret_lurk", TitleKey: "t.lurk", Category: CategorySecret,
			Icon: "ghost", Type: TypeOneTime, Stat: StatDerived, SortOrder: 7, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 30, NameKey: "l1", DescriptionKey: "ld1", Rarity: "epic", RewardType: "garma", RewardValue: "1000"},
			},
		},
		{
			Key: "secret_allrounder", TitleKey: "t.allrounder", Category: CategorySecret,
			Icon: "sparkles", Type: TypeOneTime, Stat: StatDerived, SortOrder: 8, Hidden: true,
			Levels: []Level{
				{Level: 1, Threshold: 5, NameKey: "a1", DescriptionKey: "ad1", Rarity: "rare", RewardType: "garma", RewardValue: "500"},
			},
		},
	})
	if err != nil {
		t.Fatalf("test catalog: %v", err)
	}
	return cat
}

func newEngine(t *testing.T) (*Engine, sqlmock.Sqlmock) {
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
	return New(db, testCatalog(t)), mock
}

func expectCurrentLevel(mock sqlmock.Sqlmock, key string, level int) {
	rows := sqlmock.NewRows([]string{"current_level"})
	if level > 0 {
		rows.AddRow(level)
	}
	mock.ExpectQuery("SELECT COALESCE\\(current_level").WithArgs("u1", GroupID(key)).WillReturnRows(rows)
}

func expectExactUpsert(mock sqlmock.Sqlmock, key string, level, progress int) {
	mock.ExpectExec("INSERT INTO user_achievements").
		WithArgs("u1", GroupID(key), level, progress, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

// expectCounterReconcile stubs a counter event: a sourceCount query returning
// the live value, the counter write, a level read and the exact upsert.
func expectCounterReconcile(mock sqlmock.Sqlmock, fragment, key string, value, level int) {
	mock.ExpectQuery(fragment).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(value))
	mock.ExpectExec("INSERT INTO user_achievement_counters").
		WithArgs("u1", key, value).WillReturnResult(sqlmock.NewResult(1, 1))
	expectCurrentLevel(mock, key, 0)
	if level > 0 {
		expectExactUpsert(mock, key, level, value)
	}
}

// expectDerivedNoUnlock stubs a derived-group query returning a value below its
// threshold, followed by the level read (no upsert, no delete).
func expectDerivedNoUnlock(mock sqlmock.Sqlmock, fragment, key string, value int) {
	mock.ExpectQuery(fragment).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(value))
	expectCurrentLevel(mock, key, 0)
}

// Entry events also re-check secret_owl, and an unlock re-checks
// secret_allrounder — register those expectations.
func expectEntryEventDerived(mock sqlmock.Sqlmock, unlocked bool) {
	expectDerivedNoUnlock(mock, "EXTRACT", "secret_owl", 0)
	if unlocked {
		expectDerivedNoUnlock(mock, "achievement_type = 'progressive'", "secret_allrounder", 0)
	}
}

// ──────────────── counter events ────────────────

// TestHandleEvent_CounterUnlock: an entry crosses threshold 1 → the counter is
// reconciled from live data and the level row upserted (silent unlock).
func TestHandleEvent_CounterUnlock(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "FROM threads t WHERE t.user_id", "entries", 1, 1)
	expectEntryEventDerived(mock, true)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

// TestHandleEvent_SameLevelNoUpsert: 2 entries still level 1 → counter synced,
// no level write.
func TestHandleEvent_SameLevelNoUpsert(t *testing.T) {
	e, mock := newEngine(t)

	mock.ExpectQuery("FROM threads t WHERE t.user_id").
		WithArgs("u1").WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(2))
	mock.ExpectExec("INSERT INTO user_achievement_counters").
		WithArgs("u1", "entries", 2).WillReturnResult(sqlmock.NewResult(1, 1))
	expectCurrentLevel(mock, "entries", 1) // already at level 1; 2 entries still level 1
	expectEntryEventDerived(mock, false)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

func TestHandleEvent_OneTimeCounter(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "avatar_url IS NOT NULL", "avatar", 1, 1)

	e.HandleEvent(Event{UserID: "u1", Type: EventAvatarUpdated})
}

// TestHandleEvent_CounterSelfHeals: the counter reconciles to the LIVE value
// even when an earlier event was missed (dirty/incomplete history) — the
// achievement never lags the real row count.
func TestHandleEvent_CounterSelfHeals(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "FROM threads t WHERE t.user_id", "entries", 5, 1)
	expectEntryEventDerived(mock, true)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

func TestHandleEvent_UnknownTypeNoop(t *testing.T) {
	e, _ := newEngine(t)
	// No DB expectations registered: an unknown event must not touch the DB.
	e.HandleEvent(Event{UserID: "u1", Type: "totally_unknown"})
}

// ──────────────── derived events ────────────────

func TestHandleEvent_DailyVisitDerived(t *testing.T) {
	e, mock := newEngine(t)

	// daily_streak = 3 → level 1 unlock
	mock.ExpectQuery("ROW_NUMBER\\(\\) OVER").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(3))
	expectCurrentLevel(mock, "daily_streak", 0)
	expectExactUpsert(mock, "daily_streak", 1, 3)
	// secret_shower = 100 → below 720 → nothing
	mock.ExpectQuery("MAX\\(total_minutes\\)").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(100))
	expectCurrentLevel(mock, "secret_shower", 0)
	// secret_lurk = 5 → below 30 → nothing
	mock.ExpectQuery("SUM\\(CASE WHEN wrote").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(5))
	expectCurrentLevel(mock, "secret_lurk", 0)
	// unlocked → allrounder check: 2 progressive groups at level 2+ → below 5
	mock.ExpectQuery("achievement_type = 'progressive'").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(2))
	expectCurrentLevel(mock, "secret_allrounder", 0)

	e.HandleEvent(Event{UserID: "u1", Type: EventDailyVisit})
}

func TestHandleEvent_SecretShowerUnlock(t *testing.T) {
	e, mock := newEngine(t)

	mock.ExpectQuery("ROW_NUMBER\\(\\) OVER").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(1)) // streak 1 → no unlock
	expectCurrentLevel(mock, "daily_streak", 0)
	// 720 minutes in a day → unlock
	mock.ExpectQuery("MAX\\(total_minutes\\)").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(720))
	expectCurrentLevel(mock, "secret_shower", 0)
	expectExactUpsert(mock, "secret_shower", 1, 720)
	mock.ExpectQuery("SUM\\(CASE WHEN wrote").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(5))
	expectCurrentLevel(mock, "secret_lurk", 0)
	// unlocked → allrounder
	mock.ExpectQuery("achievement_type = 'progressive'").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(1))
	expectCurrentLevel(mock, "secret_allrounder", 0)

	e.HandleEvent(Event{UserID: "u1", Type: EventDailyVisit})
}

// ──────────────── sync / recompute ────────────────

func TestSync_CreatesMirror(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, testCatalog(t))

	mock.ExpectQuery("SELECT group_key, COALESCE\\(definition_hash").
		WillReturnRows(sqlmock.NewRows([]string{"group_key", "definition_hash"}))
	for range testCatalog(t).Groups() {
		mock.ExpectExec("INSERT INTO achievements").
			WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec("DELETE FROM user_achievements").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("DELETE FROM achievements").WillReturnResult(sqlmock.NewResult(1, 1))

	dirty, err := e.Sync(t.Context())
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(dirty) != 0 {
		t.Errorf("fresh catalog must not be dirty, got %v", dirty)
	}
}

func TestSync_DetectsDirty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, testCatalog(t))

	// entries exists with a stale hash → dirty
	mock.ExpectQuery("SELECT group_key, COALESCE\\(definition_hash").
		WillReturnRows(sqlmock.NewRows([]string{"group_key", "definition_hash"}).
			AddRow("entries", "stale-hash"))
	for range testCatalog(t).Groups() {
		mock.ExpectExec("INSERT INTO achievements").
			WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(),
				sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))
	}
	mock.ExpectExec("DELETE FROM user_achievements").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("DELETE FROM achievements").WillReturnResult(sqlmock.NewResult(1, 1))

	dirty, err := e.Sync(t.Context())
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if len(dirty) != 1 || dirty[0] != "entries" {
		t.Errorf("expected dirty=[entries], got %v", dirty)
	}
}

func TestGroupID_Deterministic(t *testing.T) {
	a := GroupID("entries")
	b := GroupID("entries")
	if a != b {
		t.Errorf("GroupID not deterministic: %s != %s", a, b)
	}
	if a == GroupID("comments") {
		t.Errorf("different keys share id %s", a)
	}
	if !strings.Contains(a, "-") {
		t.Errorf("expected UUID string, got %q", a)
	}
}

func TestRecomputeUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, testCatalog(t))

	// 8 groups in the catalog; give each a source/derived value and a level.
	// Keep it short: only entries (counter) and daily_streak (derived).
	// RecomputeUser iterates ALL groups, so stub every one.
	cat := testCatalog(t)
	values := map[string]int{
		"entries": 60, "avatar": 1, "daily_streak": 8, "session_time": 700,
		"secret_owl": 3, "secret_shower": 100, "secret_lurk": 2, "secret_allrounder": 1,
	}
	// Distinctive query fragments per group (matches sourceCountQueries /
	// derivedValueQueries) so a wrong expectation fails loudly.
	fragments := map[string]string{
		"entries":           "FROM threads t WHERE t.user_id",
		"avatar":            "avatar_url IS NOT NULL",
		"daily_streak":      "ROW_NUMBER",
		"session_time":      "total_minutes",
		"secret_owl":        "EXTRACT",
		"secret_shower":     "MAX",
		"secret_lurk":       "CASE WHEN wrote",
		"secret_allrounder": "achievement_type = 'progressive'",
	}
	for _, g := range cat.Groups() {
		v := values[g.Key]
		mock.ExpectQuery(fragments[g.Key]).WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(v))
		if g.Stat == StatCounter {
			mock.ExpectExec("INSERT INTO user_achievement_counters").
				WithArgs("u1", g.Key, v).WillReturnResult(sqlmock.NewResult(1, 1))
		}
		expectCurrentLevel(mock, g.Key, 0)
		lvl := g.LevelFor(v)
		if lvl > 0 {
			expectExactUpsert(mock, g.Key, lvl, v)
		}
	}

	e.RecomputeUser(t.Context(), "u1")
}
