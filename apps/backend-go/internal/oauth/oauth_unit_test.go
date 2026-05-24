package oauth

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gomo6/backend/internal/auth"
)

// =============================================================================
// PKCE verification tests (security-critical)
// =============================================================================

func TestVerifyPKCE_ValidS256(t *testing.T) {
	verifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjX8"
	challenge := generatePKCEChallenge(verifier)

	err := verifyPKCE(challenge, CodeChallengeMethodS256, verifier)
	if err != nil {
		t.Fatalf("PKCE verification should succeed: %v", err)
	}
}

func TestVerifyPKCE_WrongVerifier(t *testing.T) {
	verifier := "correct-verifier"
	challenge := generatePKCEChallenge(verifier)

	err := verifyPKCE(challenge, CodeChallengeMethodS256, "wrong-verifier")
	if err == nil {
		t.Fatal("Expected PKCE verification to fail with wrong verifier")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "pkce") && !strings.Contains(err.Error(), "verification") {
		t.Errorf("Expected PKCE error, got: %v", err)
	}
}

func TestVerifyPKCE_EmptyVerifier(t *testing.T) {
	verifier := "some-verifier"
	challenge := generatePKCEChallenge(verifier)

	err := verifyPKCE(challenge, CodeChallengeMethodS256, "")
	if err == nil {
		t.Fatal("Expected PKCE verification to fail with empty verifier")
	}
}

func TestVerifyPKCE_Base64URLSafe(t *testing.T) {
	// Verifier with characters that are NOT base64url-safe (contains + and /)
	verifier := "verifier+with/special=chars"
	challenge := generatePKCEChallenge(verifier)
	err := verifyPKCE(challenge, CodeChallengeMethodS256, verifier)
	if err != nil {
		t.Fatalf("PKCE with special chars should succeed: %v", err)
	}
}

func TestVerifyPKCE_LongVerifier(t *testing.T) {
	// Maximum PKCE verifier length is typically 128 chars
	b := make([]byte, 96)
	rand.Read(b)
	verifier := base64.RawURLEncoding.EncodeToString(b)
	challenge := generatePKCEChallenge(verifier)

	err := verifyPKCE(challenge, CodeChallengeMethodS256, verifier)
	if err != nil {
		t.Fatalf("PKCE with long verifier should succeed: %v", err)
	}
}

func TestVerifyPKCE_CaseSensitivity(t *testing.T) {
	verifier := "CaseSensitive-Verifier"
	challenge := generatePKCEChallenge(verifier)

	err := verifyPKCE(challenge, CodeChallengeMethodS256, "casesensitive-verifier")
	if err == nil {
		t.Fatal("Expected PKCE verification to fail with wrong-case verifier")
	}
}

// =============================================================================
// bigEndianBytes tests
// =============================================================================

func TestBigEndianBytes_Zero(t *testing.T) {
	result := bigEndianBytes(0)
	if len(result) != 1 || result[0] != 0 {
		t.Errorf("bigEndianBytes(0) = %v, expected [0]", result)
	}
}

func TestBigEndianBytes_StandardRSAExponent(t *testing.T) {
	// Standard RSA public exponent is 65537
	result := bigEndianBytes(65537)
	if len(result) != 3 {
		t.Errorf("bigEndianBytes(65537) length = %d, expected 3", len(result))
	}
	// Verify encoding is correct (big-endian)
	expected := []byte{0x01, 0x00, 0x01}
	if len(result) != len(expected) {
		t.Fatalf("length mismatch")
	}
	for i := range expected {
		if result[i] != expected[i] {
			t.Errorf("bigEndianBytes(65537)[%d] = %d, expected %d", i, result[i], expected[i])
		}
	}
}

func TestBigEndianBytes_SingleByte(t *testing.T) {
	result := bigEndianBytes(3)
	if len(result) != 1 || result[0] != 3 {
		t.Errorf("bigEndianBytes(3) = %v, expected [3]", result)
	}
}

func TestBigEndianBytes_MaxUint(t *testing.T) {
	// Test with a moderately large number
	result := bigEndianBytes(0x01020304)
	if len(result) != 4 {
		t.Errorf("bigEndianBytes(0x01020304) length = %d, expected 4", len(result))
	}
}

