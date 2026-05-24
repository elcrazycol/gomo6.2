package auth

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/redis/go-redis/v9"
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

func TestGenerateToken_Expiry1Hour(t *testing.T) {
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

	// Should expire ~1 hour from now (allow 5 second tolerance)
	expectedExpiry := now.Add(1 * time.Hour)
	diff := expiresAt.Sub(expectedExpiry)
	if diff < -5*time.Second || diff > 5*time.Second {
		t.Errorf("expected expiry ~1h from now, got %v (diff: %v)", expiresAt, diff)
	}
}

func TestGenerateToken_HasJTI(t *testing.T) {
	svc := NewAuthService()

	token, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	claims, err := svc.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken failed: %v", err)
	}

	if claims.ID == "" {
		t.Fatal("expected jti (ID) to be set on token claims")
	}

	// Two tokens should have different jti
	token2, _ := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	claims2, _ := svc.ValidateToken(token2)
	if claims.ID == claims2.ID {
		t.Fatal("different tokens should have unique jti values")
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
// GenerateTokenPair & Refresh Tokens
// =============================================================================

func TestGenerateTokenPair_Success(t *testing.T) {
	svc := NewAuthService()

	pair, err := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}
	if pair.AccessToken == "" {
		t.Fatal("expected non-empty access token")
	}
	if pair.RefreshToken == "" {
		t.Fatal("expected non-empty refresh token")
	}
	if pair.ExpiresIn != 3600 {
		t.Errorf("expected 3600 expires_in, got %d", pair.ExpiresIn)
	}

	// Access token should be valid JWT
	claims, err := svc.ValidateToken(pair.AccessToken)
	if err != nil {
		t.Fatalf("access token validation failed: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected UserID user-123, got %q", claims.UserID)
	}
}

func TestGenerateTokenPair_UniqueRefreshTokens(t *testing.T) {
	svc := NewAuthService()

	pair1, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	pair2, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	if pair1.RefreshToken == pair2.RefreshToken {
		t.Fatal("refresh tokens must be unique")
	}
}

func TestRefreshTokenExists_NoRedis(t *testing.T) {
	svc := NewAuthService() // no Redis set

	if svc.refreshTokenExists("user-123", "any-token") {
		t.Fatal("refreshTokenExists should return false without Redis")
	}
}

func TestRefreshAccessToken_NoRedis(t *testing.T) {
	svc := NewAuthService()

	_, err := svc.RefreshAccessToken("user-123", "alice", "gomo6.wtf", "any-token")
	if err == nil {
		t.Fatal("RefreshAccessToken should fail without Redis")
	}
}

func TestBlacklistToken_NoRedis(t *testing.T) {
	svc := NewAuthService()

	// Should not panic when Redis is nil
	svc.BlacklistToken("test-jti", time.Now().Add(1*time.Hour))
}

func TestBlacklistToken_EmptyJTI(t *testing.T) {
	svc := NewAuthService()

	svc.BlacklistToken("", time.Now().Add(1*time.Hour))
	// Should not panic
}

func TestBlacklistToken_AlreadyExpired(t *testing.T) {
	svc := NewAuthService()

	// Token already expired - should not try to blacklist
	svc.BlacklistToken("test-jti", time.Now().Add(-1*time.Hour))
}

func TestIsTokenBlacklisted_NoRedis(t *testing.T) {
	svc := NewAuthService()

	if svc.isTokenBlacklisted("any-jti") {
		t.Fatal("isTokenBlacklisted should return false without Redis")
	}
}

func TestIsTokenBlacklisted_EmptyJTI(t *testing.T) {
	svc := NewAuthService()

	if svc.isTokenBlacklisted("") {
		t.Fatal("isTokenBlacklisted should return false for empty jti")
	}
}

func TestRevokeAllRefreshTokens_NoRedis(t *testing.T) {
	svc := NewAuthService()

	// Should not panic
	svc.RevokeAllRefreshTokens("user-123")
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

// =============================================================================
// Redis-dependent tests (using miniredis)
// =============================================================================

func setupRedisAuthService(t *testing.T) (*AuthService, *miniredis.Miniredis) {
	t.Helper()

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	t.Cleanup(func() { mr.Close() })

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { client.Close() })

	svc := NewAuthService()
	svc.SetRedis(client)

	return svc, mr
}

func TestSetRedis(t *testing.T) {
	svc := NewAuthService()
	if svc.redis != nil {
		t.Fatal("redis should be nil before SetRedis")
	}

	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("failed to start miniredis: %v", err)
	}
	defer mr.Close()

	client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	defer client.Close()

	svc.SetRedis(client)
	if svc.redis == nil {
		t.Fatal("redis should NOT be nil after SetRedis")
	}
}

func TestSetRedis_Nil(t *testing.T) {
	svc := NewAuthService()
	svc.SetRedis(nil)
	// Should not panic, redis stays nil
}

