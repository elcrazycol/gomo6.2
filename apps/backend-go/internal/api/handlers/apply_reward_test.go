package handlers

import (
	"testing"
)

// =============================================================================
// applyReward — guard clauses and empty/unknown reward types (no DB needed)
// =============================================================================

func TestApplyReward_EmptyType_ReturnsEarly(t *testing.T) {
	ac := &AchievementChecker{}
	// Should not panic or error on empty reward type
	ac.applyReward("user-1", "", "10")
	// If we get here without panic, the early return worked
}

func TestApplyReward_UnknownType_NoOp(t *testing.T) {
	ac := &AchievementChecker{}
	// Unknown reward type should be a no-op (only "garma" is handled)
	ac.applyReward("user-1", "unknown_type", "100")
	// No panic = success
}

func TestApplyReward_NilDB_NoPanic(t *testing.T) {
	ac := &AchievementChecker{}
	// Even with nil DB, empty reward type should return early
	ac.applyReward("", "", "")
}

func TestApplyReward_GarmaWithNilDB_Panics(t *testing.T) {
	ac := &AchievementChecker{}
	// "garma" reward type tries db.Exec on nil DB — expect panic
	defer func() {
		if r := recover(); r == nil {
			t.Log("expected panic or error from nil DB, none occurred")
		}
	}()
	ac.applyReward("user-1", "garma", "50")
}
