package achievements

import (
	"database/sql/driver"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

// testCatalog covers every milestone stat kind plus one hand-granted award.
func testCatalog(t *testing.T) *Catalog {
	t.Helper()
	cat, err := NewCatalog([]*Group{
		{
			Key: "entries", TitleKey: "t.entries", Category: CategoryContent,
			Icon: "message-square", Kind: KindMilestone, Type: TypeProgressive, Stat: StatCounter, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "k1", DescriptionKey: "d1"},
				{Level: 2, Threshold: 10, NameKey: "k2", DescriptionKey: "d2"},
			},
		},
		{
			Key: "likes_received", TitleKey: "t.likes", Category: CategoryContent,
			Icon: "heart", Kind: KindMilestone, Type: TypeProgressive, Stat: StatCounter, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "l1", DescriptionKey: "ld1"},
				{Level: 2, Threshold: 10, NameKey: "l2", DescriptionKey: "ld2"},
			},
		},
		{
			Key: "resonance", TitleKey: "t.resonance", Category: CategoryContent,
			Icon: "flame", Kind: KindMilestone, Type: TypeProgressive, Stat: StatDerived, SortOrder: 3,
			Levels: []Level{
				{Level: 1, Threshold: 10, NameKey: "r1", DescriptionKey: "rd1"},
				{Level: 2, Threshold: 100, NameKey: "r2", DescriptionKey: "rd2"},
			},
		},
		{
			Key: "tenure", TitleKey: "t.tenure", Category: CategoryRetention,
			Icon: "calendar-check", Kind: KindMilestone, Stat: StatTenure, SortOrder: 4,
		},
		{
			Key: "award_ktitor", TitleKey: "t.ktitor", DescriptionKey: "t.ktitor.d",
			Category: CategoryAwards, Icon: "gem", Kind: KindAward, SortOrder: 5,
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

// expectDerivedQuery stubs a derived milestone query.
func expectDerivedQuery(mock sqlmock.Sqlmock, fragment, key string, value int) {
	mock.ExpectQuery(fragment).WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(value))
	expectCurrentLevel(mock, key, 0)
}

// ──────────────── counter events ────────────────

// An entry crosses threshold 1 → the counter is reconciled from live data and
// the level row upserted, then resonance is re-evaluated (no unlock here).
func TestHandleEvent_CounterUnlock(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "FROM threads t WHERE t.user_id", "entries", 1, 1)
	expectDerivedQuery(mock, "GREATEST", "resonance", 3)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

// 2 entries still level 1 → counter synced, no level write, resonance checked.
func TestHandleEvent_SameLevelNoUpsert(t *testing.T) {
	e, mock := newEngine(t)

	mock.ExpectQuery("FROM threads t WHERE t.user_id").
		WithArgs("u1").WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(2))
	mock.ExpectExec("INSERT INTO user_achievement_counters").
		WithArgs("u1", "entries", 2).WillReturnResult(sqlmock.NewResult(1, 1))
	expectCurrentLevel(mock, "entries", 1)
	expectDerivedQuery(mock, "GREATEST", "resonance", 3)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

// A received like reconciles likes_received and re-evaluates resonance; here it
// crosses the resonance threshold too.
func TestHandleEvent_LikeReceivedResonanceUnlock(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "FROM post_likes pl", "likes_received", 1, 1)
	// resonance crosses level 1 (threshold 10)
	mock.ExpectQuery("GREATEST").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(42))
	expectCurrentLevel(mock, "resonance", 0)
	expectExactUpsert(mock, "resonance", 1, 42)

	e.HandleEvent(Event{UserID: "u1", Type: EventLikeReceived})
}

// The counter reconciles to the LIVE value even when an earlier event was
// missed — the milestone never lags the real row count.
func TestHandleEvent_CounterSelfHeals(t *testing.T) {
	e, mock := newEngine(t)

	expectCounterReconcile(mock, "FROM threads t WHERE t.user_id", "entries", 5, 1)
	expectDerivedQuery(mock, "GREATEST", "resonance", 3)

	e.HandleEvent(Event{UserID: "u1", Type: EventEntryCreated})
}

func TestHandleEvent_UnknownTypeNoop(t *testing.T) {
	e, _ := newEngine(t)
	// No DB expectations registered: an unknown event must not touch the DB.
	e.HandleEvent(Event{UserID: "u1", Type: "totally_unknown"})
}

// ──────────────── tenure ────────────────

func TestHandleEvent_TenureOnDailyVisit(t *testing.T) {
	e, mock := newEngine(t)

	// 400 days on site → level 2 (1 year)
	mock.ExpectQuery("EXTRACT").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(400))
	expectCurrentLevel(mock, "tenure", 0)
	expectExactUpsert(mock, "tenure", 2, 400)

	e.HandleEvent(Event{UserID: "u1", Type: EventDailyVisit})
}

// ──────────────── sync / recompute ────────────────

// The mirror insert takes 12 args ($1…$12; $3 is used twice).
const mirrorArgs = 12

func mirrorArgValues() []driver.Value {
	args := make([]driver.Value, mirrorArgs)
	for i := range args {
		args[i] = sqlmock.AnyArg()
	}
	return args
}

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
		mock.ExpectExec("INSERT INTO achievements").WithArgs(mirrorArgValues()...).
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

	mock.ExpectQuery("SELECT group_key, COALESCE\\(definition_hash").
		WillReturnRows(sqlmock.NewRows([]string{"group_key", "definition_hash"}).
			AddRow("entries", "stale-hash"))
	for range testCatalog(t).Groups() {
		mock.ExpectExec("INSERT INTO achievements").WithArgs(mirrorArgValues()...).
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
	if a == GroupID("likes_received") {
		t.Errorf("different keys share id %s", a)
	}
	if !strings.Contains(a, "-") {
		t.Errorf("expected UUID string, got %q", a)
	}
}

// RecomputeUser iterates every milestone (awards are skipped) and reconciles
// each from live data.
func TestRecomputeUser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, testCatalog(t))

	values := map[string]int{
		"entries":        60,
		"likes_received": 5,
		"resonance":      700,
		"tenure":         400,
	}
	fragments := map[string]string{
		"entries":        "FROM threads t WHERE t.user_id",
		"likes_received": "FROM post_likes pl",
		"resonance":      "GREATEST",
		"tenure":         "EXTRACT",
	}
	for _, g := range testCatalog(t).Groups() {
		if g.IsAward() {
			continue // awards are hand-granted; recompute must not touch them
		}
		v := values[g.Key]
		mock.ExpectQuery(fragments[g.Key]).WithArgs("u1").
			WillReturnRows(sqlmock.NewRows([]string{"v"}).AddRow(v))
		if g.Stat == StatCounter {
			mock.ExpectExec("INSERT INTO user_achievement_counters").
				WithArgs("u1", g.Key, v).WillReturnResult(sqlmock.NewResult(1, 1))
		}
		expectCurrentLevel(mock, g.Key, 0)
		lvl := g.LevelFor(v)
		if g.IsDynamic() {
			lvl = tenureLevel(v)
		}
		if lvl > 0 {
			expectExactUpsert(mock, g.Key, lvl, v)
		}
	}

	e.RecomputeUser(t.Context(), "u1")
}
