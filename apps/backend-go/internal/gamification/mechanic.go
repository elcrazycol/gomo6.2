package gamification

// Mechanic is the extension point of the engine. Each gamification type (the
// rarity chest today; wheels, scratch-cards, ... tomorrow) implements it and
// registers itself, after which the one-liner entry points Start/Tap work.
//
// A Mechanic must be pure: Start and Step do no I/O and keep no hidden
// mutable state. All session data flows through State.
//
// Mechanics may additionally implement the optional Describable and
// ChanceProvider interfaces to expose static config / success chances to UI
// and API surfaces (the dev-dashboard playground uses both).
type Mechanic interface {
	// Key is the unique registry identifier, e.g. "rarity_chest".
	Key() string
	// Start returns the initial State for a fresh session of this mechanic.
	Start() State
	// Step advances one session by a single action using src for randomness
	// and returns the next State plus the Event describing the outcome.
	Step(s State, src Source) (State, Event)
	// Validate checks the mechanic's static configuration. It is called on
	// registration; a broken config must fail fast at startup.
	Validate() error
}

// Describable is an optional Mechanic capability: expose the mechanic's
// static configuration (rarity window, attempt budget, chance table) as a
// JSON-friendly value so generic UI can render it without duplicating config.
// Implemented by rarityChest.
type Describable interface {
	Describe() any
}

// ChanceProvider is an optional Mechanic capability: expose the success
// probability for the next step from a given state. UI uses it to display the
// current chance and to build deterministic "force" rolls.
type ChanceProvider interface {
	ChanceFor(s State) (float64, bool)
}

// RewardProvider is an optional Mechanic capability: expose the payout table
// for a finished session. RollRewards consults it when a chest opens, so a
// mechanic decides its own rewards (the rarity chest pays gems today; others
// may drop fragments or cosmetics later) without the engine knowing the kinds.
type RewardProvider interface {
	// GemsFor returns the gem payout range for a session finished at rarity r.
	GemsFor(r Rarity) (GemsRange, bool)
}
