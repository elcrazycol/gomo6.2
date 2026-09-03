package gamification

import "fmt"

// RarityChestKey is the registry key of the built-in rarity upgrade chest.
const RarityChestKey = "rarity_chest"

// RarityChestConfig is the per-chest-type configuration. Everything is
// tunable without touching the mechanic logic: the rarity window the chest
// can span, the attempt budget per tier, and the per-tier upgrade chances.
// RarityChestConfig is the per-chest-type configuration. Everything is
// tunable without touching the mechanic logic: the rarity window the chest
// can span, the attempt budget per tier, and the per-tier upgrade chances.
// JSON tags mirror the API field naming so Describe() can be served straight
// to UI consumers.
type RarityChestConfig struct {
	// Key is the registry key for this chest type. Defaults to RarityChestKey.
	Key string `json:"key"`
	// StartRarity is the rarity a fresh chest starts at. Defaults to Common.
	StartRarity Rarity `json:"start_rarity"`
	// MaxRarity is the highest rarity this chest can reach. Reaching it
	// opens the chest immediately (top prize). Defaults to Eternal.
	MaxRarity Rarity `json:"max_rarity"`
	// AttemptsPerTier is how many taps the player gets at each rarity.
	// Defaults to 5.
	AttemptsPerTier int `json:"attempts_per_tier"`
	// UpgradeChances maps a rarity to the probability (0..1) that a tap at
	// that rarity upgrades it to the next one. It must cover every rarity
	// from StartRarity up to (but excluding) MaxRarity.
	UpgradeChances map[Rarity]float64 `json:"upgrade_chances"`
	// Gems is the per-rarity gem payout range when the chest opens at that
	// rarity. Optional and partial: missing rungs fall back to the default
	// table, and NewRarityChest fills the window so Describe() always serves
	// the complete drop table.
	Gems map[Rarity]GemsRange `json:"gems,omitempty"`
}

// DefaultRarityChestConfig returns the production config for the built-in
// rarity chest: Common → Eternal, 5 attempts per tier, and a deliberately
// hard-to-climb chance curve.
func DefaultRarityChestConfig() RarityChestConfig {
	return RarityChestConfig{
		Key:             RarityChestKey,
		StartRarity:     RarityCommon,
		MaxRarity:       RarityEternal,
		AttemptsPerTier: 5,
		UpgradeChances: map[Rarity]float64{
			RarityCommon:    0.60,
			RarityUnusual:   0.50,
			RarityRare:      0.35,
			RarityEpic:      0.20,
			RarityLegendary: 0.10,
			RarityMythic:    0.05,
		},
	}
}

// rarityChest implements the Mechanic: "tap = one attempt to raise the
// rarity". Success moves up one rung and resets the attempt budget; failure
// spends one attempt. When the budget runs out (or the top rarity is hit)
// the chest opens at its current rarity.
type rarityChest struct {
	cfg RarityChestConfig
}

// NewRarityChest builds the rarity-chest mechanic, filling defaults for any
// zero-valued config field.
func NewRarityChest(cfg RarityChestConfig) Mechanic {
	if cfg.Key == "" {
		cfg.Key = RarityChestKey
	}
	if cfg.StartRarity == "" {
		cfg.StartRarity = RarityCommon
	}
	if cfg.MaxRarity == "" {
		cfg.MaxRarity = RarityEternal
	}
	if cfg.AttemptsPerTier <= 0 {
		cfg.AttemptsPerTier = 5
	}
	// Fill the payout table for the window so the drop table is complete and
	// Describe()/GemsFor() never hit a missing rung.
	cfg.Gems = mergedGemsTable(cfg.Gems, cfg.StartRarity, cfg.MaxRarity)
	return &rarityChest{cfg: cfg}
}

// Key implements Mechanic.
func (c *rarityChest) Key() string { return c.cfg.Key }

// Start implements Mechanic: a fresh chest starts at StartRarity with the
// full attempt budget and is not yet opened.
func (c *rarityChest) Start() State {
	return State{
		MechanicKey:  c.cfg.Key,
		Rarity:       c.cfg.StartRarity,
		AttemptsLeft: c.cfg.AttemptsPerTier,
		Opened:       false,
	}
}

