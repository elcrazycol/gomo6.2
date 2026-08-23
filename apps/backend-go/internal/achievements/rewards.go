package achievements

// Rewarder applies a non-garma reward when a level is reached. garma is
// formula-based (RecomputeUserProfileStats sums level rewards from the levels
// JSONB), so it needs no live Rewarder; new reward types (username color,
// title, badge, …) register one here and the engine calls it on unlock.
type Rewarder interface {
	Type() RewardType
	Apply(userID, value string)
}

var rewarders = map[RewardType]Rewarder{}

// RegisterRewarder makes the engine apply a reward type on unlock. Also
// registers the type for catalog validation.
func RegisterRewarder(r Rewarder) {
	if r == nil {
		return
	}
	RegisterRewardType(r.Type())
	rewarders[r.Type()] = r
}

// applyRewards runs the registered rewarder for a level's reward (if any).
// garma levels are a no-op here — the recompute formula accounts for them.
func (e *Engine) applyRewards(userID string, g *Group, lvl Level) {
	if lvl.RewardType == "" {
		return
	}
	r, ok := rewarders[RewardType(lvl.RewardType)]
	if !ok {
		// Registered types without a live rewarder (garma) are expected.
		return
	}
	e.logf("reward %s (%s) → %s", r.Type(), g.Key, userID)
	r.Apply(userID, lvl.RewardValue)
}
