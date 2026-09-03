package gamification

// State is the full snapshot of one gamification session (one chest in play).
// It is a plain value — mechanics never mutate it in place, Step returns a
// new State — so a caller can persist it, hand it to a handler, or put it in
// a cache without worrying about hidden internal state.
type State struct {
	// MechanicKey identifies which registered Mechanic owns this session.
	MechanicKey string `json:"mechanic_key"`
	// Rarity is the current rarity of the session.
	Rarity Rarity `json:"rarity"`
	// AttemptsLeft is how many attempts remain at the current rarity.
	AttemptsLeft int `json:"attempts_left"`
	// Opened is true once the chest is finished (no more steps allowed).
	Opened bool `json:"opened"`
	// FinalRarity is set when Opened becomes true.
	FinalRarity Rarity `json:"final_rarity,omitempty"`
}

// IsOpened reports whether the session is finished.
func (s State) IsOpened() bool { return s.Opened }
