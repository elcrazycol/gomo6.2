package oauth

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ─── Token Introspection (RFC 7662) ─────────────────────────────────────────

// IntrospectToken checks the status of a token (access or refresh)
// Returns an IntrospectResponse with active=true and token metadata if valid.
func (s *OAuthService) IntrospectToken(tokenStr, tokenTypeHint string) *IntrospectResponse {
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
			// Check revocation
			var revoked bool
			s.db.QueryRow(`SELECT revoked FROM oauth_access_tokens WHERE token_id = $1`, claims.ID).Scan(&revoked)
			if revoked {
				return &IntrospectResponse{Active: false}
			}

			return &IntrospectResponse{
				Active:    true,
				Scope:     strings.Join(claims.Scopes, " "),
				ClientID:  claims.ClientID,
				UserID:    claims.UserID,
				TokenID:   claims.ID,
				TokenType: "access_token",
				Exp:       claims.ExpiresAt.Unix(),
				Iat:       claims.IssuedAt.Unix(),
				Sub:       claims.UserID,
				Username:  claims.Username,
				Aud:       claims.Audience,
				Iss:       claims.Issuer,
			}
		}
	}

	// Try as refresh token
	if tokenTypeHint == "" || tokenTypeHint == "refresh_token" {
		hash := sha256_hex(tokenStr)

		var rt RefreshToken
		var scopesStr string
		err := s.db.QueryRow(`
			SELECT id, client_id, user_id, scopes, expires_at, revoked, created_at
			FROM oauth_refresh_tokens
			WHERE token_hash = $1
		`, hash).Scan(
			&rt.ID, &rt.ClientID, &rt.UserID, &scopesStr, &rt.ExpiresAt, &rt.Revoked, &rt.CreatedAt,
		)
		if err == nil {
			if rt.Revoked || time.Now().After(rt.ExpiresAt) {
				return &IntrospectResponse{Active: false}
			}

			// Parse scopes from PostgreSQL array format
			scopeStr := strings.Trim(scopesStr, "{}")
			var scopes []string
			if scopeStr != "" {
				scopes = strings.Split(scopeStr, ",")
			}

			return &IntrospectResponse{
				Active:    true,
				Scope:     strings.Join(scopes, " "),
				ClientID:  rt.ClientID,
				UserID:    rt.UserID,
				TokenType: "refresh_token",
				Exp:       rt.ExpiresAt.Unix(),
				Iat:       rt.CreatedAt.Unix(),
				Sub:       rt.UserID,
			}
		}
	}

	return &IntrospectResponse{Active: false}
}

// ─── Token Revocation ───────────────────────────────────────────────────────

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
		hash := sha256_hex(tokenStr)
		_, err := s.db.Exec(`UPDATE oauth_refresh_tokens SET revoked = true WHERE token_hash = $1 AND client_id = $2`, hash, clientID)
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

// ─── OpenID Connect Discovery ───────────────────────────────────────────────

// GetOpenIDConfiguration returns the OpenID Connect discovery document
func (s *OAuthService) GetOpenIDConfiguration() *OpenIDConfiguration {
	return &OpenIDConfiguration{
		Issuer:                 s.issuer,
		AuthorizationEndpoint:  s.issuer + "/oauth/authorize",
		TokenEndpoint:          s.issuer + "/oauth/token",
		UserinfoEndpoint:       s.issuer + "/oauth/userinfo",
		RevocationEndpoint:     s.issuer + "/oauth/revoke",
		IntrospectionEndpoint:  s.issuer + "/oauth/introspect",
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
		IDTokenSigningAlgValuesSupported: []string{"RS256", "HS256"},
		CodeChallengeMethodsSupported: []string{
			CodeChallengeMethodS256,
		},
	}
}

// GetJWKS returns the JWK Set for ID token verification
// With RS256, clients can verify ID tokens using the public key
func (s *OAuthService) GetJWKS() map[string]interface{} {
	if s.rsaPrivateKey == nil {
		return map[string]interface{}{
			"keys": []interface{}{},
		}
	}

	pubKey := &s.rsaPrivateKey.PublicKey
	n := base64url_encode(pubKey.N.Bytes())
	e := base64url_encode(bigEndianBytes(pubKey.E))

	return map[string]interface{}{
		"keys": []interface{}{
			map[string]interface{}{
				"kty": "RSA",
				"kid": "rsa-key-1",
				"use": "sig",
				"alg": "RS256",
				"n":   n,
				"e":   e,
			},
		},
	}
}

// ─── Audit Log ──────────────────────────────────────────────────────────────

// LogOAuthAction records an OAuth operation in the audit log
func (s *OAuthService) LogOAuthAction(userID, clientID, appName, action, ipAddress string, details map[string]interface{}) error {
	var detailsJSON []byte
	if details != nil {
		var err error
		detailsJSON, err = json.Marshal(details)
		if err != nil {
			detailsJSON = []byte("{}")
		}
	} else {
		detailsJSON = []byte("{}")
	}

	_, err := s.db.Exec(`
		INSERT INTO oauth_audit_log (user_id, client_id, app_name, action, details, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, nullableString(userID), nullableString(clientID), appName, action, string(detailsJSON), ipAddress)
	if err != nil {
		log.Printf("Failed to write OAuth audit log: %v", err)
		return err
	}
	return nil
}
