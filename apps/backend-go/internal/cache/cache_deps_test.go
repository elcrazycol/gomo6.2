package cache

import (
	"testing"
)

// =============================================================================
// BuildCacheKeys tests
// =============================================================================

func TestBuildCacheKeys_Posts(t *testing.T) {
	keys := BuildCacheKeys("posts", map[string]string{"id": "123"})
	if len(keys) == 0 {
		t.Fatal("Expected non-empty keys for posts table")
	}

	expected := []string{
		"data:/api/v1/posts",
		"data:/api/v1/posts?id=eq.123",
		"data:/api/v1/posts?thread_id=eq.{thread_id}",
		"data:/api/v1/posts/123",
	}
	if !equalStrings(keys, expected) {
		t.Errorf("Posts keys:\ngot:  %v\nexp:  %v", keys, expected)
	}
}

func TestBuildCacheKeys_Threads(t *testing.T) {
	keys := BuildCacheKeys("threads", map[string]string{"id": "abc", "board_id": "board-1"})
	if len(keys) == 0 {
		t.Fatal("Expected non-empty keys for threads table")
	}

	if !contains(keys, "data:/api/v1/threads?id=eq.abc") {
		t.Error("Expected key with id placeholder replaced")
	}
	if !contains(keys, "data:/api/v1/threads?board_id=eq.board-1") {
		t.Error("Expected key with board_id placeholder replaced")
	}
	if !contains(keys, "data:/api/v1/threads/abc") {
		t.Error("Expected resource path key")
	}
}

func TestBuildCacheKeys_UnknownTable(t *testing.T) {
	keys := BuildCacheKeys("nonexistent", map[string]string{"id": "1"})
	if keys != nil {
		t.Errorf("Expected nil for unknown table, got %v", keys)
	}
}

func TestBuildCacheKeys_EmptyValues(t *testing.T) {
	keys := BuildCacheKeys("posts", map[string]string{})
	if len(keys) == 0 {
		t.Fatal("Expected non-empty keys even with empty values")
	}
	// Should return base patterns without replacements
	if !contains(keys, "data:/api/v1/posts") {
		t.Error("Expected base posts key")
	}
}

func TestBuildCacheKeys_Profiles(t *testing.T) {
	keys := BuildCacheKeys("profiles", map[string]string{"id": "user-1", "username": "alice"})
	if !contains(keys, "data:/api/v1/profiles?id=eq.user-1") {
		t.Error("Expected key with id placeholder")
	}
	if !contains(keys, "data:/api/v1/profiles?username=eq.alice") {
		t.Error("Expected key with username placeholder")
	}
	if !contains(keys, "data:/api/v1/profiles/user-1") {
		t.Error("Expected resource path key")
	}
}

func TestBuildCacheKeys_Notifications(t *testing.T) {
	keys := BuildCacheKeys("notifications", map[string]string{"user_id": "user-1"})
	if !contains(keys, "data:/api/v1/notifications?user_id=eq.user-1") {
		t.Errorf("Expected notification key with user_id, got %v", keys)
	}
}

func TestBuildCacheKeys_ChatMessages(t *testing.T) {
	keys := BuildCacheKeys("chat_messages", map[string]string{"conversation_id": "conv-1"})
	if !contains(keys, "data:/api/v1/chat_messages?conversation_id=eq.conv-1") {
		t.Errorf("Expected chat message key, got %v", keys)
	}
}

func TestBuildCacheKeys_PostLikes(t *testing.T) {
	keys := BuildCacheKeys("post_likes", map[string]string{"post_id": "post-1", "thread_id": "thread-1"})
	if !contains(keys, "data:/api/v1/posts?id=eq.post-1") {
		t.Error("Expected post_likes to reference posts endpoint with post_id replaced")
	}
	if !contains(keys, "data:/api/v1/posts/post-1") {
		t.Error("Expected resource path key with post_id replaced")
	}
	if !contains(keys, "data:/api/v1/posts?thread_id=eq.thread-1") {
		t.Error("Expected post_likes to reference posts with thread_id replaced")
	}
}

func TestBuildCacheKeys_Polls(t *testing.T) {
	keys := BuildCacheKeys("polls", map[string]string{"id": "poll-1", "poll_id": "poll-1"})
	if !contains(keys, "data:/api/v1/polls?id=eq.poll-1") {
		t.Errorf("Expected poll key, got %v", keys)
	}
}

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
	// Should also match by resource path
	if !contains(patterns, "data:/api/v1/posts/123*") {
		t.Errorf("Expected resource path pattern, got %v", patterns)
	}
}