// Step implements Mechanic: one tap on the chest. See the type comment for
// the exact state machine. Invariant: once Opened, AttemptsLeft is 0.
func (c *rarityChest) Step(s State, src Source) (State, Event) {
	// Already finished: further taps are no-ops.
	if s.Opened {
		return s, Event{Type: EventOpened, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft, FinalRarity: s.FinalRarity}
	}

	if s.Rarity == c.cfg.MaxRarity {
		// Already at the chest's top rarity: nothing left to roll.
		s = c.open(s)
		return s, Event{Type: EventOpened, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft, FinalRarity: s.FinalRarity}
	}

	chance, ok := c.cfg.UpgradeChances[s.Rarity]
	if !ok {
		// Missing chance entry — treat as 0 (never upgrades). Validate()
		// normally rejects such configs, but a runtime-crafted State must
		// not panic.
		chance = 0
	}

	if src.Float64() < chance {
		// Success: move up one rung and refresh the attempt budget. If the
		// roll lands on the chest's top rarity, it opens right there — the
		// jackpot — instead of asking for more taps.
		next, _ := s.Rarity.Next()
		s.Rarity = next
		if next == c.cfg.MaxRarity {
			s = c.open(s)
			return s, Event{Type: EventOpened, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft, FinalRarity: s.FinalRarity}
		}
		s.AttemptsLeft = c.cfg.AttemptsPerTier
		return s, Event{Type: EventUpgraded, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft}
	}

	// Failure: spend one attempt; opening when the budget hits zero.
	s.AttemptsLeft--
	if s.AttemptsLeft <= 0 {
		s = c.open(s)
		return s, Event{Type: EventOpened, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft, FinalRarity: s.FinalRarity}
	}
	return s, Event{Type: EventFailed, Rarity: s.Rarity, AttemptsLeft: s.AttemptsLeft}
}

// open marks the state as finished at its current rarity. A finished chest
// carries no leftover attempt budget.
func (c *rarityChest) open(s State) State {
	s.Opened = true
	s.FinalRarity = s.Rarity
	s.AttemptsLeft = 0
	return s
}

// Validate implements Mechanic: config sanity checks so a typo'd chance table
// or window fails at startup, not in production.
func (c *rarityChest) Validate() error {
	if c.cfg.Key == "" {
		return fmt.Errorf("rarity_chest: key is empty")
	}
	if !c.cfg.StartRarity.IsValid() {
		return fmt.Errorf("rarity_chest: %s: invalid start rarity %q", c.cfg.Key, c.cfg.StartRarity)
	}
	if !c.cfg.MaxRarity.IsValid() {
		return fmt.Errorf("rarity_chest: %s: invalid max rarity %q", c.cfg.Key, c.cfg.MaxRarity)
	}
	if c.cfg.StartRarity.Index() > c.cfg.MaxRarity.Index() {
		return fmt.Errorf("rarity_chest: %s: start rarity %s is above max rarity %s", c.cfg.Key, c.cfg.StartRarity, c.cfg.MaxRarity)
	}
	if c.cfg.AttemptsPerTier <= 0 {
		return fmt.Errorf("rarity_chest: %s: attempts per tier must be positive", c.cfg.Key)
	}
	if c.cfg.UpgradeChances == nil {
		return fmt.Errorf("rarity_chest: %s: upgrade chances are not configured", c.cfg.Key)
	}
	// The chance table must cover every rung the chest can actually roll on:
	// from StartRarity up to, but excluding, MaxRarity.
	for i := c.cfg.StartRarity.Index(); i < c.cfg.MaxRarity.Index(); i++ {
		r := rarityOrder[i]
		chance, ok := c.cfg.UpgradeChances[r]
		if !ok {
			return fmt.Errorf("rarity_chest: %s: missing upgrade chance for %s", c.cfg.Key, r)
		}
		if chance < 0 || chance > 1 {
			return fmt.Errorf("rarity_chest: %s: upgrade chance for %s must be in [0,1], got %v", c.cfg.Key, r, chance)
		}
	}
	// The payout table may be partial only before NewRarityChest merged the
	// defaults — any rung that is present must be sane enough to roll.
	for i := c.cfg.StartRarity.Index(); i <= c.cfg.MaxRarity.Index(); i++ {
		r := rarityOrder[i]
		if g, ok := c.cfg.Gems[r]; ok && !g.Valid() {
			return fmt.Errorf("rarity_chest: %s: gems range for %s is invalid (min=%d max=%d)", c.cfg.Key, r, g.Min, g.Max)
		}
	}
	return nil
}

// Describe implements Describable: expose the static config so generic UI can
// render the rarity window, attempt budget and chance table.
func (c *rarityChest) Describe() any {
	return c.cfg
}

// ChanceFor implements ChanceProvider: the success probability of a tap at the
// state's current rarity. Returns ok=false when the state is opened, at the
// chest's top rarity, or on an unknown rarity (nothing to roll for).
func (c *rarityChest) ChanceFor(s State) (float64, bool) {
	if s.Opened {
		return 0, false
	}
	chance, ok := c.cfg.UpgradeChances[s.Rarity]
	return chance, ok
}

// GemsFor implements RewardProvider: the gem payout range for a chest that
// finished at rarity r. The table is complete for the chest's window (filled
// by NewRarityChest); anything outside it reports no payout.
func (c *rarityChest) GemsFor(r Rarity) (GemsRange, bool) {
	g, ok := c.cfg.Gems[r]
	if !ok || !g.Valid() {
		return GemsRange{}, false
	}
	return g, true
}

func init() {
	// Register the built-in chest so the one-liner works out of the box.
	// A second copy in a test or another init is rejected, which is fine —
	// first registration wins.
	if err := Register(NewRarityChest(DefaultRarityChestConfig())); err != nil {
		panic(err)
	}
}
