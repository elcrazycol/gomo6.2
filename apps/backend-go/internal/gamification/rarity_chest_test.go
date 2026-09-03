package gamification

import "testing"

// stubSource returns a fixed roll every time, so tests are deterministic.
type stubSource struct{ v float64 }

func (s stubSource) Float64() float64 { return s.v }

// TestRarityLadder checks the canonical order and helpers.
func TestRarityLadder(t *testing.T) {
	want := []Rarity{
		RarityCommon, RarityUnusual, RarityRare, RarityEpic,
		RarityLegendary, RarityMythic, RarityEternal,
	}
	got := AllRarities()
	if len(got) != len(want) {
		t.Fatalf("AllRarities() = %d rungs, want %d", len(got), len(want))
	}
	for i, r := range want {
		if got[i] != r {
			t.Errorf("rung %d = %q, want %q", i, got[i], r)
		}
		if !r.IsValid() {
			t.Errorf("%q should be valid", r)
		}
		if r.Index() != i {
			t.Errorf("%q Index() = %d, want %d", r, r.Index(), i)
		}
		if color := RarityColorFor(r); color == "" {
			t.Errorf("%q has no color hint", r)
		}
	}
}

// TestRarityInvalidRungs ensures unknown rarities are rejected everywhere.
func TestRarityInvalidRungs(t *testing.T) {
	bad := Rarity("platinum")
	if bad.IsValid() {
		t.Error("unknown rarity should be invalid")
	}
	if bad.Index() != -1 {
		t.Errorf("unknown rarity Index() = %d, want -1", bad.Index())
	}
	if next, ok := bad.Next(); ok {
		t.Errorf("unknown rarity Next() = %q, want no next", next)
	}
	if color := RarityColorFor(bad); color != "" {
		t.Errorf("unknown rarity color = %q, want empty", color)
	}
}

// TestRarityNext walks the ladder from bottom to top.
func TestRarityNext(t *testing.T) {
	for i, r := range rarityOrder {
		next, ok := r.Next()
		if i == len(rarityOrder)-1 {
			if ok {
				t.Errorf("%q should have no next", r)
			}
			continue
		}
		if !ok {
			t.Fatalf("%q should have a next rarity", r)
		}
		if next != rarityOrder[i+1] {
			t.Errorf("%q Next() = %q, want %q", r, next, rarityOrder[i+1])
		}
	}
}

// TestStartDefaults checks that a fresh chest starts Common with the full
// attempt budget and is sealed.
func TestStartDefaults(t *testing.T) {
	s, err := Start(RarityChestKey)
	if err != nil {
		t.Fatalf("Start() error: %v", err)
	}
	if s.Rarity != RarityCommon {
		t.Errorf("start rarity = %q, want %q", s.Rarity, RarityCommon)
	}
	if s.AttemptsLeft != 5 {
		t.Errorf("attempts = %d, want 5", s.AttemptsLeft)
	}
	if s.Opened {
		t.Error("fresh chest should not be opened")
	}
	if s.IsOpened() {
		t.Error("IsOpened() should be false on a fresh chest")
	}
}

// TestStep_AllFailOpensAtStart walks 5 guaranteed failures: the chest must
// open at Common with zero attempts left.
func TestStep_AllFailOpensAtStart(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	s := c.Start()
	never := stubSource{v: 1} // 1 is never < any chance in [0,1]

	var ev Event
	for i := 0; i < 4; i++ {
		s, ev = c.Step(s, never)
		if ev.Type != EventFailed {
			t.Fatalf("tap %d: event = %q, want failed", i+1, ev.Type)
		}
		if s.Opened {
			t.Fatalf("tap %d: chest opened too early", i+1)
		}
		if s.AttemptsLeft != 5-(i+1) {
			t.Errorf("tap %d: attempts = %d, want %d", i+1, s.AttemptsLeft, 5-(i+1))
		}
	}

	s, ev = c.Step(s, never)
	if ev.Type != EventOpened {
		t.Fatalf("final tap: event = %q, want opened", ev.Type)
	}
	if !s.Opened {
		t.Fatal("chest should be opened")
	}
	if s.FinalRarity != RarityCommon {
		t.Errorf("final rarity = %q, want %q", s.FinalRarity, RarityCommon)
	}
	if s.AttemptsLeft != 0 {
		t.Errorf("attempts after open = %d, want 0", s.AttemptsLeft)
	}
}

// TestStep_AlwaysUpgradeToTop: guaranteed successes climb one rung per tap,
// resetting the budget each time, and reaching Eternal opens the chest.
func TestStep_AlwaysUpgradeToTop(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	s := c.Start()
	always := stubSource{v: 0} // 0 is always < any positive chance

	wantOrder := []Rarity{RarityUnusual, RarityRare, RarityEpic, RarityLegendary, RarityMythic, RarityEternal}
	for _, want := range wantOrder {
		// Burn down the budget a bit first — a success must reset it.
		s, _ = c.Step(s, stubSource{v: 1})
		if s.AttemptsLeft != 4 {
			t.Fatalf("pre-burn attempts = %d, want 4", s.AttemptsLeft)
		}

		var ev Event
		s, ev = c.Step(s, always)
		last := want == RarityEternal
		if last {
			// The chest opens right when Eternal is reached.
			if ev.Type != EventOpened {
				t.Fatalf("step to eternal: event = %q, want opened", ev.Type)
			}
		} else if ev.Type != EventUpgraded {
			t.Fatalf("step to %q: event = %q, want upgraded", want, ev.Type)
		}
		if s.Rarity != want {
			t.Fatalf("rarity after step = %q, want %q", s.Rarity, want)
		}
		if last {
			if s.AttemptsLeft != 0 {
				t.Errorf("attempts after open = %d, want 0", s.AttemptsLeft)
			}
		} else if s.AttemptsLeft != 5 {
			t.Errorf("attempts after success = %d, want 5", s.AttemptsLeft)
		}
	}

	if !s.Opened {
		t.Fatal("chest should open upon reaching Eternal")
	}
	if s.FinalRarity != RarityEternal {
		t.Errorf("final rarity = %q, want %q", s.FinalRarity, RarityEternal)
	}
}

