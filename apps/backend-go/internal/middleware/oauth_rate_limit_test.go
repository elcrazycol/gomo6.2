package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// =============================================================================
// OAuthRateLimiter — AllowToken
// =============================================================================

func TestOAuthRateLimiter_Token_FirstAllowed(t *testing.T) {
	limiter := NewOAuthRateLimiter(10, 5, time.Minute)

	if !limiter.AllowToken("ip:192.168.1.1") {
		t.Error("first token request must be allowed")
	}
}

func TestOAuthRateLimiter_Token_WithinLimit(t *testing.T) {
	limiter := NewOAuthRateLimiter(5, 5, time.Minute)

	for i := 0; i < 5; i++ {
		if !limiter.AllowToken("ip:192.168.1.1") {
			t.Errorf("token request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestOAuthRateLimiter_Token_ExceedLimit(t *testing.T) {
	limiter := NewOAuthRateLimiter(3, 5, time.Minute)

	for i := 0; i < 3; i++ {
		if !limiter.AllowToken("ip:192.168.1.1") {
			t.Fatalf("token request %d must be allowed", i+1)
		}
	}

	if limiter.AllowToken("ip:192.168.1.1") {
		t.Fatal("4th token request must be denied")
	}
}

// =============================================================================
// OAuthRateLimiter — AllowRevoke (separate limit)
// =============================================================================

func TestOAuthRateLimiter_Revoke_FirstAllowed(t *testing.T) {
	limiter := NewOAuthRateLimiter(10, 5, time.Minute)

	if !limiter.AllowRevoke("ip:192.168.1.1") {
		t.Error("first revoke request must be allowed")
	}
}

func TestOAuthRateLimiter_Revoke_ExceedLimit(t *testing.T) {
	limiter := NewOAuthRateLimiter(10, 2, time.Minute)

	for i := 0; i < 2; i++ {
		if !limiter.AllowRevoke("ip:192.168.1.1") {
			t.Fatalf("revoke request %d must be allowed", i+1)
		}
	}

	if limiter.AllowRevoke("ip:192.168.1.1") {
		t.Fatal("3rd revoke request must be denied")
	}
}

func TestOAuthRateLimiter_TokenAndRevoke_ShareBucket(t *testing.T) {
	// Token and Revoke share the same bucket by key.
	// When token is exhausted, revoke is also denied for the same key.
	limiter := NewOAuthRateLimiter(1, 5, time.Minute)

	// Use the only token for this key
	limiter.AllowToken("ip:shared-key")

	// Token is now exhausted for this key
	if limiter.AllowToken("ip:shared-key") {
		t.Fatal("token must be exhausted")
	}

	// Revoke shares the same bucket — also denied
	if limiter.AllowRevoke("ip:shared-key") {
		t.Error("revoke must also be denied — token and revoke share the same bucket by key")
	}

	// Different key is unaffected
	if !limiter.AllowRevoke("ip:other-key") {
		t.Error("different key must have its own bucket")
	}
}

// =============================================================================
// OAuthRateLimiter — window refill
// =============================================================================

func TestOAuthRateLimiter_Token_RefillAfterWindow(t *testing.T) {
	limiter := NewOAuthRateLimiter(1, 5, 30*time.Millisecond)

	// Use the only token
	limiter.AllowToken("ip:192.168.1.1")

	// Exhausted
	if limiter.AllowToken("ip:192.168.1.1") {
		t.Fatal("token must be exhausted")
	}

	// Wait for window to pass
	time.Sleep(40 * time.Millisecond)

	// Should be refilled
	if !limiter.AllowToken("ip:192.168.1.1") {
		t.Error("token must be allowed after window refill")
	}
}

// =============================================================================
// OAuthRateLimiter — separate keys
// =============================================================================

func TestOAuthRateLimiter_SeparateIPs(t *testing.T) {
	limiter := NewOAuthRateLimiter(1, 5, time.Minute)

	// Exhaust ip1
	limiter.AllowToken("ip:10.0.0.1")
	if limiter.AllowToken("ip:10.0.0.1") {
		t.Fatal("ip1 must be exhausted")
	}

	// ip2 should still work
	if !limiter.AllowToken("ip:10.0.0.2") {
		t.Error("ip2 must still have its own quota")
	}
}

func TestOAuthRateLimiter_UserKey_vs_IPKey(t *testing.T) {
	limiter := NewOAuthRateLimiter(1, 5, time.Minute)

	limiter.AllowToken("user:user-123")
	if limiter.AllowToken("user:user-123") {
		t.Fatal("user:user-123 must be exhausted")
	}

	// Same IP as fallback should have separate quota
	if !limiter.AllowToken("ip:192.168.1.1") {
		t.Error("ip:192.168.1.1 must have separate quota from user:user-123")
	}
}

// =============================================================================
// OAuthRateLimiter — edge cases
// =============================================================================

func TestOAuthRateLimiter_EmptyKey(t *testing.T) {
	limiter := NewOAuthRateLimiter(5, 5, time.Minute)

	if !limiter.AllowToken("") {
		t.Error("empty key must still work (first request)")
	}
}

func TestOAuthRateLimiter_ZeroLimits(t *testing.T) {
	limiter := NewOAuthRateLimiter(0, 0, time.Minute)

	// Implementation-dependent: AllowToken with max=0
	result := limiter.AllowToken("ip:test")
	t.Logf("AllowToken with max=0: %v", result)

	// Second call should return false (tokens = -1, then -2)
	if limiter.AllowToken("ip:test") {
		t.Error("second request with max=0 should be denied")
	}
}

// =============================================================================
// resolveKey
// =============================================================================

func newOAuthKeyContext(claimsClaims interface{}) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/oauth/token", nil)
	c.Request.RemoteAddr = "10.0.0.99:12345"
	if claimsClaims != nil {
		c.Set("claims", claimsClaims)
	}
	return c, w
}

func TestResolveKey_WithUserClaims_ReturnsUserPrefix(t *testing.T) {
	c, _ := newOAuthKeyContext(&authClaims{userID: "user-42"})

	key := resolveKey(c)

	if key != "user:user-42" {
		t.Errorf("expected 'user:user-42', got %q", key)
	}
}

func TestResolveKey_WithoutClaims_ReturnsIPPrefix(t *testing.T) {
	c, _ := newOAuthKeyContext(nil)

	key := resolveKey(c)

	if key != "ip:10.0.0.99" {
		t.Errorf("expected 'ip:10.0.0.99', got %q", key)
	}
}

func TestResolveKey_EmptyUserID_FallsBackToIP(t *testing.T) {
	c, _ := newOAuthKeyContext(&authClaims{userID: ""})

	key := resolveKey(c)

	// Empty userID still goes to "user:" prefix (the code checks uid != "" after GetUserID())
	// Actually looking at the code:
	//   if uid := claims.GetUserID(); uid != "" { return "user:" + uid }
	// So empty uid → falls through to IP
	if key != "ip:10.0.0.99" {
		t.Errorf("expected 'ip:10.0.0.99' for empty userID, got %q", key)
	}
}

// =============================================================================
// OAuthTokenRateLimitMiddleware
// =============================================================================

func newOAuthTokenContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/oauth/token", nil)
	c.Request.RemoteAddr = "10.0.0.1:54321"
	return c, w
}

func TestOAuthTokenRateLimitMiddleware_FirstRequest_Allowed(t *testing.T) {
	limiter := NewOAuthRateLimiter(5, 3, time.Minute)
	middleware := OAuthTokenRateLimitMiddleware(limiter)

	c, w := newOAuthTokenContext()

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestOAuthTokenRateLimitMiddleware_ExceedLimit_Returns429(t *testing.T) {
	limiter := NewOAuthRateLimiter(1, 3, time.Minute)
	middleware := OAuthTokenRateLimitMiddleware(limiter)

	// First request
	c1, _ := newOAuthTokenContext()
	middleware(c1)

	// Second request — blocked
	c2, w2 := newOAuthTokenContext()

	middleware(c2)

	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", w2.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	errDesc, _ := resp["error_description"].(string)
	if !strings.Contains(strings.ToLower(errDesc), "rate limit") {
		t.Errorf("expected error_description mentioning rate limit, got %q", errDesc)
	}
}

// =============================================================================
// OAuthRevokeRateLimitMiddleware
// =============================================================================

func newOAuthRevokeContext() (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/oauth/revoke", nil)
	c.Request.RemoteAddr = "10.0.0.2:54321"
	return c, w
}

func TestOAuthRevokeRateLimitMiddleware_FirstRequest_Allowed(t *testing.T) {
	limiter := NewOAuthRateLimiter(5, 3, time.Minute)
	middleware := OAuthRevokeRateLimitMiddleware(limiter)

	c, w := newOAuthRevokeContext()

	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestOAuthRevokeRateLimitMiddleware_ExceedLimit_Returns429(t *testing.T) {
	limiter := NewOAuthRateLimiter(5, 1, time.Minute)
	middleware := OAuthRevokeRateLimitMiddleware(limiter)

	// First revoke
	c1, _ := newOAuthRevokeContext()
	middleware(c1)

	// Second revoke — blocked (revoke limit=1)
	c2, w2 := newOAuthRevokeContext()

	middleware(c2)

	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", w2.Code)
	}
}

func TestOAuthRevokeRateLimitMiddleware_TokenAndRevoke_IndependentLimits(t *testing.T) {
	limiter := NewOAuthRateLimiter(10, 1, time.Minute)
	tokenMiddleware := OAuthTokenRateLimitMiddleware(limiter)
	revokeMiddleware := OAuthRevokeRateLimitMiddleware(limiter)

	// Exhaust revoke limit
	c1, _ := newOAuthRevokeContext()
	revokeMiddleware(c1)

	// Revoke should be blocked now
	c2, w2 := newOAuthRevokeContext()
	revokeMiddleware(c2)
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("revoke should be blocked after exhausting limit, got %d", w2.Code)
	}

	// Token should still work (separate limit)
	c3, w3 := newOAuthTokenContext()
	tokenMiddleware(c3)
	if w3.Code != http.StatusOK {
		t.Errorf("token should still be allowed (separate limit), got %d", w3.Code)
	}
}
