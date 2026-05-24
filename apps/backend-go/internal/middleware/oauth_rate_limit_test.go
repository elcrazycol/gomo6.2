package middleware

import (
	"testing"
	"time"
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
