package handlers

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/oauth"
)

// =============================================================================
// Test helpers for OAuth handler
// =============================================================================

func setupOAuthHandler(t *testing.T) (*OAuthHandler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	authSvc := auth.NewAuthService()
	oauthSvc := oauth.NewOAuthService(db, authSvc)
	handler := NewOAuthHandler(db, oauthSvc, authSvc)
	return handler, mock
}

// newOAuthPOSTContext creates a POST context without claims (unauthenticated)
func newOAuthPOSTContext(url string, body interface{}) (*gin.Context, *httptest.ResponseRecorder) {
	return newPOSTContext(url, body, nil, nil)
}

// newOAuthGETContext creates a GET context with query params
func newOAuthGETContext(url string, queryParams map[string]string, claims *auth.Claims) (*gin.Context, *httptest.ResponseRecorder) {
	return newGETContextWithClaims(url, queryParams, claims)
}

// =============================================================================
// Standalone function tests
// =============================================================================

func TestIsValidRedirectURI_ExactMatch(t *testing.T) {
	allowed := []string{"http://localhost:3000/callback", "https://app.example.com/oauth"}
	if !isValidRedirectURI(allowed, "http://localhost:3000/callback") {
		t.Fatal("Expected exact match to be valid")
	}
	if !isValidRedirectURI(allowed, "https://app.example.com/oauth") {
		t.Fatal("Expected second exact match to be valid")
	}
}

func TestIsValidRedirectURI_NoMatch(t *testing.T) {
	allowed := []string{"http://localhost:3000/callback"}
	if isValidRedirectURI(allowed, "http://evil.com/callback") {
		t.Fatal("Expected disallowed URI to be rejected")
	}
	if isValidRedirectURI(allowed, "http://localhost:4000/callback") {
		t.Fatal("Expected different port localhost to be rejected")
	}
}

func TestIsValidRedirectURI_LocalhostWildcard(t *testing.T) {
	allowed := []string{"http://localhost:*"}
	if !isValidRedirectURI(allowed, "http://localhost:3000/callback") {
		t.Fatal("Expected wildcard localhost to match any port")
	}
	if !isValidRedirectURI(allowed, "http://localhost:8080/auth") {
		t.Fatal("Expected wildcard localhost to match port 8080")
	}
	if isValidRedirectURI(allowed, "https://localhost:3000/callback") {
		t.Fatal("Expected wildcard NOT to match https")
	}
}

func TestIsValidRedirectURI_EmptyAllowed(t *testing.T) {
	if isValidRedirectURI([]string{}, "http://localhost/callback") {
		t.Fatal("Expected empty allowed list to reject all URIs")
	}
}

func TestIsValidRedirectURI_SubdirectoryMatch(t *testing.T) {
	allowed := []string{"http://localhost:3000/callback"}
	// The function does exact matching — subdirectory should NOT match
	if isValidRedirectURI(allowed, "http://localhost:3000/callback/extra") {
		t.Fatal("Expected subdirectory to be rejected (exact match only)")
	}
}

func TestIsScopeAllowed_OpenIDAlways(t *testing.T) {
	if !isScopeAllowed([]string{}, oauth.ScopeOpenID) {
		t.Fatal("Expected openid to always be allowed")
	}
}

func TestIsScopeAllowed_FromList(t *testing.T) {
	allowed := []string{oauth.ScopeProfile, oauth.ScopeEmail}
	if !isScopeAllowed(allowed, oauth.ScopeProfile) {
		t.Fatal("Expected profile to be allowed")
	}
	if !isScopeAllowed(allowed, oauth.ScopeEmail) {
		t.Fatal("Expected email to be allowed")
	}
}

func TestIsScopeAllowed_NotInList(t *testing.T) {
	allowed := []string{oauth.ScopeProfile}
	if isScopeAllowed(allowed, oauth.ScopeOfflineAccess) {
		t.Fatal("Expected offline_access to NOT be allowed when not in list")
	}
	// But openid is always allowed
	if !isScopeAllowed(allowed, oauth.ScopeOpenID) {
		t.Fatal("Expected openid to be allowed even without list")
	}
}

func TestSplitToken_Valid(t *testing.T) {
	result := splitToken("Bearer abc123")
	if result == nil {
		t.Fatal("Expected valid split for 'Bearer abc123'")
	}
	if result[0] != "Bearer" || result[1] != "abc123" {
		t.Errorf("Expected ['Bearer', 'abc123'], got %v", result)
	}
}

func TestSplitToken_Invalid_MissingSpace(t *testing.T) {
	if splitToken("Bearerabc123") != nil {
		t.Fatal("Expected nil for missing space after Bearer")
	}
}