func TestGenerateTokenPair_StoresInRedis(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	pair, err := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateTokenPair failed: %v", err)
	}

	// Verify refresh token hash is stored in Redis
	hash := sha256.Sum256([]byte(pair.RefreshToken))
	key := fmt.Sprintf("refresh:user-123:%x", hash)

	val, err := mr.Get(key)
	if err != nil {
		t.Fatalf("refresh token not stored in Redis: %v", err)
	}
	if val != "1" {
		t.Errorf("expected '1', got %q", val)
	}

	// Verify TTL is set (7 days)
	ttl := mr.TTL(key)
	if ttl < 6*24*time.Hour || ttl > 7*24*time.Hour {
		t.Errorf("expected TTL ~7 days, got %v", ttl)
	}
}

func TestRefreshTokenExists_WithRedis_Exists(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	pair, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	if !svc.refreshTokenExists("user-123", pair.RefreshToken) {
		t.Fatal("refreshTokenExists should return true for just-stored token")
	}
}

func TestRefreshTokenExists_WithRedis_NotExists(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	if svc.refreshTokenExists("user-123", "nonexistent-token") {
		t.Fatal("refreshTokenExists should return false for non-existent token")
	}
}

func TestRefreshTokenExists_WithRedis_WrongHash(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	// Store one token, check for different token
	pair, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	// Slightly different token should not match
	if svc.refreshTokenExists("user-123", pair.RefreshToken+"x") {
		t.Fatal("refreshTokenExists should return false for modified token")
	}
}

func TestDeleteRefreshToken_WithRedis(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	pair, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	hash := sha256.Sum256([]byte(pair.RefreshToken))
	key := fmt.Sprintf("refresh:user-123:%x", hash)

	// Verify token exists before delete
	if _, err := mr.Get(key); err != nil {
		t.Fatalf("token should exist before delete: %v", err)
	}

	svc.deleteRefreshToken("user-123", pair.RefreshToken)

	// Verify token is deleted
	if mr.Exists(key) {
		t.Fatal("token should be deleted after deleteRefreshToken")
	}
}

func TestRefreshAccessToken_WithRedis_Success(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	pair, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	oldRefreshToken := pair.RefreshToken

	// Calculate old key to verify deletion
	oldHash := sha256.Sum256([]byte(oldRefreshToken))
	oldKey := fmt.Sprintf("refresh:user-123:%x", oldHash)

	newPair, err := svc.RefreshAccessToken("user-123", "alice", "gomo6.wtf", oldRefreshToken)
	if err != nil {
		t.Fatalf("RefreshAccessToken failed: %v", err)
	}

	// New pair should have new tokens
	if newPair.AccessToken == "" {
		t.Fatal("new access token should not be empty")
	}
	if newPair.RefreshToken == "" {
		t.Fatal("new refresh token should not be empty")
	}
	if newPair.RefreshToken == oldRefreshToken {
		t.Fatal("new refresh token must be different from old one")
	}

	// Old refresh token should be deleted
	if mr.Exists(oldKey) {
		t.Fatal("old refresh token should be deleted after rotation")
	}

	// New refresh token should be stored
	newHash := sha256.Sum256([]byte(newPair.RefreshToken))
	newKey := fmt.Sprintf("refresh:user-123:%x", newHash)
	if !mr.Exists(newKey) {
		t.Fatal("new refresh token should be stored in Redis")
	}
}

func TestRefreshAccessToken_WithRedis_InvalidToken(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	_, err := svc.RefreshAccessToken("user-123", "alice", "gomo6.wtf", "nonexistent")
	if err == nil {
		t.Fatal("RefreshAccessToken should fail for non-existent token")
	}
	if !errors.Is(err, ErrRefreshTokenNotFound) {
		t.Errorf("expected ErrRefreshTokenNotFound, got %v", err)
	}
}

func TestBlacklistToken_WithRedis(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	jti := "test-jti-123"
	expiresAt := time.Now().Add(1 * time.Hour)

	svc.BlacklistToken(jti, expiresAt)

	// Verify blacklist entry
	key := fmt.Sprintf("blacklist:%s", jti)
	val, err := mr.Get(key)
	if err != nil {
		t.Fatalf("blacklist entry not found: %v", err)
	}
	if val != "1" {
		t.Errorf("expected '1', got %q", val)
	}

	// Verify TTL
	ttl := mr.TTL(key)
	if ttl < 50*time.Minute || ttl > 70*time.Minute {
		t.Errorf("expected TTL ~1h, got %v", ttl)
	}
}

func TestIsTokenBlacklisted_WithRedis_Blacklisted(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	svc.BlacklistToken("compromised-jti", time.Now().Add(1*time.Hour))

	if !svc.isTokenBlacklisted("compromised-jti") {
		t.Fatal("blacklisted token should be detected")
	}
}

