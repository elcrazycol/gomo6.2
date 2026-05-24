package cache

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// =============================================================================
// newTestRedis creates a miniredis server for testing.
// =============================================================================

func newTestRedis(t *testing.T) (*redis.Client, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("Failed to start miniredis: %v", err)
	}
	client := redis.NewClient(&redis.Options{
		Addr: mr.Addr(),
	})
	t.Cleanup(func() {
		client.Close()
		mr.Close()
	})
	return client, mr
}

// =============================================================================
// NewInvalidator tests
// =============================================================================

func TestNewInvalidator(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)
	if inv == nil {
		t.Fatal("Expected non-nil Invalidator")
	}
	if inv.redis != client {
		t.Error("Invalidator should store the redis client")
	}
}

func TestNewInvalidator_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if inv == nil {
		t.Fatal("Expected non-nil Invalidator even with nil redis")
	}
}

// =============================================================================
// InvalidateKeys tests
// =============================================================================

func TestInvalidateKeys_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateKeys("key1", "key2"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateKeys_EmptyKeys(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)

	if err := inv.InvalidateKeys(); err != nil {
		t.Errorf("Expected nil error for empty keys, got: %v", err)
	}
}

func TestInvalidateKeys_AllEmpty(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)

	if err := inv.InvalidateKeys("", "", ""); err != nil {
		t.Errorf("Expected nil error for all-empty keys, got: %v", err)
	}
}

func TestInvalidateKeys_ExistingKeys(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	// Set some keys
	mr.Set("key1", "value1")
	mr.Set("key2", "value2")
	mr.Set("key3", "value3")

	if err := inv.InvalidateKeys("key1", "key2"); err != nil {
		t.Fatalf("InvalidateKeys failed: %v", err)
	}

	// Check they're deleted
	if mr.Exists("key1") {
		t.Error("key1 should be deleted")
	}
	if mr.Exists("key2") {
		t.Error("key2 should be deleted")
	}
	if !mr.Exists("key3") {
		t.Error("key3 should still exist")
	}
}

func TestInvalidateKeys_MixedEmptyAndValid(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	mr.Set("real-key", "value")
	mr.Set("keep-key", "value")

	if err := inv.InvalidateKeys("real-key", "", "nonexistent"); err != nil {
		t.Fatalf("InvalidateKeys failed: %v", err)
	}

	if mr.Exists("real-key") {
		t.Error("real-key should be deleted")
	}
	if !mr.Exists("keep-key") {
		t.Error("keep-key should still exist")
	}
}

// =============================================================================
// InvalidateByPattern tests
// =============================================================================

func TestInvalidateByPattern_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateByPattern("pattern:*"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateByPattern_EmptyPattern(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)

	if err := inv.InvalidateByPattern(""); err != nil {
		t.Errorf("Expected nil error for empty pattern, got: %v", err)
	}
}

func TestInvalidateByPattern_MatchingKeys(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	mr.Set("data:/api/v1/posts?id=eq.123", "v1")
	mr.Set("data:/api/v1/posts?id=eq.456", "v2")
	mr.Set("data:/api/v1/threads?id=eq.123", "v3")

	if err := inv.InvalidateByPattern("data:/api/v1/posts*"); err != nil {
		t.Fatalf("InvalidateByPattern failed: %v", err)
	}

	if mr.Exists("data:/api/v1/posts?id=eq.123") {
		t.Error("posts key should be deleted")
	}
	if mr.Exists("data:/api/v1/posts?id=eq.456") {
		t.Error("second posts key should be deleted")
	}
	if !mr.Exists("data:/api/v1/threads?id=eq.123") {
		t.Error("threads key should still exist")
	}
}

func TestInvalidateByPattern_NoMatch(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	mr.Set("key1", "val1")
	mr.Set("key2", "val2")

	if err := inv.InvalidateByPattern("nomatch:*"); err != nil {
		t.Fatalf("InvalidateByPattern failed: %v", err)
	}

	if !mr.Exists("key1") || !mr.Exists("key2") {
		t.Error("keys should not be deleted when pattern doesn't match")
	}
}

// =============================================================================
// InvalidateForTable tests
// =============================================================================

func TestInvalidateForTable_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForTable("posts", map[string]string{"id": "123"}); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateForTable_EmptyValues(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	mr.Set("data:/api/v1/posts?id=eq.1", "v1")
	mr.Set("data:/api/v1/posts?id=eq.2", "v2")

	if err := inv.InvalidateForTable("posts", map[string]string{}); err != nil {
		t.Fatalf("InvalidateForTable failed: %v", err)
	}

	// Empty values = full-table flush via wildcard patterns (e.g. "data:/api/v1/posts?*")
	if mr.Exists("data:/api/v1/posts?id=eq.1") {
		t.Error("keys SHOULD be deleted with empty values (full-table flush)")
	}
}

// =============================================================================
// InvalidateForPost tests
// =============================================================================