func TestBigEndianBytes_RoundTrip(t *testing.T) {
	tests := []int{0, 1, 255, 256, 65535, 65536, 65537, 0xFFFFFF}
	for _, v := range tests {
		bytes := bigEndianBytes(v)
		// Reconstruct the value from big-endian bytes
		reconstructed := 0
		for _, b := range bytes {
			reconstructed = (reconstructed << 8) | int(b)
		}
		if reconstructed != v {
			t.Errorf("bigEndianBytes round-trip for %d: got %d", v, reconstructed)
		}
	}
}

// =============================================================================
// RSA key pair generation & PEM encoding
// =============================================================================

func TestGenerateRS256KeyPair(t *testing.T) {
	key, err := GenerateRS256KeyPair()
	if err != nil {
		t.Fatalf("GenerateRS256KeyPair failed: %v", err)
	}
	if key == nil {
		t.Fatal("Expected non-nil RSA key")
	}
	if key.N == nil || key.E == 0 || key.D == nil {
		t.Fatal("Generated key is incomplete")
	}
}

func TestGenerateRS256KeyPair_MultipleUnique(t *testing.T) {
	key1, _ := GenerateRS256KeyPair()
	key2, _ := GenerateRS256KeyPair()
	if key1.N.Cmp(key2.N) == 0 {
		t.Error("Expected two generated RSA keys to have different moduli")
	}
}

func TestEncodeRS256PrivateKeyToPEM(t *testing.T) {
	key, err := GenerateRS256KeyPair()
	if err != nil {
		t.Fatalf("GenerateRS256KeyPair failed: %v", err)
	}

	pemStr := EncodeRS256PrivateKeyToPEM(key)
	if pemStr == "" {
		t.Fatal("Expected non-empty PEM string")
	}
	if !strings.Contains(pemStr, "BEGIN RSA PRIVATE KEY") {
		t.Errorf("Expected PEM to contain 'BEGIN RSA PRIVATE KEY', got: %s", pemStr[:50])
	}

	// Verify PEM can be decoded
	block, _ := pem.Decode([]byte(pemStr))
	if block == nil {
		t.Fatal("Failed to decode PEM block")
	}
	if block.Type != "RSA PRIVATE KEY" {
		t.Errorf("Expected PEM type 'RSA PRIVATE KEY', got '%s'", block.Type)
	}
}

func TestEncodeRS256PrivateKeyToPEM_RoundTrip(t *testing.T) {
	key, _ := GenerateRS256KeyPair()
	pemStr := EncodeRS256PrivateKeyToPEM(key)

	block, _ := pem.Decode([]byte(pemStr))
	parsedKey, err := x509.ParsePKCS1PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("Failed to parse decoded PEM: %v", err)
	}
	if parsedKey.N.Cmp(key.N) != 0 {
		t.Error("Round-trip PEM encode/decode: public key N mismatch")
	}
}

// =============================================================================
// isValidScope tests
// =============================================================================

func TestIsValidScope_KnownScopes(t *testing.T) {
	validScopes := []string{ScopeOpenID, ScopeProfile, ScopeEmail, ScopeOfflineAccess}
	for _, s := range validScopes {
		if !isValidScope(s) {
			t.Errorf("Expected scope '%s' to be valid", s)
		}
	}
}

func TestIsValidScope_Invalid(t *testing.T) {
	invalid := []string{"admin", "write", "delete", "unknown", ""}
	for _, s := range invalid {
		if isValidScope(s) {
			t.Errorf("Expected scope '%s' to be invalid", s)
		}
	}
}

func TestIsValidScope_CaseSensitive(t *testing.T) {
	if isValidScope("OPENID") {
		t.Error("Expected uppercase 'OPENID' to be invalid (scopes are case-sensitive)")
	}
	if isValidScope("Profile") {
		t.Error("Expected 'Profile' to be invalid")
	}
}

// =============================================================================
// HasScope tests (additional edge cases)
// =============================================================================

func TestHasScope_Duplicates(t *testing.T) {
	scopes := []string{"openid", "profile", "openid"}
	if !HasScope(scopes, "openid") {
		t.Error("HasScope should handle duplicates")
	}
}

func TestHasScope_SingleItem(t *testing.T) {
	if !HasScope([]string{"openid"}, "openid") {
		t.Error("HasScope should match single-item slice")
	}
	if HasScope([]string{"openid"}, "profile") {
		t.Error("HasScope should not match wrong scope")
	}
}

