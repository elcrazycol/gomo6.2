package gamification

import (
	"fmt"
	"sort"
)

// registry holds every registered mechanic by key. It is populated at
// startup (or via init in each mechanic file); nothing else mutates it.
var registry = map[string]Mechanic{}

// Register adds a mechanic to the registry, validating it first. Duplicate
// keys are rejected so a config error surfaces at registration time.
func Register(m Mechanic) error {
	if m == nil {
		return fmt.Errorf("gamification: nil mechanic")
	}
	if m.Key() == "" {
		return fmt.Errorf("gamification: mechanic key is empty")
	}
	if _, exists := registry[m.Key()]; exists {
		return fmt.Errorf("gamification: duplicate mechanic key %q", m.Key())
	}
	if err := m.Validate(); err != nil {
		return fmt.Errorf("gamification: %s: %w", m.Key(), err)
	}
	registry[m.Key()] = m
	return nil
}

// Lookup returns a registered mechanic by key.
func Lookup(key string) (Mechanic, bool) {
	m, ok := registry[key]
	return m, ok
}

// RegisteredKeys returns every registered mechanic key, sorted, so catalog
// surfaces can iterate the registry deterministically.
func RegisteredKeys() []string {
	keys := make([]string, 0, len(registry))
	for k := range registry {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// Start spawns a fresh session of the mechanic with the given key — the
// one-liner that "gives out a chest".
//
//	state, err := gamification.Start("rarity_chest")
func Start(key string) (State, error) {
	m, ok := registry[key]
	if !ok {
		return State{}, fmt.Errorf("gamification: unknown mechanic %q", key)
	}
	return m.Start(), nil
}

// Tap advances a session by one action — the one-liner that "taps a chest".
// The mechanic is resolved from the state itself, so the caller just passes
// the session along.
//
//	state, ev, err := gamification.Tap(state, rng)
func Tap(s State, src Source) (State, Event, error) {
	m, ok := registry[s.MechanicKey]
	if !ok {
		return s, Event{}, fmt.Errorf("gamification: state has unknown mechanic %q", s.MechanicKey)
	}
	next, ev := m.Step(s, src)
	return next, ev, nil
}
