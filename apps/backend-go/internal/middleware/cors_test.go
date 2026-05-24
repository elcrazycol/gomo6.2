package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func setupCORSContext(method string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/api/test", nil)
	return c, w
}

func TestCORS_SetsHeaders(t *testing.T) {
	c, w := setupCORSContext("GET")

	CORS()(c)

	if w.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Errorf("expected Access-Control-Allow-Origin: *, got %q", w.Header().Get("Access-Control-Allow-Origin"))
	}
	if w.Header().Get("Access-Control-Allow-Methods") != "GET, POST, PUT, DELETE, OPTIONS" {
		t.Errorf("expected Access-Control-Allow-Methods header, got %q", w.Header().Get("Access-Control-Allow-Methods"))
	}
	if w.Header().Get("Access-Control-Allow-Headers") != "Origin, Content-Type, Accept, Authorization" {
		t.Errorf("expected Access-Control-Allow-Headers header, got %q", w.Header().Get("Access-Control-Allow-Headers"))
	}
}

func TestCORS_OPTIONS_Returns204(t *testing.T) {
	c, w := setupCORSContext("OPTIONS")

	CORS()(c)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204 for OPTIONS, got %d", w.Code)
	}
	if !c.IsAborted() {
		t.Error("OPTIONS request should be aborted")
	}
}

func TestCORS_GET_PassesThrough(t *testing.T) {
	handler := CORS()

	// Use gin engine to properly test c.Next() passthrough
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)

	handler(c)

	if c.IsAborted() {
		t.Error("GET request should NOT be aborted")
	}
}

func TestCORS_POST_PassesThrough(t *testing.T) {
	handler := CORS()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("POST", "/api/test", nil)

	handler(c)

	if c.IsAborted() {
		t.Error("POST request should NOT be aborted")
	}
}

func TestCORS_PUT_PassesThrough(t *testing.T) {
	handler := CORS()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("PUT", "/api/test", nil)

	handler(c)

	if c.IsAborted() {
		t.Error("PUT request should NOT be aborted")
	}
}

func TestCORS_DELETE_PassesThrough(t *testing.T) {
	handler := CORS()

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("DELETE", "/api/test", nil)

	handler(c)

	if c.IsAborted() {
		t.Error("DELETE request should NOT be aborted")
	}
}
