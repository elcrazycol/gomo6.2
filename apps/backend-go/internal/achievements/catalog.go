// Package achievements defines the achievement catalog — the single source of
// truth, in Go code — and validates it. The runtime engine (later stage) uses
// this catalog: event-driven counters increment user_achievement_counters,
// levels are evaluated against thresholds, and rewards/notifications fire on
// unlock.
//
// Design rules:
//   - The catalog lives in code, not in DB seeds. The `achievements` table is
//     only a mirror synced from here at startup; change detection uses the
//     definition Hash() stored in achievements.definition_hash.
//   - Names/descriptions are i18n keys (achievements.<group>.<level>.name …);
//     the frontend localizes them.
//   - The messenger NEVER emits achievement events — private conversations are
//     out of scope by design.
//   - One-time achievements have exactly one level; progressive groups have
//     two or more levels with strictly increasing thresholds.
package achievements

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Type is the achievement progression model.
type Type string

const (
	TypeOneTime     Type = "one_time"
	TypeProgressive Type = "progressive"
)

// Category groups achievements on the UI (filters, secret bucket, …).
type Category string

const (
	CategoryContent      Category = "content"
	CategoryCommunity    Category = "community"
	CategoryRetention    Category = "retention"
	CategoryProfile      Category = "profile"
	CategoryIntegrations Category = "integrations"
	CategoryGifts        Category = "gifts"
	CategorySecret       Category = "secret"
)

// StatKind describes how the engine obtains the progress value of a group.
type StatKind string

const (
	// StatCounter: event-driven increments stored in user_achievement_counters.
	StatCounter StatKind = "counter"
	// StatDerived: computed from live data during recompute (streaks, session
	// time, secret conditions that cannot be a plain counter).
	StatDerived StatKind = "derived"
)

// RewardType is the reward a level grants. The registry is the extension point:
// adding a new reward type = RegisterRewardType + a Rewarder implementation in
// the engine. Only garma exists today.
type RewardType string

const (
	RewardGarma RewardType = "garma"
)

var registeredRewards = map[RewardType]struct{}{
	RewardGarma: {},
}

// RegisterRewardType adds a reward type so catalog validation accepts it.
func RegisterRewardType(rt RewardType) { registeredRewards[rt] = struct{}{} }

func isRegisteredReward(rt string) bool {
	if rt == "" {
		return true
	}
	_, ok := registeredRewards[RewardType(rt)]
	return ok
}

var validRarities = map[string]struct{}{
	"common":    {},
	"uncommon":  {},
	"rare":      {},
	"epic":      {},
	"legendary": {},
}

var validCategories = map[Category]struct{}{
	CategoryContent:      {},
	CategoryCommunity:    {},
	CategoryRetention:    {},
	CategoryProfile:      {},
	CategoryIntegrations: {},
	CategoryGifts:        {},
	CategorySecret:       {},
}

var validKinds = map[StatKind]struct{}{
	StatCounter: {},
	StatDerived: {},
}

// Level is one step of a group. Names/descriptions are i18n keys.
type Level struct {
	Level          int    `json:"level"`
	Threshold      int    `json:"threshold"`
	NameKey        string `json:"name_key"`
	DescriptionKey string `json:"description_key"`
	Rarity         string `json:"rarity"`
	RewardType     string `json:"reward_type,omitempty"`
	RewardValue    string `json:"reward_value,omitempty"`
}

// Group is one achievement group (e.g. "entries", "daily_streak").
type Group struct {
	Key       string   `json:"key"`
	TitleKey  string   `json:"title_key"`
	Category  Category `json:"category"`
	Icon      string   `json:"icon"`
	Type      Type     `json:"type"`
	Hidden    bool     `json:"hidden"`
	SortOrder int      `json:"sort_order"`
	Stat      StatKind `json:"stat"`
	Levels    []Level  `json:"levels"`
}

