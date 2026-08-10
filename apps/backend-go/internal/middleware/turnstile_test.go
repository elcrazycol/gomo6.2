package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
)

// fakeSiteverify spins up an httptest server that answers like the canonical
// Cloudflare Turnstile siteverify endpoint, and points the package-level URL
// at it. The handler function lets each test control the JSON response.
func fakeSiteverify(t *testing.T, handler func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	t.Helper()
	old := turnstileSiteverifyURL
	server := httptest.NewServer(http.HandlerFunc(handler))
	turnstileSiteverifyURL = server.URL
	t.Cleanup(func() {
		server.Close()
		turnstileSiteverifyURL = old
	})
	return server
}

func newTurnstileCtx(t *testing.T) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.RemoteAddr = "203.0.113.7:1234"
	c.Request = req
	return c, w
}

func respondSiteverify(w http.ResponseWriter, body map[string]interface{}) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(body)
}

func TestVerifyTurnstile_Success(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Setenv("TURNSTILE_HOSTNAMES", "localhost, gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_SECRET")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("failed to parse form: %v", err)
		}
		if got := r.PostForm.Get("secret"); got != "test-secret" {
			t.Errorf("expected secret test-secret, got %q", got)
		}
		if got := r.PostForm.Get("response"); got != "valid-token" {
			t.Errorf("expected response valid-token, got %q", got)
		}
		if got := r.PostForm.Get("remoteip"); got != "203.0.113.7" {
			t.Errorf("expected remoteip 203.0.113.7, got %q", got)
		}
		respondSiteverify(w, map[string]interface{}{
			"success":  true,
			"action":   "signup",
			"hostname": "gomo6.wtf",
		})
	})

	c, _ := newTurnstileCtx(t)
	if !VerifyTurnstile(c, "valid-token", "signup") {
		t.Fatal("expected verification to succeed")
	}
}

func TestVerifyTurnstile_WrongAction(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Setenv("TURNSTILE_HOSTNAMES", "gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_SECRET")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		respondSiteverify(w, map[string]interface{}{
			"success":  true,
			"action":   "login",
			"hostname": "gomo6.wtf",
		})
	})

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "valid-token", "signup") {
		t.Fatal("expected verification to fail when action does not match")
	}
}

func TestVerifyTurnstile_HostnameNotAllowed(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Setenv("TURNSTILE_HOSTNAMES", "gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_SECRET")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		respondSiteverify(w, map[string]interface{}{
			"success":  true,
			"action":   "signup",
			"hostname": "evil.example.com",
		})
	})

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "valid-token", "signup") {
		t.Fatal("expected verification to fail for non-allowed hostname")
	}
}

func TestVerifyTurnstile_SiteverifyFailure(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Setenv("TURNSTILE_HOSTNAMES", "gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_SECRET")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		respondSiteverify(w, map[string]interface{}{
			"success":     false,
			"error-codes": []string{"invalid-input-response"},
		})
	})

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "bad-token", "signup") {
		t.Fatal("expected verification to fail when siteverify returns success=false")
	}
}

func TestVerifyTurnstile_FailsClosedWithoutSecret(t *testing.T) {
	os.Unsetenv("TURNSTILE_SECRET")
	os.Setenv("TURNSTILE_HOSTNAMES", "gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	// Even if the server would say success, missing TURNSTILE_SECRET must reject.
	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		respondSiteverify(w, map[string]interface{}{"success": true, "action": "signup", "hostname": "gomo6.wtf"})
	})

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "valid-token", "signup") {
		t.Fatal("expected fail-closed when TURNSTILE_SECRET is unset")
	}
}

func TestVerifyTurnstile_FailsClosedWithoutHostnames(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Unsetenv("TURNSTILE_HOSTNAMES")
	defer os.Unsetenv("TURNSTILE_SECRET")

	fakeSiteverify(t, func(w http.ResponseWriter, r *http.Request) {
		respondSiteverify(w, map[string]interface{}{"success": true, "action": "signup", "hostname": "gomo6.wtf"})
	})

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "valid-token", "signup") {
		t.Fatal("expected fail-closed when TURNSTILE_HOSTNAMES is unset")
	}
}

func TestVerifyTurnstile_EmptyToken(t *testing.T) {
	os.Setenv("TURNSTILE_SECRET", "test-secret")
	os.Setenv("TURNSTILE_HOSTNAMES", "gomo6.wtf")
	defer os.Unsetenv("TURNSTILE_SECRET")
	defer os.Unsetenv("TURNSTILE_HOSTNAMES")

	c, _ := newTurnstileCtx(t)
	if VerifyTurnstile(c, "", "signup") {
		t.Fatal("expected empty token to be rejected")
	}
}
