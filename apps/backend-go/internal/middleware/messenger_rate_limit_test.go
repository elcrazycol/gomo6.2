package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

// setupMessengerRateLimitRedis creates a miniredis instance and a Redis-backed limiter.
func setupMessengerRateLimitRedis(t *testing.T) (*miniredis.Miniredis, *MessengerRateLimiter) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	limiter := NewMessengerRateLimiter(rdb, 5, time.Minute)
	return mr, limiter
}

// =============================================================================
// MessengerRateLimiter — Allow
// =============================================================================

func TestMessengerRateLimiter_FirstRequestAllowed(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	if !rl.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestMessengerRateLimiter_WithinLimit(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestMessengerRateLimiter_ExceedLimit(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		if !rl.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
	// 6th request must be denied
	if rl.Allow("user-1") {
		t.Error("6th request must be denied (limit 5)")
	}
}

func TestMessengerRateLimiter_IndependentBuckets(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		rl.Allow("user-1")
	}
	// user-2 should still have a full independent budget
	if !rl.Allow("user-2") {
		t.Error("user-2 must have an independent budget")
	}
	// user-1 should still be blocked
	if rl.Allow("user-1") {
		t.Error("user-1 should still be blocked")
	}
}

func TestMessengerRateLimiter_WindowRefill(t *testing.T) {
	// miniredis minimum TTL is 1s, so use a 2s window.
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	rl := NewMessengerRateLimiter(rdb, 2, 2*time.Second)

	for i := 0; i < 2; i++ {
		if !rl.Allow("user-1") {
			t.Fatal("first two requests must be allowed")
		}
	}
	if rl.Allow("user-1") {
		t.Fatal("third request must be denied")
	}

	// Fast-forward the simulated Redis clock past the window.
	mr.FastForward(3 * time.Second)
	time.Sleep(20 * time.Millisecond)

	if !rl.Allow("user-1") {
		t.Error("request must be allowed after window refill")
	}
}

func TestMessengerRateLimiter_EmptyUserID(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	if !rl.Allow("") {
		t.Error("empty user ID must be allowed initially")
	}
}

func TestMessengerRateLimiter_NilRedis(t *testing.T) {
	rl := NewMessengerRateLimiter(nil, 5, time.Minute)
	if !rl.Allow("user-1") {
		t.Error("nil Redis must fail open (allow)")
	}
}

func TestMessengerRateLimiter_ZeroMaxRequests(t *testing.T) {
	_, rl := setupMessengerRateLimitRedis(t)
	rl.maxRequests = 0
	if rl.Allow("user-1") {
		t.Error("maxRequests=0 must deny all requests")
	}
}

// =============================================================================
// MessengerRateLimitMiddleware — gin wrapper
// =============================================================================

func TestMessengerRateLimitMiddleware_NoClaims_PassesThrough(t *testing.T) {
	_, limiter := setupMessengerRateLimitRedis(t)
	handler := MessengerRateLimitMiddleware(limiter)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	handler(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 pass-through without claims, got %d", w.Code)
	}
}

func TestMessengerRateLimitMiddleware_WithClaims_Allowed(t *testing.T) {
	_, limiter := setupMessengerRateLimitRedis(t)
	handler := MessengerRateLimitMiddleware(limiter)

	for i := 0; i < 5; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("claims", &auth.Claims{UserID: "user-1"})
		handler(c)
		if w.Code != http.StatusOK {
			t.Fatalf("request %d expected 200, got %d", i+1, w.Code)
		}
	}
}

func TestMessengerRateLimitMiddleware_WithClaims_Denied(t *testing.T) {
	_, limiter := setupMessengerRateLimitRedis(t)
	handler := MessengerRateLimitMiddleware(limiter)

	for i := 0; i < 6; i++ {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Set("claims", &auth.Claims{UserID: "user-1"})
		handler(c)
		if i == 5 && w.Code != http.StatusTooManyRequests {
			t.Fatalf("6th request expected 429, got %d", w.Code)
		}
	}
}