func TestSplitToken_Invalid_WrongPrefix(t *testing.T) {
	if splitToken("Basic abc123") != nil {
		t.Fatal("Expected nil for wrong prefix")
	}
	if splitToken("bearer abc123") != nil {
		t.Fatal("Expected nil for lowercase bearer")
	}
}

func TestSplitToken_Invalid_TooShort(t *testing.T) {
	if splitToken("") != nil {
		t.Fatal("Expected nil for empty string")
	}
	if splitToken("Bear") != nil {
		t.Fatal("Expected nil for too-short string")
	}
}

func TestSplitToken_Invalid_OnlyBearer(t *testing.T) {
	// splitToken("Bearer ") returns ["Bearer", ""] — the empty string after the space
	// is technically a token (splitToken checks len >= 7 && prefix match)
	result := splitToken("Bearer ")
	if result == nil {
		t.Fatal("Expected non-nil for 'Bearer ' (empty token string)")
	}
	if result[0] != "Bearer" || result[1] != "" {
		t.Errorf("Expected ['Bearer', ''], got %v", result)
	}
}

func TestSplitToken_MultipleSpaces(t *testing.T) {
	result := splitToken("Bearer abc def ghi")
	if result == nil {
		t.Fatal("Expected valid split for multiple-part token")
	}
	if result[1] != "abc def ghi" {
		t.Errorf("Expected token 'abc def ghi', got '%s'", result[1])
	}
}

func TestStringsHasPrefix(t *testing.T) {
	if !stringsHasPrefix("hello world", "hello") {
		t.Fatal("Expected 'hello world' to start with 'hello'")
	}
	if stringsHasPrefix("hello world", "world") {
		t.Fatal("Expected 'hello world' NOT to start with 'world'")
	}
	if !stringsHasPrefix("abc", "abc") {
		t.Fatal("Expected exact match to pass")
	}
	if stringsHasPrefix("ab", "abc") {
		t.Fatal("Expected shorter string NOT to start with longer prefix")
	}
	if !stringsHasPrefix("", "") {
		t.Fatal("Expected empty string to start with empty string")
	}
}

// =============================================================================
// OAuthBearerMiddleware tests
// =============================================================================

