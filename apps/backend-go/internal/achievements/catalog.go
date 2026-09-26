// Package achievements defines the awards catalog — the single source of truth,
// in Go code — and validates it. The runtime engine uses this catalog: event-
// driven counters increment user_achievement_counters, levels are evaluated
// against thresholds, and hand-granted awards live in user_awards.
//
// Two kinds of entries:
//   - milestone (auto): a counter/derived/tenure metric with levels.
//   - award (manual): a single, hand-granted honour (contributor, legend, …).
//
// Design rules:
//   - The catalog lives in code for milestones and the starter awards. Awards
//     created by an admin live in the DB (origin = admin) and are NOT touched by
//     the code sync. The `achievements` table is the mirror the frontend reads.
//   - Names/descriptions are i18n keys (achievements.<key>.<level>.name …); the
//     frontend localizes them.
//   - Awards are NOT a currency: no garma, no rewards anywhere.
//   - Rarity is not a field — it is the computed share of owners.
//   - The messenger NEVER emits achievement events — private conversations are
//     out of scope by design.
package achievements

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

// Kind is the nature of a catalog entry.
type Kind string

const (
	// KindMilestone is an automatic, metric-driven achievement.
	KindMilestone Kind = "milestone"
	// KindAward is a hand-granted honour (never auto-unlocked).
	KindAward Kind = "award"
)

// Origin says who owns a catalog row. Code rows are managed by the Go sync;
// admin rows are created/edited through the admin API and survive the sync.
type Origin string

const (
	OriginCode  Origin = "code"
	OriginAdmin Origin = "admin"
)

// Type is the milestone progression model. Awards and tenure have no type.
type Type string

const (
	TypeOneTime     Type = "one_time"
	TypeProgressive Type = "progressive"
)

// Category groups entries on the UI.
type Category string

const (
	CategoryContent      Category = "content"
	CategoryCommunity    Category = "community"
	CategoryRetention    Category = "retention"
	CategoryProfile      Category = "profile"
	CategoryIntegrations Category = "integrations"
	CategoryGifts        Category = "gifts"
	CategoryAwards       Category = "awards" // hand-granted honours
)

// StatKind describes how the engine obtains a milestone's value.
type StatKind string

const (
	// StatCounter: event-driven values stored in user_achievement_counters.
	StatCounter StatKind = "counter"
	// StatDerived: computed from live data during (re)compute.
	StatDerived StatKind = "derived"
	// StatTenure: account age in days; a dynamic series with no fixed levels.
	StatTenure StatKind = "tenure"
)

var validCategories = map[Category]struct{}{
	CategoryContent:      {},
	CategoryCommunity:    {},
	CategoryRetention:    {},
	CategoryProfile:      {},
	CategoryIntegrations: {},
	CategoryGifts:        {},
	CategoryAwards:       {},
}

var validKinds = map[StatKind]struct{}{
	StatCounter: {},
	StatDerived: {},
	StatTenure:  {},
}

// Level is one step of a milestone. Names/descriptions are i18n keys.
type Level struct {
	Level          int    `json:"level"`
	Threshold      int    `json:"threshold"`
	NameKey        string `json:"name_key"`
	DescriptionKey string `json:"description_key"`
}

// Group is one catalog entry: a milestone or an award.
type Group struct {
	Key       string   `json:"key"`
	TitleKey  string   `json:"title_key"`
	Category  Category `json:"category"`
	Icon      string   `json:"icon"`
	Kind      Kind     `json:"kind"`
	Origin    Origin   `json:"origin"`
	SortOrder int      `json:"sort_order"`
	// Milestone fields.
	Type   Type     `json:"type,omitempty"`
	Stat   StatKind `json:"stat,omitempty"`
	Levels []Level  `json:"levels,omitempty"`
	// Award fields (manual).
	DescriptionKey string `json:"description_key,omitempty"`
	ImageURL       string `json:"image_url,omitempty"`
}

func (g *Group) kind() Kind {
	if g.Kind == "" {
		return KindMilestone
	}
	return g.Kind
}

func (g *Group) origin() Origin {
	if g.Origin == "" {
		return OriginCode
	}
	return g.Origin
}

// IsAward reports whether the group is hand-granted.
func (g *Group) IsAward() bool { return g.kind() == KindAward }

// IsCode reports whether the group is defined in Go (managed by the sync).
func (g *Group) IsCode() bool { return g.origin() == OriginCode }

// IsDynamic reports whether the group is a dynamic series (no fixed levels).
func (g *Group) IsDynamic() bool { return g.kind() == KindMilestone && g.Stat == StatTenure }

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
	if g.TitleKey == "" {
		return fmt.Errorf("achievements: %s: title key is empty", g.Key)
	}

	switch g.kind() {
	case KindAward:
		return g.validateAward()
	case KindMilestone:
		return g.validateMilestone()
	default:
		return fmt.Errorf("achievements: %s: invalid kind %q", g.Key, g.Kind)
	}
}

func (g *Group) validateAward() error {
	if len(g.Levels) != 0 {
		return fmt.Errorf("achievements: %s: award must not have levels", g.Key)
	}
	if g.Type != "" {
		return fmt.Errorf("achievements: %s: award must not have a type", g.Key)
	}
	if g.Stat != "" {
		return fmt.Errorf("achievements: %s: award must not have a stat", g.Key)
	}
	if g.DescriptionKey == "" {
		return fmt.Errorf("achievements: %s: award description key is empty", g.Key)
	}
	return nil
}

func (g *Group) validateMilestone() error {
	if _, ok := validKinds[g.Stat]; !ok {
		return fmt.Errorf("achievements: %s: invalid stat kind %q", g.Key, g.Stat)
	}
	if g.Stat == StatTenure {
		if len(g.Levels) != 0 {
			return fmt.Errorf("achievements: %s: tenure must not have fixed levels", g.Key)
		}
		return nil
	}
	if g.Type != TypeOneTime && g.Type != TypeProgressive {
		return fmt.Errorf("achievements: %s: invalid type %q", g.Key, g.Type)
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
	}
	return nil
}

// Catalog is the validated set of catalog entries.
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

// Groups returns the catalog groups in definition order.
func (c *Catalog) Groups() []*Group { return c.groups }

// Get returns a group by key.
func (c *Catalog) Get(key string) (*Group, bool) {
	g, ok := c.byKey[key]
	return g, ok
}

// Len returns the number of groups.
func (c *Catalog) Len() int { return len(c.groups) }

// LevelFor returns the highest qualifying level for a value (0 if none), for
// counter/derived milestones with fixed levels.
func (g *Group) LevelFor(value int) int {
	highest := 0
	for _, lvl := range g.Levels {
		if value >= lvl.Threshold && lvl.Level > highest {
			highest = lvl.Level
		}
	}
	return highest
}
