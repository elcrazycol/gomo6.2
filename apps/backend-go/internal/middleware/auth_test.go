package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gomo6/backend/internal/auth"
)

// =============================================================================
// AuthMiddleware
// =============================================================================

func newTestContext(method, path, authHeader string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, nil)
	if authHeader != "" {
		c.Request.Header.Set("Authorization", authHeader)
	}
	return c, w
}

func TestAuthMiddleware_ValidToken(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	c, w := newTestContext("GET", "/api/test", "Bearer "+token)

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		// Status OK means middleware passed (c.Next() was called)
		t.Errorf("expected 200 after valid token, got %d", w.Code)
	}

	// Claims should be set in context
	claimsInterface, exists := c.Get("claims")
	if !exists {
		t.Fatal("claims not set in context after valid auth")
	}
	claims, ok := claimsInterface.(*auth.Claims)
	if !ok {
		t.Fatalf("unexpected claims type: %T", claimsInterface)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID 'user-123', got %q", claims.UserID)
	}
}

func TestAuthMiddleware_NoHeader(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newTestContext("GET", "/api/test", "")

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for missing header, got %d", w.Code)
	}

	// Verify c.Abort() was called — no claims should be set
	_, exists := c.Get("claims")
	if exists {
		t.Error("claims should not be set when auth fails")
	}
}

func TestAuthMiddleware_InvalidFormat_NoBearer(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newTestContext("GET", "/api/test", "token-without-bearer")

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for non-Bearer header, got %d", w.Code)
	}
}

func TestAuthMiddleware_InvalidFormat_EmptyBearer(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newTestContext("GET", "/api/test", "Bearer ")

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for Bearer with no token, got %d", w.Code)
	}
}

func TestAuthMiddleware_InvalidFormat_ThreeParts(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newTestContext("GET", "/api/test", "Bearer token extra")

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for malformed header, got %d", w.Code)
	}
}

func TestAuthMiddleware_InvalidToken(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newTestContext("GET", "/api/test", "Bearer garbage.token.here")

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid token, got %d", w.Code)
	}
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	// Use a fixed JWT secret so we can manually create an expired token
	secret := "test-expired-secret-at-least-32-bytes-ok"
	t.Setenv("JWT_SECRET", secret)

	svc := auth.NewAuthService()

	// Create a token that expired 1 hour ago
	claims := auth.Claims{
		UserID:   "user-123",
		Username: "alice",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to create expired token: %v", err)
	}

	c, w := newTestContext("GET", "/api/test", "Bearer "+tokenStr)

	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired token, got %d", w.Code)
	}
}

// TestAuthMiddleware_BlacklistedToken verifies that a blacklisted token is rejected.
// Since we don't have Redis in tests, this verifies the JWT validation itself works
// with the blacklist feature (which is a no-op without Redis).
func TestAuthMiddleware_BlacklistedToken_NoRedis(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	// Blacklist the token (no-op without Redis)
	svc.BlacklistToken("some-jti", time.Now().Add(1*time.Hour))

	// Token should still be valid (blacklist requires Redis)
	c, w := newTestContext("GET", "/api/test", "Bearer "+token)
	middleware := AuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for valid token (blacklist is no-op without Redis), got %d", w.Code)
	}
}

// TestAuthMiddleware_WrongUserToken verifies a token for a different service is rejected.
// The secrets are pinned explicitly: when JWT_SECRET exists in the environment
// (e.g. a local .env export), two bare NewAuthService() calls would share one
// secret and this test would silently pass a foreign token.
func TestAuthMiddleware_DifferentServiceToken(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-a-that-is-definitely-32-bytes-aaaa")
	svcA := auth.NewAuthService()
	t.Setenv("JWT_SECRET", "test-secret-b-that-is-definitely-32-bytes-bbbb")
	svcB := auth.NewAuthService()

	token, err := svcA.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	c, w := newTestContext("GET", "/api/test", "Bearer "+token)
	middleware := AuthMiddleware(svcB) // different service
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for token from different service, got %d", w.Code)
	}
}

// =============================================================================
// AuthCacheMiddleware
// =============================================================================

func newCacheTestContext(method, path string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, path, nil)
	return c, w
}

func TestAuthCacheMiddleware_Bearer_Valid(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	c, w := newCacheTestContext("GET", "/api/test")
	c.Request.Header.Set("Authorization", "Bearer "+token)

	middleware := AuthCacheMiddleware(svc, nil) // no Redis
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for valid Bearer token, got %d", w.Code)
	}

	claimsInterface, exists := c.Get("claims")
	if !exists {
		t.Fatal("claims not set")
	}
	claims := claimsInterface.(*auth.Claims)
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID 'user-123', got %q", claims.UserID)
	}
}

