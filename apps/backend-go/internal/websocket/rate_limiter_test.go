package websocket

import (
	"sync"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

// setupWSRateLimitRedis creates a miniredis instance and a Redis-backed limiter.
func setupWSRateLimitRedis(t *testing.T) (*miniredis.Miniredis, *RateLimiter) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	limiter := NewRateLimiter(rdb, 5, time.Minute)
	return mr, limiter
}

// =============================================================================
// RateLimiter — basic Allow/Deny
// =============================================================================

func TestRateLimiter_FirstRequestAllowed(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	if !rl.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestRateLimiter_WithinLimit(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestRateLimiter_ExceedLimit(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Fatalf("request %d must be allowed", i+1)
		}
	}
	if rl.Allow("user-1") {
		t.Fatal("6th request must be denied after exceeding limit of 5")
	}
}

func TestRateLimiter_SeparateUsers(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)

	for i := 0; i < 5; i++ {
		rl.Allow("user-1")
	}
	if rl.Allow("user-1") {
		t.Error("user-1 must be rate-limited")
	}

	// user-2 should still have full quota
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-2") {
			t.Errorf("user-2 request %d must be allowed", i+1)
		}
	}
}

// =============================================================================
// RateLimiter — window refill
// =============================================================================

func TestRateLimiter_WindowRefill(t *testing.T) {
	// miniredis minimum TTL is 1s, so use a 2s window.
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	rl := NewRateLimiter(rdb, 3, 2*time.Second)

	for i := 0; i < 3; i++ {
		rl.Allow("user-1")
	}
	if rl.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	// Fast-forward the simulated Redis clock past the window.
	mr.FastForward(3 * time.Second)
	time.Sleep(20 * time.Millisecond)

	if !rl.Allow("user-1") {
		t.Error("must be allowed after window refill")
	}
}

// =============================================================================
// RateLimiter — Reset
// =============================================================================

func TestRateLimiter_Reset(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)

	for i := 0; i < 5; i++ {
		rl.Allow("user-1")
	}
	if rl.Allow("user-1") {
		t.Fatal("must be denied after exceeding limit")
	}

	rl.Reset("user-1")

	if !rl.Allow("user-1") {
		t.Error("request after reset must be allowed")
	}
}

func TestRateLimiter_Reset_Nonexistent(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	// Reset on a user that doesn't exist should not panic
	rl.Reset("nonexistent-user")
}

// =============================================================================
// RateLimiter — edge cases
// =============================================================================

func TestRateLimiter_NilRedis(t *testing.T) {
	rl := NewRateLimiter(nil, 5, time.Minute)
	if !rl.Allow("user-1") {
		t.Error("nil Redis must fail open (allow)")
	}
}

func TestRateLimiter_ZeroMaxRequests(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	rl.maxMessages = 0
	if rl.Allow("user-1") {
		t.Error("maxMessages=0 must deny all requests")
	}
}

func TestRateLimiter_EmptyUserID(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	if !rl.Allow("") {
		t.Error("first empty user request must be allowed")
	}
}

// =============================================================================
// RateLimiter — concurrent access (INCR is atomic in Redis)
// =============================================================================

func TestRateLimiter_ConcurrentAtBoundary(t *testing.T) {
	_, rl := setupWSRateLimitRedis(t)
	rl.maxMessages = 5

	var wg sync.WaitGroup
	results := make(chan bool, 20)

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- rl.Allow("user-boundary")
		}()
	}

	wg.Wait()
	close(results)

	passed := 0
	for r := range results {
		if r {
			passed++
		}
	}

	if passed != 5 {
		t.Errorf("expected exactly 5 concurrent requests to pass (INCR is atomic), got %d", passed)
	}
}
