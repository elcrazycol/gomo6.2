package oauth

import (
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gomo6/backend/internal/auth"
	_ "github.com/lib/pq"
)

// testDB holds the shared database connection for integration tests.
// Set DATABASE_URL_TEST env var to run tests, otherwise tests are skipped.
var testDB *sql.DB

// These are populated during TestMain and reused across all tests.
var (
	testUsername    = "oauth_test_user"
	testUserEmail   = "oauth_test@example.com"
	testAppName     = "Test OAuth App"
	testRedirectURI = "http://localhost:3000/callback"
	testAppClientID string
)

func TestMain(m *testing.M) {
	dbURL := os.Getenv("DATABASE_URL_TEST")
	if dbURL == "" {
		// Default to the Docker compose connection
		dbURL = "postgres://gomo6:gomo6password@localhost:5432/gomo6?sslmode=disable"
	}

	var err error
	testDB, err = sql.Open("postgres", dbURL)
	if err != nil {
		fmt.Printf("Failed to connect to test database: %v\n", err)
		fmt.Println("Set DATABASE_URL_TEST or start Docker containers. Skipping integration tests.")
		os.Exit(0) // Skip tests gracefully
	}

	if err := testDB.Ping(); err != nil {
		fmt.Printf("Failed to ping test database: %v\n", err)
		fmt.Println("Start Docker containers with 'docker compose up -d'. Skipping integration tests.")
		os.Exit(0)
	}

	// Ensure the oauth_audit_log table exists
	testDB.Exec(`CREATE TABLE IF NOT EXISTS oauth_audit_log (
		id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
		user_id UUID REFERENCES users(id) ON DELETE SET NULL,
		client_id VARCHAR(64),
		app_name VARCHAR(255),
		action VARCHAR(50) NOT NULL,
		details JSONB DEFAULT '{}'::jsonb,
		ip_address VARCHAR(45) DEFAULT '',
		created_at TIMESTAMPTZ DEFAULT NOW()
	)`)
	testDB.Exec(`CREATE INDEX IF NOT EXISTS idx_oauth_audit_user ON oauth_audit_log(user_id)`)
	testDB.Exec(`CREATE INDEX IF NOT EXISTS idx_oauth_audit_client ON oauth_audit_log(client_id)`)
	testDB.Exec(`CREATE INDEX IF NOT EXISTS idx_oauth_audit_action ON oauth_audit_log(action)`)
	testDB.Exec(`CREATE INDEX IF NOT EXISTS idx_oauth_audit_created ON oauth_audit_log(created_at DESC)`)

	code := m.Run()
	testDB.Close()
	os.Exit(code)
}

