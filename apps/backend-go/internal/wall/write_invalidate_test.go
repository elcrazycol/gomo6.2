package wall

import (
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// newRedisService builds a wall Service backed by an in-memory redis. The DB,
// hub and notifier stay nil: the DELETE/PUT side effects under test never touch
// them (they are only needed when a notification/stat recompute applies).
func newRedisService(t *testing.T) (*Service, *miniredis.Miniredis) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return New(nil, rdb, nil, nil), mr
}

// A deleted wall post must leave every viewer's unified feed immediately — the
// row is embedded in the cached /api/v1/feed response, and until now it only
// disappeared when the 30s TTL expired.
func TestAfterPostWriteDeleteInvalidatesFeed(t *testing.T) {
	svc, mr := newRedisService(t)
	mr.Set("data:/api/v1/feed?limit=20|viewer=anon", "a")
	mr.Set("data:/api/v1/feed?limit=20|viewer=u2", "b")
	mr.Set("data:/api/v1/profile_wall_posts?user_id=eq.owner&limit=5|viewer=u2", "wall")

	c, _ := newRequestContext("DELETE", "/api/v1/profile_wall_posts?id=eq.post1", nil, nil)
	svc.AfterPostWrite(c, "DELETE", map[string]interface{}{"id": "post1", "user_id": "owner"})

	if mr.Exists("data:/api/v1/feed?limit=20|viewer=anon") || mr.Exists("data:/api/v1/feed?limit=20|viewer=u2") {
		t.Fatal("expected the unified feed cache to be cleared on wall post delete")
	}
	if mr.Exists("data:/api/v1/profile_wall_posts?user_id=eq.owner&limit=5|viewer=u2") {
		t.Fatal("expected the owner's wall-list cache to be cleared on delete")
	}
}

// An edited wall post embeds its new body in feed cards, so the feed cache must
// be cleared on PUT too.
func TestAfterPostWriteUpdateInvalidatesFeed(t *testing.T) {
	svc, mr := newRedisService(t)
	mr.Set("data:/api/v1/feed?limit=20|viewer=anon", "a")

	c, _ := newRequestContext("PUT", "/api/v1/profile_wall_posts?id=eq.post1", nil, nil)
	svc.AfterPostWrite(c, "PUT", map[string]interface{}{"id": "post1", "user_id": "owner"})

	if mr.Exists("data:/api/v1/feed?limit=20|viewer=anon") {
		t.Fatal("expected the unified feed cache to be cleared on wall post edit")
	}
}
