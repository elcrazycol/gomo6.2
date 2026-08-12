package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

func TestPresenceThrottle_Limits(t *testing.T) {
	throttle := newPresenceThrottle()

	if !throttle.allow("u1", time.Minute) {
		t.Fatal("first touch must be allowed")
	}
	if throttle.allow("u1", time.Minute) {
		t.Fatal("second touch within the window must be throttled")
	}
	// Different user is not affected.
	if !throttle.allow("u2", time.Minute) {
		t.Fatal("another user must not be throttled")
	}
	// After the window passes, the user is allowed again.
	throttle.last["u1"] = time.Now().Add(-2 * time.Minute)
	if !throttle.allow("u1", time.Minute) {
		t.Fatal("touch after the window must be allowed")
	}
}

// newPresenceGinContext builds a gin context with (optionally) a claims value.
func newPresenceGinContext(claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	c.Request = req
	if claims != nil {
		c.Set("claims", claims)
	}
	return c, w
}

func TestPresenceActivity_TouchesAuthenticatedOncePerWindow(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var touches int
	mw := PresenceActivity(func(userID string) {
		touches++
	}, time.Minute)

	c1, _ := newPresenceGinContext(&auth.Claims{UserID: "user-1"})
	mw(c1)
	if touches != 1 {
		t.Fatalf("expected 1 touch, got %d", touches)
	}

	// Same user within the window: no second touch.
	c2, _ := newPresenceGinContext(&auth.Claims{UserID: "user-1"})
	mw(c2)
	if touches != 1 {
		t.Fatalf("expected still 1 touch, got %d", touches)
	}

	// Different user: touched.
	c3, _ := newPresenceGinContext(&auth.Claims{UserID: "user-2"})
	mw(c3)
	if touches != 2 {
		t.Fatalf("expected 2 touches, got %d", touches)
	}
}

func TestPresenceActivity_NoClaims_NoTouch(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var touches int
	mw := PresenceActivity(func(userID string) {
		touches++
	}, time.Minute)

	c, _ := newPresenceGinContext(nil)
	mw(c)
	if touches != 0 {
		t.Fatalf("expected 0 touches without claims, got %d", touches)
	}
}

func TestPresenceActivity_NilTouch_Noop(t *testing.T) {
	gin.SetMode(gin.TestMode)
	mw := PresenceActivity(nil, time.Minute)

	c, w := newPresenceGinContext(&auth.Claims{UserID: "user-1"})
	mw(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}
