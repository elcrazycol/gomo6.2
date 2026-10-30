package achievements

import (
	"errors"
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
		WithArgs("u1", 20, 120, "Quest reward: +20 gems").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("UPDATE users SET drops").
		WithArgs(5, "u1").WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(105))
	mock.ExpectExec("INSERT INTO drops_transactions").
		WithArgs("u1", 5, 105, "Quest reward: +5 drops").
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
