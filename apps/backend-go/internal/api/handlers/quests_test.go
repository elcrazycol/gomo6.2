package handlers

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

func questProgressRows() *sqlmock.Rows {
	levels, _ := json.Marshal([]achievements.Level{
		{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d",
			Rewards: []achievements.Reward{{Kind: achievements.RewardGems, Amount: 10}}},
	})
	claimed, _ := json.Marshal([]int{})
	return sqlmock.NewRows([]string{
		"group_key", "title", "category", "icon", "sort_order",
		"current_level", "progress_current", "levels", "claimed",
	}).AddRow("qs_avatar", "t", "profile", "smile", 1, 1, 1, string(levels), string(claimed))
}

func TestQuestsProgress_OwnerSeesCanClaim(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cat, err := achievements.NewCatalog([]*achievements.Group{
		{
			Key: "qs_avatar", TitleKey: "t", Category: achievements.CategoryProfile,
			Icon: "smile", Kind: achievements.KindMilestone, Type: achievements.TypeOneTime,
			Stat: achievements.StatCounter, Track: achievements.TrackFirstSteps, SortOrder: 1,
			Levels: []achievements.Level{
				{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d",
					Rewards: []achievements.Reward{{Kind: achievements.RewardGems, Amount: 10}}},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	h := NewQuestsHandler(db, achievements.New(db, cat))

	mock.ExpectQuery("FROM achievements a").WithArgs("u1").WillReturnRows(questProgressRows())
	mock.ExpectQuery("SELECT COALESCE\\(drops").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"drops"}).AddRow(30))
	mock.ExpectQuery("FROM quest_chests").WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "group_key", "level", "mechanic", "created_at", "opened_at"}))

	c, rec := testutil.NewGETContextWithClaims("/api/v1/quests/progress", nil, &auth.Claims{UserID: "u1"})
	h.GetProgress(c)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Data struct {
			Drops          int `json:"drops"`
			UnclaimedCount int `json:"unclaimed_count"`
			Quests         []struct {
				GroupKey string `json:"group_key"`
				Track    string `json:"track"`
				Levels   []struct {
					Completed bool `json:"completed"`
					Claimed   bool `json:"claimed"`
					CanClaim  bool `json:"can_claim"`
				} `json:"levels"`
			} `json:"quests"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Data.Drops != 30 || body.Data.UnclaimedCount != 1 {
		t.Errorf("unexpected payload: drops=%d unclaimed=%d", body.Data.Drops, body.Data.UnclaimedCount)
	}
	if len(body.Data.Quests) != 1 || body.Data.Quests[0].Track != "first_steps" {
		t.Fatalf("unexpected quests payload: %+v", body.Data.Quests)
	}
	lvl := body.Data.Quests[0].Levels[0]
	if !lvl.Completed || lvl.Claimed || !lvl.CanClaim {
		t.Errorf("expected completed+can_claim, got %+v", lvl)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled: %v", err)
	}
}
