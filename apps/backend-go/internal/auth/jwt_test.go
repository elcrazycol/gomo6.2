package auth

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// =============================================================================
// GetJWTSecret
// =============================================================================

func TestGetJWTSecret_FromEnv(t *testing.T) {
	os.Setenv("JWT_SECRET", "my-very-secure-secret-at-least-32-bytes!!")
	defer os.Unsetenv("JWT_SECRET")

	secret := GetJWTSecret()
	if secret != "my-very-secure-secret-at-least-32-bytes!!" {
		t.Errorf("expected env secret, got %q", secret)
	}
}

func TestGetJWTSecret_TooShort(t *testing.T) {
	// Should log a warning but still return the value
	os.Setenv("JWT_SECRET", "short")
	defer os.Unsetenv("JWT_SECRET")

	secret := GetJWTSecret()
	if secret != "short" {
		t.Errorf("expected short secret to be returned anyway, got %q", secret)
	}
}

func TestGetJWTSecret_AutoGenerate(t *testing.T) {
	// No env var set — should auto-generate a 64-char hex string
	os.Unsetenv("JWT_SECRET")

	secret := GetJWTSecret()

	// Should be a 64-char hex string (32 bytes * 2 hex chars)
	if len(secret) != 64 {
		t.Errorf("expected 64-char auto-generated secret, got %d chars: %q", len(secret), secret)
	}

	// Should be callable multiple times — each call generates a new secret
	secret2 := GetJWTSecret()
	if secret == secret2 {
		t.Error("expected each GetJWTSecret() call to generate a different key when JWT_SECRET is not set")
	}
}

// =============================================================================
// GenerateToken
// =============================================================================

func TestGenerateToken_Success(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty token")
	}

	// Token should have 3 parts (header.payload.signature)
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		t.Errorf("expected 3-part JWT, got %d parts", len(parts))
	}

	// Validate the token we just created
	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed for just-generated token: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID 'user-123', got %q", claims.UserID)
	}
	if claims.Username != "alice" {
		t.Errorf("expected Username 'alice', got %q", claims.Username)
	}
	if claims.Domain != "gomo6.wtf" {
		t.Errorf("expected Domain 'gomo6.wtf', got %q", claims.Domain)
	}
}

func TestGenerateToken_Expiry24Hours(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}

	now := time.Now()
	expiresAt := claims.ExpiresAt.Time

	// Should expire ~24 hours from now (allow 5 second tolerance)
	expectedExpiry := now.Add(24 * time.Hour)
	diff := expiresAt.Sub(expectedExpiry)
	if diff < -5*time.Second || diff > 5*time.Second {
		t.Errorf("expected expiry ~24h from now, got %v (diff: %v)", expiresAt, diff)
	}
}

// =============================================================================
// GeneratePartialToken
// =============================================================================

func TestGeneratePartialToken_Success(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GeneratePartialToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GeneratePartialToken failed: %v", err)
	}
	if token == "" {
		t.Fatal("expected non-empty partial token")
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed for partial token: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID 'user-123', got %q", claims.UserID)
	}
}

func TestGeneratePartialToken_Expiry5Minutes(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GeneratePartialToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GeneratePartialToken failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}

	now := time.Now()
	expiresAt := claims.ExpiresAt.Time

	// Should expire ~5 minutes from now (allow 5 second tolerance)
	expectedExpiry := now.Add(5 * time.Minute)
	diff := expiresAt.Sub(expectedExpiry)
	if diff < -5*time.Second || diff > 5*time.Second {
		t.Errorf("expected expiry ~5m from now, got %v (diff: %v)", expiresAt, diff)
	}
}

func TestPartialToken_ShorterThanFullToken(t *testing.T) {
	svc := NewAuthService()

	fullToken, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}
	partialToken, err := svc.GeneratePartialToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GeneratePartialToken failed: %v", err)
	}

	fullClaims, _ := svc.ValidateToken(fullToken)
	partialClaims, _ := svc.ValidateToken(partialToken)

	if !partialClaims.ExpiresAt.Before(fullClaims.ExpiresAt.Time) {
		t.Error("partial token must expire before full token")
	}
}

// =============================================================================
// ValidateToken — security tests
// =============================================================================

func TestValidateToken_EmptyString(t *testing.T) {
	svc := NewAuthService()

	_, err := svc.ValidateToken("")
	if err == nil {
		t.Fatal("expected error for empty token")
	}
}

func TestValidateToken_Garbage(t *testing.T) {
	svc := NewAuthService()

	_, err := svc.ValidateToken("not-a-valid-jwt-token-at-all")
	if err == nil {
		t.Fatal("expected error for garbage token")
	}
}

func TestValidateToken_TamperedPayload(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	// Tamper: change the user ID in the payload but keep signature
	parts := strings.Split(token, ".")
	// Decode payload, replace user-123 with admin, re-encode
	// Actually, we can't easily do this without base64 — just add a character
	parts[1] = parts[1] + "X"
	tamperedToken := strings.Join(parts, ".")

	_, err = svc.ValidateToken(tamperedToken)
	if err == nil {
		t.Fatal("SECURITY: tampered token was accepted! This is a critical vulnerability.")
	}
}

