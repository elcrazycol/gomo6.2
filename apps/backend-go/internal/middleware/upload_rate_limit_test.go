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
	"github.com/gomo6/backend/internal/auth"
)

func newUploadLimiter(t *testing.T, maxPerMinute int, maxBytesPerHour int64) (*miniredis.Miniredis, *UploadRateLimiter) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := newRedisClientForTest(mr.Addr())
	return mr, NewUploadRateLimiter(rdb, maxPerMinute, maxBytesPerHour)
}

// =============================================================================
// UploadRateLimiter — request rate (count per minute)
// =============================================================================

func TestUploadRateLimiter_CountFirstRequestAllowed(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	if !limiter.AllowCount("user-1") {
		t.Error("first request must be allowed")
	}
}

func TestUploadRateLimiter_CountWithinLimit(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	for i := 0; i < 5; i++ {
		if !limiter.AllowCount("user-1") {
			t.Errorf("request %d must be allowed (max 5)", i+1)
		}
	}
}

func TestUploadRateLimiter_CountExceedLimit(t *testing.T) {
	_, limiter := newUploadLimiter(t, 3, 1000)
	for i := 0; i < 3; i++ {
		if !limiter.AllowCount("user-1") {
			t.Fatalf("request %d must be allowed", i+1)
		}
	}
	if limiter.AllowCount("user-1") {
		t.Fatal("4th request must be denied after exceeding limit of 3")
	}
}

func TestUploadRateLimiter_CountSeparateUsers(t *testing.T) {
	_, limiter := newUploadLimiter(t, 2, 1000)
	limiter.AllowCount("user-1")
	limiter.AllowCount("user-1")
	if limiter.AllowCount("user-1") {
		t.Error("user-1 must be rate-limited")
	}
	if !limiter.AllowCount("user-2") {
		t.Error("user-2 must still be allowed (separate key)")
	}
}

func TestUploadRateLimiter_CountWindowRefill(t *testing.T) {
	mr, limiter := newUploadLimiter(t, 2, 1000)
	limiter.AllowCount("user-1")
	limiter.AllowCount("user-1")
	if limiter.AllowCount("user-1") {
		t.Fatal("must be rate-limited after using all tokens")
	}

	// The count window is one minute; fast-forward past it.
	mr.FastForward(61 * time.Second)
	time.Sleep(20 * time.Millisecond)

	if !limiter.AllowCount("user-1") {
		t.Error("must be allowed again after the window refills")
	}
}

// =============================================================================
// UploadRateLimiter — byte quota (per hour)
// =============================================================================

func TestUploadRateLimiter_BytesQuota(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	if !limiter.AllowBytes("user-1", 400) {
		t.Fatal("first 400 bytes must fit the quota")
	}
	if !limiter.AllowBytes("user-1", 400) {
		t.Fatal("second 400 bytes must fit the quota (total 800)")
	}
	if limiter.AllowBytes("user-1", 400) {
		t.Fatal("third 400 bytes must be denied (total would exceed 1000)")
	}
}

func TestUploadRateLimiter_BytesQuotaEqualsAllowed(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	if !limiter.AllowBytes("user-1", 1000) {
		t.Fatal("charge exactly equal to the quota must be allowed")
	}
	if limiter.AllowBytes("user-1", 1) {
		t.Fatal("any further charge must be denied")
	}
}

func TestUploadRateLimiter_BytesUnknownSizeChargesDefault(t *testing.T) {
	// Unknown/absent Content-Length is charged the maximum upload size, so the
	// quota cannot be bypassed by omitting the header.
	_, limiter := newUploadLimiter(t, 5, uploadUnknownSizeCharge)
	if !limiter.AllowBytes("user-1", 0) {
		t.Fatal("first unknown-size charge must fit (charged the max size)")
	}
	if limiter.AllowBytes("user-1", 0) {
		t.Fatal("second unknown-size charge must be denied (quota exhausted)")
	}
}

func TestUploadRateLimiter_BytesWindowRefill(t *testing.T) {
	mr, limiter := newUploadLimiter(t, 5, 1000)
	limiter.AllowBytes("user-1", 900)
	if limiter.AllowBytes("user-1", 200) {
		t.Fatal("must be denied while the hourly quota is exhausted")
	}

	// The byte window is one hour; fast-forward past it.
	mr.FastForward(3601 * time.Second)
	time.Sleep(20 * time.Millisecond)

	if !limiter.AllowBytes("user-1", 900) {
		t.Error("must be allowed again after the hourly quota refills")
	}
}