// TestStep_OpenIsIdempotent: tapping an opened chest returns it unchanged
// with an opened event.
func TestStep_OpenIsIdempotent(t *testing.T) {
	c, _ := Lookup(RarityChestKey)
	s := c.Start()
	s, _ = c.Step(s, stubSource{v: 1})
	s, _ = c.Step(s, stubSource{v: 1})
	s, _ = c.Step(s, stubSource{v: 1})
	s, _ = c.Step(s, stubSource{v: 1})
	s, _ = c.Step(s, stubSource{v: 1})
	if !s.Opened {
		t.Fatal("setup: chest should be opened")
	}
	before := s
	after, ev := c.Step(s, stubSource{v: 0})
	if ev.Type != EventOpened {
		t.Errorf("tap on opened chest: event = %q, want opened", ev.Type)
	}
	if after != before {
		t.Error("tap on opened chest must not change state")
	}
}

// TestChestWindow: a custom chest with a narrower window (Common→Rare) opens
// at Rare instead of climbing toward Eternal.
func TestChestWindow(t *testing.T) {
	cfg := RarityChestConfig{
		Key:             "rarity_chest_small",
		StartRarity:     RarityCommon,
		MaxRarity:       RarityRare,
		AttemptsPerTier: 5,
		UpgradeChances: map[Rarity]float64{
			RarityCommon:  1,
			RarityUnusual: 1,
		},
	}
	c := NewRarityChest(cfg)
	if err := c.Validate(); err != nil {
		t.Fatalf("Validate() error: %v", err)
	}
	s := c.Start()
	always := stubSource{v: 0}
	s, ev := c.Step(s, always)
	if ev.Type != EventUpgraded {
		t.Fatalf("first step: %q, want upgraded", ev.Type)
	}
	s, ev = c.Step(s, always)
	if ev.Type != EventOpened {
		t.Fatalf("second step: %q, want opened (window top)", ev.Type)
	}
	if !s.Opened || s.FinalRarity != RarityRare {
		t.Errorf("final = opened=%v rarity=%q, want opened at rare", s.Opened, s.FinalRarity)
	}
}

// TestStartUnknownKey checks the registry error path.
func TestStartUnknownKey(t *testing.T) {
	if _, err := Start("no_such_chest"); err == nil {
		t.Fatal("Start() with unknown key should error")
	}
}

// TestTapUnknownKey checks Tap resolves the mechanic from the state.
func TestTapUnknownKey(t *testing.T) {
	s := State{MechanicKey: "no_such_chest", Rarity: RarityCommon}
	if _, _, err := Tap(s, stubSource{v: 0}); err == nil {
		t.Fatal("Tap() with unknown mechanic should error")
	}
}

// TestValidateRejectsBadConfigs table-tests the config invariants.
func TestValidateRejectsBadConfigs(t *testing.T) {
	good := RarityChestConfig{
		Key:             "rarity_chest_good",
		StartRarity:     RarityCommon,
		MaxRarity:       RarityLegendary,
		AttemptsPerTier: 5,
		UpgradeChances: map[Rarity]float64{
			RarityCommon: 0.5, RarityUnusual: 0.5, RarityRare: 0.5, RarityEpic: 0.5,
		},
	}

	cases := []struct {
		name string
		mut  func(*RarityChestConfig)
	}{
		// NB: an empty key cannot be tested here — NewRarityChest always fills
		// it from the default, so Validate sees a non-empty key.
		{"empty chances", func(c *RarityChestConfig) { c.UpgradeChances = nil }},
		{"missing rung", func(c *RarityChestConfig) { delete(c.UpgradeChances, RarityRare) }},
		{"chance out of range", func(c *RarityChestConfig) { c.UpgradeChances[RarityCommon] = 1.5 }},
		{"negative chance", func(c *RarityChestConfig) { c.UpgradeChances[RarityCommon] = -0.1 }},
		{"zero attempts", func(c *RarityChestConfig) { c.AttemptsPerTier = 0 }},
		{"start above max", func(c *RarityChestConfig) { c.StartRarity = RarityLegendary; c.MaxRarity = RarityRare }},
		{"start invalid", func(c *RarityChestConfig) { c.StartRarity = "platinum" }},
		{"max invalid", func(c *RarityChestConfig) { c.MaxRarity = "platinum" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := good
			cfg.UpgradeChances = map[Rarity]float64{
				RarityCommon: 0.5, RarityUnusual: 0.5, RarityRare: 0.5, RarityEpic: 0.5,
			}
			tc.mut(&cfg)
			// Validate directly on the raw mechanic, bypassing the constructor
			// (which would silently re-default mutated zero values).
			c := &rarityChest{cfg: cfg}
			if err := c.Validate(); err == nil {
				t.Error("Validate() should reject this config")
			}
		})
	} // Every mutation must have been applied to the fresh per-case copy, so the
	// original config stays valid.
	if err := NewRarityChest(good).Validate(); err != nil {
		t.Errorf("good config rejected: %v", err)
	}
}