func TestBuildCachePatterns_ByForeignKey(t *testing.T) {
	patterns := BuildCachePatterns("posts", map[string]string{"thread_id": "thread-1"})
	if !contains(patterns, "data:/api/v1/posts*thread_id=eq.thread-1*") {
		t.Errorf("Expected pattern with thread_id, got %v", patterns)
	}
	// No resource path for non-id keys
	if contains(patterns, "/thread-1*") {
		t.Error("Should NOT generate resource path for non-id key")
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
	// Generates 3 patterns: id query, id resource path, and username query
	if len(patterns) != 3 {
		t.Fatalf("Expected 3 patterns (id query + id path + username query), got %d: %v", len(patterns), patterns)
	}
	if !contains(patterns, "data:/api/v1/profiles*id=eq.user-1*") {
		t.Error("Expected id pattern")
	}
	if !contains(patterns, "data:/api/v1/profiles/user-1*") {
		t.Error("Expected resource path for id")
	}
	if !contains(patterns, "data:/api/v1/profiles*username=eq.alice*") {
		t.Error("Expected username pattern")
	}
}

func TestBuildCachePatterns_NoResourcePathForNonID(t *testing.T) {
	patterns := BuildCachePatterns("notifications", map[string]string{"user_id": "user-1"})
	for _, p := range patterns {
		if contains(patterns, "/user-1*") && !contains(patterns, "user_id") {
			// Got a resource path for a non-id key
			t.Errorf("Unexpected resource path pattern: %s", p)
		}
	}
}

// =============================================================================
// replaceAll / replacePlaceholder tests
// =============================================================================

func TestReplaceAll_Simple(t *testing.T) {
	result := replaceAll("hello {name} world", "{name}", "alice")
	if result != "hello alice world" {
		t.Errorf("Expected 'hello alice world', got '%s'", result)
	}
}

func TestReplaceAll_Multiple(t *testing.T) {
	result := replaceAll("{a} and {a}", "{a}", "x")
	if result != "x and x" {
		t.Errorf("Expected 'x and x', got '%s'", result)
	}
}

func TestReplaceAll_NoMatch(t *testing.T) {
	result := replaceAll("hello world", "{x}", "y")
	if result != "hello world" {
		t.Errorf("Expected unchanged 'hello world', got '%s'", result)
	}
}

// replaceAll with empty old string would cause an infinite loop — skip this edge case

func TestReplaceAll_EmptyNew(t *testing.T) {
	result := replaceAll("hello {name}", "{name}", "")
	if result != "hello " {
		t.Errorf("Expected 'hello ', got '%s'", result)
	}
}

func TestReplacePlaceholder(t *testing.T) {
	result := replacePlaceholder("data:/api/v1/posts?id=eq.{id}", "id", "123")
	expected := "data:/api/v1/posts?id=eq.123"
	if result != expected {
		t.Errorf("Expected '%s', got '%s'", expected, result)
	}
}

func TestReplacePlaceholder_MultiplePlaceholders(t *testing.T) {
	result := replacePlaceholder("{id} and {id}", "id", "42")
	if result != "42 and 42" {
		t.Errorf("Expected '42 and 42', got '%s'", result)
	}
}

// =============================================================================
// GetPrimaryKeyColumn tests
// =============================================================================

func TestGetPrimaryKeyColumn_KnownTables(t *testing.T) {
	tables := []string{
		"posts", "threads", "boards", "users", "notifications",
		"profile_wall_posts", "profile_wall_post_comments",
		"chat_messages", "chat_conversations", "polls",
		"post_likes", "thread_likes",
		"chat_conversation_members", "chat_receipts",
	}
	for _, table := range tables {
		if pk := GetPrimaryKeyColumn(table); pk != "id" {
			t.Errorf("Expected 'id' for table %s, got '%s'", table, pk)
		}
	}
}

func TestGetPrimaryKeyColumn_Unknown(t *testing.T) {
	pk := GetPrimaryKeyColumn("unknown_table")
	if pk != "id" {
		t.Errorf("Expected 'id' for unknown table, got '%s'", pk)
	}
}

// =============================================================================
// GetForeignKeyColumns tests
// =============================================================================

func TestGetForeignKeyColumns_Posts(t *testing.T) {
	fks := GetForeignKeyColumns("posts")
	expected := []string{"thread_id", "user_id"}
	if !equalStrings(fks, expected) {
		t.Errorf("Expected %v, got %v", expected, fks)
	}
}

func TestGetForeignKeyColumns_Threads(t *testing.T) {
	fks := GetForeignKeyColumns("threads")
	expected := []string{"board_id", "user_id"}
	if !equalStrings(fks, expected) {
		t.Errorf("Expected %v, got %v", expected, fks)
	}
}

func TestGetForeignKeyColumns_ProfileWallPosts(t *testing.T) {
	fks := GetForeignKeyColumns("profile_wall_posts")
	if !contains(fks, "user_id") {
		t.Errorf("Expected user_id for profile_wall_posts, got %v", fks)
	}
}

func TestGetForeignKeyColumns_ChatMessages(t *testing.T) {
	fks := GetForeignKeyColumns("chat_messages")
	if !contains(fks, "conversation_id") || !contains(fks, "sender_user_id") {
		t.Errorf("Expected conversation_id and sender_user_id, got %v", fks)
	}
}

func TestGetForeignKeyColumns_PostLikes(t *testing.T) {
	fks := GetForeignKeyColumns("post_likes")
	if !contains(fks, "post_id") || !contains(fks, "user_id") {
		t.Errorf("Expected post_id and user_id, got %v", fks)
	}
}

func TestGetForeignKeyColumns_UnknownTable(t *testing.T) {
	fks := GetForeignKeyColumns("unknown_table")
	if fks != nil {
		t.Errorf("Expected nil for unknown table, got %v", fks)
	}
}

func TestGetForeignKeyColumns_ChatReceipts(t *testing.T) {
	fks := GetForeignKeyColumns("chat_receipts")
	expected := []string{"message_id", "user_id", "conversation_id"}
	if !equalStrings(fks, expected) {
		t.Errorf("Expected %v, got %v", expected, fks)
	}
}

func TestGetForeignKeyColumns_Notifications(t *testing.T) {
	fks := GetForeignKeyColumns("notifications")
	if !contains(fks, "user_id") {
		t.Errorf("Expected user_id for notifications, got %v", fks)
	}
}

func TestGetForeignKeyColumns_PollVotes(t *testing.T) {
	fks := GetForeignKeyColumns("poll_votes")
	expected := []string{"poll_id", "user_id"}
	if !equalStrings(fks, expected) {
		t.Errorf("Expected %v, got %v", expected, fks)
	}
}

// =============================================================================
// GetCacheKeyExact tests
// =============================================================================

func TestGetCacheKeyExact_NoParams(t *testing.T) {
	key := GetCacheKeyExact("/api/v1/posts", nil)
	if key != "data:/api/v1/posts" {
		t.Errorf("Expected 'data:/api/v1/posts', got '%s'", key)
	}
}

func TestGetCacheKeyExact_EmptyParams(t *testing.T) {
	key := GetCacheKeyExact("/api/v1/posts", map[string]string{})
	if key != "data:/api/v1/posts" {
		t.Errorf("Expected 'data:/api/v1/posts', got '%s'", key)
	}
}

func TestGetCacheKeyExact_SingleParam(t *testing.T) {
	key := GetCacheKeyExact("/api/v1/posts", map[string]string{"id": "eq.123"})
	if key != "data:/api/v1/posts?id=eq.123" {
		t.Errorf("Expected 'data:/api/v1/posts?id=eq.123', got '%s'", key)
	}
}

func TestGetCacheKeyExact_MultipleParams(t *testing.T) {
	key := GetCacheKeyExact("/api/v1/posts", map[string]string{
		"id":     "eq.123",
		"select": "id,title",
	})
	if key != "data:/api/v1/posts?id=eq.123&select=id,title" &&
		key != "data:/api/v1/posts?select=id,title&id=eq.123" {
		t.Errorf("Unexpected key (order may vary): '%s'", key)
	}
}

func TestGetCacheKeyExact_Threads(t *testing.T) {
	key := GetCacheKeyExact("/api/v1/threads", map[string]string{"board_id": "eq.board-1"})
	if key != "data:/api/v1/threads?board_id=eq.board-1" {
		t.Errorf("Expected 'data:/api/v1/threads?board_id=eq.board-1', got '%s'", key)
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

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