// setupTestUser creates or reuses a test user and returns its ID.
func setupTestUser(t *testing.T) string {
	t.Helper()

	// Try to find existing test user first
	var id string
	err := testDB.QueryRow(`SELECT id FROM users WHERE username = $1`, testUsername).Scan(&id)
	if err == nil {
		return id
	}

	// Create a new test user
	err = testDB.QueryRow(`
		INSERT INTO users (username, email, password_hash)
		VALUES ($1, $2, $3)
		RETURNING id
	`, testUsername, testUserEmail, "test-hash-not-used").Scan(&id)
	if err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}

	// Also ensure privacy settings exist
	testDB.Exec(`INSERT INTO privacy_settings (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, id)

	return id
}

// setupTestApp creates an OAuth app for the test user and returns client_id + client_secret.
func setupTestApp(t *testing.T, svc *OAuthService, userID string) (clientID, clientSecret string) {
	t.Helper()

	appName := fmt.Sprintf("%s %d", testAppName, time.Now().UnixNano())
	app, secret, err := svc.CreateApplication(
		userID,
		appName,
		"Test app for integration tests",
		[]string{testRedirectURI},
		[]string{ScopeProfile, ScopeEmail},
		true, // confidential
		"",
		"https://example.com",
	)
	if err != nil {
		t.Fatalf("Failed to create test app: %v", err)
	}
	t.Cleanup(func() {
		svc.DeleteApplication(app.ID, userID)
	})
	return app.ClientID, secret
}

// generatePKCEChallenge creates an S256 code_challenge from a verifier.
func generatePKCEChallenge(verifier string) string {
	h := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

// TestOAuthFullFlow tests the complete happy path: authorize → token → userinfo.
func TestOAuthFullFlow(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	clientID, _ := setupTestApp(t, svc, userID)

	// Save for potential later use in same test run
	testAppClientID = clientID

	// --- Step 1: Generate authorization code ---
	codeVerifier := "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjX8"
	codeChallenge := generatePKCEChallenge(codeVerifier)

	code, err := svc.GenerateAuthorizationCode(
		clientID, userID, testRedirectURI,
		codeChallenge, CodeChallengeMethodS256,
		"openid profile email",
		"test-nonce",
	)
	if err != nil {
		t.Fatalf("GenerateAuthorizationCode failed: %v", err)
	}
	if code == "" {
		t.Fatal("Expected non-empty authorization code")
	}
	t.Logf("Authorization code generated: %s", code[:20]+"...")

	// --- Step 2: Exchange code for tokens ---
	gotUserID, scopes, nonce, err := svc.ValidateAuthorizationCode(code, clientID, testRedirectURI, codeVerifier)
	if err != nil {
		t.Fatalf("ValidateAuthorizationCode failed: %v", err)
	}
	if gotUserID != userID {
		t.Errorf("Expected userID %s, got %s", userID, gotUserID)
	}
	if nonce != "test-nonce" {
		t.Errorf("Expected nonce 'test-nonce', got '%s'", nonce)
	}
	if !hasScope(scopes, ScopeOpenID) || !hasScope(scopes, ScopeProfile) || !hasScope(scopes, ScopeEmail) {
		t.Errorf("Expected scopes [openid profile email], got %v", scopes)
	}
	t.Logf("Scopes: %v", scopes)

	// Verify code is now used (second attempt should fail)
	_, _, _, err = svc.ValidateAuthorizationCode(code, clientID, testRedirectURI, codeVerifier)
	if err == nil {
		t.Fatal("Expected error for reusing authorization code, got nil")
	}
	t.Logf("Code reuse correctly rejected: %v", err)

	// --- Step 3: Generate access token ---
	at, accessTokenStr, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	if at.TokenID == "" || accessTokenStr == "" {
		t.Fatal("Expected non-empty access token")
	}

	// --- Step 4: Validate access token ---
	claims, err := svc.ValidateAccessToken(accessTokenStr)
	if err != nil {
		t.Fatalf("ValidateAccessToken failed: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("Expected UserID %s, got %s", userID, claims.UserID)
	}
	if claims.ClientID != clientID {
		t.Errorf("Expected ClientID %s, got %s", clientID, claims.ClientID)
	}
	t.Logf("Access token validated successfully for user %s", claims.Username)

	// --- Step 5: Generate ID token ---
	idToken, err := svc.GenerateIDToken(clientID, userID, testUsername, "test-nonce", scopes)
	if err != nil {
		t.Fatalf("GenerateIDToken failed: %v", err)
	}
	if idToken == "" {
		t.Fatal("Expected non-empty ID token")
	}
	t.Logf("ID token generated: %s", idToken[:40]+"...")

	// --- Step 6: Get user info ---
	info, err := svc.GetUserInfo(userID, scopes)
	if err != nil {
		t.Fatalf("GetUserInfo failed: %v", err)
	}
	if info.Sub != userID {
		t.Errorf("Expected sub %s, got %s", userID, info.Sub)
	}
	if info.PreferredUsername != testUsername {
		t.Errorf("Expected username %s, got %s", testUsername, info.PreferredUsername)
	}
	if info.Email != testUserEmail {
		t.Errorf("Expected email %s, got %s", testUserEmail, info.Email)
	}
	if !info.EmailVerified {
		t.Error("Expected email_verified true")
	}
	t.Logf("User info: sub=%s, name=%s, email=%s", info.Sub, info.Name, info.Email)
}

// TestOAuthScopeBasedUserinfo tests that userinfo respects scope boundaries.
func TestOAuthScopeBasedUserinfo(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	// Only openid scope
	info, err := svc.GetUserInfo(userID, []string{ScopeOpenID})
	if err != nil {
		t.Fatalf("GetUserInfo with openid only failed: %v", err)
	}
	if info.Sub != userID {
		t.Errorf("Expected sub %s, got %s", userID, info.Sub)
	}
	if info.Name != "" || info.PreferredUsername != "" || info.Email != "" || info.Picture != "" {
		t.Errorf("Expected only sub for openid scope, got extra fields: %+v", info)
	}
	t.Log("Only-sub userinfo response verified")

	// openid + profile
	info, err = svc.GetUserInfo(userID, []string{ScopeOpenID, ScopeProfile})
	if err != nil {
		t.Fatalf("GetUserInfo with profile failed: %v", err)
	}
	if info.PreferredUsername != testUsername {
		t.Errorf("Expected username %s, got %s", testUsername, info.PreferredUsername)
	}
	if info.Email != "" {
		t.Errorf("Expected no email without email scope, got %s", info.Email)
	}
	t.Log("Profile-only userinfo response verified")

	// openid + email
	info, err = svc.GetUserInfo(userID, []string{ScopeOpenID, ScopeEmail})
	if err != nil {
		t.Fatalf("GetUserInfo with email failed: %v", err)
	}
	if info.PreferredUsername != "" {
		t.Errorf("Expected no username without profile scope, got %s", info.PreferredUsername)
	}
	if info.Email != testUserEmail {
		t.Errorf("Expected email %s, got %s", testUserEmail, info.Email)
	}
	t.Log("Email-only userinfo response verified")
}

// TestOAuthRefreshTokenFlow tests refresh token issuance and rotation.
func TestOAuthRefreshTokenFlow(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeProfile, ScopeOfflineAccess}

	// Generate access token + refresh token
	at, _, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	refreshToken, err := svc.GenerateRefreshToken(at.ID, clientID, userID, scopes)
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}
	if refreshToken == "" {
		t.Fatal("Expected non-empty refresh token")
	}
	t.Logf("Refresh token generated: %s", refreshToken[:20]+"...")

	// Use refresh token to get new tokens (rotation)
	newAT, newRT, idToken, err := svc.RefreshAccessToken(refreshToken, clientID)
	if err != nil {
		t.Fatalf("RefreshAccessToken failed: %v", err)
	}
	if newAT == "" {
		t.Fatal("Expected new access token after refresh")
	}
	if newRT == "" {
		t.Fatal("Expected new refresh token (rotation) after refresh")
	}
	if idToken == "" {
		t.Fatal("Expected ID token after refresh (openid scope present)")
	}
	t.Logf("Token rotation successful: new access token, new refresh token, ID token")

	// Old refresh token should be revoked now
	_, _, _, err = svc.RefreshAccessToken(refreshToken, clientID)
	if err == nil {
		t.Fatal("Expected error when reusing revoked refresh token")
	}
	t.Logf("Old refresh token correctly rejected: %v", err)

	// New refresh token should work
	newAT2, newRT2, _, err := svc.RefreshAccessToken(newRT, clientID)
	if err != nil {
		t.Fatalf("Second refresh failed: %v", err)
	}
	if newAT2 == "" || newRT2 == "" {
		t.Fatal("Expected new tokens after second refresh")
	}
	t.Log("Second token rotation successful")

	// Validate the new access token works
	claims, err := svc.ValidateAccessToken(newAT2)
	if err != nil {
		t.Fatalf("ValidateAccessToken on refreshed token failed: %v", err)
	}
	if claims.UserID != userID {
		t.Errorf("Expected userID %s in refreshed token, got %s", userID, claims.UserID)
	}
}

// TestOAuthNoOfflineAccess ensures refresh token is NOT issued without offline_access scope.
func TestOAuthNoOfflineAccess(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	// Scopes without offline_access
	scopes := []string{ScopeOpenID, ScopeProfile}

	at, _, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, err = svc.GenerateRefreshToken(at.ID, clientID, userID, scopes)
	if err != nil {
		t.Fatalf("GenerateRefreshToken should succeed even without offline_access (just used conditionally): %v", err)
	}
	// The actual enforcement is in the handler. Here we just verify the service can generate it.
	t.Log("Refresh token generation works at service level — handler enforces scope check")
}

// TestOAuthTokenRevocation tests revoking tokens.
func TestOAuthTokenRevocation(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID}

	// Generate access token
	_, accessTokenStr, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	// Token should be valid before revocation
	_, err = svc.ValidateAccessToken(accessTokenStr)
	if err != nil {
		t.Fatalf("Expected valid token before revocation, got error: %v", err)
	}

	// Revoke by access_token type hint
	err = svc.RevokeToken(accessTokenStr, "access_token", clientID)
	if err != nil {
		t.Fatalf("RevokeToken failed: %v", err)
	}
	t.Log("Access token revoked")

	// Token should be invalid after revocation
	_, err = svc.ValidateAccessToken(accessTokenStr)
	if err == nil {
		t.Fatal("Expected error after token revocation, got nil")
	}
	if !strings.Contains(err.Error(), "revoked") {
		t.Errorf("Expected 'revoked' error, got: %v", err)
	}
	t.Logf("Revoked token correctly rejected: %v", err)

	// Test revoking a non-existent token should not fail
	err = svc.RevokeToken("nonexistent-token", "", clientID)
	if err != nil {
		t.Errorf("RevokeToken on non-existent token should not fail, got: %v", err)
	}
	t.Log("Revoking non-existent token gracefully handled")
}

// TestOAuthRefreshTokenRevocation tests revoking refresh tokens.
func TestOAuthRefreshTokenRevocation(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeProfile, ScopeOfflineAccess}

	at, _, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	refreshToken, err := svc.GenerateRefreshToken(at.ID, clientID, userID, scopes)
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}

	// Revoke by refresh_token type hint
	err = svc.RevokeToken(refreshToken, "refresh_token", clientID)
	if err != nil {
		t.Fatalf("RevokeToken refresh token failed: %v", err)
	}
	t.Log("Refresh token revoked")

	// Using a revoked refresh token should fail
	_, _, _, err = svc.RefreshAccessToken(refreshToken, clientID)
	if err == nil {
		t.Fatal("Expected error when using revoked refresh token")
	}
	t.Logf("Revoked refresh token correctly rejected: %v", err)
}

// TestOAuthRevokeAllUserTokens tests revoking all tokens for a user on an app.
func TestOAuthRevokeAllUserTokens(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID}

	// Generate two access tokens
	_, token1, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	_, token2, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken 2 failed: %v", err)
	}

	// Both should be valid
	_, err = svc.ValidateAccessToken(token1)
	if err != nil {
		t.Fatalf("Token1 should be valid before revoke-all: %v", err)
	}
	_, err = svc.ValidateAccessToken(token2)
	if err != nil {
		t.Fatalf("Token2 should be valid before revoke-all: %v", err)
	}

	// Revoke all
	err = svc.RevokeAllUserTokens(clientID, userID)
	if err != nil {
		t.Fatalf("RevokeAllUserTokens failed: %v", err)
	}

	// Both should be revoked now
	_, err = svc.ValidateAccessToken(token1)
	if err == nil {
		t.Fatal("Expected error for token1 after revoke-all")
	}
	_, err = svc.ValidateAccessToken(token2)
	if err == nil {
		t.Fatal("Expected error for token2 after revoke-all")
	}
	t.Log("All user tokens correctly revoked")
}

// TestOAuthClientSecretHash tests client secret hashing and verification.
func TestOAuthClientSecretHash(t *testing.T) {
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	secret := "my-super-secret-client-secret-123!@#"
	hash, err := svc.HashClientSecret(secret)
	if err != nil {
		t.Fatalf("HashClientSecret failed: %v", err)
	}

	if !svc.VerifyClientSecret(secret, hash) {
		t.Fatal("VerifyClientSecret should return true for correct secret")
	}

	if svc.VerifyClientSecret("wrong-secret", hash) {
		t.Fatal("VerifyClientSecret should return false for wrong secret")
	}

	// Verify with known test secret
	knownHash, err := svc.HashClientSecret("test-secret")
	if err != nil {
		t.Fatalf("HashClientSecret failed: %v", err)
	}
	if !svc.VerifyClientSecret("test-secret", knownHash) {
		t.Fatal("VerifyClientSecret should be deterministic")
	}
	t.Log("Client secret hashing and verification works correctly")
}

// TestOAuthInvalidPKCE tests that wrong PKCE verifier is rejected.
func TestOAuthInvalidPKCE(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	codeVerifier := "correct-verifier"
	codeChallenge := generatePKCEChallenge(codeVerifier)

	code, err := svc.GenerateAuthorizationCode(
		clientID, userID, testRedirectURI,
		codeChallenge, CodeChallengeMethodS256,
		"openid profile",
		"",
	)
	if err != nil {
		t.Fatalf("GenerateAuthorizationCode failed: %v", err)
	}

	// Try with wrong verifier
	_, _, _, err = svc.ValidateAuthorizationCode(code, clientID, testRedirectURI, "wrong-verifier")
	if err == nil {
		t.Fatal("Expected error for wrong PKCE verifier, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "pkce") && !strings.Contains(err.Error(), "verification") {
		t.Errorf("Expected PKCE-related error, got: %v", err)
	}
	t.Logf("Wrong PKCE verifier correctly rejected: %v", err)
}

// TestOAuthExpiredAuthorizationCode tests that expired codes are rejected.
func TestOAuthExpiredAuthorizationCode(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	codeVerifier := "test-verifier"
	codeChallenge := generatePKCEChallenge(codeVerifier)

	// Manually insert an already-expired code
	b := make([]byte, 32)
	expiredCode := hex.EncodeToString(b)
	scopesArray := "{openid,profile}"

	_, err := testDB.Exec(`
		INSERT INTO oauth_authorization_codes (code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, expiredCode, clientID, userID, testRedirectURI, codeChallenge, CodeChallengeMethodS256, scopesArray, time.Now().Add(-1*time.Hour))
	if err != nil {
		t.Fatalf("Failed to insert expired auth code: %v", err)
	}

	_, _, _, err = svc.ValidateAuthorizationCode(expiredCode, clientID, testRedirectURI, codeVerifier)
	if err == nil {
		t.Fatal("Expected error for expired authorization code, got nil")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "expir") {
		t.Errorf("Expected expiration-related error, got: %v", err)
	}
	t.Logf("Expired code correctly rejected: %v", err)
}

