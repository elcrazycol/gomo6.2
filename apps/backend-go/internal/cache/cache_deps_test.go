package cache

import (
	"testing"
)

// =============================================================================
// BuildCachePatterns tests
// =============================================================================

func TestBuildCachePatterns_ByID(t *testing.T) {
	patterns := BuildCachePatterns("posts", map[string]string{"id": "123"})
	if len(patterns) == 0 {
		t.Fatal("Expected non-empty patterns")
	}

	// Should match any query with id=eq.123
	if !contains(patterns, "data:/api/v1/posts*id=eq.123*") {
		t.Errorf("Expected pattern with id=eq.123, got %v", patterns)
	}
	// Should also match by resource path (now uses ?* boundary for precision)
	if !contains(patterns, "data:/api/v1/posts/123?*") {
		t.Errorf("Expected resource path pattern, got %v", patterns)
	}
}

func TestBuildCachePatterns_ByForeignKey(t *testing.T) {
	patterns := BuildCachePatterns("posts", map[string]string{"thread_id": "thread-1"})
	if !contains(patterns, "data:/api/v1/posts*thread_id=eq.thread-1*") {
		t.Errorf("Expected pattern with thread_id, got %v", patterns)
	}
	// All keys now get a resource path pattern for invalidation by URL path
	if !contains(patterns, "data:/api/v1/posts/thread-1?*") {
		t.Errorf("Expected resource path pattern for thread_id, got %v", patterns)
	}
}

func TestBuildCachePatterns_EmptyValues(t *testing.T) {
	patterns := BuildCachePatterns("posts", map[string]string{})
	if len(patterns) != 2 {
		t.Fatalf("Expected 2 patterns for empty values (full table flush), got %d: %v", len(patterns), patterns)
	}
	if !contains(patterns, "data:/api/v1/posts?*") {
		t.Error("Expected wildcard query pattern")
	}
	if !contains(patterns, "data:/api/v1/posts/*") {
		t.Error("Expected wildcard path pattern")
	}
}

func TestBuildCachePatterns_EmptyValueForKey(t *testing.T) {
	patterns := BuildCachePatterns("boards", map[string]string{"slug": ""})
	if len(patterns) != 0 {
		t.Errorf("Expected 0 patterns for empty value, got %d: %v", len(patterns), patterns)
	}
}

func TestBuildCachePatterns_MultipleValues(t *testing.T) {
	patterns := BuildCachePatterns("profiles", map[string]string{"id": "user-1", "username": "alice"})
	// Generates 4 patterns: id query, id path, username query, username path
	if len(patterns) != 4 {
		t.Fatalf("Expected 4 patterns (id query + id path + username query + username path), got %d: %v", len(patterns), patterns)
	}
	if !contains(patterns, "data:/api/v1/profiles*id=eq.user-1*") {
		t.Error("Expected id pattern")
	}
	if !contains(patterns, "data:/api/v1/profiles/user-1?*") {
		t.Error("Expected resource path for id")
	}
	if !contains(patterns, "data:/api/v1/profiles*username=eq.alice*") {
		t.Error("Expected username pattern")
	}
	if !contains(patterns, "data:/api/v1/profiles/alice?*") {
		t.Error("Expected resource path for username")
	}
}

func TestBuildCachePatterns_NoResourcePathForNonID(t *testing.T) {
	// After the fix, all keys generate resource path patterns.
	// Verify that user_id generates a path pattern (not just query pattern).
	patterns := BuildCachePatterns("notifications", map[string]string{"user_id": "user-1"})
	if !contains(patterns, "data:/api/v1/notifications*user_id=eq.user-1*") {
		t.Error("Expected query pattern for user_id")
	}
	if !contains(patterns, "data:/api/v1/notifications/user-1?*") {
		t.Error("Expected resource path pattern for user_id")
	}
}

// =============================================================================
// helpers
// =============================================================================

func contains(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}