// =============================================================================
// UploadRateLimiter — edge cases
// =============================================================================

func TestUploadRateLimiter_NilRedis(t *testing.T) {
	limiter := NewUploadRateLimiter(nil, 5, 1000)
	if !limiter.AllowCount("user-1") {
		t.Error("nil redis must fail open for the count limit")
	}
	if !limiter.AllowBytes("user-1", 500) {
		t.Error("nil redis must fail open for the byte quota")
	}
}

func TestUploadRateLimiter_ZeroLimits(t *testing.T) {
	_, limiter := newUploadLimiter(t, 0, 0)
	if limiter.AllowCount("user-1") {
		t.Error("zero max per minute must deny all uploads")
	}
	if limiter.AllowBytes("user-1", 10) {
		t.Error("zero byte quota must deny all uploads")
	}
}

// =============================================================================
// UploadRateLimitMiddleware — gin wrapper
// =============================================================================

func newUploadRateLimitContext(claimsUserID string, contentLength int64) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/storage/v1/upload", nil)
	c.Request.ContentLength = contentLength
	if claimsUserID != "" {
		c.Set("claims", &auth.Claims{UserID: claimsUserID})
	}
	return c, w
}

func TestUploadRateLimitMiddleware_NilRedis_PassesThrough(t *testing.T) {
	limiter := NewUploadRateLimiter(nil, 1, 1000)
	c, w := newUploadRateLimitContext("user-1", 100)
	UploadRateLimitMiddleware(limiter)(c)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 with nil redis (fail open), got %d", w.Code)
	}
}

func TestUploadRateLimitMiddleware_NoClaims_PassesThrough(t *testing.T) {
	_, limiter := newUploadLimiter(t, 1, 1000)
	c, w := newUploadRateLimitContext("", 100)
	UploadRateLimitMiddleware(limiter)(c)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 without claims, got %d", w.Code)
	}
}

func TestUploadRateLimitMiddleware_WithinLimits_PassesThrough(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	c, w := newUploadRateLimitContext("user-1", 100)
	UploadRateLimitMiddleware(limiter)(c)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200 within limits, got %d", w.Code)
	}
}

func TestUploadRateLimitMiddleware_CountExceeded_Returns429(t *testing.T) {
	_, limiter := newUploadLimiter(t, 1, 1000)
	mw := UploadRateLimitMiddleware(limiter)

	c1, _ := newUploadRateLimitContext("user-1", 100)
	mw(c1)

	c2, w2 := newUploadRateLimitContext("user-1", 100)
	mw(c2)

	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429, got %d", w2.Code)
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

func TestUploadRateLimitMiddleware_ByteQuotaExceeded_Returns429(t *testing.T) {
	_, limiter := newUploadLimiter(t, 5, 1000)
	mw := UploadRateLimitMiddleware(limiter)

	c1, _ := newUploadRateLimitContext("user-1", 700)
	mw(c1)

	c2, w2 := newUploadRateLimitContext("user-1", 700)
	mw(c2)

	if w2.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 when the byte quota is exceeded, got %d", w2.Code)
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(w2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	errMsg, _ := resp["error"].(string)
	if !strings.Contains(strings.ToLower(errMsg), "quota") {
		t.Errorf("expected error mentioning quota, got %q", errMsg)
	}
}

func TestUploadRateLimitMiddleware_DifferentUsers_Independent(t *testing.T) {
	_, limiter := newUploadLimiter(t, 1, 1000)
	mw := UploadRateLimitMiddleware(limiter)

	c1, _ := newUploadRateLimitContext("user-1", 100)
	mw(c1)

	c2, w2 := newUploadRateLimitContext("user-1", 100)
	mw(c2)
	if w2.Code != http.StatusTooManyRequests {
		t.Errorf("user-1 should be blocked, got %d", w2.Code)
	}

	c3, w3 := newUploadRateLimitContext("user-2", 100)
	mw(c3)
	if w3.Code != http.StatusOK {
		t.Errorf("user-2 expected 200, got %d", w3.Code)
	}
}