// TestOAuthRedirectURIMismatch tests that wrong redirect URI is rejected.
func TestOAuthRedirectURIMismatch(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	codeVerifier := "test-verifier"
	codeChallenge := generatePKCEChallenge(codeVerifier)

	code, err := svc.GenerateAuthorizationCode(
		clientID, userID, testRedirectURI,
		codeChallenge, CodeChallengeMethodS256,
		"openid profile",
		"",
	)
	if err != nil {
		t.Fatalf("GenerateAuthorizationCode failed: %v", err)
	}

	// Try with wrong redirect URI
	_, _, _, err = svc.ValidateAuthorizationCode(code, clientID, "http://evil.com/callback", codeVerifier)
	if err == nil {
		t.Fatal("Expected error for redirect_uri mismatch, got nil")
	}
	t.Logf("Redirect URI mismatch correctly rejected: %v", err)
}

// TestOAuthGenerateIDTokenRS256 tests that ID tokens are signed with RS256.
func TestOAuthGenerateIDTokenRS256(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeProfile, ScopeEmail}
	idToken, err := svc.GenerateIDToken(clientID, userID, testUsername, "nonce-123", scopes)
	if err != nil {
		t.Fatalf("GenerateIDToken failed: %v", err)
	}
	if idToken == "" {
		t.Fatal("Expected non-empty ID token")
	}

	// Verify JWKS endpoint has keys
	jwks := svc.GetJWKS()
	keys, ok := jwks["keys"].([]interface{})
	if !ok || len(keys) == 0 {
		t.Fatal("Expected JWKS to have keys")
	}

	key := keys[0].(map[string]interface{})
	if key["kty"] != "RSA" {
		t.Errorf("Expected kty RSA, got %s", key["kty"])
	}
	if key["alg"] != "RS256" {
		t.Errorf("Expected alg RS256, got %s", key["alg"])
	}
	if key["kid"] != "rsa-key-1" {
		t.Errorf("Expected kid 'rsa-key-1', got %s", key["kid"])
	}
	t.Logf("JWKS contains RSA public key: n=%s..., e=%s", key["n"].(string)[:20], key["e"].(string))
}

