package middleware

import (
	"sync"
	"testing"
	"time"
)

// =============================================================================
// MessengerRateLimiter — NewMessengerRateLimiter
// =============================================================================

func TestNewMessengerRateLimiter(t *testing.T) {
	rl := NewMessengerRateLimiter(10, time.Minute)
	if rl == nil {
		t.Fatal("expected non-nil limiter")
	}
	if rl.maxRequests != 10 {
		t.Errorf("expected maxRequests=10, got %d", rl.maxRequests)
	}
	if rl.window != time.Minute {
		t.Errorf("expected window=1m, got %v", rl.window)
	}
}

// =============================================================================
// MessengerRateLimiter — Allow
// =============================================================================

func TestMessengerRateLimiter_FirstRequestAllowed(t *testing.T) {
	rl := NewMessengerRateLimiter(5, time.Minute)
	if !rl.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestMessengerRateLimiter_WithinLimit(t *testing.T) {
	rl := NewMessengerRateLimiter(5, time.Minute)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestMessengerRateLimiter_ExceedLimit(t *testing.T) {
	rl := NewMessengerRateLimiter(3, time.Minute)
	for i := 0; i < 3; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 3)", i+1)
		}
	}
	// 4th request must be denied
	if rl.Allow("user-1") {
		t.Error("4th request must be denied (limit 3)")
	}
}

func TestMessengerRateLimiter_IndependentBuckets(t *testing.T) {
	rl := NewMessengerRateLimiter(2, time.Minute)

	// Use up user-1's tokens
	rl.Allow("user-1")
	rl.Allow("user-1")

	// user-2 should still have full allowance
	if !rl.Allow("user-2") {
		t.Error("user-2 must have independent bucket")
	}
	if !rl.Allow("user-2") {
		t.Error("user-2's second request must be allowed")
	}
	// user-1 should still be blocked
	if rl.Allow("user-1") {
		t.Error("user-1 should still be blocked")
	}
}

func TestMessengerRateLimiter_WindowRefill(t *testing.T) {
	// Use a very short window so the test doesn't take long
	rl := NewMessengerRateLimiter(2, 50*time.Millisecond)

	// Use up tokens
	if !rl.Allow("user-1") {
		t.Fatal("first request must be allowed")
	}
	if !rl.Allow("user-1") {
		t.Fatal("second request must be allowed")
	}
	if rl.Allow("user-1") {
		t.Fatal("third request must be denied")
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	// Should be allowed again after refill
	if !rl.Allow("user-1") {
		t.Error("request must be allowed after window refill")
	}
}

func TestMessengerRateLimiter_PartialRefill(t *testing.T) {
	// Tokens don't accumulate across windows — they reset to max-1
	// plus the refill request itself counts, giving maxRequests total
	rl := NewMessengerRateLimiter(3, 50*time.Millisecond)

	// Use 2 of the 3 available tokens
	if !rl.Allow("user-1") {
		t.Fatal("first")
	}
	if !rl.Allow("user-1") {
		t.Fatal("second")
	}

	// Wait for window to expire
	time.Sleep(60 * time.Millisecond)

	// After refill: tokens = maxRequests - 1 = 2, and the refill itself returns true
	// So we get maxRequests total requests
	for i := 0; i < 3; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("call %d after refill must be allowed (max %d total)", i+1, 3)
		}
	}
	// 4th should be denied
	if rl.Allow("user-1") {
		t.Error("4th call after refill must be denied")
	}
}

func TestMessengerRateLimiter_ConcurrentAccess(t *testing.T) {
	rl := NewMessengerRateLimiter(100, time.Minute)
	var wg sync.WaitGroup
	concurrency := 10
	allowed := make([]bool, concurrency*10)

	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				allowed[idx*10+j] = rl.Allow("concurrent-user")
			}
		}(i)
	}
	wg.Wait()

	// Count allowed requests — should be exactly maxRequests (100) even under concurrency
	allowedCount := 0
	for _, a := range allowed {
		if a {
			allowedCount++
		}
	}
	if allowedCount != 100 {
		t.Errorf("expected exactly 100 allowed requests under concurrency, got %d", allowedCount)
	}
}

// =============================================================================
// MessengerRateLimiter — Allow with empty/edge user IDs
// =============================================================================

func TestMessengerRateLimiter_EmptyUserID(t *testing.T) {
	rl := NewMessengerRateLimiter(3, time.Minute)
	if !rl.Allow("") {
		t.Error("empty user ID must be allowed initially")
	}
}
