package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/redis/go-redis/v9"
)

func newGlobalLimiter(t *testing.T, perUser, perIP int) (*miniredis.Miniredis, *GlobalRateLimiter) {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return mr, NewGlobalRateLimiter(rdb, perUser, perIP, time.Minute)
}

func TestGlobalRateLimiter_PerUserAndPerIPIndependent(t *testing.T) {
	_, rl := newGlobalLimiter(t, 3, 2)

	// IP bucket allows 2, third denied
	if !rl.Allow("ip:1.2.3.4", rl.maxRequestsPerIP) {
		t.Fatal("first IP request should be allowed")
	}
	if !rl.Allow("ip:1.2.3.4", rl.maxRequestsPerIP) {
		t.Fatal("second IP request should be allowed")
	}
	if rl.Allow("ip:1.2.3.4", rl.maxRequestsPerIP) {
		t.Fatal("third IP request should be denied")
	}

	// User bucket has its own budget — unaffected by the IP bucket
	if !rl.Allow("user:u1", rl.maxRequestsPerUser) {
		t.Fatal("user request should be allowed")
	}
	if !rl.Allow("user:u1", rl.maxRequestsPerUser) {
		t.Fatal("second user request should be allowed")
	}
	if !rl.Allow("user:u1", rl.maxRequestsPerUser) {
		t.Fatal("third user request should be allowed")
	}
	if rl.Allow("user:u1", rl.maxRequestsPerUser) {
		t.Fatal("fourth user request should be denied")
	}
}

func TestGlobalRateLimiter_WindowRefill(t *testing.T) {
	mr, rl := newGlobalLimiter(t, 2, 2)

	if !rl.Allow("ip:9.9.9.9", rl.maxRequestsPerIP) || !rl.Allow("ip:9.9.9.9", rl.maxRequestsPerIP) {
		t.Fatal("requests within limit should be allowed")
	}
	if rl.Allow("ip:9.9.9.9", rl.maxRequestsPerIP) {
		t.Fatal("request over limit should be denied")
	}

	mr.FastForward(61 * time.Second)
	if !rl.Allow("ip:9.9.9.9", rl.maxRequestsPerIP) {
		t.Fatal("bucket should refill after the window")
	}
}

func TestGlobalRateLimiter_NilRedisFailsOpen(t *testing.T) {
	rl := NewGlobalRateLimiter(nil, 1, 1, time.Minute)
	if !rl.Allow("ip:1.1.1.1", 1) {
		t.Fatal("nil Redis must fail open")
	}
	if !rl.Allow("ip:1.1.1.1", 1) {
		t.Fatal("nil Redis must fail open on every request")
	}
}

func TestGlobalRateLimiter_ZeroLimitDeniesAll(t *testing.T) {
	_, rl := newGlobalLimiter(t, 0, 0)
	if rl.Allow("ip:2.2.2.2", 0) {
		t.Fatal("zero budget must deny")
	}
}

func TestGlobalRateLimiter_PrefixesIndependent(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	// Both limiters share one IP key and one budget size, but different
	// prefixes: consuming one surface's budget must not touch the other's.
	rpcLimiter := NewGlobalRateLimiterWithPrefix("rpc", rdb, 900, 2, time.Minute)
	restLimiter := NewGlobalRateLimiterWithPrefix("global", rdb, 900, 2, time.Minute)

	// Exhaust the rpc per-IP budget.
	if !rpcLimiter.Allow("ip:5.5.5.5", rpcLimiter.maxRequestsPerIP) {
		t.Fatal("first rpc IP request should be allowed")
	}
	if !rpcLimiter.Allow("ip:5.5.5.5", rpcLimiter.maxRequestsPerIP) {
		t.Fatal("second rpc IP request should be allowed")
	}
	if rpcLimiter.Allow("ip:5.5.5.5", rpcLimiter.maxRequestsPerIP) {
		t.Fatal("third rpc IP request should be denied (budget exhausted)")
	}

	// The REST surface keeps its own untouched budget for the same IP.
	if !restLimiter.Allow("ip:5.5.5.5", restLimiter.maxRequestsPerIP) {
		t.Fatal("rest limiter must have an independent budget for the same IP")
	}
	if !restLimiter.Allow("ip:5.5.5.5", restLimiter.maxRequestsPerIP) {
		t.Fatal("second rest request must be allowed")
	}
}