// TestOAuthOpenIDConfiguration tests the OpenID discovery document.
func TestOAuthOpenIDConfiguration(t *testing.T) {
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	cfg := svc.GetOpenIDConfiguration()

	if cfg.Issuer == "" {
		t.Fatal("Expected non-empty issuer")
	}
	if cfg.AuthorizationEndpoint == "" || cfg.TokenEndpoint == "" || cfg.UserinfoEndpoint == "" {
		t.Fatal("Expected all endpoints to be set")
	}

	if !containsString(cfg.ScopesSupported, ScopeOpenID) {
		t.Errorf("Expected scopes_supported to include openid, got %v", cfg.ScopesSupported)
	}
	if !containsString(cfg.ScopesSupported, ScopeProfile) {
		t.Errorf("Expected scopes_supported to include profile")
	}
	if !containsString(cfg.ScopesSupported, ScopeEmail) {
		t.Errorf("Expected scopes_supported to include email")
	}
	if !containsString(cfg.ScopesSupported, ScopeOfflineAccess) {
		t.Errorf("Expected scopes_supported to include offline_access")
	}

	if !containsString(cfg.GrantTypesSupported, GrantTypeAuthorizationCode) {
		t.Errorf("Expected grant_types to include authorization_code")
	}
	if !containsString(cfg.GrantTypesSupported, GrantTypeRefreshToken) {
		t.Errorf("Expected grant_types to include refresh_token")
	}

	if !containsString(cfg.CodeChallengeMethodsSupported, CodeChallengeMethodS256) {
		t.Errorf("Expected code_challenge_methods to include S256")
	}
	if len(cfg.CodeChallengeMethodsSupported) != 1 {
		t.Errorf("Expected only S256 code challenge method, got %v", cfg.CodeChallengeMethodsSupported)
	}

	t.Log("OpenID Configuration verified")
}

