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

// =============================================================================
// SupabaseAuthMiddleware
// =============================================================================

func TestSupabaseAuthMiddleware_ValidBearer(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	c, w := newTestContext("GET", "/api/test", "Bearer "+token)

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for valid Bearer, got %d", w.Code)
	}

	claimsInterface, exists := c.Get("claims")
	if !exists {
		t.Fatal("claims not set after valid Supabase auth")
	}
	claims := claimsInterface.(*auth.Claims)
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID 'user-123', got %q", claims.UserID)
	}
}

func TestSupabaseAuthMiddleware_QueryToken(t *testing.T) {
	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-456", "bob", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test?token="+token, nil)

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for valid query token, got %d", w.Code)
	}

	claimsInterface, exists := c.Get("claims")
	if !exists {
		t.Fatal("claims not set after query token auth")
	}
	claims := claimsInterface.(*auth.Claims)
	if claims.UserID != "user-456" {
		t.Errorf("expected UserID 'user-456', got %q", claims.UserID)
	}
}

func TestSupabaseAuthMiddleware_QueryToken_Invalid(t *testing.T) {
	svc := auth.NewAuthService()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test?token=garbage", nil)

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid query token, got %d", w.Code)
	}
}

func TestSupabaseAuthMiddleware_NoAuth(t *testing.T) {
	svc := auth.NewAuthService()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for no auth, got %d", w.Code)
	}
}

func TestSupabaseAuthMiddleware_ApikeyHeader_Match(t *testing.T) {
	// Set the SUPABASE_ANON_KEY to a known value
	t.Setenv("SUPABASE_ANON_KEY", "test-anon-key-12345")

	svc := auth.NewAuthService()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)
	c.Request.Header.Set("apikey", "test-anon-key-12345")

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 for matching apikey, got %d", w.Code)
	}
}

func TestSupabaseAuthMiddleware_ApikeyHeader_Mismatch(t *testing.T) {
	t.Setenv("SUPABASE_ANON_KEY", "test-anon-key-12345")

	svc := auth.NewAuthService()

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)
	c.Request.Header.Set("apikey", "wrong-key")

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for mismatching apikey, got %d", w.Code)
	}
}

func TestSupabaseAuthMiddleware_BearerTakesPriorityOverApikey(t *testing.T) {
	// When both Bearer and apikey are present, Bearer should take priority
	t.Setenv("SUPABASE_ANON_KEY", "test-anon-key-12345")

	svc := auth.NewAuthService()
	token, err := svc.GenerateToken("user-999", "priority", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/test", nil)
	c.Request.Header.Set("Authorization", "Bearer "+token)
	c.Request.Header.Set("apikey", "test-anon-key-12345")

	middleware := SupabaseAuthMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 when both Bearer and apikey present, got %d", w.Code)
	}

	// Claims should come from token, not apikey
	claimsInterface, exists := c.Get("claims")
	if !exists {
		t.Fatal("claims not set")
	}
	claims := claimsInterface.(*auth.Claims)
	if claims.UserID != "user-999" {
		t.Errorf("expected UserID from token ('user-999'), got %q", claims.UserID)
	}
}