func TestGlobalRateLimiter_DefaultPrefixMatchesLegacyKeys(t *testing.T) {
	// NewGlobalRateLimiter (no prefix) must keep using the "global" namespace
	// so existing Redis keys stay valid across deployments.
	limiter := NewGlobalRateLimiter(nil, 1, 1, time.Minute)
	if limiter.prefix != "global" {
		t.Fatalf("expected default prefix \"global\", got %q", limiter.prefix)
	}
}

func TestGlobalRateLimitMiddleware_AuthenticatedUsesUserBucket(t *testing.T) {
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	// Per-user budget of 1: the second authenticated request must 429.
	limiter := NewGlobalRateLimiter(rdb, 1, 10, time.Minute)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		c.Set("claims", &auth.Claims{UserID: "u-42"})
		c.Next()
	})
	router.Use(GlobalRateLimitMiddleware(limiter))
	router.GET("/test", func(c *gin.Context) { c.Status(http.StatusOK) })

	first := httptest.NewRecorder()
	router.ServeHTTP(first, httptest.NewRequest(http.MethodGet, "/test", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first authenticated request: expected 200, got %d", first.Code)
	}

	second := httptest.NewRecorder()
	router.ServeHTTP(second, httptest.NewRequest(http.MethodGet, "/test", nil))
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("second authenticated request: expected 429, got %d", second.Code)
	}

	// A different user is not affected (own budget).
	router2 := gin.New()
	router2.Use(func(c *gin.Context) {
		c.Set("claims", &auth.Claims{UserID: "u-43"})
		c.Next()
	})
	router2.Use(GlobalRateLimitMiddleware(limiter))
	router2.GET("/test", func(c *gin.Context) { c.Status(http.StatusOK) })

	other := httptest.NewRecorder()
	router2.ServeHTTP(other, httptest.NewRequest(http.MethodGet, "/test", nil))
	if other.Code != http.StatusOK {
		t.Fatalf("request from another user: expected 200, got %d", other.Code)
	}
}

// ─── Metrics middleware ──────────────────────────────────────────────────────

func TestMetricsMiddleware_TracksPerRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(MetricsMiddleware())
	router.GET("/ok", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.GET("/boom", func(c *gin.Context) { c.Status(http.StatusInternalServerError) })
	router.POST("/limited", func(c *gin.Context) { c.Status(http.StatusTooManyRequests) })

	for i := 0; i < 3; i++ {
		router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ok", nil))
	}
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/boom", nil))
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/limited", nil))

	rows := MetricsSnapshot()
	byRoute := map[string]MetricsRow{}
	for _, r := range rows {
		byRoute[r.Route] = r
	}

	if got := byRoute["GET /ok"].Requests; got != 3 {
		t.Errorf("GET /ok: expected 3 requests, got %d", got)
	}
	if got := byRoute["GET /ok"].AvgLatencyMs; got > 10000 {
		t.Errorf("GET /ok latency looks wrong: %d ms", got)
	}
	if got := byRoute["GET /boom"].ServerErrors; got != 1 {
		t.Errorf("GET /boom: expected 1 server error, got %d", got)
	}
	if got := byRoute["POST /limited"].RateLimited; got != 1 {
		t.Errorf("POST /limited: expected 1 rate-limited, got %d", got)
	}
}

func TestMetricsMiddleware_JSONSerializable(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.Use(MetricsMiddleware())
	router.GET("/a", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/a", nil))

	buf, err := json.Marshal(MetricsSnapshot())
	if err != nil {
		t.Fatalf("metrics snapshot must marshal to JSON: %v", err)
	}
	if len(buf) == 0 {
		t.Fatal("empty metrics JSON")
	}
}