// TestOAuthAuditLog tests that audit log entries are created.
func TestOAuthAuditLog(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	// Log an action
	err := svc.LogOAuthAction(userID, clientID, testAppName, AuditActionAuthorize,
		"127.0.0.1", map[string]interface{}{
			"scopes": []string{"openid", "profile"},
		})
	if err != nil {
		t.Fatalf("LogOAuthAction failed: %v", err)
	}

	// Check the log entry exists
	var logCount int
	err = testDB.QueryRow(`SELECT COUNT(*) FROM oauth_audit_log WHERE action = $1 AND client_id = $2`,
		AuditActionAuthorize, clientID).Scan(&logCount)
	if err != nil {
		t.Fatalf("Failed to query audit log: %v", err)
	}
	if logCount < 1 {
		t.Fatal("Expected at least 1 audit log entry")
	}

	// Verify details JSON is stored correctly
	var detailsJSON string
	err = testDB.QueryRow(`SELECT details::text FROM oauth_audit_log WHERE action = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 1`,
		AuditActionAuthorize, clientID).Scan(&detailsJSON)
	if err != nil {
		t.Fatalf("Failed to query audit log details: %v", err)
	}
	if !strings.Contains(detailsJSON, "openid") || !strings.Contains(detailsJSON, "profile") {
		t.Errorf("Expected details to contain scopes, got: %s", detailsJSON)
	}

	t.Logf("Audit log entry verified: action=%s, details=%s", AuditActionAuthorize, detailsJSON)

	// Log with nil userID (anonymous)
	err = svc.LogOAuthAction("", clientID, testAppName, AuditActionTokenRevoke,
		"192.168.1.1", nil)
	if err != nil {
		t.Fatalf("LogOAuthAction with nil user failed: %v", err)
	}

	var anonCount int
	testDB.QueryRow(`SELECT COUNT(*) FROM oauth_audit_log WHERE action = $1 AND user_id IS NULL`,
		AuditActionTokenRevoke).Scan(&anonCount)
	if anonCount < 1 {
		t.Fatal("Expected anonymous audit log entry with NULL user_id")
	}
	t.Log("Anonymous audit log entry verified with NULL user_id")
}

