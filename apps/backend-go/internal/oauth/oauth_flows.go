package oauth

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

// ─── Authorization Code ─────────────────────────────────────────────────────

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
		if err == sql.ErrNoRows {
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

	// Verify PKCE code challenge (S256 only, mandatory)
	if authCode.CodeChallenge == "" {
		return "", nil, "", fmt.Errorf("PKCE code_challenge is required")
	}
	if authCode.CodeChallengeMethod != CodeChallengeMethodS256 {
		return "", nil, "", fmt.Errorf("only S256 code_challenge_method is supported")
	}
	if codeVerifier == "" {
		return "", nil, "", fmt.Errorf("code_verifier required")
	}
	if err := verifyPKCE(authCode.CodeChallenge, authCode.CodeChallengeMethod, codeVerifier); err != nil {
		return "", nil, "", err
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

// ─── Token Generation ───────────────────────────────────────────────────────

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

	// Sign with RS256 so third parties can verify the ID token using our JWKS endpoint
	// Falls back to HS256 if RSA key generation failed at startup
	if s.rsaPrivateKey != nil {
		token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
		token.Header["kid"] = "rsa-key-1"
		return token.SignedString(s.rsaPrivateKey)
	}
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

// ─── Refresh Tokens ─────────────────────────────────────────────────────────

// GenerateRefreshToken creates a refresh token and stores its hash
func (s *OAuthService) GenerateRefreshToken(accessTokenID, clientID, userID string, scopes []string) (string, error) {
	// Generate opaque refresh token
	b := make([]byte, 40)
	rand.Read(b)
	refreshToken := base64.RawURLEncoding.EncodeToString(b)

	// Hash the refresh token for storage
	hash := sha256_hex(refreshToken)

	var scopesArray string
	if len(scopes) == 0 {
		scopesArray = "{}"
	} else {
		scopesArray = fmt.Sprintf("{%s}", strings.Join(scopes, ","))
	}

	_, err := s.db.Exec(`
		INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, access_token_id, scopes, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, hash, clientID, userID, accessTokenID, scopesArray, time.Now().Add(30*24*time.Hour))
	if err != nil {
		return "", fmt.Errorf("failed to store refresh token: %w", err)
	}

	return refreshToken, nil
}

// RefreshAccessToken validates a refresh token and issues new tokens
func (s *OAuthService) RefreshAccessToken(refreshTokenStr, clientID string) (newAccessToken string, newRefreshToken string, idToken string, err error) {
	// Hash the incoming refresh token
	hash := sha256_hex(refreshTokenStr)

	// Look up the refresh token
	var rt RefreshToken
	var scopesStr string
	var userID string

	err = s.db.QueryRow(`
		SELECT id, token_hash, client_id, user_id, access_token_id, scopes, expires_at, revoked
		FROM oauth_refresh_tokens
		WHERE token_hash = $1 AND client_id = $2 AND revoked = false
	`, hash, clientID).Scan(
		&rt.ID, &rt.TokenHash, &rt.ClientID, &rt.UserID, &rt.AccessTokenID, &scopesStr, &rt.ExpiresAt, &rt.Revoked,
	)
	if err != nil {
		if err == sql.ErrNoRows {
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

	// Generate new refresh token only if offline_access was in original scopes
	var newRefreshTokenStr string
	if HasScope(scopes, ScopeOfflineAccess) {
		newRefreshTokenStr, err = s.GenerateRefreshToken(at.ID, clientID, userID, scopes)
		if err != nil {
			return "", "", "", err
		}
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

// ─── User Info ──────────────────────────────────────────────────────────────

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