func TestInvalidateForPost_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForPost("post-1", "thread-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateForPost_EmptyThreadID(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)

	if err := inv.InvalidateForPost("post-1", ""); err != nil {
		t.Errorf("Expected nil error for empty threadID, got: %v", err)
	}
}

// =============================================================================
// InvalidateForThread tests
// =============================================================================

func TestInvalidateForThread_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForThread("thread-1", "board-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateForThread_EmptyBoardID(t *testing.T) {
	client, mr := newTestRedis(t)
	inv := NewInvalidator(client)

	mr.Set("data:/api/v1/threads?id=eq.thread-1", "v1")

	if err := inv.InvalidateForThread("thread-1", ""); err != nil {
		t.Fatalf("InvalidateForThread failed: %v", err)
	}
}

// =============================================================================
// InvalidateForBoard tests
// =============================================================================

func TestInvalidateForBoard_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForBoard("board-1", "slug-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForProfile tests
// =============================================================================

func TestInvalidateForProfile_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForProfile("user-1", "alice"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForNotification tests
// =============================================================================

func TestInvalidateForNotification_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForNotification("user-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForWallPost tests
// =============================================================================

func TestInvalidateForWallPost_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForWallPost("post-1", "user-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForWallComment tests
// =============================================================================

func TestInvalidateForWallComment_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForWallComment("comment-1", "post-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForChatConversation tests
// =============================================================================

func TestInvalidateForChatConversation_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForChatConversation("conv-1", "user-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForChatMessage tests
// =============================================================================

func TestInvalidateForChatMessage_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForChatMessage("msg-1", "conv-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

func TestInvalidateForChatMessage_EmptyConversationID(t *testing.T) {
	client, _ := newTestRedis(t)
	inv := NewInvalidator(client)

	if err := inv.InvalidateForChatMessage("msg-1", ""); err != nil {
		t.Errorf("Expected nil error for empty conversationID, got: %v", err)
	}
}

// =============================================================================
// InvalidateForPostLike tests
// =============================================================================

func TestInvalidateForPostLike_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForPostLike("post-1", "thread-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// InvalidateForThreadLike tests
// =============================================================================

func TestInvalidateForThreadLike_NilRedis(t *testing.T) {
	inv := NewInvalidator(nil)
	if err := inv.InvalidateForThreadLike("thread-1", "board-1"); err != nil {
		t.Errorf("Expected nil error for nil redis, got: %v", err)
	}
}

// =============================================================================
// Global invalidator tests
// =============================================================================

func TestSetGetGlobalInvalidator(t *testing.T) {
	client, _ := newTestRedis(t)
	SetGlobalInvalidator(client)

	inv := GetGlobalInvalidator()
	if inv == nil {
		t.Fatal("Expected non-nil global invalidator")
	}
	if inv.redis != client {
		t.Error("Global invalidator should have the correct redis client")
	}
}

func TestSetGetGlobalInvalidator_Nil(t *testing.T) {
	globalInvalidator = nil
	inv := GetGlobalInvalidator()
	if inv != nil {
		t.Error("Expected nil when no global invalidator set")
	}
}

// =============================================================================
// Convenience functions tests (with nil Redis — should not panic)
// =============================================================================

func TestConvenienceFunctions_NoPanic(t *testing.T) {
	// All convenience functions should handle nil Redis gracefully
	InvalidateForPost(nil, "post-1", "thread-1")
	InvalidateForThread(nil, "thread-1", "board-1")
	InvalidateForBoard(nil, "board-1", "slug-1")
	InvalidateForProfile(nil, "user-1", "alice")
	InvalidateForNotification(nil, "user-1")
	InvalidateForWallPost(nil, "post-1", "user-1")
	InvalidateForWallComment(nil, "comment-1", "post-1")
	InvalidateForChatMessage(nil, "msg-1", "conv-1")
	InvalidateForChatConversation(nil, "conv-1", "user-1")
	InvalidateForPostLike(nil, "post-1", "thread-1")
	InvalidateForThreadLike(nil, "thread-1", "board-1")
	InvalidateForTable(nil, "posts", map[string]string{"id": "123"})
	InvalidateKeys(nil)
	InvalidateByPattern(nil, "pattern:*")
}

// =============================================================================
// Convenience functions — actual Redis test
// =============================================================================

func TestConvenienceFunctions_WithRedis(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/posts?id=eq.post-1", "v1")
	mr.Set("data:/api/v1/posts?thread_id=eq.thread-1", "v2")

	// This should try to invalidate, but the patterns may not match exact keys
	// This is fine — test that it doesn't panic and returns
	InvalidateForPost(client, "post-1", "thread-1")

	// Test InvalidateKeys with real keys worked
	mr.Set("test-key", "val")
	InvalidateKeys(client, "test-key")
	if mr.Exists("test-key") {
		t.Error("test-key should be deleted by InvalidateKeys convenience function")
	}
}