func TestAuthCacheMiddleware_ExpiredToken(t *testing.T) {
	secret := "test-authcache-expired-secret-at-least-32-ok"
	t.Setenv("JWT_SECRET", secret)

	svc := auth.NewAuthService()

	// Create a token that expired 1 hour ago
	claims := auth.Claims{
		UserID:   "user-123",
		Username: "alice",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to create expired token: %v", err)
	}

	c, w := newCacheTestContext("GET", "/api/test")
	c.Request.Header.Set("Authorization", "Bearer "+tokenStr)

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for expired token, got %d", w.Code)
	}

	_, exists := c.Get("claims")
	if exists {
		t.Error("claims should not be set for expired token")
	}
}

func TestAuthCacheMiddleware_QueryToken_Rejected(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-456", "bob", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	c, w := newCacheTestContext("GET", "/api/test?token="+token)
	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for query token, got %d", w.Code)
	}
	if _, exists := c.Get("claims"); exists {
		t.Fatal("claims must not be set for query token")
	}
}

func TestAuthCacheMiddleware_QueryToken_Invalid_Rejected(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newCacheTestContext("GET", "/api/test?token=garbage")
	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for query token, got %d", w.Code)
	}
	if _, exists := c.Get("claims"); exists {
		t.Error("claims should not be set for query token")
	}
}

func TestAuthCacheMiddleware_NoAuth(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newCacheTestContext("GET", "/api/test")

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for no auth, got %d", w.Code)
	}
}

func TestAuthCacheMiddleware_WebSocketUpgrade_Unauthorized(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newCacheTestContext("GET", "/ws")
	c.Request.Header.Set("Upgrade", "websocket")

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	// Should return 401 (not 200) — the upgraded middleware uses AbortWithStatus(401)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthorized WebSocket upgrade, got %d", w.Code)
	}

	// Should NOT have a JSON body (browsers can't read it during WebSocket handshake)
	body := w.Body.String()
	if body != "" {
		t.Errorf("expected empty body for WebSocket abort, got %q", body)
	}
}

// Query tokens are rejected before any upgrade/auth handling, including a
// request that happens to carry WebSocket headers.
func TestAuthCacheMiddleware_WebSocketUpgrade_QueryTokenRejected(t *testing.T) {
	svc := auth.NewAuthService()

	c, w := newCacheTestContext("GET", "/ws?token=garbage.token.here")
	c.Request.Header.Set("Upgrade", "websocket")

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for WebSocket query token, got %d", w.Code)
	}
}

// TestAuthCacheMiddleware_WebSocketUpgrade_ExpiredToken verifies that a WebSocket
// upgrade with an expired query token is rejected with 401 and empty body.
func TestAuthCacheMiddleware_WebSocketUpgrade_ExpiredToken(t *testing.T) {
	secret := "test-ws-expired-secret-at-least-32-bytes-ok"
	t.Setenv("JWT_SECRET", secret)

	svc := auth.NewAuthService()

	// Create a token that expired 1 hour ago
	claims := auth.Claims{
		UserID:   "user-123",
		Username: "alice",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("failed to create expired token: %v", err)
	}

	c, w := newCacheTestContext("GET", "/ws?token="+tokenStr)
	c.Request.Header.Set("Upgrade", "websocket")

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for WebSocket query token, got %d", w.Code)
	}

	_, exists := c.Get("claims")
	if exists {
		t.Error("claims should not be set for expired token")
	}
}

func TestAuthCacheMiddleware_BearerPriorityOverQuery(t *testing.T) {
	svc := auth.NewAuthService()
	bearerToken, _ := svc.GenerateToken("user-bearer", "alice", "gomo6.wtf")
	queryToken, _ := svc.GenerateToken("user-query", "bob", "gomo6.wtf")

	// A query token is rejected even when a valid Bearer token is present.
	c, w := newCacheTestContext("GET", "/api/test?token="+queryToken)
	c.Request.Header.Set("Authorization", "Bearer "+bearerToken)

	middleware := AuthCacheMiddleware(svc, nil)
	middleware(c)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 when query token is present, got %d", w.Code)
	}
	if _, exists := c.Get("claims"); exists {
		t.Fatal("claims must not be set when query token is present")
	}
}
