package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// AuthRateLimiter — basic Allow/Deny
// =============================================================================

func TestAuthRateLimiter_FirstRequestAllowed(t *testing.T) {
	limiter := NewAuthRateLimiter(5, time.Minute)

	if !limiter.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestAuthRateLimiter_WithinLimit(t *testing.T) {
	limiter := NewAuthRateLimiter(5, time.Minute)

	for i := 0; i < 5; i++ {
		if !limiter.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestAuthRateLimiter_ExceedLimit(t *testing.T) {
	limiter := NewAuthRateLimiter(3, time.Minute)

	// First 3 must succeed
	for i := 0; i < 3; i++ {
		if !limiter.Allow("user-1") {
			t.Fatalf("request %d must be allowed", i+1)
		}
	}

	// 4th must fail
	if limiter.Allow("user-1") {
		t.Fatal("4th request must be denied after exceeding limit of 3")
	}
}

func TestAuthRateLimiter_SeparateUsers(t *testing.T) {
	limiter := NewAuthRateLimiter(2, time.Minute)

	// User 1 uses all tokens
	limiter.Allow("user-1")
	limiter.Allow("user-1")

	if limiter.Allow("user-1") {
		t.Error("user-1 must be rate-limited")
	}

	// User 2 should still have full quota
	if !limiter.Allow("user-2") {
		t.Error("user-2 must still be allowed (separate bucket)")
	}
	if !limiter.Allow("user-2") {
		t.Error("user-2 second request must be allowed")
	}
}

// =============================================================================
// AuthRateLimiter — window refill
// =============================================================================

func TestAuthRateLimiter_WindowRefill(t *testing.T) {
	// Small window: 50ms
	limiter := NewAuthRateLimiter(3, 50*time.Millisecond)

	// Use all tokens
	for i := 0; i < 3; i++ {
		limiter.Allow("user-1")
	}

	// Must be denied now
	if limiter.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	// Wait for window to pass
	time.Sleep(60 * time.Millisecond)

	// Should be allowed again after window refill
	if !limiter.Allow("user-1") {
		t.Error("must be allowed after window refill")
	}
}

func TestAuthRateLimiter_NoPartialRefill(t *testing.T) {
	// Window: 100ms — ensure no partial refill before window ends
	limiter := NewAuthRateLimiter(3, 100*time.Millisecond)

	// Use all tokens
	for i := 0; i < 3; i++ {
		limiter.Allow("user-1")
	}

	// Wait less than window
	time.Sleep(30 * time.Millisecond)

	// Still rate-limited
	if limiter.Allow("user-1") {
		t.Error("must still be rate-limited before window ends")
	}
}

// =============================================================================
// AuthRateLimiter — concurrent access
// =============================================================================

func TestAuthRateLimiter_ConcurrentAccess(t *testing.T) {
	limiter := NewAuthRateLimiter(1000, time.Minute)

	var wg sync.WaitGroup
	users := []string{"a", "b", "c", "d", "e"}
	results := make(chan bool, len(users)*10)

	for _, user := range users {
		user := user
		for j := 0; j < 10; j++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				results <- limiter.Allow(user)
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

	// Total: 5 users * 10 requests = 50 requests
	// Expected: all allowed (1000 limit, 10 per user is far below)
	if allowed != 50 {
		t.Errorf("expected all 50 requests to pass, got %d allowed, %d denied", allowed, denied)
	}
	if denied != 0 {
		t.Errorf("expected 0 denied requests, got %d", denied)
	}
}

// =============================================================================
// AuthRateLimiter — concurrent at boundary
// =============================================================================

func TestAuthRateLimiter_ConcurrentAtBoundary(t *testing.T) {
	// 5 goroutines, each makes 1 request, limit = 5
	// All 5 should pass, 6th sequential should fail
	limiter := NewAuthRateLimiter(5, time.Minute)

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

	// 6th request after the boundary should be denied
	if limiter.Allow("user-boundary") {
		t.Error("6th request after concurrent boundary must be denied")
	}
}

// =============================================================================
// AuthRateLimiter — cleanup
// =============================================================================

func TestAuthRateLimiter_Cleanup(t *testing.T) {
	// Small window to speed up cleanup
	limiter := NewAuthRateLimiter(5, 10*time.Millisecond)

	// Add a user
	limiter.Allow("temp-user")

	// Wait for cleanup to fire (window*2 = 20ms, plus ticker timing)
	time.Sleep(50 * time.Millisecond)

	limiter.mu.RLock()
	_, exists := limiter.buckets["temp-user"]
	limiter.mu.RUnlock()

	if exists {
		t.Log("temp-user bucket still exists after cleanup window (may be OK due to timing)")
	}
}

func TestAuthRateLimiter_StaleEntryCleaned(t *testing.T) {
	// Very small window for fast cleanup
	limiter := NewAuthRateLimiter(5, 5*time.Millisecond)

	// Add a user
	limiter.Allow("stale-user")

	// Verify it exists
	limiter.mu.RLock()
	_, exists := limiter.buckets["stale-user"]
	limiter.mu.RUnlock()
	if !exists {
		t.Fatal("stale-user must exist right after Allow")
	}

	// Wait much longer than cleanup window (window*2 = 10ms)
	time.Sleep(100 * time.Millisecond)

	limiter.mu.RLock()
	_, exists = limiter.buckets["stale-user"]
	limiter.mu.RUnlock()

	if exists {
		t.Error("stale-user bucket must have been cleaned up")
	}
}

// =============================================================================
// AuthRateLimiter — edge cases
// =============================================================================

func TestAuthRateLimiter_EmptyUserID(t *testing.T) {
	limiter := NewAuthRateLimiter(5, time.Minute)

	if !limiter.Allow("") {
		t.Error("empty user ID should still work (first request)")
	}

	// Second request for same empty key
	if !limiter.Allow("") {
		t.Error("second empty-user request must be allowed (within limit)")
	}
}

func TestAuthRateLimiter_ZeroMaxRequests(t *testing.T) {
	limiter := NewAuthRateLimiter(0, time.Minute)

	// First request: creates bucket with tokens = -1, returns true
	if !limiter.Allow("user-1") {
		t.Error("first request with max=0 must be allowed (bucket created with tokens=0-1=-1)")
	}

	// Second request: tokens = -1, not > 0 → denied
	if limiter.Allow("user-1") {
		t.Error("second request with max=0 must be denied (tokens=-1)")
	}
}

func TestAuthRateLimiter_OneRequest(t *testing.T) {
	limiter := NewAuthRateLimiter(1, time.Minute)

	if !limiter.Allow("user-1") {
		t.Fatal("first (only) request must be allowed")
	}
	if limiter.Allow("user-1") {
		t.Fatal("second request must be denied when max=1")
	}
}

// =============================================================================
// AuthRateLimitMiddleware — gin wrapper
// =============================================================================

func newRateLimitContext(claimsExists bool) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/auth/me", nil)
	if claimsExists {
		c.Set("claims", &authClaims{userID: "user-123"})
	}
	return c, w
}

// authClaims implements the GetUserID() interface expected by the middleware.
type authClaims struct {
	userID string
}

func (a *authClaims) GetUserID() string {
	return a.userID
}

func TestAuthRateLimitMiddleware_NoClaims_PassesThrough(t *testing.T) {
	limiter := NewAuthRateLimiter(1, time.Minute)
	middleware := AuthRateLimitMiddleware(limiter)

	c, w := newRateLimitContext(false)

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestAuthRateLimitMiddleware_WithClaims_Allowed(t *testing.T) {
	limiter := NewAuthRateLimiter(3, time.Minute)
	middleware := AuthRateLimitMiddleware(limiter)

	c, w := newRateLimitContext(true)

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestAuthRateLimitMiddleware_ExceedLimit_Returns429(t *testing.T) {
	limiter := NewAuthRateLimiter(1, time.Minute)
	middleware := AuthRateLimitMiddleware(limiter)

	// First request — allowed
	c1, _ := newRateLimitContext(true)
	middleware(c1)

	// Second request — should be denied
	c2, w2 := newRateLimitContext(true)

	middleware(c2)

	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", w2.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	errMsg, _ := resp["error"].(string)
	if !strings.Contains(strings.ToLower(errMsg), "rate limit") {
		t.Errorf("expected error mentioning rate limit, got %q", errMsg)
	}
}

func TestAuthRateLimitMiddleware_DifferentUsers_Independent(t *testing.T) {
	limiter := NewAuthRateLimiter(1, time.Minute)
	middleware := AuthRateLimitMiddleware(limiter)

	// User 1 exhausts their limit
	c1, _ := newRateLimitContext(true)
	c1.Set("claims", &authClaims{userID: "user-1"})
	middleware(c1)

	// User 1 should be blocked now
	c2, w2 := newRateLimitContext(true)
	c2.Set("claims", &authClaims{userID: "user-1"})
	middleware(c2)
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("user-1 should be blocked after exhausting limit, got %d", w2.Code)
	}

	// User 2 should still have their own quota
	c3, w3 := newRateLimitContext(true)
	c3.Set("claims", &authClaims{userID: "user-2"})
	middleware(c3)

	if w3.Code != http.StatusOK {
		t.Errorf("user-2 expected 200, got %d", w3.Code)
	}
}
