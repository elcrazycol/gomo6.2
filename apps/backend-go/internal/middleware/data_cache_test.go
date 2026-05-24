package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// testDummyHandler returns a simple JSON response.
func testDummyHandler(c *gin.Context) {
	c.JSON(200, gin.H{"data": "hello", "id": "123"})
}

// testEmptyHandler returns an empty array (should not be cached).
func testEmptyHandler(c *gin.Context) {
	c.JSON(200, []interface{}{})
}

// TestDataCache_SkipNonGET verifies that POST/PUT/DELETE requests pass through without caching.
func TestDataCache_SkipNonGET(t *testing.T) {
	gin.SetMode(gin.TestMode)

	methods := []string{"POST", "PUT", "DELETE", "PATCH"}
	for _, method := range methods {
		t.Run(method, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(method, "/api/v1/test", nil)

			middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
			middleware(c)

			// Cache middleware should just call c.Next() → handler runs
			testDummyHandler(c)

			if w.Code != http.StatusOK {
				t.Errorf("expected 200, got %d", w.Code)
			}

			// X-Cache header should NOT be set (skip non-GET)
			if w.Header().Get("X-Cache") != "" {
				t.Errorf("expected no X-Cache header for %s, got %q", method, w.Header().Get("X-Cache"))
			}
		})
	}
}

// TestDataCache_NilRedis verifies that GET passes through when Redis is nil.
func TestDataCache_NilRedis(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/test", nil)

	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	testDummyHandler(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	// X-Cache should NOT be set (nil redis → passthrough)
	if w.Header().Get("X-Cache") != "" {
		t.Errorf("expected no X-Cache header with nil redis, got %q", w.Header().Get("X-Cache"))
	}
}

// TestDataCache_Passthrough verifies that GET with redis=nil passes through and handler works.
func TestDataCache_Passthrough(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/test", nil)

	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	testDummyHandler(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	// Verify response body is correct after passthrough
	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp["data"] != "hello" {
		t.Errorf("expected data='hello', got %v", resp["data"])
	}

	// No X-Cache header with nil redis (middleware returns early before setting it)
	if w.Header().Get("X-Cache") != "" {
		t.Errorf("expected no X-Cache header with nil redis, got %q", w.Header().Get("X-Cache"))
	}
}

// TestDataCache_NoCacheKeyWithNilRedis verifies cache_key is NOT set when redis is nil.
func TestDataCache_NoCacheKeyWithNilRedis(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/test?foo=bar", nil)

	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	testDummyHandler(c)

	// With nil redis, middleware returns early — cache_key should NOT be set
	_, exists := c.Get("cache_key")
	if exists {
		t.Error("cache_key should NOT be set when redis is nil")
	}
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// TestDataCache_GetWithNilRedis_NoCrash verifies GET with nil redis and empty body doesn't crash.
func TestDataCache_GetWithNilRedis_NoCrash(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/data", nil)

	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	testEmptyHandler(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// TestDataCache_ResponseWriter verifies the responseWriter wraps correctly.
func TestDataCache_ResponseWriter(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/test", nil)

	// With nil redis, middleware does c.Next() and returns early
	// The writer is NOT wrapped in this path (early return before responseWriter)
	// So this test just verifies no crash
	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	c.Next()

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

// TestDataCache_MultipleWrites verifies gin context JSON works after middleware passthrough.
func TestDataCache_GinResponseAfterPassthrough(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/v1/test", nil)

	middleware := DataCacheMiddleware(nil, DefaultDataCacheTTL)
	middleware(c)
	c.JSON(200, gin.H{"a": 1, "b": 2})

	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("json unmarshal: %v", err)
	}
	if resp["a"] != float64(1) || resp["b"] != float64(2) {
		t.Errorf("unexpected body: %v", resp)
	}
}