func TestIsTokenBlacklisted_WithRedis_NotBlacklisted(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	if svc.isTokenBlacklisted("unknown-jti") {
		t.Fatal("non-blacklisted token should return false")
	}
}

func TestBlacklistToken_AlreadyExpired_WithRedis(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	// Token already expired - should not store in Redis
	svc.BlacklistToken("expired-jti", time.Now().Add(-1*time.Hour))

	key := fmt.Sprintf("blacklist:%s", "expired-jti")
	if mr.Exists(key) {
		t.Fatal("expired token should not be blacklisted")
	}
}

func TestValidateToken_BlacklistedToken_WithRedis(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	// Generate a real token
	tokenStr, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	// Get the jti from the token
	claims, err := svc.ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("ValidateToken failed before blacklist: %v", err)
	}
	jti := claims.ID

	// Blacklist the token
	svc.BlacklistToken(jti, time.Now().Add(1*time.Hour))

	// Now validation should fail
	_, err = svc.ValidateToken(tokenStr)
	if err == nil {
		t.Fatal("SECURITY: blacklisted token was accepted!")
	}
	if err.Error() != "token has been revoked" {
		t.Errorf("expected 'token has been revoked', got %v", err)
	}
}

func TestValidateToken_NonBlacklistedToken_WithRedis(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	tokenStr, err := svc.GenerateToken("user-123", "alice", "gomo6.wtf")
	if err != nil {
		t.Fatalf("GenerateToken failed: %v", err)
	}

	// Blacklist some OTHER token
	svc.BlacklistToken("some-other-jti", time.Now().Add(1*time.Hour))

	// Our token should still be valid
	claims, err := svc.ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("ValidateToken failed for non-blacklisted token: %v", err)
	}
	if claims.UserID != "user-123" {
		t.Errorf("expected 'user-123', got %q", claims.UserID)
	}
}

func TestRevokeAllRefreshTokens_WithRedis(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	// Create multiple refresh tokens for the same user
	pair1, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	pair2, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	// Also create a token for another user (should NOT be affected)
	pairOther, _ := svc.GenerateTokenPair("user-456", "bob", "gomo6.wtf")

	hash1 := sha256.Sum256([]byte(pair1.RefreshToken))
	hash2 := sha256.Sum256([]byte(pair2.RefreshToken))
	hashOther := sha256.Sum256([]byte(pairOther.RefreshToken))

	key1 := fmt.Sprintf("refresh:user-123:%x", hash1)
	key2 := fmt.Sprintf("refresh:user-123:%x", hash2)
	keyOther := fmt.Sprintf("refresh:user-456:%x", hashOther)

	// Verify all tokens exist before revocation
	if !mr.Exists(key1) || !mr.Exists(key2) || !mr.Exists(keyOther) {
		t.Fatal("all tokens should exist before revoke")
	}

	// Revoke all tokens for user-123
	svc.RevokeAllRefreshTokens("user-123")

	// user-123 tokens should be gone
	if mr.Exists(key1) {
		t.Fatal("user-123 token 1 should be revoked")
	}
	if mr.Exists(key2) {
		t.Fatal("user-123 token 2 should be revoked")
	}

	// user-456 token should still exist
	if !mr.Exists(keyOther) {
		t.Fatal("other user's token should NOT be affected by revoke")
	}
}

func TestRevokeAllRefreshTokens_NoTokens(t *testing.T) {
	svc, _ := setupRedisAuthService(t)

	// Should not panic when user has no tokens
	svc.RevokeAllRefreshTokens("user-nonexistent")
}

func TestGenerateTokenPair_WithRedis_UniqueHashes(t *testing.T) {
	svc, mr := setupRedisAuthService(t)

	pair1, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")
	pair2, _ := svc.GenerateTokenPair("user-123", "alice", "gomo6.wtf")

	hash1 := sha256.Sum256([]byte(pair1.RefreshToken))
	hash2 := sha256.Sum256([]byte(pair2.RefreshToken))

	key1 := fmt.Sprintf("refresh:user-123:%x", hash1)
	key2 := fmt.Sprintf("refresh:user-123:%x", hash2)

	// Both should exist and be different
	if !mr.Exists(key1) {
		t.Fatal("first refresh token should exist")
	}
	if !mr.Exists(key2) {
		t.Fatal("second refresh token should exist")
	}
	if key1 == key2 {
		t.Fatal("refresh tokens must have unique hashes")
	}
}

func TestRefreshTokenExists_NilRedis(t *testing.T) {
	svc := NewAuthService() // no Redis

	if svc.refreshTokenExists("user-123", "any-token") {
		t.Fatal("refreshTokenExists should return false without Redis")
	}
}

func TestDeleteRefreshToken_NilRedis(t *testing.T) {
	svc := NewAuthService() // no Redis

	// Should not panic
	svc.deleteRefreshToken("user-123", "any-token")
}