func TestOAuthBearerMiddleware_NoAuthHeader(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodGet, "/test", nil)

	svc := &oauth.OAuthService{}
	middleware := OAuthBearerMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestOAuthBearerMiddleware_InvalidFormat(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Basic abc")
	c.Request = req

	svc := &oauth.OAuthService{}
	middleware := OAuthBearerMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestOAuthBearerMiddleware_EmptyBearer(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer ")
	c.Request = req

	svc := &oauth.OAuthService{}
	middleware := OAuthBearerMiddleware(svc)
	middleware(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for empty Bearer token, got %d", w.Code)
	}
}

// =============================================================================
// Authorize handler tests
// =============================================================================

func TestAuthorize_MissingClientID(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "code",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_MissingRedirectURI(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "code",
		"client_id":     "test-client",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_UnsupportedResponseType(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "token",
		"client_id":     "test-client",
		"redirect_uri":  "http://localhost:3000/callback",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_InvalidClientID(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("invalid-client").
		WillReturnRows(sqlmock.NewRows([]string{}))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "code",
		"client_id":     "invalid-client",
		"redirect_uri":  "http://localhost:3000/callback",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_InvalidRedirectURI(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "code",
		"client_id":     "test-client",
		"redirect_uri":  "http://evil.com/callback",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_MissingPKCE(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type": "code",
		"client_id":     "test-client",
		"redirect_uri":  "http://localhost:3000/callback",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing PKCE, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_WrongPKCEMethod(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type":         "code",
		"client_id":             "test-client",
		"redirect_uri":          "http://localhost:3000/callback",
		"code_challenge":        "abcdef123456",
		"code_challenge_method": "plain",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plain PKCE, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_InvalidScope(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type":         "code",
		"client_id":             "test-client",
		"redirect_uri":          "http://localhost:3000/callback",
		"code_challenge":        "abcdef1234567890abcdef1234567890abcdef1234567890ab",
		"code_challenge_method": "S256",
		"scope":                 "admin",
	}, nil)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid scope, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAuthorize_ConsentMissing(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	claims := &auth.Claims{UserID: "user-1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthGETContext("/oauth/authorize", map[string]string{
		"response_type":         "code",
		"client_id":             "test-client",
		"redirect_uri":          "http://localhost:3000/callback",
		"code_challenge":        "abcdef1234567890abcdef1234567890abcdef1234567890ab",
		"code_challenge_method": "S256",
		"scope":                 "profile",
	}, claims)
	h.Authorize(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing consent, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// Token handler tests
// =============================================================================

func TestToken_InvalidBody(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthPOSTContext("/oauth/token", "not json")
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestToken_InvalidClient(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("invalid-client").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType: oauth.GrantTypeAuthorizationCode,
		ClientID:  "invalid-client",
		Code:      "some-code",
	})
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToken_ConfidentialClient_NoSecret(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("confidential-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "confidential-client", "$2a$10$abcdefghijklmnopqrstuv", // placeholder hash validates nothing
			`["http://localhost:3000/callback"]`, "{profile}", true, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType: oauth.GrantTypeAuthorizationCode,
		ClientID:  "confidential-client",
		Code:      "some-code",
	})
	h.Token(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for confidential client without secret, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToken_UnsupportedGrant(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType: "password",
		ClientID:  "test-client",
	})
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unsupported grant, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToken_AuthorizationCode_MissingCode(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType: oauth.GrantTypeAuthorizationCode,
		ClientID:  "test-client",
	})
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing code, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToken_AuthorizationCode_InvalidCode(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	// The auth code lookup will fail
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_authorization_codes.*WHERE code.*`).
		WithArgs("invalid-code", "test-client").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType:    oauth.GrantTypeAuthorizationCode,
		ClientID:     "test-client",
		Code:         "invalid-code",
		RedirectURI:  "http://localhost:3000/callback",
		CodeVerifier: "verifier",
	})
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid code, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToken_RefreshToken_MissingToken(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("test-client").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "owner_id", "name", "description", "client_id", "client_secret_hash",
			"redirect_uris", "allowed_scopes", "is_confidential", "logo_url", "homepage_url",
			"is_active", "created_at", "updated_at",
		}).AddRow("app-1", "user-1", "Test App", "desc", "test-client", "",
			`["http://localhost:3000/callback"]`, "{profile}", false, "", "",
			true, time.Now(), time.Now()))

	c, w := newOAuthPOSTContext("/oauth/token", oauth.TokenRequest{
		GrantType: oauth.GrantTypeRefreshToken,
		ClientID:  "test-client",
	})
	h.Token(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing refresh_token, got %d: %s", w.Code, w.Body.String())
	}
}

// =============================================================================
// Revoke handler tests
// =============================================================================

func TestRevoke_MissingToken(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthPOSTContext("/oauth/revoke", oauth.RevokeRequest{})
	h.Revoke(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing token, got %d", w.Code)
	}
}

func TestRevoke_InvalidBody(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthPOSTContext("/oauth/revoke", "not json")
	h.Revoke(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// =============================================================================
// UserInfo handler tests
// =============================================================================

func TestUserInfo_NoOAuthClaims(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newGETContextWithClaims("/oauth/userinfo", nil, nil)
	h.UserInfo(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// =============================================================================
// OpenID Configuration handler tests
// =============================================================================

func TestOpenIDConfiguration_Success(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/.well-known/openid-configuration", nil, nil)
	h.OpenIDConfiguration(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var cfg map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &cfg)
	if cfg["issuer"] == nil {
		t.Fatal("Expected issuer in OpenID config")
	}
	if cfg["authorization_endpoint"] == nil {
		t.Fatal("Expected authorization_endpoint in OpenID config")
	}
}

// =============================================================================
// JWKS handler tests
// =============================================================================

func TestJWKS_Success(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/.well-known/jwks.json", nil, nil)
	h.JWKS(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var jwks map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &jwks)
	keys, ok := jwks["keys"]
	if !ok {
		t.Fatal("Expected 'keys' in JWKS response")
	}
	_ = keys
}

// =============================================================================
// AppInfo handler tests
// =============================================================================

func TestAppInfo_MissingClientID(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthGETContext("/oauth/app-info", nil, nil)
	h.AppInfo(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestAppInfo_NotFound(t *testing.T) {
	h, mock := setupOAuthHandler(t)
	mock.ExpectQuery(`(?s).*SELECT.*FROM oauth_applications.*WHERE client_id.*`).
		WithArgs("unknown-client").
		WillReturnRows(sqlmock.NewRows([]string{}))

	c, w := newOAuthGETContext("/oauth/app-info", map[string]string{
		"client_id": "unknown-client",
	}, nil)
	h.AppInfo(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// =============================================================================
// Introspect handler tests
// =============================================================================
// These require valid RSA keypair. We test auth/db-independent paths.

func TestIntrospect_MissingToken(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthPOSTContext("/oauth/introspect", oauth.IntrospectRequest{})
	h.Introspect(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestIntrospect_NoAuth(t *testing.T) {
	h, _ := setupOAuthHandler(t)
	c, w := newOAuthPOSTContext("/oauth/introspect", oauth.IntrospectRequest{
		Token: "some-token",
	})
	h.Introspect(c)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated introspect, got %d", w.Code)
	}
}

// =============================================================================
// Prevent unused import error
// =============================================================================
var _ = rand.Reader
var _ = rsa.GenerateKey
