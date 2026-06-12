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
	"encoding/pem"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
	"github.com/gomo6/backend/internal/auth"
)

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

// ─── Service ────────────────────────────────────────────────────────────────

// OAuthService handles all OAuth 2.0 + OpenID Connect operations
type OAuthService struct {
	db            *sql.DB
	authSvc       *auth.AuthService
	issuer        string
	jwtSecret     []byte
	rsaPrivateKey *rsa.PrivateKey
}

// NewOAuthService creates a new OAuthService
func NewOAuthService(db *sql.DB, authSvc *auth.AuthService) *OAuthService {
	issuer := os.Getenv("ISSUER_URL")
	if issuer == "" {
		domain := os.Getenv("DOMAIN")
		if domain == "" {
			domain = "localhost:8080"
		}
		issuer = "http://" + domain
	}

	secret := auth.GetJWTSecret()

	// Generate RSA key pair for RS256-signed ID tokens
	rsaPrivateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		log.Printf("Warning: failed to generate RSA key for ID tokens: %v. Falling back to HS256.", err)
	}

	return &OAuthService{
		db:            db,
		authSvc:       authSvc,
		issuer:        issuer,
		jwtSecret:     []byte(secret),
		rsaPrivateKey: rsaPrivateKey,
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// sha256_hex returns the SHA-256 hex digest of a string.
func sha256_hex(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:])
}

// base64url_encode base64url-encodes bytes (no padding).
func base64url_encode(b []byte) string {
	return base64.RawURLEncoding.EncodeToString(b)
}

// isValidScope checks if a scope is supported
func isValidScope(scope string) bool {
	for _, s := range AllSupportedScopes {
		if s == scope {
			return true
		}
	}
	return false
}

// HasScope checks if a list of scopes contains a specific scope
func HasScope(scopes []string, target string) bool {
	for _, s := range scopes {
		if s == target {
			return true
		}
	}
	return false
}

// hasScope is an alias for internal use
func hasScope(scopes []string, target string) bool {
	return HasScope(scopes, target)
}

// verifyPKCE validates a PKCE S256 code challenge/verifier pair
func verifyPKCE(codeChallenge, method, codeVerifier string) error {
	h := sha256.Sum256([]byte(codeVerifier))
	expected := base64.RawURLEncoding.EncodeToString(h[:])
	if !hmac.Equal([]byte(expected), []byte(codeChallenge)) {
		return fmt.Errorf("PKCE verification failed")
	}
	return nil
}

// bigEndianBytes converts an int to big-endian bytes for JWK exponent encoding
func bigEndianBytes(v int) []byte {
	if v == 0 {
		return []byte{0}
	}
	b := make([]byte, 4)
	for i := 3; i >= 0; i-- {
		b[i] = byte(v & 0xff)
		v >>= 8
	}
	i := 0
	for i < len(b) && b[i] == 0 {
		i++
	}
	return b[i:]
}

// nullableString returns a *string for SQL NULL handling.
func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
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

// GenerateAuthToken generate a short-lived JWT for internal auth
func (s *OAuthService) GenerateAuthToken(userID, username, domain string) (string, error) {
	return s.authSvc.GenerateToken(userID, username, domain)
}

// buildAvatarURL converts a relative or Garage-direct avatar path to an absolute URL
func (s *OAuthService) buildAvatarURL(avatarPath string) string {
	if avatarPath == "" {
		return ""
	}

	if strings.HasPrefix(avatarPath, "http://") || strings.HasPrefix(avatarPath, "https://") {
		garageEndpoint := os.Getenv("GARAGE_S3_PUBLIC_ENDPOINT")
		if garageEndpoint != "" && strings.HasPrefix(avatarPath, garageEndpoint) {
			key := strings.TrimPrefix(avatarPath, garageEndpoint)
			key = strings.TrimPrefix(key, "/")
			if parts := strings.SplitN(key, "/", 2); len(parts) == 2 {
				key = parts[1]
			}
			return s.issuer + "/storage/v1/object/post-images/" + key
		}
		return avatarPath
	}

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
	var valid []string
	for _, s := range scopes {
		if s != "" {
			valid = append(valid, s)
		}
	}
	return strings.Join(valid, " ")
}
