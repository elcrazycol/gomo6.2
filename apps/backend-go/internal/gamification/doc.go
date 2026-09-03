// Package gamification is a modular engine for game-like mechanics (chests,
// rarity ladders, and whatever comes next). It is deliberately small,
// dependency-free and pure:
//
//   - Rarity is a closed 7-step ladder (Common → Eternal), each step carrying
//     a color hint for future UI work.
//
//   - A Mechanic implements one game type. It is pure: Start() builds the
//     initial State, Step(state, source) advances it by one player action
//     using an injected randomness Source. No I/O, no globals, no timers —
//     a State is a plain value a caller can store and restore freely.
//
//   - The registry maps mechanic keys to implementations and exposes the
//     one-liner entry points:
//
//     state, err := gamification.Start("rarity_chest") // give out a chest
//     state, ev, err := gamification.Tap(state, rng)   // one tap
//
// Adding a new game type = implement Mechanic, call Register, done. Rewards
// are not granted yet: RewardSpec values ride along on the open Event so the
// caller decides how to apply them (gems, cosmetics, drops, ...). Unlock a
// reward kind for config validation with RegisterRewardType.
package gamification
