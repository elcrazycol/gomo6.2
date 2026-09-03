package gamification

// Mechanic is the extension point of the engine. Each gamification type (the
// rarity chest today; wheels, scratch-cards, ... tomorrow) implements it and
// registers itself, after which the one-liner entry points Start/Tap work.
//
// A Mechanic must be pure: Start and Step do no I/O and keep no hidden
// mutable state. All session data flows through State.
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
