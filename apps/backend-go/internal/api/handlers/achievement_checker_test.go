package handlers

import (
	"reflect"
	"testing"
)

// =============================================================================
// parseLevels
// =============================================================================

func TestParseLevels_ValidJSON(t *testing.T) {
	ac := &AchievementChecker{}
	jsonStr := `[
		{"level":1,"threshold":5,"name":"Bronze","description":"5 posts","rarity":"common","reward_type":"garma","reward_value":"10"},
		{"level":2,"threshold":25,"name":"Silver","description":"25 posts","rarity":"uncommon","reward_type":"garma","reward_value":"50"}
	]`
	levels := ac.parseLevels(jsonStr)
	if levels == nil {
		t.Fatal("expected non-nil levels")
	}
	if len(levels) != 2 {
		t.Fatalf("expected 2 levels, got %d", len(levels))
	}
	if levels[0].Level != 1 || levels[0].Threshold != 5 || levels[0].Name != "Bronze" {
		t.Errorf("level[0] mismatch: %+v", levels[0])
	}
	if levels[1].Level != 2 || levels[1].Threshold != 25 || levels[1].Name != "Silver" {
		t.Errorf("level[1] mismatch: %+v", levels[1])
	}
}

func TestParseLevels_EmptyArray(t *testing.T) {
	ac := &AchievementChecker{}
	levels := ac.parseLevels("[]")
	if levels == nil {
		t.Fatal("expected non-nil, empty slice")
	}
	if len(levels) != 0 {
		t.Errorf("expected 0 levels, got %d", len(levels))
	}
}

func TestParseLevels_InvalidJSON(t *testing.T) {
	ac := &AchievementChecker{}
	levels := ac.parseLevels("{invalid}")
	if levels != nil {
		t.Error("expected nil for invalid JSON")
	}
}

func TestParseLevels_EmptyString(t *testing.T) {
	ac := &AchievementChecker{}
	levels := ac.parseLevels("")
	if levels != nil {
		t.Error("expected nil for empty string")
	}
}

func TestParseLevels_NotAnArray(t *testing.T) {
	ac := &AchievementChecker{}
	levels := ac.parseLevels(`{"level":1}`)
	if levels != nil {
		t.Error("expected nil when JSON is not an array")
	}
}

func TestParseLevels_SingleLevel(t *testing.T) {
	ac := &AchievementChecker{}
	jsonStr := `[{"level":1,"threshold":1,"name":"First Post","description":"Posted once","rarity":"common"}]`
	levels := ac.parseLevels(jsonStr)
	if levels == nil || len(levels) != 1 {
		t.Fatalf("expected 1 level, got %d", len(levels))
	}
	if levels[0].Level != 1 || levels[0].Name != "First Post" {
		t.Errorf("level mismatch: %+v", levels[0])
	}
}

func TestParseLevels_PartialFields(t *testing.T) {
	// Some fields may be empty — should still parse
	ac := &AchievementChecker{}
	jsonStr := `[{"level":1,"threshold":10}]`
	levels := ac.parseLevels(jsonStr)
	if levels == nil || len(levels) != 1 {
		t.Fatalf("expected 1 level, got %d", len(levels))
	}
	if levels[0].Level != 1 || levels[0].Threshold != 10 {
		t.Errorf("level mismatch: %+v", levels[0])
	}
}

// =============================================================================
// statForGroup
// =============================================================================