// =============================================================================
// buildAvatarURL tests
// =============================================================================

func TestBuildAvatarURL_Empty(t *testing.T) {
	authSvc := auth.NewAuthService()
	// We need a valid issuer. Override via env temporarily.
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, authSvc)
	if svc.buildAvatarURL("") != "" {
		t.Error("Expected empty string for empty avatar path")
	}
}

func TestBuildAvatarURL_RelativePath(t *testing.T) {
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, auth.NewAuthService())
	result := svc.buildAvatarURL("user123/avatar_1234567890.jpg")
	expected := "https://gomo6.local/storage/v1/object/post-images/user123/avatar_1234567890.jpg"
	if result != expected {
		t.Errorf("buildAvatarURL: expected %q, got %q", expected, result)
	}
}

func TestBuildAvatarURL_ExternalURL(t *testing.T) {
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, auth.NewAuthService())
	external := "https://gravatar.com/avatar/abc123.jpg"
	result := svc.buildAvatarURL(external)
	if result != external {
		t.Errorf("buildAvatarURL for external URL: expected %q, got %q", external, result)
	}
}

func TestBuildAvatarURL_GarageURL(t *testing.T) {
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")
	os.Setenv("GARAGE_S3_PUBLIC_ENDPOINT", "http://localhost:3900")
	defer os.Unsetenv("GARAGE_S3_PUBLIC_ENDPOINT")

	svc := NewOAuthService(nil, auth.NewAuthService())

	// Garage URL without bucket prefix
	result := svc.buildAvatarURL("http://localhost:3900/user123/avatar_123.jpg")
	expected := "https://gomo6.local/storage/v1/object/post-images/avatar_123.jpg"
	if result != expected {
		t.Errorf("buildAvatarURL for Garage URL: expected %q, got %q", expected, result)
	}
}

func TestBuildAvatarURL_GarageURLWithBucket(t *testing.T) {
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")
	os.Setenv("GARAGE_S3_PUBLIC_ENDPOINT", "http://localhost:3900")
	defer os.Unsetenv("GARAGE_S3_PUBLIC_ENDPOINT")

	svc := NewOAuthService(nil, auth.NewAuthService())

	// buildAvatarURL strips the bucket prefix from Garage URLs:
	// http://localhost:3900/post-images/user123/avatar_123.jpg
	// key = "post-images/user123/avatar_123.jpg"
	// SplitN on "/" -> ["post-images", "user123/avatar_123.jpg"]
	// result = issuer + "/storage/v1/object/post-images/" + "user123/avatar_123.jpg"
	result := svc.buildAvatarURL("http://localhost:3900/post-images/user123/avatar_123.jpg")
	expected := "https://gomo6.local/storage/v1/object/post-images/user123/avatar_123.jpg"
	if result != expected {
		t.Errorf("buildAvatarURL for Garage URL with bucket: expected %q, got %q", expected, result)
	}
}

func TestBuildAvatarURL_HTTPSExternal(t *testing.T) {
	os.Setenv("DOMAIN", "gomo6.local")
	defer os.Unsetenv("DOMAIN")
	os.Setenv("ISSUER_URL", "https://gomo6.local")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, auth.NewAuthService())
	external := "https://cdn.example.com/avatars/user.png"
	result := svc.buildAvatarURL(external)
	if result != external {
		t.Errorf("buildAvatarURL for HTTPS external URL: expected %q, got %q", external, result)
	}
}

// =============================================================================
// GetJWKS tests
// =============================================================================

func TestGetJWKS_WithRSAKey(t *testing.T) {
	svc := &OAuthService{
		rsaPrivateKey: &rsa.PrivateKey{},
	}
	// Manually set up a valid key pair
	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	svc.rsaPrivateKey = key

	jwks := svc.GetJWKS()
	keys, ok := jwks["keys"].([]interface{})
	if !ok || len(keys) == 0 {
		t.Fatal("Expected JWKS to have keys")
	}

	k := keys[0].(map[string]interface{})
	if k["kty"] != "RSA" {
		t.Errorf("Expected kty RSA, got %v", k["kty"])
	}
	if k["alg"] != "RS256" {
		t.Errorf("Expected alg RS256, got %v", k["alg"])
	}
	if k["kid"] != "rsa-key-1" {
		t.Errorf("Expected kid 'rsa-key-1', got %v", k["kid"])
	}
	if k["use"] != "sig" {
		t.Errorf("Expected use 'sig', got %v", k["use"])
	}
	if k["n"] == nil || k["n"].(string) == "" {
		t.Error("Expected non-empty n (modulus)")
	}
	if k["e"] == nil || k["e"].(string) == "" {
		t.Error("Expected non-empty e (exponent)")
	}
}