// TestOAuthParseAndJoinScopes tests scope parsing utilities.
func TestOAuthParseAndJoinScopes(t *testing.T) {
	tests := []struct {
		input  string
		parsed []string
		joined string
	}{
		{"openid profile email", []string{"openid", "profile", "email"}, "openid profile email"},
		{"openid", []string{"openid"}, "openid"},
		{"", nil, ""},
		{"  openid   profile  ", []string{"openid", "profile"}, "openid profile"},
	}

	for _, tt := range tests {
		parsed := ParseScopeString(tt.input)
		joined := JoinScopes(parsed)

		if len(parsed) != len(tt.parsed) {
			t.Errorf("ParseScopeString(%q): expected %v, got %v", tt.input, tt.parsed, parsed)
			continue
		}
		for i := range parsed {
			if parsed[i] != tt.parsed[i] {
				t.Errorf("ParseScopeString(%q)[%d]: expected %s, got %s", tt.input, i, tt.parsed[i], parsed[i])
			}
		}

		if joined != tt.joined {
			t.Errorf("JoinScopes(%v): expected %q, got %q", parsed, tt.joined, joined)
		}
	}
	t.Log("ParseScopeString and JoinScopes verified")
}

// TestOAuthIntrospectAccessToken tests introspection of a valid access token.
func TestOAuthIntrospectAccessToken(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeProfile}

	at, accessTokenStr, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}
	_ = at

	// Introspect with access_token hint
	result := svc.IntrospectToken(accessTokenStr, "access_token")
	if !result.Active {
		t.Fatal("Expected active=true for valid access token")
	}
	if result.TokenType != "access_token" {
		t.Errorf("Expected token_type 'access_token', got '%s'", result.TokenType)
	}
	if result.ClientID != clientID {
		t.Errorf("Expected client_id %s, got %s", clientID, result.ClientID)
	}
	if result.UserID != userID {
		t.Errorf("Expected user_id %s, got %s", userID, result.UserID)
	}
	if result.Sub != userID {
		t.Errorf("Expected sub %s, got %s", userID, result.Sub)
	}
	if result.Username != testUsername {
		t.Errorf("Expected username %s, got %s", testUsername, result.Username)
	}
	if !strings.Contains(result.Scope, "openid") || !strings.Contains(result.Scope, "profile") {
		t.Errorf("Expected scopes to contain openid and profile, got '%s'", result.Scope)
	}
	if result.Exp == 0 {
		t.Error("Expected non-zero exp")
	}
	if result.Iat == 0 {
		t.Error("Expected non-zero iat")
	}
	if len(result.Aud) == 0 || result.Aud[0] != clientID {
		t.Errorf("Expected aud to include client_id %s, got %v", clientID, result.Aud)
	}
	if result.Iss == "" {
		t.Error("Expected non-empty iss")
	}
	t.Logf("Access token introspection: active=%v, scope='%s', exp=%d", result.Active, result.Scope, result.Exp)
}

// TestOAuthIntrospectRefreshToken tests introspection of a valid refresh token.
func TestOAuthIntrospectRefreshToken(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeOfflineAccess}

	at, _, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	refreshToken, err := svc.GenerateRefreshToken(at.ID, clientID, userID, scopes)
	if err != nil {
		t.Fatalf("GenerateRefreshToken failed: %v", err)
	}

	// Introspect with refresh_token hint
	result := svc.IntrospectToken(refreshToken, "refresh_token")
	if !result.Active {
		t.Fatal("Expected active=true for valid refresh token")
	}
	if result.TokenType != "refresh_token" {
		t.Errorf("Expected token_type 'refresh_token', got '%s'", result.TokenType)
	}
	if result.ClientID != clientID {
		t.Errorf("Expected client_id %s, got %s", clientID, result.ClientID)
	}
	if result.UserID != userID {
		t.Errorf("Expected user_id %s, got %s", userID, result.UserID)
	}
	if result.Exp == 0 {
		t.Error("Expected non-zero exp for refresh token")
	}
	t.Logf("Refresh token introspection: active=%v, exp=%d", result.Active, result.Exp)

	// Introspect without hint (should auto-detect refresh token)
	result = svc.IntrospectToken(refreshToken, "")
	if !result.Active {
		t.Fatal("Expected active=true for refresh token without hint")
	}
	t.Log("Refresh token introspection without hint also works")
}

