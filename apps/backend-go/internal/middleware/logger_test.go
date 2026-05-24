package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// captureLogger creates a gin engine with Logger middleware that writes to a buffer
func captureLogger(method, path string, statusCode int, latency time.Duration) string {
	gin.SetMode(gin.TestMode)

	var buf bytes.Buffer
	gin.DefaultWriter = &buf

	router := gin.New()
	router.Use(Logger())

	router.Handle(method, path, func(c *gin.Context) {
		time.Sleep(latency)
		c.Status(statusCode)
	})

	req := httptest.NewRequest(method, path, nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	return buf.String()
}

func TestLogger_FormatsGETRequest(t *testing.T) {
	output := captureLogger("GET", "/api/test", http.StatusOK, 0)

	if output == "" {
		t.Fatal("expected non-empty log output")
	}

	// Should contain method, path, status code
	if !contains(output, "GET") {
		t.Errorf("expected log to contain 'GET', got: %s", output)
	}
	if !contains(output, "/api/test") {
		t.Errorf("expected log to contain '/api/test', got: %s", output)
	}
	if !contains(output, "200") {
		t.Errorf("expected log to contain '200', got: %s", output)
	}
}

func TestLogger_FormatsPOSTRequest(t *testing.T) {
	output := captureLogger("POST", "/api/auth/login", http.StatusUnauthorized, 0)

	if !contains(output, "POST") {
		t.Errorf("expected log to contain 'POST', got: %s", output)
	}
	if !contains(output, "/api/auth/login") {
		t.Errorf("expected log to contain '/api/auth/login', got: %s", output)
	}
	if !contains(output, "401") {
		t.Errorf("expected log to contain '401', got: %s", output)
	}
}

func TestLogger_ContainsLatency(t *testing.T) {
	output := captureLogger("GET", "/api/test", http.StatusOK, 10*time.Millisecond)

	if !contains(output, "ms") && !contains(output, "µs") {
		t.Errorf("expected log to contain latency, got: %s", output)
	}
}

func TestLogger_ContainsHTTPProto(t *testing.T) {
	output := captureLogger("GET", "/api/test", http.StatusOK, 0)

	if !contains(output, "HTTP/") {
		t.Errorf("expected log to contain HTTP proto, got: %s", output)
	}
}

func TestLogger_NoClientIPOrUserAgent(t *testing.T) {
	output := captureLogger("GET", "/api/test", http.StatusOK, 0)

	// The LoggerWithFormatter only includes: timestamp, method, path, proto, status, latency, err
	// It should NOT include client IP or User-Agent for privacy
	if contains(output, "User-Agent") || contains(output, "client_ip") {
		t.Errorf("expected no client IP or User-Agent in log for privacy, got: %s", output)
	}
}

func TestLogger_ErrorRequest(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var buf bytes.Buffer
	gin.DefaultWriter = &buf

	router := gin.New()
	router.Use(Logger())

	router.GET("/api/error", func(c *gin.Context) {
		c.Error(NewHTTPError(http.StatusNotFound, "not found"))
		c.Status(http.StatusNotFound)
	})

	req := httptest.NewRequest("GET", "/api/error", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	output := buf.String()
	if !contains(output, "404") {
		t.Errorf("expected log to contain '404', got: %s", output)
	}
}

func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