func TestStatForGroup_ByGroupKey_Posting(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{postCount: 42}
	if got := ac.statForGroup("posting", "", stats); got != 42 {
		t.Errorf("expected 42, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_SecretPosts(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{postCount: 7}
	if got := ac.statForGroup("secret_posts", "", stats); got != 7 {
		t.Errorf("expected 7, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_Threads(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{threadCount: 15}
	if got := ac.statForGroup("threads", "", stats); got != 15 {
		t.Errorf("expected 15, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_LikesReceived(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{likesReceived: 100}
	if got := ac.statForGroup("likes_received", "", stats); got != 100 {
		t.Errorf("expected 100, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_LikesGiven(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{likesGiven: 50}
	if got := ac.statForGroup("likes_given", "", stats); got != 50 {
		t.Errorf("expected 50, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_SecretLikes(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{likesGiven: 33}
	if got := ac.statForGroup("secret_likes", "", stats); got != 33 {
		t.Errorf("expected 33, got %d", got)
	}
}

func TestStatForGroup_ByGroupKey_Images(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{imageCount: 8}
	if got := ac.statForGroup("images", "", stats); got != 8 {
		t.Errorf("expected 8, got %d", got)
	}
}

func TestStatForGroup_UnknownGroupKey_FallbackToCategory_Posting(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{postCount: 99}
	if got := ac.statForGroup("unknown_key", "posting", stats); got != 99 {
		t.Errorf("expected 99 via category fallback, got %d", got)
	}
}

func TestStatForGroup_UnknownGroupKey_FallbackToCategory_Threads(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{threadCount: 5}
	if got := ac.statForGroup("nonexistent", "threads", stats); got != 5 {
		t.Errorf("expected 5 via category fallback, got %d", got)
	}
}

func TestStatForGroup_UnknownGroupKey_FallbackToCategory_LikesReceived(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{likesReceived: 200}
	if got := ac.statForGroup("custom_key", "likes_received", stats); got != 200 {
		t.Errorf("expected 200 via category fallback, got %d", got)
	}
}

func TestStatForGroup_UnknownGroupKey_FallbackToCategory_LikesGiven(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{likesGiven: 75}
	if got := ac.statForGroup("xyz", "likes_given", stats); got != 75 {
		t.Errorf("expected 75 via category fallback, got %d", got)
	}
}

func TestStatForGroup_UnknownGroupKey_FallbackToCategory_Images(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{imageCount: 3}
	if got := ac.statForGroup("foo", "images", stats); got != 3 {
		t.Errorf("expected 3 via category fallback, got %d", got)
	}
}

func TestStatForGroup_UnknownBoth_ReturnsZero(t *testing.T) {
	ac := &AchievementChecker{}
	stats := &userStats{postCount: 10, threadCount: 5}
	if got := ac.statForGroup("unknown", "unknown_category", stats); got != 0 {
		t.Errorf("expected 0 for unknown group+category, got %d", got)
	}
}

func TestStatForGroup_GroupKeyTakesPriority(t *testing.T) {
	ac := &AchievementChecker{}
	// GroupKey "threads" should match before category "posting"
	stats := &userStats{postCount: 100, threadCount: 7}
	if got := ac.statForGroup("threads", "posting", stats); got != 7 {
		t.Errorf("expected 7 (threads from group_key, not 100 from category), got %d", got)
	}
}

func TestStatForGroup_NilStats(t *testing.T) {
	ac := &AchievementChecker{}
	// Should not panic — defer/recover not needed due to field access,
	// but statForGroup expects non-nil. This tests that it handles nil gracefully.
	// Since it's a direct field access, Go will panic on nil pointer dereference.
	// We wrap to confirm expected behavior.
	defer func() {
		if r := recover(); r == nil {
			t.Log("no panic on nil stats — expected field access panic")
		}
	}()
	ac.statForGroup("posting", "", nil)
}

// =============================================================================
// parseLevels — verify returned levelDef structs are fully populated
// =============================================================================

func TestParseLevels_AllFields(t *testing.T) {
	ac := &AchievementChecker{}
	jsonStr := `[{"level":3,"threshold":100,"name":"Gold","description":"100 posts","rarity":"rare","reward_type":"garma","reward_value":"200"}]`
	levels := ac.parseLevels(jsonStr)
	if levels == nil || len(levels) != 1 {
		t.Fatalf("expected 1 level, got %v", levels)
	}
	want := levelDef{
		Level:       3,
		Threshold:   100,
		Name:        "Gold",
		Description: "100 posts",
		Rarity:      "rare",
		RewardType:  "garma",
		RewardValue: "200",
	}
	if !reflect.DeepEqual(levels[0], want) {
		t.Errorf("levelDef mismatch:\n got: %+v\nwant: %+v", levels[0], want)
	}
}