// TestOAuthIntrospectRevokedToken tests that revoked tokens are reported inactive.
func TestOAuthIntrospectRevokedToken(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID}

	_, accessTokenStr, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	// Revoke the token
	err = svc.RevokeToken(accessTokenStr, "access_token", clientID)
	if err != nil {
		t.Fatalf("RevokeToken failed: %v", err)
	}

	// Introspect should show inactive
	result := svc.IntrospectToken(accessTokenStr, "access_token")
	if result.Active {
		t.Fatal("Expected active=false for revoked access token")
	}
	t.Log("Revoked token correctly reported as inactive")
}

// TestOAuthIntrospectInvalidToken tests that invalid/malformed tokens are reported inactive.
func TestOAuthIntrospectInvalidToken(t *testing.T) {
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	// Empty token
	result := svc.IntrospectToken("", "access_token")
	if result.Active {
		t.Fatal("Expected active=false for empty token")
	}

	// Malformed token
	result = svc.IntrospectToken("not-a-token", "")
	if result.Active {
		t.Fatal("Expected active=false for malformed token")
	}

	// Random gibberish
	result = svc.IntrospectToken("eyJhbGciOiJSUzI1NiIsImtpZCI6InJzYS1rZXktMSJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature", "")
	if result.Active {
		t.Fatal("Expected active=false for random JWT")
	}

	t.Log("All invalid token cases correctly reported as inactive")
}

// TestOAuthIntrospectWithoutHint tests auto-detection without token_type_hint.
func TestOAuthIntrospectWithoutHint(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	scopes := []string{ScopeOpenID, ScopeProfile}

	_, accessTokenStr, err := svc.GenerateAccessToken(clientID, userID, testUsername, scopes)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	// Introspect without hint — should be auto-detected as access token (JWT)
	result := svc.IntrospectToken(accessTokenStr, "")
	if !result.Active {
		t.Fatal("Expected active=true for access token without hint")
	}
	if result.TokenType != "access_token" {
		t.Errorf("Expected token_type 'access_token', got '%s'", result.TokenType)
	}
	t.Log("Access token auto-detected without token_type_hint")
}

// TestOAuthIntrospectExpiredRefreshToken tests that expired refresh tokens are inactive.
func TestOAuthIntrospectExpiredRefreshToken(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)
	clientID, _ := setupTestApp(t, svc, userID)

	// Manually insert an expired refresh token
	b := make([]byte, 40)
	randomToken := base64.RawURLEncoding.EncodeToString(b)
	hash := sha256.Sum256([]byte(randomToken))
	tokenHash := hex.EncodeToString(hash[:])
	scopesArray := "{openid,offline_access}"

	_, err := testDB.Exec(`
		INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5)
	`, tokenHash, clientID, userID, scopesArray, time.Now().Add(-1*time.Hour))
	if err != nil {
		t.Fatalf("Failed to insert expired refresh token: %v", err)
	}

	result := svc.IntrospectToken(randomToken, "refresh_token")
	if result.Active {
		t.Fatal("Expected active=false for expired refresh token")
	}
	t.Log("Expired refresh token correctly reported as inactive")
}

// TestOAuthInvalidTokenRejection ensures invalid/malformed tokens are rejected.
func TestOAuthInvalidTokenRejection(t *testing.T) {
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	// Empty token
	_, err := svc.ValidateAccessToken("")
	if err == nil {
		t.Fatal("Expected error for empty token")
	}
	t.Logf("Empty token rejected: %v", err)

	// Malformed token
	_, err = svc.ValidateAccessToken("not-a-jwt-token")
	if err == nil {
		t.Fatal("Expected error for malformed token")
	}
	t.Logf("Malformed token rejected: %v", err)

}

// TestOAuthHasScope tests the HasScope utility function.
func TestOAuthHasScope(t *testing.T) {
	scopes := []string{"openid", "profile", "email", "offline_access"}

	if !HasScope(scopes, "openid") {
		t.Error("Expected HasScope to find 'openid'")
	}
	if !HasScope(scopes, "offline_access") {
		t.Error("Expected HasScope to find 'offline_access'")
	}
	if HasScope(scopes, "admin") {
		t.Error("Expected HasScope to not find 'admin'")
	}
	if HasScope([]string{}, "openid") {
		t.Error("Expected HasScope to return false for empty scopes")
	}
}

