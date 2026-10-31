package achievements

import (
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func mustMarshal(t *testing.T, rs []Reward) string {
	t.Helper()
	b, err := json.Marshal(rs)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func TestDiffRewards(t *testing.T) {
	chest := Reward{Kind: RewardChest, Mechanic: "rarity_chest"}
	cases := []struct {
		name    string
		already []Reward
		current []Reward
		want    []Reward // nil = nothing owed
	}{
		{"no claim yet", nil, []Reward{{Kind: RewardDrops, Amount: 10}}, []Reward{{Kind: RewardDrops, Amount: 10}}},
		{"exact match", []Reward{{Kind: RewardDrops, Amount: 10}}, []Reward{{Kind: RewardDrops, Amount: 10}}, nil},
		{"drops grew", []Reward{{Kind: RewardDrops, Amount: 5}}, []Reward{{Kind: RewardDrops, Amount: 20}}, []Reward{{Kind: RewardDrops, Amount: 15}}},
		{"gems added", []Reward{{Kind: RewardDrops, Amount: 10}}, []Reward{{Kind: RewardDrops, Amount: 10}, {Kind: RewardGems, Amount: 5}}, []Reward{{Kind: RewardGems, Amount: 5}}},
		{"shrunk keeps old", []Reward{{Kind: RewardDrops, Amount: 50}}, []Reward{{Kind: RewardDrops, Amount: 10}}, nil},
		{"chest added", []Reward{{Kind: RewardDrops, Amount: 300}}, []Reward{{Kind: RewardDrops, Amount: 300}, chest}, []Reward{chest}},
		{"chest kept", []Reward{{Kind: RewardDrops, Amount: 300}, chest}, []Reward{{Kind: RewardDrops, Amount: 300}, chest}, nil},
		{"second chest added", []Reward{chest}, []Reward{chest, chest}, []Reward{chest}},
		{"chest removed keeps old", []Reward{{Kind: RewardDrops, Amount: 300}, chest}, []Reward{{Kind: RewardDrops, Amount: 300}}, nil},
	}
	for _, c := range cases {
		got := diffRewards(c.already, c.current)
		if len(got) != len(c.want) {
			t.Errorf("%s: diff len = %d, want %d (%v)", c.name, len(got), len(c.want), got)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("%s: diff[%d] = %+v, want %+v", c.name, i, got[i], c.want[i])
			}
		}
	}
}

func reconcileTestCatalog(t *testing.T) *Catalog {
	t.Helper()
	cat, err := NewCatalog([]*Group{
		{
			Key: "re_a", TitleKey: "t", Category: CategoryContent,
			Icon: "star", Kind: KindMilestone, Type: TypeProgressive, Stat: StatCounter, Track: TrackMain, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d", Rewards: []Reward{{Kind: RewardDrops, Amount: 10}}},
				{Level: 2, Threshold: 10, NameKey: "k", DescriptionKey: "d",
					Rewards: []Reward{{Kind: RewardDrops, Amount: 50}, {Kind: RewardGems, Amount: 5}, {Kind: RewardChest, Mechanic: "rarity_chest"}}},
			},
		},
		{
			Key: "re_b", TitleKey: "t", Category: CategoryContent,
			Icon: "star", Kind: KindMilestone, Type: TypeOneTime, Stat: StatCounter, Track: TrackMain, SortOrder: 2,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d", Rewards: []Reward{{Kind: RewardDrops, Amount: 10}}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	return cat
}

func TestReconcileUser_TopUp(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	// One transaction for the whole pass: lock, two bulk reads, then writes.
	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").
		WithArgs("achievements:reconcile:u1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM user_achievements WHERE user_id").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "current_level"}).
			AddRow(GroupID("re_a"), 2).
			AddRow(GroupID("re_b"), 1)) // completed but never claimed → skipped
	mock.ExpectQuery("FROM quest_claims WHERE user_id").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "level", "rewards", "topup_rewards"}).
			AddRow(GroupID("re_a"), 1, mustMarshal(t, []Reward{{Kind: RewardDrops, Amount: 5}}), "[]").
			AddRow(GroupID("re_a"), 2, mustMarshal(t, []Reward{{Kind: RewardDrops, Amount: 50}}), "[]"))

	// re_a level 1: completed, claimed 5 of the current 10 → top up 5.
	mock.ExpectQuery("UPDATE users SET drops").
		WithArgs(5, "u1").WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(105))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 5, 105, "quest_recalc", "Quest recalc: +5 drops").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE quest_claims SET topup_rewards").
		WithArgs(sqlmock.AnyArg(), "u1", GroupID("re_a"), 1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// re_a level 2: completed, claimed 50 drops (no gems/chest yet) → gems + chest.
	mock.ExpectQuery("UPDATE users SET gems").
		WithArgs(5, "u1").WillReturnRows(sqlmock.NewRows([]string{"gems"}).AddRow(10))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 5, 10, "quest_recalc", "Quest recalc: +5 gems").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("INSERT INTO quest_chests").
		WithArgs("u1", GroupID("re_a"), 2, "rarity_chest").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("00000000-0000-0000-0000-000000000001"))
	mock.ExpectExec("UPDATE quest_claims SET topup_rewards").
		WithArgs(sqlmock.AnyArg(), "u1", GroupID("re_a"), 2).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	topped, err := e.ReconcileUser(t.Context(), "u1")
	if err != nil {
		t.Fatalf("ReconcileUser: %v", err)
	}
	if len(topped) != 2 {
		t.Fatalf("expected 2 topped-up levels, got %d (%v)", len(topped), topped)
	}
	if topped[0].GroupKey != "re_a" || topped[0].Level != 1 || len(topped[0].Granted) != 1 {
		t.Errorf("unexpected first top-up: %+v", topped[0])
	}
	if topped[1].GroupKey != "re_a" || topped[1].Level != 2 || len(topped[1].Granted) != 2 {
		t.Errorf("unexpected second top-up: %+v", topped[1])
	}
	if topped[1].Granted[1].ChestID == "" {
		t.Errorf("chest top-up must report the chest id")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestReconcileUser_NothingOwed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	// Nothing owed: one transaction, lock, two bulk reads, then the deferred
	// rollback closes the tx without a commit.
	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").
		WithArgs("achievements:reconcile:u1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM user_achievements WHERE user_id").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "current_level"}).
			AddRow(GroupID("re_a"), 2).
			AddRow(GroupID("re_b"), 1))
	mock.ExpectQuery("FROM quest_claims WHERE user_id").
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "level", "rewards", "topup_rewards"}).
			AddRow(GroupID("re_a"), 1, mustMarshal(t, e.levelRewards("re_a", 1)), "[]").
			AddRow(GroupID("re_a"), 2, mustMarshal(t, e.levelRewards("re_a", 2)), "[]").
			AddRow(GroupID("re_b"), 1, mustMarshal(t, e.levelRewards("re_b", 1)), "[]"))
	mock.ExpectRollback()

	topped, err := e.ReconcileUser(t.Context(), "u1")
	if err != nil {
		t.Fatalf("ReconcileUser: %v", err)
	}
	if len(topped) != 0 {
		t.Errorf("expected no top-ups, got %v", topped)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

// Top-ups accumulate in topup_rewards while rewards keeps the original grant:
// a repeat pass diffs the catalog against their sum and grants nothing.
func TestReconcileUser_AccumulatesTopups(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, reconcileTestCatalog(t))

	base := mustMarshal(t, []Reward{{Kind: RewardDrops, Amount: 5}})
	firstTopup := mustMarshal(t, []Reward{{Kind: RewardDrops, Amount: 5}})

	// Pass 1: claimed 5 of 10 → top up 5, appended to topup_rewards.
	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").WithArgs("achievements:reconcile:u1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM user_achievements WHERE user_id").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "current_level"}).
			AddRow(GroupID("re_a"), 1))
	mock.ExpectQuery("FROM quest_claims WHERE user_id").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "level", "rewards", "topup_rewards"}).
			AddRow(GroupID("re_a"), 1, base, "[]"))
	mock.ExpectQuery("UPDATE users SET drops").WithArgs(5, "u1").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(105))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 5, 105, "quest_recalc", "Quest recalc: +5 drops").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE quest_claims SET topup_rewards").
		WithArgs(sqlmock.AnyArg(), "u1", GroupID("re_a"), 1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	// Pass 2: original 5 + top-up 5 = full 10 → nothing owed, no commit.
	mock.ExpectBegin()
	mock.ExpectExec("pg_advisory_xact_lock").WithArgs("achievements:reconcile:u1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM user_achievements WHERE user_id").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "current_level"}).
			AddRow(GroupID("re_a"), 1))
	mock.ExpectQuery("FROM quest_claims WHERE user_id").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"achievement_id", "level", "rewards", "topup_rewards"}).
			AddRow(GroupID("re_a"), 1, base, firstTopup))
	mock.ExpectRollback()

	first, err := e.ReconcileUser(t.Context(), "u1")
	if err != nil {
		t.Fatalf("pass 1: %v", err)
	}
	if len(first) != 1 || len(first[0].Granted) != 1 {
		t.Fatalf("pass 1: expected one 1-reward top-up, got %+v", first)
	}
	second, err := e.ReconcileUser(t.Context(), "u1")
	if err != nil {
		t.Fatalf("pass 2: %v", err)
	}
	if len(second) != 0 {
		t.Errorf("pass 2: expected no top-ups, got %+v", second)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