func TestGetJWKS_NilRSAKey(t *testing.T) {
	svc := &OAuthService{
		rsaPrivateKey: nil,
	}
	jwks := svc.GetJWKS()
	keys, ok := jwks["keys"].([]interface{})
	if !ok {
		t.Fatal("Expected JWKS to have keys array")
	}
	if len(keys) != 0 {
		t.Errorf("Expected empty keys array when no RSA key, got %d keys", len(keys))
	}
}

// =============================================================================
// ValidateAccessToken tests (invalid tokens, no DB needed)
// =============================================================================

func TestValidateAccessToken_EmptyToken(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}
	_, err := svc.ValidateAccessToken("")
	if err == nil {
		t.Fatal("Expected error for empty token")
	}
}

func TestValidateAccessToken_MalformedToken(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}
	_, err := svc.ValidateAccessToken("not-a-jwt")
	if err == nil {
		t.Fatal("Expected error for malformed token")
	}
}

func TestValidateAccessToken_WrongSigningKey(t *testing.T) {
	secret1 := []byte("service-a-secret-1234")
	secret2 := []byte("service-b-secret-5678")

	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "testuser",
		ClientID: "client-1",
		Scopes:   []string{"openid"},
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "jti-1",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString(secret1)

	svcB := &OAuthService{jwtSecret: secret2}
	_, err := svcB.ValidateAccessToken(tokenStr)
	if err == nil {
		t.Fatal("Expected error when validating with wrong signing key")
	}
}

func TestValidateAccessToken_AlgorithmConfusion_RS256(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}

	// Create token signed with RS256 (but validator only accepts HMAC)
	rsaKey, _ := rsa.GenerateKey(rand.Reader, 2048)
	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "attacker",
		ClientID: "client-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	rs256Token, _ := token.SignedString(rsaKey)

	_, err := svc.ValidateAccessToken(rs256Token)
	if err == nil {
		t.Fatal("Expected algorithm confusion RS256 to be rejected")
	}
	if !strings.Contains(err.Error(), "unexpected signing method") {
		t.Errorf("Expected 'unexpected signing method' error, got: %v", err)
	}
}

func TestValidateAccessToken_AlgorithmConfusion_None(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}

	// Create token with alg=none
	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "attacker",
		ClientID: "client-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodNone, claims)
	noneToken, _ := token.SignedString(jwt.UnsafeAllowNoneSignatureType)

	_, err := svc.ValidateAccessToken(noneToken)
	if err == nil {
		t.Fatal("Expected algorithm 'none' to be rejected")
	}
}

func TestValidateAccessToken_ExpiredToken(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}

	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "testuser",
		ClientID: "client-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "jti-1",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(-1 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString(svc.jwtSecret)

	_, err := svc.ValidateAccessToken(tokenStr)
	if err == nil {
		t.Fatal("Expected error for expired token")
	}
}

func TestValidateAccessToken_NoExpiry(t *testing.T) {
	// JWT spec allows tokens without expiry, but ValidateAccessToken
	// requires a DB connection for revocation check.
	// Test jwt-go library behavior directly: no-expiry tokens parse successfully.
	secret := []byte("test-secret")

	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "testuser",
		ClientID: "client-1",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString(secret)

	parsed, err := jwt.ParseWithClaims(tokenStr, &OAuthClaims{}, func(token *jwt.Token) (interface{}, error) {
		return secret, nil
	})
	if err != nil {
		t.Fatalf("Token without expiry should be valid per JWT spec: %v", err)
	}
	parsedClaims, ok := parsed.Claims.(*OAuthClaims)
	if !ok || parsedClaims.UserID != "user-1" {
		t.Errorf("Expected user-1 in parsed claims, got %+v", parsedClaims)
	}
}

