package gamification

// Event is the outcome of one step (one tap on a chest). It tells the caller
// what happened so the UI can animate/notify accordingly.
type Event struct {
	// Type is the kind of outcome.
	Type EventType `json:"type"`
	// Rarity is the rarity of the session after the step.
	Rarity Rarity `json:"rarity"`
	// AttemptsLeft is the attempt budget after the step.
	AttemptsLeft int `json:"attempts_left"`
	// FinalRarity is set when the chest opened as a result of this step.
	FinalRarity Rarity `json:"final_rarity,omitempty"`
}

// EventType discriminates step outcomes.
type EventType string

const (
	// EventUpgraded: the tap raised the rarity; the attempt budget was reset.
	EventUpgraded EventType = "upgraded"
	// EventFailed: the tap consumed one attempt without raising rarity.
	EventFailed EventType = "failed"
	// EventOpened: the chest finished (attempts exhausted or top rarity
	// reached); FinalRarity is the outcome.
	EventOpened EventType = "opened"
)
