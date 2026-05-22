package oauth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gomo6/backend/internal/auth"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// OAuthService handles all OAuth 2.0 + OpenID Connect operations
type OAuthService struct {
	db        *sql.DB
	authSvc   *auth.AuthService
	issuer    string
	jwtSecret []byte
}

// NewOAuthService creates a new OAuthService
func NewOAuthService(db *sql.DB, authSvc *auth.AuthService) *OAuthService {
	issuer := os.Getenv("ISSUER_URL")
	if issuer == "" {
		issuer = "http://localhost:8080"
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		secret = "your-secret-key"
	}

	return &OAuthService{
		db:        db,
		authSvc:   authSvc,
		issuer:    issuer,
		jwtSecret: []byte(secret),
	}
}

// =============================
// Client Registration
// =============================

// GenerateClientID generates a cryptographically random client ID
func (s *OAuthService) GenerateClientID() string {
	b := make([]byte, 32)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// GenerateClientSecret generates a cryptographically random client secret
func (s *OAuthService) GenerateClientSecret() string {
	b := make([]byte, 40)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// HashClientSecret hashes a client secret with SHA-256 first, then bcrypt
// bcrypt has a 72-byte input limit, so we pre-hash with SHA-256 to avoid truncation
func (s *OAuthService) HashClientSecret(secret string) (string, error) {
	// Pre-hash with SHA-256 to stay within bcrypt's 72-byte limit
	hash := sha256.Sum256([]byte(secret))
	hashHex := hex.EncodeToString(hash[:])
	bcryptHash, err := bcrypt.GenerateFromPassword([]byte(hashHex), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(bcryptHash), nil
}

// VerifyClientSecret verifies a client secret against its hash
func (s *OAuthService) VerifyClientSecret(secret, hash string) bool {
	// Pre-hash with SHA-256 to match the hashing method
	h := sha256.Sum256([]byte(secret))
	hashHex := hex.EncodeToString(h[:])
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(hashHex)) == nil
}

// CreateApplication creates a new OAuth application
func (s *OAuthService) CreateApplication(ownerID, name, description string, redirectURIs []string, allowedScopes []string, isConfidential bool, logoURL, homepageURL string) (*OAuthApplication, string, error) {
	clientID := s.GenerateClientID()
	clientSecret := s.GenerateClientSecret()

	secretHash, err := s.HashClientSecret(clientSecret)
	if err != nil {
		return nil, "", err
	}

	// Validate scopes
	for _, scope := range allowedScopes {
		if !isValidScope(scope) {
			return nil, "", fmt.Errorf("invalid scope: %s", scope)
		}
	}

	redirectURIsJSON, _ := json.Marshal(redirectURIs)
	scopesArray := fmt.Sprintf("{%s}", strings.Join(allowedScopes, ","))

	var app OAuthApplication
	var redirectURIsResult string
	var scopesArrayResult []byte
	err = s.db.QueryRow(`
		INSERT INTO oauth_applications 
			(owner_id, name, description, client_id, client_secret_hash, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, owner_id, name, description, client_id, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at
	`, ownerID, name, description, clientID, secretHash, string(redirectURIsJSON), scopesArray, isConfidential, logoURL, homepageURL).Scan(
		&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.ClientID,
		&redirectURIsResult, &scopesArrayResult, &app.IsConfidential,
		&app.LogoURL, &app.HomepageURL, &app.IsActive, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to create application: %w", err)
	}
	// Parse redirect URIs from JSON string
	json.Unmarshal([]byte(redirectURIsResult), &app.RedirectURIs)
	// Parse scopes from PostgreSQL text array
	scopeStr := strings.Trim(string(scopesArrayResult), "{}")
	if scopeStr != "" {
		app.AllowedScopes = strings.Split(scopeStr, ",")
	}

	return &app, clientSecret, nil
}

// GetApplicationByClientID retrieves an application by client_id
func (s *OAuthService) GetApplicationByClientID(clientID string) (*OAuthApplication, error) {
	var app OAuthApplication
	var redirectURIsJSON string
	var scopesArray []byte

	err := s.db.QueryRow(`
		SELECT id, owner_id, name, description, client_id, client_secret_hash, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at
		FROM oauth_applications
		WHERE client_id = $1
	`, clientID).Scan(
		&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.ClientID,
		&app.ClientSecretHash, &redirectURIsJSON, &scopesArray, &app.IsConfidential,
		&app.LogoURL, &app.HomepageURL, &app.IsActive, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	// Parse redirect URIs
	json.Unmarshal([]byte(redirectURIsJSON), &app.RedirectURIs)

	// Parse scopes (PostgreSQL text array format {a,b,c})
	scopeStr := string(scopesArray)
	scopeStr = strings.Trim(scopeStr, "{}")
	if scopeStr != "" {
		app.AllowedScopes = strings.Split(scopeStr, ",")
	}

	return &app, nil
}

// =============================
// Authorization Code
// =============================

// GenerateAuthorizationCode creates a short-lived authorization code
func (s *OAuthService) GenerateAuthorizationCode(clientID, userID, redirectURI, codeChallenge, codeChallengeMethod, scopes, nonce string) (string, error) {
	// Generate random code
	b := make([]byte, 32)
	rand.Read(b)
	code := base64.RawURLEncoding.EncodeToString(b)

	var scopesArray string
	if scopes == "" {
		scopesArray = "{}"
	} else {
		scopesArray = fmt.Sprintf("{%s}", strings.Join(strings.Fields(scopes), ","))
	}

	_, err := s.db.Exec(`
		INSERT INTO oauth_authorization_codes 
			(code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes, nonce, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, code, clientID, userID, redirectURI, codeChallenge, codeChallengeMethod, scopesArray, nonce, time.Now().Add(5*time.Minute))
	if err != nil {
		return "", fmt.Errorf("failed to store authorization code: %w", err)
	}

	return code, nil
}

// ValidateAuthorizationCode validates and consumes an authorization code
func (s *OAuthService) ValidateAuthorizationCode(code, clientID, redirectURI, codeVerifier string) (userID string, scopes []string, nonce string, err error) {
	var authCode AuthorizationCode
	var scopesStr string

	err = s.db.QueryRow(`
		SELECT id, code, client_id, user_id, redirect_uri, code_challenge, code_challenge_method, scopes, nonce, expires_at, used
		FROM oauth_authorization_codes
		WHERE code = $1 AND client_id = $2 AND used = false
	`, code, clientID).Scan(
		&authCode.ID, &authCode.Code, &authCode.ClientID, &authCode.UserID,
		&authCode.RedirectURI, &authCode.CodeChallenge, &authCode.CodeChallengeMethod,
		&scopesStr, &authCode.Nonce, &authCode.ExpiresAt, &authCode.Used,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil, "", fmt.Errorf("invalid authorization code")
		}
		return "", nil, "", err
	}

	// Check expiration
	if time.Now().After(authCode.ExpiresAt) {
		return "", nil, "", fmt.Errorf("authorization code expired")
	}

	// Verify redirect URI
	if authCode.RedirectURI != redirectURI {
		return "", nil, "", fmt.Errorf("redirect_uri mismatch")
	}

	// Verify PKCE code challenge
	if authCode.CodeChallenge != "" {
		if codeVerifier == "" {
			return "", nil, "", fmt.Errorf("code_verifier required")
		}
		if err := verifyPKCE(authCode.CodeChallenge, authCode.CodeChallengeMethod, codeVerifier); err != nil {
			return "", nil, "", err
		}
	}

	// Mark code as used
	_, err = s.db.Exec(`UPDATE oauth_authorization_codes SET used = true WHERE id = $1`, authCode.ID)
	if err != nil {
		return "", nil, "", fmt.Errorf("failed to consume authorization code")
	}

	// Parse scopes
	scopesStr = strings.Trim(scopesStr, "{}")
	if scopesStr != "" {
		scopes = strings.Split(scopesStr, ",")
	} else {
		scopes = []string{}
	}

	return authCode.UserID, scopes, authCode.Nonce, nil
}

// =============================
// Token Generation
// =============================

// OAuthClaims represents custom JWT claims for OAuth access tokens
type OAuthClaims struct {
	UserID   string   `json:"user_id"`
	Username string   `json:"username"`
	ClientID string   `json:"client_id"`
	Scopes   []string `json:"scopes"`
	jwt.RegisteredClaims
}

// IDTokenClaims represents JWT claims for OpenID Connect ID token
type IDTokenClaims struct {
	AuthTime          int64  `json:"auth_time,omitempty"`
	Nonce             string `json:"nonce,omitempty"`
	Name              string `json:"name,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Email             string `json:"email,omitempty"`
	EmailVerified     bool   `json:"email_verified,omitempty"`
	Picture           string `json:"picture,omitempty"`
	jwt.RegisteredClaims
}

// GenerateAccessToken creates an OAuth access token (JWT)
func (s *OAuthService) GenerateAccessToken(clientID, userID, username string, scopes []string) (*AccessToken, string, error) {
	tokenID := uuid.New().String()

	now := time.Now()
	expiresAt := now.Add(1 * time.Hour)

	claims := OAuthClaims{
		UserID:   userID,
		Username: username,
		ClientID: clientID,
		Scopes:   scopes,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        tokenID,
			Issuer:    s.issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(s.jwtSecret)
	if err != nil {
		return nil, "", err
	}

	// Store in database for revocation tracking
	var scopesArray string
	if len(scopes) == 0 {
		scopesArray = "{}"
	} else {
		scopesArray = fmt.Sprintf("{%s}", strings.Join(scopes, ","))
	}

	var at AccessToken
	var scopesResult []byte
	err = s.db.QueryRow(`
		INSERT INTO oauth_access_tokens (token_id, client_id, user_id, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, token_id, client_id, user_id, scopes, expires_at, revoked, created_at
	`, tokenID, clientID, userID, scopesArray, expiresAt).Scan(
		&at.ID, &at.TokenID, &at.ClientID, &at.UserID, &scopesResult, &at.ExpiresAt, &at.Revoked, &at.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("failed to store access token: %w", err)
	}
	// Parse scopes from PostgreSQL text array
	if len(scopesResult) > 0 {
		scopeStr := strings.Trim(string(scopesResult), "{}")
		if scopeStr != "" {
			at.Scopes = strings.Split(scopeStr, ",")
		}
	}

	return &at, tokenString, nil
}

// GenerateIDToken creates an OpenID Connect ID token
func (s *OAuthService) GenerateIDToken(clientID, userID, username, nonce string, scopes []string) (string, error) {
	now := time.Now()
	expiresAt := now.Add(1 * time.Hour)

	claims := IDTokenClaims{
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    s.issuer,
			Subject:   userID,
			Audience:  jwt.ClaimStrings{clientID},
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(now),
		},
		AuthTime:          now.Unix(),
		Nonce:             nonce,
		PreferredUsername: username,
	}

	// Add profile claims if scope includes profile
	if hasScope(scopes, ScopeProfile) {
		var avatarURL *string
		s.db.QueryRow(`SELECT avatar_url FROM users WHERE id = $1`, userID).Scan(&avatarURL)
		claims.Name = username
		if avatarURL != nil && *avatarURL != "" {
			claims.Picture = s.buildAvatarURL(*avatarURL)
		}
	}

	// Add email claims if scope includes email
	if hasScope(scopes, ScopeEmail) {
		var email string
		err := s.db.QueryRow(`SELECT email FROM users WHERE id = $1`, userID).Scan(&email)
		if err == nil {
			claims.Email = email
			claims.EmailVerified = true
		}
	}

	// Sign with HMAC-SHA256 (same as access token for now)
	// In production, you'd want RS256 for ID tokens so third parties can verify
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(s.jwtSecret)
}

// ValidateAccessToken validates an OAuth access token and returns its claims
func (s *OAuthService) ValidateAccessToken(tokenString string) (*OAuthClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &OAuthClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
		}
		return s.jwtSecret, nil
	})

	if err != nil {
		return nil, err
	}

	claims, ok := token.Claims.(*OAuthClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid token")
	}

	// Check if token has been revoked
	var revoked bool
	err = s.db.QueryRow(`SELECT revoked FROM oauth_access_tokens WHERE token_id = $1`, claims.ID).Scan(&revoked)
	if err == nil && revoked {
		return nil, fmt.Errorf("token has been revoked")
	}

	return claims, nil
}

// =============================
// Refresh Tokens
// =============================

// GenerateRefreshToken creates a refresh token and stores its hash
func (s *OAuthService) GenerateRefreshToken(accessTokenID, clientID, userID string, scopes []string) (string, error) {
	// Generate opaque refresh token
	b := make([]byte, 40)
	rand.Read(b)
	refreshToken := base64.RawURLEncoding.EncodeToString(b)

	// Hash the refresh token for storage
	hash := sha256.Sum256([]byte(refreshToken))
	tokenHash := hex.EncodeToString(hash[:])

	var scopesArray string
	if len(scopes) == 0 {
		scopesArray = "{}"
	} else {
		scopesArray = fmt.Sprintf("{%s}", strings.Join(scopes, ","))
	}

	_, err := s.db.Exec(`
		INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, access_token_id, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, tokenHash, clientID, userID, accessTokenID, scopesArray, time.Now().Add(30*24*time.Hour))
	if err != nil {
		return "", fmt.Errorf("failed to store refresh token: %w", err)
	}

	return refreshToken, nil
}

// RefreshAccessToken validates a refresh token and issues new tokens
func (s *OAuthService) RefreshAccessToken(refreshTokenStr, clientID string) (newAccessToken string, newRefreshToken string, idToken string, err error) {
	// Hash the incoming refresh token
	hash := sha256.Sum256([]byte(refreshTokenStr))
	tokenHash := hex.EncodeToString(hash[:])

	// Look up the refresh token
	var rt RefreshToken
	var scopesStr string
	var userID string

	err = s.db.QueryRow(`
		SELECT id, token_hash, client_id, user_id, access_token_id, scopes, expires_at, revoked
		FROM oauth_refresh_tokens
		WHERE token_hash = $1 AND client_id = $2 AND revoked = false
	`, tokenHash, clientID).Scan(
		&rt.ID, &rt.TokenHash, &rt.ClientID, &rt.UserID, &rt.AccessTokenID, &scopesStr, &rt.ExpiresAt, &rt.Revoked,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", "", "", fmt.Errorf("invalid refresh token")
		}
		return "", "", "", err
	}

	if time.Now().After(rt.ExpiresAt) {
		return "", "", "", fmt.Errorf("refresh token expired")
	}

	userID = rt.UserID

	// Revoke old refresh token
	_, err = s.db.Exec(`UPDATE oauth_refresh_tokens SET revoked = true WHERE id = $1`, rt.ID)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to revoke old refresh token")
	}

	// Parse scopes
	scopesStr = strings.Trim(scopesStr, "{}")
	var scopes []string
	if scopesStr != "" {
		scopes = strings.Split(scopesStr, ",")
	}

	// Get username for new token
	var username string
	err = s.db.QueryRow(`SELECT username FROM users WHERE id = $1`, userID).Scan(&username)
	if err != nil {
		return "", "", "", fmt.Errorf("user not found")
	}

	// Generate new access token
	at, newAccessTokenStr, err := s.GenerateAccessToken(clientID, userID, username, scopes)
	if err != nil {
		return "", "", "", err
	}

	// Generate new refresh token
	newRefreshTokenStr, err := s.GenerateRefreshToken(at.ID, clientID, userID, scopes)
	if err != nil {
		return "", "", "", err
	}

	// Generate ID token if openid scope is present
	if hasScope(scopes, ScopeOpenID) {
		idTokenStr, err := s.GenerateIDToken(clientID, userID, username, "", scopes)
		if err == nil {
			idToken = idTokenStr
		}
	}

	return newAccessTokenStr, newRefreshTokenStr, idToken, nil
}

// =============================
// Token Revocation
// =============================

// RevokeToken revokes an access or refresh token
func (s *OAuthService) RevokeToken(tokenStr, tokenTypeHint, clientID string) error {
	// Try as access token (JWT) first
	if tokenTypeHint == "" || tokenTypeHint == "access_token" {
		// Try to parse as JWT
		claims := &OAuthClaims{}
		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method")
			}
			return s.jwtSecret, nil
		})
		if err == nil && token.Valid {
			_, err = s.db.Exec(`UPDATE oauth_access_tokens SET revoked = true WHERE token_id = $1`, claims.ID)
			return err
		}
	}

	// Try as refresh token
	if tokenTypeHint == "" || tokenTypeHint == "refresh_token" {
		hash := sha256.Sum256([]byte(tokenStr))
		tokenHash := hex.EncodeToString(hash[:])
		_, err := s.db.Exec(`UPDATE oauth_refresh_tokens SET revoked = true WHERE token_hash = $1 AND client_id = $2`, tokenHash, clientID)
		if err == nil {
			return nil
		}
	}

	return nil
}

// RevokeAllUserTokens revokes all tokens for a specific user on a specific app
func (s *OAuthService) RevokeAllUserTokens(clientID, userID string) error {
	_, err := s.db.Exec(`UPDATE oauth_access_tokens SET revoked = true WHERE client_id = $1 AND user_id = $2`, clientID, userID)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`UPDATE oauth_refresh_tokens SET revoked = true WHERE client_id = $1 AND user_id = $2`, clientID, userID)
	return err
}

// =============================
// User Info
// =============================

// GetUserInfo returns user info for the /userinfo endpoint
func (s *OAuthService) GetUserInfo(userID string, scopes []string) (*UserInfoResponse, error) {
	var username, email string
	var avatarURL *string

	err := s.db.QueryRow(`SELECT username, email, avatar_url FROM users WHERE id = $1`, userID).Scan(&username, &email, &avatarURL)
	if err != nil {
		return nil, err
	}

	info := &UserInfoResponse{
		Sub: userID,
	}

	if hasScope(scopes, ScopeProfile) {
		info.PreferredUsername = username
		info.Name = username
		if avatarURL != nil && *avatarURL != "" {
			info.Picture = s.buildAvatarURL(*avatarURL)
		}
	}

	if hasScope(scopes, ScopeEmail) {
		info.Email = email
		info.EmailVerified = true
	}

	return info, nil
}

// =============================
// OpenID Connect Discovery
// =============================

// GetOpenIDConfiguration returns the OpenID Connect discovery document
func (s *OAuthService) GetOpenIDConfiguration() *OpenIDConfiguration {
	return &OpenIDConfiguration{
		Issuer:                 s.issuer,
		AuthorizationEndpoint:  s.issuer + "/oauth/authorize",
		TokenEndpoint:          s.issuer + "/oauth/token",
		UserinfoEndpoint:       s.issuer + "/oauth/userinfo",
		RevocationEndpoint:     s.issuer + "/oauth/revoke",
		JWKSURI:                s.issuer + "/.well-known/jwks.json",
		ScopesSupported:        AllSupportedScopes,
		ResponseTypesSupported: []string{ResponseTypeCode},
		GrantTypesSupported: []string{
			GrantTypeAuthorizationCode,
			GrantTypeRefreshToken,
		},
		TokenEndpointAuthMethodsSupported: []string{
			"client_secret_basic",
			"client_secret_post",
		},
		ClaimsSupported: []string{
			"sub", "name", "preferred_username", "email", "email_verified", "picture",
		},
		SubjectTypesSupported:            []string{"public"},
		IDTokenSigningAlgValuesSupported: []string{"HS256"},
		CodeChallengeMethodsSupported: []string{
			CodeChallengeMethodS256,
			CodeChallengeMethodPlain,
		},
	}
}

// GetJWKS returns the JWK Set for ID token verification
// For HMAC-signed tokens, returns a minimal representation
func (s *OAuthService) GetJWKS() map[string]interface{} {
	// For HMAC, we return an empty keys array since the secret can't be exposed
	// In production with RS256, you'd return the public key
	return map[string]interface{}{
		"keys": []interface{}{},
	}
}

// =============================
// Developer Panel Helpers
// =============================

// GetApplicationsByOwner returns all apps owned by a user
func (s *OAuthService) GetApplicationsByOwner(ownerID string) ([]OAuthApplication, error) {
	rows, err := s.db.Query(`
		SELECT id, owner_id, name, description, client_id, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at
		FROM oauth_applications
		WHERE owner_id = $1
		ORDER BY created_at DESC
	`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var apps []OAuthApplication
	for rows.Next() {
		var app OAuthApplication
		var redirectURIsJSON string
		var scopesArray []byte

		err := rows.Scan(
			&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.ClientID,
			&redirectURIsJSON, &scopesArray, &app.IsConfidential,
			&app.LogoURL, &app.HomepageURL, &app.IsActive, &app.CreatedAt, &app.UpdatedAt,
		)
		if err != nil {
			return nil, err
		}

		json.Unmarshal([]byte(redirectURIsJSON), &app.RedirectURIs)
		scopeStr := strings.Trim(string(scopesArray), "{}")
		if scopeStr != "" {
			app.AllowedScopes = strings.Split(scopeStr, ",")
		}

		apps = append(apps, app)
	}

	return apps, nil
}

// GetApplicationByID returns an app by its UUID (for owner access)
func (s *OAuthService) GetApplicationByID(id string) (*OAuthApplication, error) {
	var app OAuthApplication
	var redirectURIsJSON string
	var scopesArray []byte

	err := s.db.QueryRow(`
		SELECT id, owner_id, name, description, client_id, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at
		FROM oauth_applications
		WHERE id = $1
	`, id).Scan(
		&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.ClientID,
		&redirectURIsJSON, &scopesArray, &app.IsConfidential,
		&app.LogoURL, &app.HomepageURL, &app.IsActive, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	json.Unmarshal([]byte(redirectURIsJSON), &app.RedirectURIs)
	scopeStr := strings.Trim(string(scopesArray), "{}")
	if scopeStr != "" {
		app.AllowedScopes = strings.Split(scopeStr, ",")
	}

	return &app, nil
}

// UpdateApplication updates an OAuth application
func (s *OAuthService) UpdateApplication(id, ownerID string, req *UpdateAppRequest) (*OAuthApplication, error) {
	// Build update query dynamically
	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	if req.Name != nil {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, *req.Name)
		argIdx++
	}
	if req.Description != nil {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, *req.Description)
		argIdx++
	}
	if req.RedirectURIs != nil {
		urisJSON, _ := json.Marshal(*req.RedirectURIs)
		setClauses = append(setClauses, fmt.Sprintf("redirect_uris = $%d", argIdx))
		args = append(args, string(urisJSON))
		argIdx++
	}
	if req.AllowedScopes != nil {
		scopesArray := fmt.Sprintf("{%s}", strings.Join(*req.AllowedScopes, ","))
		setClauses = append(setClauses, fmt.Sprintf("allowed_scopes = $%d", argIdx))
		args = append(args, scopesArray)
		argIdx++
	}
	if req.LogoURL != nil {
		setClauses = append(setClauses, fmt.Sprintf("logo_url = $%d", argIdx))
		args = append(args, *req.LogoURL)
		argIdx++
	}
	if req.HomepageURL != nil {
		setClauses = append(setClauses, fmt.Sprintf("homepage_url = $%d", argIdx))
		args = append(args, *req.HomepageURL)
		argIdx++
	}
	if req.IsActive != nil {
		setClauses = append(setClauses, fmt.Sprintf("is_active = $%d", argIdx))
		args = append(args, *req.IsActive)
		argIdx++
	}

	if len(setClauses) == 0 {
		return s.GetApplicationByID(id)
	}

	setClauses = append(setClauses, "updated_at = NOW()")
	query := fmt.Sprintf(
		"UPDATE oauth_applications SET %s WHERE id = $%d AND owner_id = $%d RETURNING id, owner_id, name, description, client_id, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at",
		strings.Join(setClauses, ", "),
		argIdx, argIdx+1,
	)
	args = append(args, id, ownerID)

	var app OAuthApplication
	var redirectURIsJSON string
	var scopesArray []byte

	err := s.db.QueryRow(query, args...).Scan(
		&app.ID, &app.OwnerID, &app.Name, &app.Description, &app.ClientID,
		&redirectURIsJSON, &scopesArray, &app.IsConfidential,
		&app.LogoURL, &app.HomepageURL, &app.IsActive, &app.CreatedAt, &app.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	json.Unmarshal([]byte(redirectURIsJSON), &app.RedirectURIs)
	scopeStr := strings.Trim(string(scopesArray), "{}")
	if scopeStr != "" {
		app.AllowedScopes = strings.Split(scopeStr, ",")
	}

	return &app, nil
}

// RegenerateClientSecret generates a new client secret for an app
func (s *OAuthService) RegenerateClientSecret(appID, ownerID string) (string, error) {
	newSecret := s.GenerateClientSecret()
	hash, err := s.HashClientSecret(newSecret)
	if err != nil {
		return "", err
	}

	result, err := s.db.Exec(`UPDATE oauth_applications SET client_secret_hash = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3`,
		hash, appID, ownerID)
	if err != nil {
		return "", err
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		return "", fmt.Errorf("application not found")
	}

	return newSecret, nil
}

// DeleteApplication deletes an application and all associated tokens
func (s *OAuthService) DeleteApplication(appID, ownerID string) error {
	// Get client_id first
	var clientID string
	err := s.db.QueryRow(`SELECT client_id FROM oauth_applications WHERE id = $1 AND owner_id = $2`, appID, ownerID).Scan(&clientID)
	if err != nil {
		return err
	}

	// Delete associated tokens
	s.db.Exec(`DELETE FROM oauth_refresh_tokens WHERE client_id = $1`, clientID)
	s.db.Exec(`DELETE FROM oauth_access_tokens WHERE client_id = $1`, clientID)
	s.db.Exec(`DELETE FROM oauth_authorization_codes WHERE client_id = $1`, clientID)
	s.db.Exec(`DELETE FROM oauth_applications WHERE id = $1`, appID)

	return nil
}

// GetTokensByApp returns active tokens for a given app (for owner to view)
func (s *OAuthService) GetTokensByApp(appID, ownerID string) ([]AccessToken, error) {
	var clientID string
	err := s.db.QueryRow(`SELECT client_id FROM oauth_applications WHERE id = $1 AND owner_id = $2`, appID, ownerID).Scan(&clientID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.Query(`
		SELECT id, token_id, client_id, user_id, scopes, expires_at, revoked, created_at
		FROM oauth_access_tokens
		WHERE client_id = $1 AND revoked = false AND expires_at > NOW()
		ORDER BY created_at DESC
	`, clientID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tokens []AccessToken
	for rows.Next() {
		var t AccessToken
		var scopesArray []byte
		err := rows.Scan(&t.ID, &t.TokenID, &t.ClientID, &t.UserID, &scopesArray, &t.ExpiresAt, &t.Revoked, &t.CreatedAt)
		if err != nil {
			return nil, err
		}
		scopeStr := strings.Trim(string(scopesArray), "{}")
		if scopeStr != "" {
			t.Scopes = strings.Split(scopeStr, ",")
		}
		tokens = append(tokens, t)
	}

	return tokens, nil
}

// =============================
// Helpers
// =============================

// isValidScope checks if a scope is supported
func isValidScope(scope string) bool {
	for _, s := range AllSupportedScopes {
		if s == scope {
			return true
		}
	}
	return false
}

// hasScope checks if a list of scopes contains a specific scope
func hasScope(scopes []string, target string) bool {
	for _, s := range scopes {
		if s == target {
			return true
		}
	}
	return false
}

// verifyPKCE validates a PKCE code challenge/verifier pair
func verifyPKCE(codeChallenge, method, codeVerifier string) error {
	switch method {
	case CodeChallengeMethodS256:
		h := sha256.Sum256([]byte(codeVerifier))
		expected := base64.RawURLEncoding.EncodeToString(h[:])
		if !hmac.Equal([]byte(expected), []byte(codeChallenge)) {
			return fmt.Errorf("PKCE verification failed")
		}
	case CodeChallengeMethodPlain:
		if codeVerifier != codeChallenge {
			return fmt.Errorf("PKCE verification failed")
		}
	default:
		return fmt.Errorf("unsupported code challenge method: %s", method)
	}
	return nil
}

// GenerateRS256KeyPair generates an RSA key pair for ID token signing (for production use)
func GenerateRS256KeyPair() (*rsa.PrivateKey, error) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, err
	}
	return privateKey, nil
}

// EncodeRS256PrivateKeyToPEM encodes an RSA private key to PEM format
func EncodeRS256PrivateKeyToPEM(key *rsa.PrivateKey) string {
	pemData := pem.EncodeToMemory(
		&pem.Block{
			Type:  "RSA PRIVATE KEY",
			Bytes: x509.MarshalPKCS1PrivateKey(key),
		},
	)
	return string(pemData)
}

// GenerateAccessToken generate a short-lived JWT for internal auth
func (s *OAuthService) GenerateAuthToken(userID, username, domain string) (string, error) {
	return s.authSvc.GenerateToken(userID, username, domain)
}

// buildAvatarURL converts a relative or Garage-direct avatar path to an absolute URL
// through the application's storage proxy endpoint (which fetches from Garage server-side).
// Direct Garage S3 endpoints don't allow anonymous access, so we must go through
// the app proxy at /storage/v1/object/post-images/<key>.
//
// The avatar_url in the DB can be either:
//   - A relative key:         "<uuid>/avatar_<ts>.jpg"
//   - A Garage direct URL:    "http://localhost:3900/<uuid>/avatar_<ts>.jpg"
//   - An external URL:        "https://gravatar.com/..."
//
// For relative keys and Garage URLs, we rewrite through our storage proxy with
// the correct bucket (post-images). External URLs are returned as-is.
func (s *OAuthService) buildAvatarURL(avatarPath string) string {
	if avatarPath == "" {
		return ""
	}

	// For absolute URLs, check if they point to our Garage S3
	if strings.HasPrefix(avatarPath, "http://") || strings.HasPrefix(avatarPath, "https://") {
		garageEndpoint := os.Getenv("GARAGE_S3_PUBLIC_ENDPOINT")
		if garageEndpoint != "" && strings.HasPrefix(avatarPath, garageEndpoint) {
			// Garage S3 URL — extract the object key (everything after the endpoint)
			// and proxy through our app with the post-images bucket.
			// URL formats handled:
			//   http://localhost:3900/<uuid>/avatar_<ts>.jpg         → key: <uuid>/avatar_<ts>.jpg
			//   http://localhost:3900/post-images/<uuid>/avatar_<ts>.jpg → key: <uuid>/avatar_<ts>.jpg
			key := strings.TrimPrefix(avatarPath, garageEndpoint)
			key = strings.TrimPrefix(key, "/")
			// If the Garage URL includes a bucket prefix, strip it
			if parts := strings.SplitN(key, "/", 2); len(parts) == 2 {
				// parts[0] is the bucket name (e.g. "post-images" or a UUID)
				// parts[1] is the object key (could be "<uuid>/avatar_<ts>.jpg" or just "avatar_<ts>.jpg")
				// Use the second part as the key — it already includes any UUID prefix
				key = parts[1]
			}
			return s.issuer + "/storage/v1/object/post-images/" + key
		}
		return avatarPath // external URL (not our Garage), return as-is
	}

	// Relative path — construct proxy URL with the correct bucket (post-images, not avatars)
	return s.issuer + "/storage/v1/object/post-images/" + avatarPath
}

// ParseScopeString parses a space-separated scope string into a slice
func ParseScopeString(scope string) []string {
	if scope == "" {
		return nil
	}
	return strings.Fields(scope)
}

// JoinScopes joins scopes into a space-separated string
func JoinScopes(scopes []string) string {
	if len(scopes) == 0 {
		return ""
	}
	// Filter out empty strings
	var valid []string
	for _, s := range scopes {
		if s != "" {
			valid = append(valid, s)
		}
	}
	return strings.Join(valid, " ")
}
