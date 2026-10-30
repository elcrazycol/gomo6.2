package achievements

import "fmt"

// RewardKind identifies what a quest level grants on claim. The set is open:
// a new kind (fragments, exclusive cosmetics, titles, ...) is a new constant
// plus a branch in grantRewards — nothing else in the engine changes.
type RewardKind string

const (
	// RewardGems credits the paid currency (users.gems), granted by purchases
	// and by top quest levels.
	RewardGems RewardKind = "gems"
	// RewardDrops credits the soft earnable currency (users.drops) with a
	// ledger row (drops_transactions type 'quest_reward').
	RewardDrops RewardKind = "drops"
	// RewardChest grants a chest inventory row (quest_chests); opening it
	// plays a full gamification session server-side and credits the drops.
	RewardChest RewardKind = "chest"
)

// Reward is a single payout attached to a quest level. Amount applies to
// gems/drops; a chest uses Mechanic (default "rarity_chest" when empty).
type Reward struct {
	Kind     RewardKind `json:"kind"`
	Amount   int        `json:"amount,omitempty"`
	Mechanic string     `json:"mechanic,omitempty"`
}

// Validate checks a single reward entry.
func (r Reward) Validate(questKey string, level int) error {
	switch r.Kind {
	case RewardGems, RewardDrops:
		if r.Amount <= 0 {
			return fmt.Errorf("achievements: %s level %d: %s reward amount must be positive, got %d",
				questKey, level, r.Kind, r.Amount)
		}
	case RewardChest:
		// Mechanic emptiness means the default; unknown mechanics fail at
		// grant time, not at catalog validation (mechanics register in init).
	default:
		return fmt.Errorf("achievements: %s level %d: unknown reward kind %q",
			questKey, level, r.Kind)
	}
	return nil
}

// HasClaimable reports whether the level carries at least one reward.
func (l Level) HasClaimable() bool { return len(l.Rewards) > 0 }
