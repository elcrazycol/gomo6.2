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
// InvalidateByPattern tests
// =============================================================================

func TestInvalidateByPattern_NilRedis(t *testing.T) {
	// Should not panic.
	InvalidateByPattern(nil, "pattern:*")
}

func TestInvalidateByPattern_EmptyPattern(t *testing.T) {
	client, _ := newTestRedis(t)
	InvalidateByPattern(client, "")
}

func TestInvalidateByPattern_MatchingKeys(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/posts?id=eq.123", "v1")
	mr.Set("data:/api/v1/posts?id=eq.456", "v2")
	mr.Set("data:/api/v1/threads?id=eq.123", "v3")

	InvalidateByPattern(client, "data:/api/v1/posts*")

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

	mr.Set("key1", "val1")
	mr.Set("key2", "val2")

	InvalidateByPattern(client, "nomatch:*")

	if !mr.Exists("key1") || !mr.Exists("key2") {
		t.Error("keys should not be deleted when pattern doesn't match")
	}
}

// TestInvalidateCacheForProfileWall_ViewerScopedKey locks down the wall
// freshness contract: the DataCacheMiddleware cache keys are viewer-scoped
// ("...|viewer=<id>" suffix), so the owner-list invalidation pattern built by
// InvalidateCacheForProfileWall must match that exact key shape — otherwise the
// embedded interaction counts in the wall GET would go stale after a
// like/comment/repost.
func TestInvalidateCacheForProfileWall_ViewerScopedKey(t *testing.T) {
	client, mr := newTestRedis(t)
	ownerKey := "data:/api/v1/profile_wall_posts?user_id=eq.owner-1&select=id,title|viewer=viewer-1"
	otherViewerKey := "data:/api/v1/profile_wall_posts?user_id=eq.owner-1&select=id,title|viewer=viewer-2"
	otherOwnerKey := "data:/api/v1/profile_wall_posts?user_id=eq.owner-2&select=id,title|viewer=viewer-1"
	for _, k := range []string{ownerKey, otherViewerKey, otherOwnerKey} {
		mr.Set(k, "v1")
	}

	InvalidateCacheForProfileWall(client, "owner-1")

	if mr.Exists(ownerKey) {
		t.Error("viewer-scoped wall list key for the owner should be deleted")
	}
	if mr.Exists(otherViewerKey) {
		t.Error("all viewer variants of the owner's wall list should be deleted")
	}
	if !mr.Exists(otherOwnerKey) {
		t.Error("another owner's wall list must NOT be deleted")
	}
}

// =============================================================================
// InvalidateForTable tests
// =============================================================================

func TestInvalidateForTable_EmptyValues(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/posts?id=eq.1", "v1")
	mr.Set("data:/api/v1/posts?id=eq.2", "v2")

	InvalidateForTable(client, "posts", map[string]string{})

	// Empty values = full-table flush via wildcard patterns (e.g. "data:/api/v1/posts?*")
	if mr.Exists("data:/api/v1/posts?id=eq.1") {
		t.Error("keys SHOULD be deleted with empty values (full-table flush)")
	}
	if mr.Exists("data:/api/v1/posts?id=eq.2") {
		t.Error("keys SHOULD be deleted with empty values (full-table flush)")
	}
}

func TestInvalidateForTable_NilRedis(t *testing.T) {
	InvalidateForTable(nil, "posts", map[string]string{"id": "123"})
}

// =============================================================================
// Canonical InvalidateCacheFor* behavior tests
// =============================================================================

func TestInvalidateCacheForThread(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/threads?id=eq.thread-1&select=id,title|viewer=anon", "v1")
	mr.Set("data:/api/v1/threads/thread-1?select=id|viewer=u1", "v2")
	mr.Set("data:/api/v1/posts?thread_id=eq.thread-1&select=id|viewer=anon", "v3")
	mr.Set("data:/api/v1/boards?id=eq.board-1", "keep-me")

	InvalidateCacheForThread(client, "thread-1")

	if mr.Exists("data:/api/v1/threads?id=eq.thread-1&select=id,title|viewer=anon") {
		t.Error("thread detail key should be deleted")
	}
	if mr.Exists("data:/api/v1/threads/thread-1?select=id|viewer=u1") {
		t.Error("path-style thread key should be deleted")
	}
	if mr.Exists("data:/api/v1/posts?thread_id=eq.thread-1&select=id|viewer=anon") {
		t.Error("thread post-list key should be deleted")
	}
	if !mr.Exists("data:/api/v1/boards?id=eq.board-1") {
		t.Error("unrelated board key should survive when no boardID given")
	}
}

func TestInvalidateCacheForThread_WithBoardID(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/threads?board_id=eq.board-1&select=id|viewer=anon", "v1")
	mr.Set("data:/api/v1/boards?id=eq.board-1", "v2")

	InvalidateCacheForThreadInBoard(client, "thread-1", "board-1")

	if mr.Exists("data:/api/v1/threads?board_id=eq.board-1&select=id|viewer=anon") {
		t.Error("board thread-list key should be deleted when boardID given")
	}
	if mr.Exists("data:/api/v1/boards?id=eq.board-1") {
		t.Error("board detail key should be deleted when boardID given")
	}
}