// Hash returns a stable definition hash used for change detection at startup
// (stored in achievements.definition_hash; compared to detect dirty groups).
func (g *Group) Hash() (string, error) {
	b, err := json.Marshal(g)
	if err != nil {
		return "", fmt.Errorf("achievements: hash %s: %w", g.Key, err)
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

// Validate checks a single group's invariants.
func (g *Group) Validate() error {
	if g.Key == "" {
		return fmt.Errorf("achievements: group key is empty")
	}
	if _, ok := validCategories[g.Category]; !ok {
		return fmt.Errorf("achievements: %s: invalid category %q", g.Key, g.Category)
	}
	if g.Icon == "" {
		return fmt.Errorf("achievements: %s: icon is empty", g.Key)
	}
	if g.Type != TypeOneTime && g.Type != TypeProgressive {
		return fmt.Errorf("achievements: %s: invalid type %q", g.Key, g.Type)
	}
	if _, ok := validKinds[g.Stat]; !ok {
		return fmt.Errorf("achievements: %s: invalid stat kind %q", g.Key, g.Stat)
	}
	if g.TitleKey == "" {
		return fmt.Errorf("achievements: %s: title key is empty", g.Key)
	}
	if len(g.Levels) == 0 {
		return fmt.Errorf("achievements: %s: no levels", g.Key)
	}
	if g.Type == TypeOneTime && len(g.Levels) != 1 {
		return fmt.Errorf("achievements: %s: one_time must have exactly one level, got %d", g.Key, len(g.Levels))
	}
	if g.Type == TypeProgressive && len(g.Levels) < 2 {
		return fmt.Errorf("achievements: %s: progressive must have at least two levels, got %d", g.Key, len(g.Levels))
	}
	for i, lvl := range g.Levels {
		if lvl.Level != i+1 {
			return fmt.Errorf("achievements: %s: levels must be 1..N in order, got level %d at index %d", g.Key, lvl.Level, i)
		}
		if i > 0 && lvl.Threshold <= g.Levels[i-1].Threshold {
			return fmt.Errorf("achievements: %s: thresholds must be strictly increasing (level %d threshold %d <= %d)",
				g.Key, lvl.Level, lvl.Threshold, g.Levels[i-1].Threshold)
		}
		if lvl.Threshold <= 0 {
			return fmt.Errorf("achievements: %s: level %d threshold must be positive, got %d", g.Key, lvl.Level, lvl.Threshold)
		}
		if lvl.NameKey == "" || lvl.DescriptionKey == "" {
			return fmt.Errorf("achievements: %s: level %d name/description keys are empty", g.Key, lvl.Level)
		}
		if _, ok := validRarities[lvl.Rarity]; !ok {
			return fmt.Errorf("achievements: %s: level %d: invalid rarity %q", g.Key, lvl.Level, lvl.Rarity)
		}
		if !isRegisteredReward(lvl.RewardType) {
			return fmt.Errorf("achievements: %s: level %d: unknown reward type %q", g.Key, lvl.Level, lvl.RewardType)
		}
		if lvl.RewardType != "" && lvl.RewardValue == "" {
			return fmt.Errorf("achievements: %s: level %d: reward %q without value", g.Key, lvl.Level, lvl.RewardType)
		}
	}
	// One-time: threshold is the unlock condition. For counter groups it is 1
	// (the action itself unlocks it); for derived groups it is the real metric
	// threshold (e.g. 10 night entries for secret_owl). Either way it must be
	// positive — already enforced above.
	return nil
}

// Catalog is the validated set of achievement groups.
type Catalog struct {
	groups []*Group
	byKey  map[string]*Group
}

// NewCatalog validates the groups and builds an immutable catalog.
func NewCatalog(groups []*Group) (*Catalog, error) {
	byKey := make(map[string]*Group, len(groups))
	for _, g := range groups {
		if err := g.Validate(); err != nil {
			return nil, err
		}
		if _, dup := byKey[g.Key]; dup {
			return nil, fmt.Errorf("achievements: duplicate group key %q", g.Key)
		}
		byKey[g.Key] = g
	}
	return &Catalog{groups: groups, byKey: byKey}, nil
}

// Groups returns the catalog groups in definition order (sort_order ascending
// is applied by the sync to the DB mirror).
func (c *Catalog) Groups() []*Group { return c.groups }

// Get returns a group by key.
func (c *Catalog) Get(key string) (*Group, bool) {
	g, ok := c.byKey[key]
	return g, ok
}

// Len returns the number of groups.
func (c *Catalog) Len() int { return len(c.groups) }

// LevelFor returns the highest qualifying level for a progress value
// (0 if none), for counter-based groups.
func (g *Group) LevelFor(value int) int {
	highest := 0
	for _, lvl := range g.Levels {
		if value >= lvl.Threshold && lvl.Level > highest {
			highest = lvl.Level
		}
	}
	return highest
}
