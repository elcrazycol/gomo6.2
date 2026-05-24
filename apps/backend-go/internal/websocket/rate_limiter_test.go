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

	rl.Allow("user-1")
	rl.Allow("user-1")
	if rl.Allow("user-1") {
		t.Error("user-1 must be rate-limited")
	}

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
	rl := NewRateLimiter(3, 50*time.Millisecond)

	for i := 0; i < 3; i++ {
		rl.Allow("user-1")
	}

	if rl.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	time.Sleep(60 * time.Millisecond)

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
// RateLimiter — Reset
// =============================================================================

func TestRateLimiter_Reset(t *testing.T) {
	rl := NewRateLimiter(2, time.Minute)

	rl.Allow("user-1")
	rl.Allow("user-1")
	if rl.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	rl.Reset("user-1")

	if !rl.Allow("user-1") {
		t.Error("must be allowed after Reset")
	}
}

func TestRateLimiter_ResetNonExistent(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	// Reset on a user that never existed should not panic
	rl.Reset("nonexistent-user")
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
	if denied != 0 {
		t.Errorf("expected 0 denied requests, got %d", denied)
	}
}

func TestRateLimiter_ConcurrentAtBoundary(t *testing.T) {
	limiter := NewRateLimiter(5, time.Minute)

	var wg sync.WaitGroup
	results := make(chan bool, 5)

	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- limiter.Allow("user-boundary")
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
		t.Errorf("expected all 5 concurrent requests at boundary to pass, got %d", passed)
	}

	if limiter.Allow("user-boundary") {
		t.Error("6th request after concurrent boundary must be denied")
	}
}

// =============================================================================
// RateLimiter — edge cases
// =============================================================================

func TestRateLimiter_EmptyUserID(t *testing.T) {
	rl := NewRateLimiter(5, time.Minute)

	if !rl.Allow("") {
		t.Error("empty user ID first request must be allowed")
	}
}

func TestRateLimiter_ZeroMaxMessages(t *testing.T) {
	rl := NewRateLimiter(0, time.Minute)

	// max=0: first request creates bucket with tokens = -1 → allowed
	if !rl.Allow("user-1") {
		t.Error("first request with max=0 must be allowed (tokens=-1)")
	}

	// second request: tokens = -1, not > 0 → denied
	if rl.Allow("user-1") {
		t.Error("second request with max=0 must be denied")
	}
}

func TestRateLimiter_Cleanup(t *testing.T) {
	rl := NewRateLimiter(5, 10*time.Millisecond)

	rl.Allow("temp-user")

	rl.mu.RLock()
	_, exists := rl.buckets["temp-user"]
	rl.mu.RUnlock()
	if !exists {
		t.Fatal("temp-user must exist right after Allow")
	}

	// Wait for cleanup (window*2 = 20ms, plus ticker timing)
	time.Sleep(100 * time.Millisecond)

	rl.mu.RLock()
	_, exists = rl.buckets["temp-user"]
	rl.mu.RUnlock()

	if exists {
		t.Error("temp-user bucket should have been cleaned up")
	}
}
