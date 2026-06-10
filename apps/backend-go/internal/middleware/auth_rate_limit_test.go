package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
)

// setupRateLimitRedis creates a miniredis instance and a Redis client.
func setupRateLimitRedis(t *testing.T) (*miniredis.Miniredis, *AuthRateLimiter) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := newRedisClientForTest(mr.Addr())
	limiter := NewAuthRateLimiter(rdb, 5, time.Minute)
	return mr, limiter
}

// =============================================================================
// AuthRateLimiter — basic Allow/Deny
// =============================================================================

func TestAuthRateLimiter_FirstRequestAllowed(t *testing.T) {
	_, limiter := setupRateLimitRedis(t)
	if !limiter.Allow("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestAuthRateLimiter_WithinLimit(t *testing.T) {
	_, limiter := setupRateLimitRedis(t)
	for i := 0; i < 5; i++ {
		if !limiter.Allow("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestAuthRateLimiter_ExceedLimit(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	// Override with lower limit
	limiter.maxRequests = 3

	for i := 0; i < 3; i++ {
		if !limiter.Allow("user-1") {
			t.Fatalf("request %d must be allowed", i+1)
		}
	}

	if limiter.Allow("user-1") {
		t.Fatal("4th request must be denied after exceeding limit of 3")
	}
	_ = mr
}

func TestAuthRateLimiter_SeparateUsers(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 2

	// User 1 uses all tokens
	limiter.Allow("user-1")
	limiter.Allow("user-1")

	if limiter.Allow("user-1") {
		t.Error("user-1 must be rate-limited")
	}

	// User 2 should still have full quota
	if !limiter.Allow("user-2") {
		t.Error("user-2 must still be allowed (separate key)")
	}
	if !limiter.Allow("user-2") {
		t.Error("user-2 second request must be allowed")
	}
	_ = mr
}

// =============================================================================
// AuthRateLimiter — window refill (Redis TTL handles this automatically)
// =============================================================================

func TestAuthRateLimiter_WindowRefill(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 3
	limiter.window = 2 * time.Second // miniredis minimum TTL is 1s

	// Use all tokens
	for i := 0; i < 3; i++ {
		limiter.Allow("user-1")
	}

	if limiter.Allow("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	// Fast-forward Redis time past the window
	mr.FastForward(3 * time.Second)

	// Small sleep to ensure Redis has processed the fast-forward
	time.Sleep(20 * time.Millisecond)

	// Should be allowed again after window expires
	if !limiter.Allow("user-1") {
		t.Error("must be allowed after window refill")
	}
}

// =============================================================================
// AuthRateLimiter — edge cases
// =============================================================================

func TestAuthRateLimiter_EmptyUserID(t *testing.T) {
	_, limiter := setupRateLimitRedis(t)
	if !limiter.Allow("") {
		t.Error("empty user ID should still work (first request)")
	}
	if !limiter.Allow("") {
		t.Error("second empty-user request must be allowed (within limit)")
	}
}

func TestAuthRateLimiter_ZeroMaxRequests(t *testing.T) {
	_, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 0

	if limiter.Allow("user-1") {
		t.Error("zero max requests should deny all")
	}
}

func TestAuthRateLimiter_OneRequest(t *testing.T) {
	_, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 1

	if !limiter.Allow("user-1") {
		t.Fatal("first (only) request must be allowed")
	}
	if limiter.Allow("user-1") {
		t.Fatal("second request must be denied when max=1")
	}
}

func TestAuthRateLimiter_NilRedis(t *testing.T) {
	limiter := NewAuthRateLimiter(nil, 5, time.Minute)
	if !limiter.Allow("user-1") {
		t.Error("nil redis should fail open (allow all)")
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

type authClaims struct {
	userID string
}

func (a *authClaims) GetUserID() string {
	return a.userID
}

func TestAuthRateLimitMiddleware_NoClaims_PassesThrough(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	middleware := AuthRateLimitMiddleware(limiter)

	c, w := newRateLimitContext(false)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	_ = mr
}

func TestAuthRateLimitMiddleware_WithClaims_Allowed(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	middleware := AuthRateLimitMiddleware(limiter)

	c, w := newRateLimitContext(true)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
	_ = mr
}

func TestAuthRateLimitMiddleware_ExceedLimit_Returns429(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 1
	middleware := AuthRateLimitMiddleware(limiter)

	c1, _ := newRateLimitContext(true)
	middleware(c1)

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
	_ = mr
}

func TestAuthRateLimitMiddleware_DifferentUsers_Independent(t *testing.T) {
	mr, limiter := setupRateLimitRedis(t)
	limiter.maxRequests = 1
	middleware := AuthRateLimitMiddleware(limiter)

	c1, _ := newRateLimitContext(true)
	c1.Set("claims", &authClaims{userID: "user-1"})
	middleware(c1)

	c2, w2 := newRateLimitContext(true)
	c2.Set("claims", &authClaims{userID: "user-1"})
	middleware(c2)
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("user-1 should be blocked, got %d", w2.Code)
	}

	c3, w3 := newRateLimitContext(true)
	c3.Set("claims", &authClaims{userID: "user-2"})
	middleware(c3)
	if w3.Code != http.StatusOK {
		t.Errorf("user-2 expected 200, got %d", w3.Code)
	}
	_ = mr
}

// newRedisClientForTest creates a Redis client connected to miniredis.
func newRedisClientForTest(addr string) *redis.Client {
	return redis.NewClient(&redis.Options{Addr: addr})
}