func TestInvalidateCacheForBoard_WithSlug(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/threads?board_id=eq.board-1|viewer=anon", "v1")
	mr.Set("data:/api/v1/boards?id=eq.board-1", "v2")
	mr.Set("data:/api/v1/boards/shroom?select=id|viewer=anon", "v3")
	mr.Set("data:/api/v1/boards?slug=eq.shroom&select=id|viewer=anon", "v4")

	InvalidateCacheForBoardWithSlug(client, "board-1", "shroom")

	for _, k := range []string{
		"data:/api/v1/threads?board_id=eq.board-1|viewer=anon",
		"data:/api/v1/boards?id=eq.board-1",
		"data:/api/v1/boards/shroom?select=id|viewer=anon",
		"data:/api/v1/boards?slug=eq.shroom&select=id|viewer=anon",
	} {
		if mr.Exists(k) {
			t.Errorf("board cache key should be deleted: %s", k)
		}
	}
}

func TestInvalidateCacheForWallPost_WithUser(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/profile_wall_posts?id=eq.post-1|viewer=anon", "v1")
	mr.Set("data:/api/v1/profile_wall_posts/post-1?select=id|viewer=anon", "v2")
	mr.Set("data:/api/v1/profile_wall_posts?user_id=eq.owner-1&select=id|viewer=viewer-1", "v3")

	InvalidateCacheForWallPostOfUser(client, "post-1", "owner-1")

	if mr.Exists("data:/api/v1/profile_wall_posts?id=eq.post-1|viewer=anon") {
		t.Error("wall post detail key should be deleted")
	}
	if mr.Exists("data:/api/v1/profile_wall_posts/post-1?select=id|viewer=anon") {
		t.Error("path-style wall post key should be deleted")
	}
	if mr.Exists("data:/api/v1/profile_wall_posts?user_id=eq.owner-1&select=id|viewer=viewer-1") {
		t.Error("wall owner list key should be deleted when userID given")
	}
}

func TestInvalidateCacheForNotification(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/notifications?user_id=eq.user-1&select=id|viewer=user-1", "v1")
	mr.Set("data:/api/v1/notifications?user_id=eq.user-2&select=id|viewer=user-2", "keep-me")

	InvalidateCacheForNotification(client, "user-1")

	if mr.Exists("data:/api/v1/notifications?user_id=eq.user-1&select=id|viewer=user-1") {
		t.Error("user-1 notifications should be deleted")
	}
	if !mr.Exists("data:/api/v1/notifications?user_id=eq.user-2&select=id|viewer=user-2") {
		t.Error("another user's notifications must NOT be deleted")
	}
}

func TestInvalidateCacheForPost_WithThreadID(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/posts?id=eq.post-1|viewer=anon", "v1")
	mr.Set("data:/api/v1/posts/post-1?select=id|viewer=anon", "v2")
	mr.Set("data:/api/v1/posts?thread_id=eq.thread-1&select=id|viewer=anon", "v3")
	mr.Set("data:/api/v1/threads?id=eq.thread-1", "v4")

	InvalidateCacheForPost(client, "post-1", "thread-1")

	if mr.Exists("data:/api/v1/posts?id=eq.post-1|viewer=anon") {
		t.Error("post detail key should be deleted")
	}
	if mr.Exists("data:/api/v1/posts/1?select=id|viewer=anon") {
		t.Error("path-style post key should be deleted")
	}
	if mr.Exists("data:/api/v1/posts?thread_id=eq.thread-1&select=id|viewer=anon") {
		t.Error("thread post-list key should be deleted")
	}
	if mr.Exists("data:/api/v1/threads?id=eq.thread-1") {
		t.Error("thread detail key should be deleted when threadID given")
	}
}

func TestInvalidateCacheForFeed(t *testing.T) {
	client, mr := newTestRedis(t)

	mr.Set("data:/api/v1/feed?limit=10|viewer=anon", "v1")
	mr.Set("data:/api/v1/feed?limit=10|viewer=u1", "v2")
	mr.Set("data:/api/v1/threads?id=eq.t1", "keep-me")

	InvalidateCacheForFeed(client)

	if mr.Exists("data:/api/v1/feed?limit=10|viewer=anon") {
		t.Error("feed key should be deleted")
	}
	if mr.Exists("data:/api/v1/feed?limit=10|viewer=u1") {
		t.Error("all viewer variants of the feed should be deleted")
	}
	if !mr.Exists("data:/api/v1/threads?id=eq.t1") {
		t.Error("unrelated thread key should survive")
	}
}

// =============================================================================
// Canonical functions — nil Redis safety (should not panic)
// =============================================================================

func TestCanonicalInvalidators_NoPanicNilRedis(t *testing.T) {
	InvalidateCacheForThread(nil, "thread-1")
	InvalidateCacheForThreadInBoard(nil, "thread-1", "board-1")
	InvalidateCacheForProfile(nil, "user-1")
	InvalidateCacheForBoard(nil, "board-1")
	InvalidateCacheForBoardWithSlug(nil, "board-1", "slug-1")
	InvalidateCacheForProfileWall(nil, "user-1")
	InvalidateCacheForWallPost(nil, "post-1")
	InvalidateCacheForWallPostOfUser(nil, "post-1", "user-1")
	InvalidateCacheForFeed(nil)
	InvalidateCacheForWallPostPin(nil, "post-1", "user-1")
	InvalidateCacheForPost(nil, "post-1", "thread-1")
	InvalidateCacheForPostLike(nil, "post-1", "thread-1")
	InvalidateCacheForThreadLike(nil, "thread-1")
	InvalidateCacheForNotification(nil, "user-1")
	InvalidateCacheForChatMessage(nil, "msg-1", "conv-1")
	InvalidateCacheForChatConversation(nil, "conv-1", "user-1")
	InvalidateCacheForWallComment(nil, "comment-1", "post-1")
}