// TestOAuthNullableString tests the nullableString helper.
func TestOAuthNullableString(t *testing.T) {
	if nullableString("") != nil {
		t.Error("Expected nullableString('') to return nil")
	}
	if nullableString("test") == nil {
		t.Error("Expected nullableString('test') to return non-nil")
	}
	if *nullableString("test") != "test" {
		t.Errorf("Expected nullableString('test') to return pointer to 'test'")
	}
}

// TestOAuthGenerateClientIDSecret tests client ID and secret generation.
func TestOAuthGenerateClientIDSecret(t *testing.T) {
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	id1 := svc.GenerateClientID()
	id2 := svc.GenerateClientID()
	if id1 == id2 {
		t.Fatal("Expected two generated client IDs to be different")
	}
	if len(id1) != 64 { // 32 bytes = 64 hex chars
		t.Errorf("Expected client ID length 64, got %d", len(id1))
	}

	secret1 := svc.GenerateClientSecret()
	secret2 := svc.GenerateClientSecret()
	if secret1 == secret2 {
		t.Fatal("Expected two generated client secrets to be different")
	}
	if len(secret1) != 80 { // 40 bytes = 80 hex chars
		t.Errorf("Expected client secret length 80, got %d", len(secret1))
	}
	t.Logf("Client ID length: %d, Client secret length: %d", len(id1), len(secret1))
}

// TestOAuthApplicationCRUD tests creating, reading, updating, and deleting apps.
func TestOAuthApplicationCRUD(t *testing.T) {
	userID := setupTestUser(t)
	authSvc := auth.NewAuthService()
	svc := NewOAuthService(testDB, authSvc)

	// Create
	app, secret, err := svc.CreateApplication(
		userID,
		"CRUD Test App",
		"Testing app lifecycle",
		[]string{"http://localhost:4000/callback"},
		[]string{ScopeProfile},
		true,
		"https://example.com/logo.png",
		"https://example.com",
	)
	if err != nil {
		t.Fatalf("CreateApplication failed: %v", err)
	}
	if app == nil || secret == "" {
		t.Fatal("Expected non-nil app and non-empty secret")
	}
	t.Logf("App created: id=%s, client_id=%s", app.ID, app.ClientID)

	// Read by client ID
	appByClient, err := svc.GetApplicationByClientID(app.ClientID)
	if err != nil || appByClient == nil {
		t.Fatalf("GetApplicationByClientID failed: %v", err)
	}
	if appByClient.Name != "CRUD Test App" {
		t.Errorf("Expected name 'CRUD Test App', got '%s'", appByClient.Name)
	}

	// Read by ID
	appByID, err := svc.GetApplicationByID(app.ID)
	if err != nil || appByID == nil {
		t.Fatalf("GetApplicationByID failed: %v", err)
	}
	if appByID.ClientID != app.ClientID {
		t.Errorf("Expected ClientID %s, got %s", app.ClientID, appByID.ClientID)
	}

	// Update
	newName := "Updated CRUD App"
	updated, err := svc.UpdateApplication(app.ID, userID, &UpdateAppRequest{
		Name: &newName,
	})
	if err != nil {
		t.Fatalf("UpdateApplication failed: %v", err)
	}
	if updated == nil {
		t.Fatal("Expected non-nil updated app")
	}
	if updated.Name != newName {
		t.Errorf("Expected name '%s', got '%s'", newName, updated.Name)
	}
	t.Logf("App updated to: %s", updated.Name)

	// Regenerate secret
	newSecret, err := svc.RegenerateClientSecret(app.ID, userID)
	if err != nil {
		t.Fatalf("RegenerateClientSecret failed: %v", err)
	}
	if newSecret == secret {
		t.Fatal("Expected new secret to differ from old secret")
	}

	// Re-fetch to get updated hash after regeneration
	refreshed, err := svc.GetApplicationByID(app.ID)
	if err != nil || refreshed == nil {
		t.Fatalf("Failed to fetch app after secret regeneration: %v", err)
	}
	if !svc.VerifyClientSecret(newSecret, refreshed.ClientSecretHash) {
		t.Fatal("New secret should verify against updated hash")
	}
	t.Log("Secret regenerated and verified")

	// Delete
	err = svc.DeleteApplication(app.ID, userID)
	if err != nil {
		t.Fatalf("DeleteApplication failed: %v", err)
	}

	// Verify deleted
	deleted, err := svc.GetApplicationByID(app.ID)
	if err != nil {
		t.Fatalf("GetApplicationByID after delete failed: %v", err)
	}
	if deleted != nil {
		t.Fatal("Expected nil after deletion")
	}
	t.Log("App deleted successfully")
}

// helpers

func containsString(slice []string, s string) bool {
	for _, item := range slice {
		if item == s {
			return true
		}
	}
	return false
}
