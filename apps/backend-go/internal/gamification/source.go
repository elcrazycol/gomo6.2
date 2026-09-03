package gamification

// Source abstracts randomness so mechanics stay pure and tests deterministic.
// *rand.Rand satisfies it out of the box.
type Source interface {
	Float64() float64
}
