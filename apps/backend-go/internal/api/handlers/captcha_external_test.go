package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// =============================================================================
// verifyExternalToken
// =============================================================================

// mockCaptchaServer creates an httptest.Server that responds to POST /verify
// with the given status code and body.
func mockCaptchaServer(t *testing.T, status int, body interface{}) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			t.Errorf("expected POST, got %s", r.Method)
		}
		if ct := r.Header.Get("Content-Type"); ct != "application/json" {
			t.Errorf("expected Content-Type application/json, got %s", ct)
		}
		w.WriteHeader(status)
		if body != nil {
			b, _ := json.Marshal(body)
			w.Write(b)
		}
	}))
}

func TestVerifyExternalToken_EmptyToken(t *testing.T) {
	h := &CaptchaHandler{
		httpClient: http.DefaultClient,
	}
	err := h.verifyExternalToken("")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
	if err.Error() != "captcha token is required" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestVerifyExternalToken_ValidToken(t *testing.T) {
	srv := mockCaptchaServer(t, http.StatusOK, map[string]bool{"valid": true})
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("valid-token")
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestVerifyExternalToken_InvalidToken(t *testing.T) {
	srv := mockCaptchaServer(t, http.StatusOK, map[string]bool{"valid": false})
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("invalid-token")
	if err == nil {
		t.Fatal("expected error for invalid token")
	}
	if err.Error() != "captcha verification failed: token is invalid" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestVerifyExternalToken_ServerError(t *testing.T) {
	srv := mockCaptchaServer(t, http.StatusInternalServerError, "server error")
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("some-token")
	if err == nil {
		t.Fatal("expected error for server error")
	}
	// Should mention HTTP 500
	if err.Error() != "captcha verification failed (HTTP 500): \"server error\"" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestVerifyExternalToken_BadRequest(t *testing.T) {
	srv := mockCaptchaServer(t, http.StatusBadRequest, "bad request")
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("some-token")
	if err == nil {
		t.Fatal("expected error for bad request")
	}
	if err.Error() != "captcha verification failed (HTTP 400): \"bad request\"" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestVerifyExternalToken_NonJSONResponse(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("not-json"))
	}))
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("some-token")
	if err == nil {
		t.Fatal("expected error for non-JSON response")
	}
	if err.Error() != "unexpected captcha verification response: not-json" {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestVerifyExternalToken_ServerUnavailable(t *testing.T) {
	// Start a server that immediately closes
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Hijack and close the connection immediately
		hj, ok := w.(http.Hijacker)
		if ok {
			conn, _, _ := hj.Hijack()
			conn.Close()
		}
	}))
	// Close it immediately so connection fails
	srv.Close()

	h := &CaptchaHandler{
		siteKey:    "test-site-key",
		secret:     "test-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.verifyExternalToken("some-token")
	if err == nil {
		t.Fatal("expected error for unavailable server")
	}
	// Should indicate service unavailable
	if err.Error() != "captcha verification service unavailable: dial tcp: connect: connection refused" &&
		err.Error() != "captcha verification service unavailable: Post \""+srv.URL+"\": dial tcp: connect: connection refused" {
		t.Logf("unexpected error (but correct category): %v", err)
	}
}

func TestVerifyExternalToken_UsesConfiguredFields(t *testing.T) {
	// Verify that siteKey and secret are sent in the request body
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("failed to decode request body: %v", err)
		}
		if body["key"] != "expected-key" {
			t.Errorf("expected key 'expected-key', got %q", body["key"])
		}
		if body["secret"] != "expected-secret" {
			t.Errorf("expected secret 'expected-secret', got %q", body["secret"])
		}
		if body["token"] != "test-token" {
			t.Errorf("expected token 'test-token', got %q", body["token"])
		}
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]bool{"valid": true})
	}))
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "expected-key",
		secret:     "expected-secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	if err := h.verifyExternalToken("test-token"); err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

// =============================================================================
// VerifyPoW via external mode (delegates to verifyExternalToken)
// =============================================================================

func TestVerifyPoW_DelegatesToExternal(t *testing.T) {
	// When IsConfigured is true, VerifyPoW calls verifyExternalToken
	srv := mockCaptchaServer(t, http.StatusOK, map[string]bool{"valid": true})
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "key",
		secret:     "secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	if !h.IsConfigured() {
		t.Fatal("handler should be configured as external")
	}

	err := h.VerifyPoW("", "some-token")
	if err != nil {
		t.Errorf("expected no error, got: %v", err)
	}
}

func TestVerifyPoW_ExternalReturnsInvalid(t *testing.T) {
	srv := mockCaptchaServer(t, http.StatusOK, map[string]bool{"valid": false})
	defer srv.Close()

	h := &CaptchaHandler{
		siteKey:    "key",
		secret:     "secret",
		verifyURL:  srv.URL,
		httpClient: srv.Client(),
	}

	err := h.VerifyPoW("", "some-token")
	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "captcha verification failed: token is invalid" {
		t.Errorf("unexpected error: %v", err)
	}
}
