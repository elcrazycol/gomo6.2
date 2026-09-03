package gamification

// RewardKind identifies the type of a chest payout. The set is open: a new
// kind (fragments, exclusive cosmetics, ...) is a new constant plus a table
// entry in the mechanic — nothing else in the engine changes.
type RewardKind string

const (
	// RewardGems is the free premium currency granted when a chest opens. It
	// is a second, earnable currency next to drops (paid); the wallet and
	// ledger live outside the engine and are the caller's responsibility.
	RewardGems RewardKind = "gems"
)

// Reward is a single payout produced when a chest session finishes (opens).
// The engine stays pure: it reports what dropped, crediting is the caller's
// job (a nil crediter simply means the reward is announced but not granted).
type Reward struct {
	Kind   RewardKind `json:"kind"`
	Amount int        `json:"amount"`
}

// GemsRange is the min/max gems a chest finishing at one rarity pays out. The
// roll is uniform over the inclusive range.
type GemsRange struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

// Valid reports whether the range is sane enough to roll.
func (g GemsRange) Valid() bool { return g.Min >= 0 && g.Max >= g.Min }

// defaultGemsTable is the built-in payout table for the rarity ladder. Amounts
// grow steeply so an Eternal jackpot feels once-in-a-forever, yet stay bounded:
// this currency feeds a cosmetics shop, so a single open must never print the
// whole catalog (compare: 100-day streak milestone grants 1500).
var defaultGemsTable = map[Rarity]GemsRange{
	RarityCommon:    {Min: 15, Max: 30},
	RarityUnusual:   {Min: 30, Max: 55},
	RarityRare:      {Min: 55, Max: 95},
	RarityEpic:      {Min: 95, Max: 160},
	RarityLegendary: {Min: 160, Max: 280},
	RarityMythic:    {Min: 280, Max: 500},
	RarityEternal:   {Min: 700, Max: 1500},
}

// mergedGemsTable builds the effective payout table for the rarities a chest
// can actually finish at (its start..max window): the default range for every
// rung, overridden by any entry the config provides. A nil overrides map
// yields the plain defaults; a partial map tunes single rarities.
func mergedGemsTable(overrides map[Rarity]GemsRange, start, max Rarity) map[Rarity]GemsRange {
	out := make(map[Rarity]GemsRange)
	for i := start.Index(); i <= max.Index(); i++ {
		r := rarityOrder[i]
		if g, ok := overrides[r]; ok {
			out[r] = g
		} else {
			out[r] = defaultGemsTable[r]
		}
	}
	return out
}

// RollRewards rolls the payout of a finished session. Mechanics without a
// reward table (any non-rarity mechanic today) yield no rewards. The roll is
// uniform over the final rarity's range, inclusive at both ends; a nil source
// or a broken range degrades to no payout rather than a panic.
func RollRewards(m Mechanic, final Rarity, src Source) []Reward {
	if m == nil || src == nil || !final.IsValid() {
		return nil
	}
	rp, ok := m.(RewardProvider)
	if !ok {
		return nil
	}
	rg, ok := rp.GemsFor(final)
	if !ok || !rg.Valid() {
		return nil
	}

	amount := rg.Min
	if span := rg.Max - rg.Min; span > 0 {
		amount += int(src.Float64() * float64(span+1))
	}
	if amount > rg.Max {
		amount = rg.Max
	}
	return []Reward{{Kind: RewardGems, Amount: amount}}
}
