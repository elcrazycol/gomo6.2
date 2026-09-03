package gamification

import "testing"

// TestRollRewards_WithinRange rolls many payouts at every rarity and asserts
// the amount always lands inside the rarity's inclusive range.
func TestRollRewards_WithinRange(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	for _, final := range rarityOrder {
		rg := defaultGemsTable[final]
		lo, hi := rg.Min, rg.Max
		if hi < lo {
			t.Fatalf("%s: default range inverted (%d > %d)", final, lo, hi)
		}
		for i := 0; i < 200; i++ {
			roll := float64(i) / 200
			rewards := RollRewards(c, final, stubSource{v: roll})
			if len(rewards) != 1 {
				t.Fatalf("%s roll %v: got %d rewards, want 1", final, roll, len(rewards))
			}
			r := rewards[0]
			if r.Kind != RewardGems {
				t.Errorf("%s: reward kind = %q, want gems", final, r.Kind)
			}
			if r.Amount < lo || r.Amount > hi {
				t.Errorf("%s roll %v: amount = %d, want in [%d, %d]", final, roll, r.Amount, lo, hi)
			}
		}
	}
}

// TestRollRewards_ReachesBothEdges: rolls 0 and 1 must hit Min and Max exactly
// (the roll is inclusive at both ends).
func TestRollRewards_ReachesBothEdges(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	rg := defaultGemsTable[RarityMythic]
	if got := RollRewards(c, RarityMythic, stubSource{v: 0})[0].Amount; got != rg.Min {
		t.Errorf("roll 0 → %d, want min %d", got, rg.Min)
	}
	if got := RollRewards(c, RarityMythic, stubSource{v: 1})[0].Amount; got != rg.Max {
		t.Errorf("roll 1 → %d, want max %d", got, rg.Max)
	}
}

// TestRollRewards_NoProvider: a mechanic that is not a RewardProvider yields
// no rewards even when its session finishes.
func TestRollRewards_NoProvider(t *testing.T) {
	plain := &plainMechanic{key: "no_rewards"}
	if err := Register(plain); err != nil {
		t.Fatalf("register: %v", err)
	}
	if rewards := RollRewards(plain, RarityEternal, stubSource{v: 0}); len(rewards) != 0 {
		t.Errorf("no-provider mechanic rolled %d rewards, want none", len(rewards))
	}
}

// TestRollRewards_DegenerateInputs: nil mechanics/sources and invalid rarities
// must degrade to no payout, never a panic.
func TestRollRewards_DegenerateInputs(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	if rewards := RollRewards(nil, RarityCommon, stubSource{v: 0}); rewards != nil {
		t.Errorf("nil mechanic rolled %v, want nil", rewards)
	}
	if rewards := RollRewards(c, RarityCommon, nil); rewards != nil {
		t.Errorf("nil source rolled %v, want nil", rewards)
	}
	if rewards := RollRewards(c, Rarity("platinum"), stubSource{v: 0}); rewards != nil {
		t.Errorf("invalid rarity rolled %v, want nil", rewards)
	}
}

// TestGemsTableMerge_OverridesOnlyConfig: NewRarityChest must fill the window
// with defaults while honoring per-rarity overrides, and cap the window at the
// chest's max rarity.
func TestGemsTableMerge_OverridesOnlyConfig(t *testing.T) {
	cfg := RarityChestConfig{
		Key:             "rarity_chest_tuned",
		StartRarity:     RarityCommon,
		MaxRarity:       RarityRare,
		AttemptsPerTier: 5,
		UpgradeChances: map[Rarity]float64{
			RarityCommon: 0.5, RarityUnusual: 0.5,
		},
		Gems: map[Rarity]GemsRange{
			RarityRare: {Min: 1000, Max: 2000},
		},
	}
	c := NewRarityChest(cfg).(*rarityChest)

	if got := c.cfg.Gems[RarityCommon]; got != defaultGemsTable[RarityCommon] {
		t.Errorf("common gems = %+v, want default %+v", got, defaultGemsTable[RarityCommon])
	}
	wantRare := GemsRange{Min: 1000, Max: 2000}
	if got := c.cfg.Gems[RarityRare]; got != wantRare {
		t.Errorf("rare gems = %+v, want override %+v", got, wantRare)
	}
	if _, beyond := c.cfg.Gems[RarityEpic]; beyond {
		t.Error("table must not extend past the chest's max rarity")
	}
	if g, ok := c.GemsFor(RarityRare); !ok || g != wantRare {
		t.Errorf("GemsFor(rare) = %+v ok=%v, want %+v", g, ok, wantRare)
	}
	// Rolled payout honors the override, not the default.
	if got := RollRewards(c, RarityRare, stubSource{v: 1})[0].Amount; got != 2000 {
		t.Errorf("rare roll 1 → %d, want override max 2000", got)
	}
}

// plainMechanic is a minimal Mechanic without reward capabilities, for tests
// that need a registered non-reward mechanic.
type plainMechanic struct{ key string }

func (p *plainMechanic) Key() string  { return p.key }
func (p *plainMechanic) Start() State { return State{} }
func (p *plainMechanic) Step(s State, _ Source) (State, Event) {
	return s, Event{Type: EventOpened, Rarity: s.Rarity, FinalRarity: s.Rarity}
}
func (p *plainMechanic) Validate() error { return nil }
