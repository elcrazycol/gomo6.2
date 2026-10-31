package achievements

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func claimTestCatalog(t *testing.T) *Catalog {
	t.Helper()
	cat, err := NewCatalog([]*Group{
		{
			Key: "qs_avatar", TitleKey: "t", Category: CategoryProfile,
			Icon: "smile", Kind: KindMilestone, Type: TypeOneTime, Stat: StatCounter, Track: TrackFirstSteps, SortOrder: 1,
			Levels: []Level{
				{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d",
					Rewards: []Reward{{Kind: RewardGems, Amount: 20}, {Kind: RewardDrops, Amount: 5}}},
			},
		},
	})
	if err != nil {
		t.Fatalf("claim catalog: %v", err)
	}
	return cat
}

func TestClaimLevel_GemsAndDrops(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, claimTestCatalog(t))

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT COALESCE\\(current_level").
		WithArgs("u1", GroupID("qs_avatar")).
		WillReturnRows(sqlmock.NewRows([]string{"current_level"}).AddRow(1))
	mock.ExpectQuery("INSERT INTO quest_claims").
		WithArgs("u1", GroupID("qs_avatar"), 1, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"ok"}).AddRow(true))
	mock.ExpectQuery("UPDATE users SET gems").
		WithArgs(20, "u1").WillReturnRows(sqlmock.NewRows([]string{"gems"}).AddRow(120))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 20, 120, "quest", "Quest reward: +20 gems").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("UPDATE users SET drops").
		WithArgs(5, "u1").WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(105))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 5, 105, "quest", "Quest reward: +5 drops").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	granted, err := e.ClaimLevel(t.Context(), "u1", "qs_avatar", 1)
	if err != nil {
		t.Fatalf("ClaimLevel: %v", err)
	}
	if len(granted) != 2 {
		t.Fatalf("expected 2 granted rewards, got %d", len(granted))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestClaimLevel_AlreadyClaimed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, claimTestCatalog(t))

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT COALESCE\\(current_level").
		WithArgs("u1", GroupID("qs_avatar")).
		WillReturnRows(sqlmock.NewRows([]string{"current_level"}).AddRow(1))
	// ON CONFLICT DO NOTHING → no RETURNING row.
	mock.ExpectQuery("INSERT INTO quest_claims").
		WithArgs("u1", GroupID("qs_avatar"), 1, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"ok"}))
	mock.ExpectRollback()

	if _, err := e.ClaimLevel(t.Context(), "u1", "qs_avatar", 1); !errors.Is(err, ErrQuestClaimed) {
		t.Fatalf("expected ErrQuestClaimed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestClaimLevel_NotCompleted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, claimTestCatalog(t))

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT COALESCE\\(current_level").
		WithArgs("u1", GroupID("qs_avatar")).
		WillReturnRows(sqlmock.NewRows([]string{"current_level"}))
	mock.ExpectRollback()

	if _, err := e.ClaimLevel(t.Context(), "u1", "qs_avatar", 1); !errors.Is(err, ErrQuestNotCompleted) {
		t.Fatalf("expected ErrQuestNotCompleted, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}

func TestClaimLevel_UnknownQuest(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	e := New(db, claimTestCatalog(t))
	if _, err := e.ClaimLevel(t.Context(), "u1", "nope", 1); !errors.Is(err, ErrQuestUnknown) {
		t.Fatalf("expected ErrQuestUnknown, got %v", err)
	}
}

// The full session the modal replays: non-empty trace ending with the
// opening, plus rarity and drops.
func TestPlayChestSession_StepsTrace(t *testing.T) {
	res, err := playChestSession("rarity_chest")
	if err != nil {
		t.Fatalf("play: %v", err)
	}
	if len(res.Steps) == 0 {
		t.Fatal("expected a non-empty step trace")
	}
	last := res.Steps[len(res.Steps)-1]
	if last.Type != "opened" {
		t.Fatalf("last step must open the chest, got %q", last.Type)
	}
	if res.Rarity == "" || res.Drops <= 0 {
		t.Fatalf("expected rarity + drops, got %+v", res)
	}
}

// sqlmock matches query text but never the driver arg count, so a dropped $N
// stays green in tests and explodes only against real Postgres (exactly the
// outage that motivated this tripwire).
func TestOpenChestQueries_PlaceholderCounts(t *testing.T) {
	highest := func(q string) int {
		top := 0
		for i := 1; ; i++ {
			if !strings.Contains(q, fmt.Sprintf("$%d", i)) {
				return top
			}
			top = i
		}
	}
	if got := highest(openChestLedgerQuery); got != 6 {
		t.Errorf("ledger: query has $%d but the call site passes 6 args", got)
	}
	// Concurrent opens must serialize on the row lock: without FOR UPDATE
	// two racing opens both see opened_at IS NULL and both credit.
	if !strings.Contains(fmt.Sprintf(openChestSelectQuery, "quest_chests"), "FOR UPDATE") {
		t.Errorf("select: concurrent opens must serialize with FOR UPDATE")
	}
}

// An opened chest reads as unknown (opened_at IS NULL filter): no double
// payout, whatever the client retries.
func TestOpenChest_AlreadyOpened(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	e := New(db, claimTestCatalog(t))

	mock.ExpectBegin()
	mock.ExpectQuery("SELECT mechanic FROM quest_chests").WithArgs("c1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"mechanic"}))
	mock.ExpectRollback()

	if _, err := e.OpenChest(t.Context(), "u1", "c1"); !errors.Is(err, ErrChestUnknown) {
		t.Fatalf("expected ErrChestUnknown, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
