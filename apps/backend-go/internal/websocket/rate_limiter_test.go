package websocket

import (
	"sync"
	"testing"
	"time"
)

// =============================================================================
// RateLimiter — basic Allow/Deny
// =============================================================================

func TestRateLimiter_FirstRequestAllowed(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	if !rl.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestRateLimiter_WithinLimit(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestRateLimiter_ExceedLimit(t *testing.T) {
	rl := NewRateLimiter(3, time.Minute)

	for i := 0; i < 3; i++ {
		if !rl.Allow("user-1") {
			t.Fatalf("request %d must be allowed", i+1)
		}
	}

	if rl.Allow("user-1") {
		t.Fatal("4th request must be denied after exceeding limit of 3")
	}
}

func TestRateLimiter_SeparateUsers(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)

	// User 1 uses all tokens
	rl.Allow("user-1")
	rl.Allow("user-1")

	if rl.Allow("user-1") {
		t.Error("user-1 must be rate-limited")
	}

	// User 2 should still have full quota
	if !rl.Allow("user-2") {
		t.Error("user-2 must still be allowed (separate bucket)")
	}
	if !rl.Allow("user-2") {
		t.Error("user-2 second request must be allowed")
	}
}

// =============================================================================
// RateLimiter — window refill
// =============================================================================

func TestRateLimiter_WindowRefill(t *testing.T) {
	// Small window: 50ms
	rl := NewRateLimiter(3, 50*time.Millisecond)

	// Use all tokens
	for i := 0; i < 3; i++ {
		rl.Allow("user-1")
	}

	// Must be denied now
	if rl.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	// Wait for window to pass
	time.Sleep(60 * time.Millisecond)

	// Should be allowed again after window refill
	if !rl.Allow("user-1") {
		t.Error("must be allowed after window refill")
	}
}

func TestRateLimiter_NoPartialRefill(t *testing.T) {
	rl := NewRateLimiter(3, 100*time.Millisecond)

	for i := 0; i < 3; i++ {
		rl.Allow("user-1")
	}

	time.Sleep(30 * time.Millisecond)

	if rl.Allow("user-1") {
		t.Error("must still be rate-limited before window ends")
	}
}

// =============================================================================
// RateLimiter — concurrent access
// =============================================================================

func TestRateLimiter_ConcurrentAccess(t *testing.T) {
	rl := NewRateLimiter(1000, time.Minute)

	var wg sync.WaitGroup
	users := []string{"a", "b", "c", "d", "e"}
	results := make(chan bool, len(users)*10)

	for _, user := range users {
		user := user
		for j := 0; j < 10; j++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results <- rl.Allow(user)
			}()
		}
	}

	wg.Wait()
	close(results)

	allowed := 0
	denied := 0
	for r := range results {
		if r {
			allowed++
		} else {
			denied++
		}
	}

	if allowed != 50 {
		t.Errorf("expected all 50 requests to pass, got %d allowed, %d denied", allowed, denied)
	}
}

func TestRateLimiter_ConcurrentAtBoundary(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	var wg sync.WaitGroup
	results := make(chan bool, 5)

	for i := 0; i < 5; i++ {
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
		t.Errorf("expected all 5 concurrent requests to pass, got %d", passed)
	}

	if rl.Allow("user-boundary") {
		t.Error("6th request after concurrent boundary must be denied")
	}
}

// =============================================================================
// RateLimiter — Reset
// =============================================================================

func TestRateLimiter_Reset(t *testing.T) {
	rl := NewRateLimiter(1, time.Minute)

	rl.Allow("user-1")
	if rl.Allow("user-1") {
		t.Fatal("2nd request must be denied when max=1")
	}

	rl.Reset("user-1")

	if !rl.Allow("user-1") {
		t.Error("request after reset must be allowed")
	}
}

func TestRateLimiter_Reset_Nonexistent(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)
	// Reset on a user that doesn't exist should not panic
	rl.Reset("nonexistent-user")
}

// =============================================================================
// RateLimiter — Empty user ID
// =============================================================================

func TestRateLimiter_EmptyUserID(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	if !rl.Allow("") {
		t.Error("first empty user request must be allowed")
	}
	if !rl.Allow("") {
		t.Error("second empty user request must be allowed (within limit)")
	}
}

// =============================================================================
// RateLimiter — Zero max requests
// =============================================================================

func TestRateLimiter_ZeroMaxRequests(t *testing.T) {
	rl := NewRateLimiter(0, time.Minute)

	// First request: creates bucket with tokens = -1, returns true
	if !rl.Allow("user-1") {
		t.Error("first request with max=0 must be allowed")
	}

	// Second request: tokens = -1, denied
	if rl.Allow("user-1") {
		t.Error("second request with max=0 must be denied")
	}
}

func TestRateLimiter_OneRequest(t *testing.T) {
	rl := NewRateLimiter(1, time.Minute)

	if !rl.Allow("user-1") {
		t.Fatal("first (only) request must be allowed")
	}
	if rl.Allow("user-1") {
		t.Fatal("second request must be denied when max=1")
	}
}

// =============================================================================
// RateLimiter — Cleanup
// =============================================================================

func TestRateLimiter_CleanupStaleEntry(t *testing.T) {
	rl := NewRateLimiter(5, 10*time.Millisecond)

	rl.Allow("stale-user")

	rl.mu.RLock()
	_, exists := rl.buckets["stale-user"]
	rl.mu.RUnlock()
	if !exists {
		t.Fatal("stale-user must exist right after Allow")
	}

	time.Sleep(100 * time.Millisecond)

	rl.mu.RLock()
	_, exists = rl.buckets["stale-user"]
	rl.mu.RUnlock()

	if exists {
		t.Error("stale-user bucket must have been cleaned up")
	}
}

// =============================================================================
// RateLimiter — Large batch
// =============================================================================

func TestRateLimiter_LargeBatch(t *testing.T) {
	rl := NewRateLimiter(100, time.Minute)

	// Simulate 100 requests — all within limit
	for i := 0; i < 100; i++ {
		if !rl.Allow("batch-user") {
			t.Fatalf("request %d must be allowed (max 100)", i+1)
		}
	}

	// 101st must fail
	if rl.Allow("batch-user") {
		t.Fatal("101st request must be denied (max 100)")
	}
}

// =============================================================================
// RateLimiter — Multiple users independently limited
// =============================================================================

func TestRateLimiter_MultipleUsersIndependently(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)

	users := []string{"alice", "bob", "charlie"}
	for _, user := range users {
		if !rl.Allow(user) {
			t.Fatalf("first request for %s must be allowed", user)
		}
		if !rl.Allow(user) {
			t.Fatalf("second request for %s must be allowed", user)
		}
		if rl.Allow(user) {
			t.Errorf("third request for %s must be denied", user)
		}
	}
}
