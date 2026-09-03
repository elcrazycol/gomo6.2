package gamification

// Rarity is one rung of the gamification rarity ladder. The ladder is the
// extension point for UI colors: each rarity carries a color hint so the
// frontend can render badges without its own copy of the mapping.
type Rarity string

const (
	// RarityCommon is the starting rarity (gray).
	RarityCommon Rarity = "common"
	// RarityUnusual (green).
	RarityUnusual Rarity = "unusual"
	// RarityRare (blue).
	RarityRare Rarity = "rare"
	// RarityEpic (purple).
	RarityEpic Rarity = "epic"
	// RarityLegendary (orange-gold).
	RarityLegendary Rarity = "legendary"
	// RarityMythic (crimson).
	RarityMythic Rarity = "mythic"
	// RarityEternal (rainbow glow / white — the top of the ladder).
	RarityEternal Rarity = "eternal"
)

// RarityColor maps a rarity to a display color hint. `eternal` is special:
// the frontend renders it as a rainbow glow (white base), the other rarities
// are solid colors.
var RarityColor = map[Rarity]string{
	RarityCommon:    "#9ca3af", // gray
	RarityUnusual:   "#22c55e", // green
	RarityRare:      "#3b82f6", // blue
	RarityEpic:      "#a855f7", // purple
	RarityLegendary: "#f59e0b", // orange-gold
	RarityMythic:    "#e11d48", // crimson
	RarityEternal:   "#ffffff", // rainbow glow, white base
}

// rarityOrder is the canonical ladder from lowest to highest. It is the
// source of truth for iteration and upgrades; a Rarity is valid iff it is
// present here.
var rarityOrder = []Rarity{
	RarityCommon,
	RarityUnusual,
	RarityRare,
	RarityEpic,
	RarityLegendary,
	RarityMythic,
	RarityEternal,
}

// IsValid reports whether r is on the ladder.
func (r Rarity) IsValid() bool {
	for _, cand := range rarityOrder {
		if cand == r {
			return true
		}
	}
	return false
}

// Index returns r's position on the ladder (0-based) or -1 if invalid.
func (r Rarity) Index() int {
	for i, cand := range rarityOrder {
		if cand == r {
			return i
		}
	}
	return -1
}

// Next returns the next-higher rarity and true, or ("", false) when r is
// already the top (or invalid).
func (r Rarity) Next() (Rarity, bool) {
	i := r.Index()
	if i < 0 || i >= len(rarityOrder)-1 {
		return "", false
	}
	return rarityOrder[i+1], true
}

// AllRarities returns the ladder in order, lowest first. The returned slice
// is a copy; callers may not mutate the canonical ladder through it.
func AllRarities() []Rarity {
	out := make([]Rarity, len(rarityOrder))
	copy(out, rarityOrder)
	return out
}

// RarityColorFor returns the color hint for r, or "" if r is not on the
// ladder.
func RarityColorFor(r Rarity) string {
	return RarityColor[r]
}