func TestValidateAccessToken_TamperedPayload(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test-secret")}

	claims := OAuthClaims{
		UserID:   "user-1",
		Username: "testuser",
		ClientID: "client-1",
		RegisteredClaims: jwt.RegisteredClaims{
			ID: "jti-1",
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, _ := token.SignedString(svc.jwtSecret)

	// Tamper with the payload by changing one character in the base64 part
	parts := strings.Split(tokenStr, ".")
	// Append a tampered payload (different userID)
	tamperedPayload := base64.RawURLEncoding.EncodeToString([]byte(`{"user_id":"user-2","username":"hacker","client_id":"client-1","scopes":["openid"]}`))
	tampered := parts[0] + "." + tamperedPayload + "." + parts[2]

	_, err := svc.ValidateAccessToken(tampered)
	if err == nil {
		t.Fatal("Expected error for tampered token payload")
	}
}

// =============================================================================
// IntrospectToken tests (invalid/no DB needed)
// =============================================================================

func TestIntrospectToken_EmptyString(t *testing.T) {
	svc := &OAuthService{jwtSecret: []byte("test")}
	result := svc.IntrospectToken("", "access_token")
	if result.Active {
		t.Fatal("Expected active=false for empty token")
	}
}

func TestIntrospectToken_Malformed(t *testing.T) {
	// Use access_token hint to avoid the refresh_token DB path (nil DB)
	svc := &OAuthService{jwtSecret: []byte("test")}
	result := svc.IntrospectToken("not-a-token", "access_token")
	if result.Active {
		t.Fatal("Expected active=false for malformed token")
	}
}

func TestIntrospectToken_RandomJWT(t *testing.T) {
	// Use access_token hint to avoid the refresh_token DB path (nil DB)
	svc := &OAuthService{jwtSecret: []byte("test")}
	result := svc.IntrospectToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.fakesig", "access_token")
	if result.Active {
		t.Fatal("Expected active=false for random JWT signed with wrong key")
	}
}

// =============================================================================
// GenerateClientID / GenerateClientSecret tests (additional)
// =============================================================================

func TestGenerateClientID_Length(t *testing.T) {
	svc := &OAuthService{}
	for i := 0; i < 10; i++ {
		id := svc.GenerateClientID()
		if len(id) != 64 {
			t.Errorf("Client ID length = %d, expected 64", len(id))
		}
	}
}

func TestGenerateClientSecret_Length(t *testing.T) {
	svc := &OAuthService{}
	for i := 0; i < 10; i++ {
		secret := svc.GenerateClientSecret()
		if len(secret) != 80 {
			t.Errorf("Client secret length = %d, expected 80", len(secret))
		}
	}
}

func TestGenerateClientID_UniquenessBatch(t *testing.T) {
	svc := &OAuthService{}
	ids := make(map[string]bool)
	for i := 0; i < 100; i++ {
		id := svc.GenerateClientID()
		if ids[id] {
			t.Errorf("Duplicate client ID: %s", id)
		}
		ids[id] = true
	}
}

func TestGenerateClientSecret_UniquenessBatch(t *testing.T) {
	svc := &OAuthService{}
	secrets := make(map[string]bool)
	for i := 0; i < 100; i++ {
		s := svc.GenerateClientSecret()
		if secrets[s] {
			t.Errorf("Duplicate client secret: %s", s)
		}
		secrets[s] = true
	}
}

// =============================================================================
// HashClientSecret / VerifyClientSecret tests (additional edge cases)
// =============================================================================

func TestHashClientSecret_EmptySecret(t *testing.T) {
	svc := &OAuthService{}
	hash, err := svc.HashClientSecret("")
	if err != nil {
		t.Fatalf("HashClientSecret with empty string should succeed: %v", err)
	}
	if hash == "" {
		t.Fatal("Expected non-empty hash for empty secret")
	}
	if !svc.VerifyClientSecret("", hash) {
		t.Fatal("Empty secret should verify against its hash")
	}
}

func TestHashClientSecret_VeryLongSecret(t *testing.T) {
	svc := &OAuthService{}
	longSecret := strings.Repeat("abcdefgh", 100) // 800 chars
	hash, err := svc.HashClientSecret(longSecret)
	if err != nil {
		t.Fatalf("HashClientSecret with long secret should succeed: %v", err)
	}
	if !svc.VerifyClientSecret(longSecret, hash) {
		t.Fatal("Long secret should verify against its hash")
	}
}

func TestHashClientSecret_Unicode(t *testing.T) {
	svc := &OAuthService{}
	unicode := "🔐secret-密码-パスワード-בְּרִית"
	hash, err := svc.HashClientSecret(unicode)
	if err != nil {
		t.Fatalf("HashClientSecret with unicode should succeed: %v", err)
	}
	if !svc.VerifyClientSecret(unicode, hash) {
		t.Fatal("Unicode secret should verify against its hash")
	}
}

func TestHashClientSecret_WrongSecretSimilar(t *testing.T) {
	svc := &OAuthService{}
	hash, _ := svc.HashClientSecret("real-secret-abc123")
	// Similar but different
	if svc.VerifyClientSecret("real-secret-abc124", hash) {
		t.Fatal("Similar but different secret should NOT verify")
	}
}

// =============================================================================
// ParseScopeString / JoinScopes tests (additional edge cases)
// =============================================================================

func TestParseScopeString_EmptySpaces(t *testing.T) {
	result := ParseScopeString("   ")
	if len(result) != 0 {
		t.Errorf("Expected 0 scopes from spaces-only string, got %d", len(result))
	}
}

func TestJoinScopes_EmptySlice(t *testing.T) {
	result := JoinScopes([]string{})
	if result != "" {
		t.Errorf("Expected empty string from empty slice, got %q", result)
	}
}

func TestJoinScopes_WithEmptyStrings(t *testing.T) {
	result := JoinScopes([]string{"openid", "", "profile", ""})
	if result != "openid profile" {
		t.Errorf("Expected 'openid profile', got %q", result)
	}
}

func TestParseJoinRoundTrip(t *testing.T) {
	tests := []string{"openid", "openid profile", "openid profile email offline_access"}
	for _, expected := range tests {
		parsed := ParseScopeString(expected)
		joined := JoinScopes(parsed)
		if joined != expected {
			t.Errorf("Round-trip failed: %q -> %v -> %q", expected, parsed, joined)
		}
	}
}

// =============================================================================
// nullableString tests (additional)
// =============================================================================

func TestNullableString_Whitespace(t *testing.T) {
	if n := nullableString(" "); n == nil {
		t.Error("Expected nullableString(' ') to return non-nil (it's not empty)")
	}
	if *nullableString(" ") != " " {
		t.Error("Expected nullableString to preserve whitespace")
	}
}

// =============================================================================
// NewOAuthService tests
// =============================================================================

func TestNewOAuthService_DefaultIssuer(t *testing.T) {
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DOMAIN")
	defer os.Unsetenv("ISSUER_URL")
	defer os.Unsetenv("DOMAIN")

	svc := NewOAuthService(nil, auth.NewAuthService())
	if svc.issuer != "http://localhost:8080" {
		t.Errorf("Expected default issuer 'http://localhost:8080', got '%s'", svc.issuer)
	}
}

func TestNewOAuthService_CustomDomain(t *testing.T) {
	os.Setenv("DOMAIN", "example.com")
	defer os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, auth.NewAuthService())
	if svc.issuer != "http://example.com" {
		t.Errorf("Expected issuer 'http://example.com', got '%s'", svc.issuer)
	}
}

func TestNewOAuthService_ExplicitIssuerURL(t *testing.T) {
	os.Setenv("ISSUER_URL", "https://auth.example.com")
	defer os.Unsetenv("ISSUER_URL")

	svc := NewOAuthService(nil, auth.NewAuthService())
	if svc.issuer != "https://auth.example.com" {
		t.Errorf("Expected issuer 'https://auth.example.com', got '%s'", svc.issuer)
	}
}

// =============================================================================
// OAuthClaims validation (token integrity tests)
// =============================================================================

func TestOAuthClaims_Integration(t *testing.T) {
	// Test JWT sign + parse roundtrip at the library level.
	// ValidateAccessToken requires a DB to check revocation;
	// integration tests with real DB live in the handlers package.
	secret := []byte("integration-test-secret-key")

	claims := OAuthClaims{
		UserID:   "user-42",
		Username: "testuser",
		ClientID: "client-99",
		Scopes:   []string{"openid", "profile"},
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        "jti-42",
			Issuer:    "http://test.local",
			Subject:   "user-42",
			Audience:  jwt.ClaimStrings{"client-99"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokStr, _ := tok.SignedString(secret)

	// Verify using jwt-go directly (same logic as ValidateAccessToken without DB)
	parsed, err := jwt.ParseWithClaims(tokStr, &OAuthClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return secret, nil
	})
	if err != nil {
		t.Fatalf("Valid token should be accepted: %v", err)
	}
	parsedClaims, ok := parsed.Claims.(*OAuthClaims)
	if !ok {
		t.Fatal("Failed to cast parsed claims")
	}
	if parsedClaims.UserID != "user-42" {
		t.Errorf("Expected user-42, got %s", parsedClaims.UserID)
	}
	if parsedClaims.Username != "testuser" {
		t.Errorf("Expected testuser, got %s", parsedClaims.Username)
	}
	if parsedClaims.ClientID != "client-99" {
		t.Errorf("Expected client-99, got %s", parsedClaims.ClientID)
	}
	if len(parsedClaims.Scopes) != 2 {
		t.Errorf("Expected 2 scopes, got %d", len(parsedClaims.Scopes))
	}
}

// =============================================================================
// OpenID Configuration tests (additional)
// =============================================================================

func TestOpenIDConfiguration_AllEndpoints(t *testing.T) {
	svc := &OAuthService{issuer: "https://auth.example.com"}
	cfg := svc.GetOpenIDConfiguration()

	endpoints := map[string]string{
		"authorization": cfg.AuthorizationEndpoint,
		"token":         cfg.TokenEndpoint,
		"userinfo":      cfg.UserinfoEndpoint,
		"revocation":    cfg.RevocationEndpoint,
		"introspection": cfg.IntrospectionEndpoint,
		"jwks":          cfg.JWKSURI,
	}

	for name, url := range endpoints {
		if !strings.HasPrefix(url, cfg.Issuer) {
			t.Errorf("%s endpoint '%s' should start with issuer '%s'", name, url, cfg.Issuer)
		}
	}
}

func TestOpenIDConfiguration_ResponseTypes(t *testing.T) {
	svc := &OAuthService{issuer: "https://test.com"}
	cfg := svc.GetOpenIDConfiguration()

	if len(cfg.ResponseTypesSupported) != 1 || cfg.ResponseTypesSupported[0] != "code" {
		t.Errorf("Expected only 'code' response type, got %v", cfg.ResponseTypesSupported)
	}
}

func TestOpenIDConfiguration_GrantTypes(t *testing.T) {
	svc := &OAuthService{issuer: "https://test.com"}
	cfg := svc.GetOpenIDConfiguration()

	foundAuthCode := false
	foundRefresh := false
	for _, gt := range cfg.GrantTypesSupported {
		if gt == "authorization_code" {
			foundAuthCode = true
		}
		if gt == "refresh_token" {
			foundRefresh = true
		}
	}
	if !foundAuthCode {
		t.Error("authorization_code grant type not found")
	}
	if !foundRefresh {
		t.Error("refresh_token grant type not found")
	}
}

func TestOpenIDConfiguration_SubjectTypes(t *testing.T) {
	svc := &OAuthService{issuer: "https://test.com"}
	cfg := svc.GetOpenIDConfiguration()

	if len(cfg.SubjectTypesSupported) != 1 || cfg.SubjectTypesSupported[0] != "public" {
		t.Errorf("Expected 'public' subject type, got %v", cfg.SubjectTypesSupported)
	}
}

func TestOpenIDConfiguration_SigningAlgs(t *testing.T) {
	svc := &OAuthService{issuer: "https://test.com"}
	cfg := svc.GetOpenIDConfiguration()

	foundRS256 := false
	foundHS256 := false
	for _, alg := range cfg.IDTokenSigningAlgValuesSupported {
		if alg == "RS256" {
			foundRS256 = true
		}
		if alg == "HS256" {
			foundHS256 = true
		}
	}
	if !foundRS256 {
		t.Error("RS256 not in supported signing algorithms")
	}
	if !foundHS256 {
		t.Error("HS256 not in supported signing algorithms")
	}
}

func TestOpenIDConfiguration_OnlyS256PKCE(t *testing.T) {
	svc := &OAuthService{issuer: "https://test.com"}
	cfg := svc.GetOpenIDConfiguration()

	if len(cfg.CodeChallengeMethodsSupported) != 1 || cfg.CodeChallengeMethodsSupported[0] != "S256" {
		t.Errorf("Expected only S256 PKCE, got %v", cfg.CodeChallengeMethodsSupported)
	}
}

// Ensure unused imports don't cause issues — we use these above
var _ = fmt.Sprintf
var _ = os.Setenv