func TestValidateToken_WrongKey(t *testing.T) {
	// Generate with service A
	svcA := NewAuthService()

	token, err := svcA.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	// Try to validate with service B (different key)
	svcB := NewAuthService()

	_, err = svcB.ValidateToken(token)
	if err == nil {
		t.Fatal("SECURITY: token signed with key A was accepted by key B!")
	}
}

func TestValidateToken_ExpiredToken(t *testing.T) {
	svc := NewAuthService()

	// Create a token with a custom expiry in the past
	claims := Claims{
		UserID:   "user-123",
		Username: "alice",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(svc.jwtSecret)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	_, err = svc.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("SECURITY: expired token was accepted!")
	}
}

func TestValidateToken_AlgorithmConfusion_None(t *testing.T) {
	// Attacker tries to use "none" algorithm to bypass signature verification
	svc := NewAuthService()

	// Craft a token with alg: "none"
	claims := jwt.MapClaims{
		"user_id":  "admin",
		"username": "admin",
		"domain":   "gomo6.wtf",
		"exp":      time.Now().Add(24 * time.Hour).Unix(),
		"iat":      time.Now().Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	tokenStr, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("failed to create none-alg token: %v", err)
	}

	_, err = svc.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("SECURITY: 'none' algorithm token was accepted! Algorithm confusion attack possible.")
	}
}

func TestValidateToken_AlgorithmConfusion_RS256(t *testing.T) {
	// Attacker tries to use RS256 instead of HS256
	// Our validator MUST reject this since we only allow HS256
	svc := NewAuthService()

	// Create a token signed with HS256 but claiming RS256
	claims := Claims{
		UserID:   "admin",
		Username: "admin",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)

	// Override the header to claim RS256
	token.Header["alg"] = "RS256"

	tokenStr, err := token.SignedString(svc.jwtSecret)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	_, err = svc.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("SECURITY: RS256-claiming token was accepted with HS256 key! Algorithm confusion possible.")
	}
}

func TestValidateToken_AlgorithmConfusion_HS384(t *testing.T) {
	// Even HS384 should be rejected — we only accept HS256
	svc := NewAuthService()

	claims := Claims{
		UserID:   "admin",
		Username: "admin",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["alg"] = "HS384"
	tokenStr, err := token.SignedString(svc.jwtSecret)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	_, err = svc.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("SECURITY: HS384-claiming token was accepted. Only HS256 should be allowed.")
	}
}

func TestValidateToken_NoExpiration(t *testing.T) {
	// Token without expiry should still be validated (jwt library handles this)
	svc := NewAuthService()

	claims := Claims{
		UserID:   "user-123",
		Username: "alice",
		Domain:   "gomo6.wtf",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt: jwt.NewNumericDate(time.Now()),
			// No ExpiresAt
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString(svc.jwtSecret)
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}

	_, err = svc.ValidateToken(tokenStr)
	if err != nil {
		t.Errorf("token without expiry was rejected: %v (this may be OK depending on config)", err)
	}
}

// =============================================================================
// Token uniqueness
// =============================================================================

func TestGenerateToken_Unique(t *testing.T) {
	// JWT iat claim has second precision — identical claims in the same second
	// produce identical tokens. We advance time between iterations.
	svc := NewAuthService()

	tokens := make(map[string]bool)
	for i := 0; i < 5; i++ {
		token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
		if err != nil {
			t.Fatalf("GenerateToken #%d failed: %v", i, err)
		}
		if tokens[token] {
			t.Fatalf("duplicate token generated at iteration %d", i)
		}
		tokens[token] = true
		time.Sleep(1100 * time.Millisecond)
	}
}

// =============================================================================
// Empty/edge claims
// =============================================================================

func TestGenerateToken_EmptyUserID(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken with empty UserID failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.UserID != "" {
		t.Errorf("expected empty UserID, got %q", claims.UserID)
	}
}

func TestGenerateToken_SpecialCharacters(t *testing.T) {
	svc := NewAuthService()

	userID := "user-123<script>alert('xss')</script>"
	username := "alice@example.com|rm -rf /"
	domain := "gomo6.wtf'; DROP TABLE users;--"

	token, err := svc.GenerateToken(userID, username, domain)
	if err != nil {
		t.Fatalf("GenerateToken with special chars failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("UserID mismatch, got %q", claims.UserID)
	}
	if claims.Username != username {
		t.Errorf("Username mismatch, got %q", claims.Username)
	}
	if claims.Domain != domain {
		t.Errorf("Domain mismatch, got %q", claims.Domain)
	}
}

func TestGenerateToken_Unicode(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("user-日本語", "アリス", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken with unicode failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}
	if claims.Username != "アリス" {
		t.Errorf("Unicode username mismatch, got %q", claims.Username)
	}
}
