package achievements

import (
	"strings"
	"testing"
)

func TestDefaultCatalog_Valid(t *testing.T) {
	cat, err := Default()
	if err != nil {
		t.Fatalf("Default() error: %v", err)
	}
	if cat.Len() != 21 {
		t.Errorf("expected 21 groups, got %d", cat.Len())
	}

	seen := map[string]struct{}{}
	for _, g := range cat.Groups() {
		if _, dup := seen[g.Key]; dup {
			t.Errorf("duplicate group key %q", g.Key)
		}
		seen[g.Key] = struct{}{}
		if g.Stat != StatCounter && g.Stat != StatDerived {
			t.Errorf("group %s: bad stat %q", g.Key, g.Stat)
		}
	}
}

func TestDefaultCatalog_GroupCounts(t *testing.T) {
	cat, err := Default()
	if err != nil {
		t.Fatal(err)
	}
	var oneTime, progressive, hidden, derived int
	for _, g := range cat.Groups() {
		switch g.Type {
		case TypeOneTime:
			oneTime++
		case TypeProgressive:
			progressive++
		}
		if g.Hidden {
			hidden++
		}
		if g.Stat == StatDerived {
			derived++
		}
	}
	if oneTime != 14 {
		t.Errorf("expected 14 one_time groups, got %d", oneTime)
	}
	if progressive != 7 {
		t.Errorf("expected 7 progressive groups, got %d", progressive)
	}
	if hidden != 4 {
		t.Errorf("expected 4 hidden groups, got %d", hidden)
	}
	if derived != 6 {
		t.Errorf("expected 6 derived groups, got %d", derived)
	}
}

func TestLevelFor(t *testing.T) {
	g := &Group{Levels: []Level{
		{Level: 1, Threshold: 1},
		{Level: 2, Threshold: 50},
		{Level: 3, Threshold: 500},
	}}
	cases := []struct {
		value int
		want  int
	}{
		{0, 0}, {1, 1}, {49, 1}, {50, 2}, {499, 2}, {500, 3}, {100000, 3},
	}
	for _, c := range cases {
		if got := g.LevelFor(c.value); got != c.want {
			t.Errorf("LevelFor(%d) = %d, want %d", c.value, got, c.want)
		}
	}
}

func validGroup(key string) *Group {
	return &Group{
		Key: key, TitleKey: "achievements." + key + ".title", Category: CategoryContent,
		Icon: "star", Type: TypeProgressive, Stat: StatCounter, SortOrder: 1,
		Levels: []Level{
			{Level: 1, Threshold: 1, NameKey: "k1", DescriptionKey: "d1", Rarity: "common", RewardType: "garma", RewardValue: "10"},
			{Level: 2, Threshold: 10, NameKey: "k2", DescriptionKey: "d2", Rarity: "rare", RewardType: "garma", RewardValue: "50"},
		},
	}
}

func expectError(t *testing.T, g *Group, substr string) {
	t.Helper()
	if err := g.Validate(); err == nil {
		t.Fatalf("expected error containing %q, got nil", substr)
	} else if !strings.Contains(err.Error(), substr) {
		t.Fatalf("expected error containing %q, got %q", substr, err)
	}
}

func TestValidate_DuplicateKeys(t *testing.T) {
	a := validGroup("x")
	b := validGroup("x")
	if _, err := NewCatalog([]*Group{a, b}); err == nil {
		t.Fatal("expected duplicate key error")
	} else if !strings.Contains(err.Error(), "duplicate group key") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidate_EmptyLevels(t *testing.T) {
	g := validGroup("x")
	g.Levels = nil
	expectError(t, g, "no levels")
}

func TestValidate_NonContiguousLevels(t *testing.T) {
	g := validGroup("x")
	g.Levels[1].Level = 3 // 1, 3 instead of 1, 2
	expectError(t, g, "must be 1..N")
}

func TestValidate_NonIncreasingThresholds(t *testing.T) {
	g := validGroup("x")
	g.Levels[1].Threshold = 1 // not > 1
	expectError(t, g, "strictly increasing")
}

func TestValidate_ZeroThreshold(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].Threshold = 0
	expectError(t, g, "threshold must be positive")
}

func TestValidate_OneTimeMultiLevel(t *testing.T) {
	g := validGroup("x")
	g.Type = TypeOneTime
	expectError(t, g, "one_time must have exactly one level")
}

func TestValidate_OneTimeDerivedThreshold(t *testing.T) {
	// Derived one_time groups carry their real condition as the threshold
	// (e.g. secret_owl threshold=10) — that is valid.
	g := validGroup("x")
	g.Type = TypeOneTime
	g.Levels = []Level{{Level: 1, Threshold: 10, NameKey: "k", DescriptionKey: "d", Rarity: "common"}}
	if err := g.Validate(); err != nil {
		t.Fatalf("one_time with derived threshold should be valid, got: %v", err)
	}

	// Zero/negative threshold stays invalid.
	g.Levels[0].Threshold = 0
	expectError(t, g, "threshold must be positive")
}

func TestValidate_ProgressiveSingleLevel(t *testing.T) {
	g := validGroup("x")
	g.Levels = []Level{{Level: 1, Threshold: 1, NameKey: "k", DescriptionKey: "d", Rarity: "common"}}
	expectError(t, g, "progressive must have at least two levels")
}

func TestValidate_BadRarity(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].Rarity = "mythic"
	expectError(t, g, "invalid rarity")
}

func TestValidate_UnknownRewardType(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].RewardType = "fiat"
	expectError(t, g, "unknown reward type")
}

func TestValidate_EmptyNameKey(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].NameKey = ""
	expectError(t, g, "name/description keys are empty")
}

func TestValidate_BadCategory(t *testing.T) {
	g := validGroup("x")
	g.Category = "nowhere"
	expectError(t, g, "invalid category")
}

func TestValidate_EmptyIcon(t *testing.T) {
	g := validGroup("x")
	g.Icon = ""
	expectError(t, g, "icon is empty")
}

func TestValidate_RewardWithoutValue(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].RewardType = "garma"
	g.Levels[0].RewardValue = ""
	expectError(t, g, "reward \"garma\" without value")
}

func TestHash_Stable(t *testing.T) {
	a := validGroup("x")
	b := validGroup("x")
	ha, err := a.Hash()
	if err != nil {
		t.Fatal(err)
	}
	hb, err := b.Hash()
	if err != nil {
		t.Fatal(err)
	}
	if ha != hb {
		t.Errorf("hash not stable: %s != %s", ha, hb)
	}

	diff := validGroup("y")
	hd, _ := diff.Hash()
	if hd == ha {
		t.Errorf("different groups hash equal")
	}

	changed := validGroup("x")
	changed.Levels[0].RewardValue = "99"
	hc, _ := changed.Hash()
	if hc == ha {
		t.Errorf("definition change did not change hash")
	}
}

func TestRegisterRewardType(t *testing.T) {
	g := validGroup("x")
	g.Levels[0].RewardType = "trophy"
	expectError(t, g, "unknown reward type")

	RegisterRewardType("trophy")
	if err := g.Validate(); err != nil {
		t.Fatalf("expected registration to make reward valid, got: %v", err)
	}
}
