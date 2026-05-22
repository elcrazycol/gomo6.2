package oauth

import (
	"encoding/json"
	"time"
)

// OAuthApplication represents a registered third-party app
type OAuthApplication struct {
	ID               string    `json:"id" db:"id"`
	OwnerID          string    `json:"owner_id" db:"owner_id"`
	Name             string    `json:"name" db:"name"`
	Description      string    `json:"description" db:"description"`
	ClientID         string    `json:"client_id" db:"client_id"`
	ClientSecretHash string    `json:"-" db:"client_secret_hash"`
	RedirectURIs     []string  `json:"redirect_uris" db:"redirect_uris"`
	AllowedScopes    []string  `json:"allowed_scopes" db:"allowed_scopes"`
	IsConfidential   bool      `json:"is_confidential" db:"is_confidential"`
	LogoURL          string    `json:"logo_url" db:"logo_url"`
	HomepageURL      string    `json:"homepage_url" db:"homepage_url"`
	IsActive         bool      `json:"is_active" db:"is_active"`
	CreatedAt        time.Time `json:"created_at" db:"created_at"`
	UpdatedAt        time.Time `json:"updated_at" db:"updated_at"`
}

// AuthorizationCode is a short-lived, single-use code
type AuthorizationCode struct {
	ID                  string    `json:"id" db:"id"`
	Code                string    `json:"code" db:"code"`
	ClientID            string    `json:"client_id" db:"client_id"`
	UserID              string    `json:"user_id" db:"user_id"`
	RedirectURI         string    `json:"redirect_uri" db:"redirect_uri"`
	CodeChallenge       string    `json:"code_challenge" db:"code_challenge"`
	CodeChallengeMethod string    `json:"code_challenge_method" db:"code_challenge_method"`
	Scopes              []string  `json:"scopes" db:"scopes"`
	Nonce               string    `json:"nonce" db:"nonce"`
	ExpiresAt           time.Time `json:"expires_at" db:"expires_at"`
	Used                bool      `json:"used" db:"used"`
	CreatedAt           time.Time `json:"created_at" db:"created_at"`
}

// AccessToken represents a JWT access token tracked for revocation
type AccessToken struct {
	ID        string    `json:"id" db:"id"`
	TokenID   string    `json:"token_id" db:"token_id"`
	ClientID  string    `json:"client_id" db:"client_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Scopes    []string  `json:"scopes" db:"scopes"`
	ExpiresAt time.Time `json:"expires_at" db:"expires_at"`
	Revoked   bool      `json:"revoked" db:"revoked"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

// RefreshToken is an opaque token stored as a hash
type RefreshToken struct {
	ID            string    `json:"id" db:"id"`
	TokenHash     string    `json:"-" db:"token_hash"`
	ClientID      string    `json:"client_id" db:"client_id"`
	UserID        string    `json:"user_id" db:"user_id"`
	AccessTokenID *string   `json:"access_token_id" db:"access_token_id"`
	Scopes        []string  `json:"scopes" db:"scopes"`
	ExpiresAt     time.Time `json:"expires_at" db:"expires_at"`
	Revoked       bool      `json:"revoked" db:"revoked"`
	CreatedAt     time.Time `json:"created_at" db:"created_at"`
}

// AuthorizeRequest represents the OAuth authorize request
type AuthorizeRequest struct {
	ResponseType        string `json:"response_type" form:"response_type"`
	ClientID            string `json:"client_id" form:"client_id"`
	RedirectURI         string `json:"redirect_uri" form:"redirect_uri"`
	Scope               string `json:"scope" form:"scope"`
	State               string `json:"state" form:"state"`
	CodeChallenge       string `json:"code_challenge" form:"code_challenge"`
	CodeChallengeMethod string `json:"code_challenge_method" form:"code_challenge_method"`
	Nonce               string `json:"nonce" form:"nonce"`
}

// TokenRequest represents the OAuth token endpoint request
type TokenRequest struct {
	GrantType    string `json:"grant_type" form:"grant_type"`
	Code         string `json:"code" form:"code"`
	RedirectURI  string `json:"redirect_uri" form:"redirect_uri"`
	ClientID     string `json:"client_id" form:"client_id"`
	ClientSecret string `json:"client_secret" form:"client_secret"`
	CodeVerifier string `json:"code_verifier" form:"code_verifier"`
	RefreshToken string `json:"refresh_token" form:"refresh_token"`
	Scope        string `json:"scope" form:"scope"`
}

// TokenResponse represents the OAuth token endpoint response
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	IDToken      string `json:"id_token,omitempty"`
	RefreshToken string `json:"refresh_token,omitempty"`
	Scope        string `json:"scope,omitempty"`
}

// UserInfoResponse for OpenID Connect /userinfo endpoint
type UserInfoResponse struct {
	Sub               string `json:"sub"`
	Name              string `json:"name,omitempty"`
	PreferredUsername string `json:"preferred_username,omitempty"`
	Email             string `json:"email,omitempty"`
	EmailVerified     bool   `json:"email_verified,omitempty"`
	Picture           string `json:"picture,omitempty"`
}

// OpenIDConfiguration for the .well-known discovery endpoint
type OpenIDConfiguration struct {
	Issuer                            string   `json:"issuer"`
	AuthorizationEndpoint             string   `json:"authorization_endpoint"`
	TokenEndpoint                     string   `json:"token_endpoint"`
	UserinfoEndpoint                  string   `json:"userinfo_endpoint"`
	RevocationEndpoint                string   `json:"revocation_endpoint"`
	JWKSURI                           string   `json:"jwks_uri"`
	ScopesSupported                   []string `json:"scopes_supported"`
	ResponseTypesSupported            []string `json:"response_types_supported"`
	GrantTypesSupported               []string `json:"grant_types_supported"`
	TokenEndpointAuthMethodsSupported []string `json:"token_endpoint_auth_methods_supported"`
	ClaimsSupported                   []string `json:"claims_supported"`
	SubjectTypesSupported             []string `json:"subject_types_supported"`
	IDTokenSigningAlgValuesSupported  []string `json:"id_token_signing_alg_values_supported"`
	CodeChallengeMethodsSupported     []string `json:"code_challenge_methods_supported"`
}

// RevokeRequest for token revocation
type RevokeRequest struct {
	Token         string `json:"token" form:"token"`
	TokenTypeHint string `json:"token_type_hint" form:"token_type_hint"`
	ClientID      string `json:"client_id" form:"client_id"`
	ClientSecret  string `json:"client_secret" form:"client_secret"`
}

// CreateAppRequest for developer API
type CreateAppRequest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	RedirectURIs   []string `json:"redirect_uris"`
	AllowedScopes  []string `json:"allowed_scopes"`
	IsConfidential *bool    `json:"is_confidential"`
	LogoURL        string   `json:"logo_url"`
	HomepageURL    string   `json:"homepage_url"`
}

// UpdateAppRequest for developer API
type UpdateAppRequest struct {
	Name          *string   `json:"name"`
	Description   *string   `json:"description"`
	RedirectURIs  *[]string `json:"redirect_uris"`
	AllowedScopes *[]string `json:"allowed_scopes"`
	LogoURL       *string   `json:"logo_url"`
	HomepageURL   *string   `json:"homepage_url"`
	IsActive      *bool     `json:"is_active"`
}

// CreateAppResponse includes the client_secret (shown once)
type CreateAppResponse struct {
	App          OAuthApplication `json:"app"`
	ClientSecret string           `json:"client_secret"`
}

// AuditLogEntry represents a single OAuth audit log entry
type AuditLogEntry struct {
	ID        string          `json:"id"`
	UserID    *string         `json:"user_id,omitempty"`
	ClientID  *string         `json:"client_id,omitempty"`
	AppName   string          `json:"app_name,omitempty"`
	Action    string          `json:"action"`
	Details   json.RawMessage `json:"details,omitempty"`
	IPAddress string          `json:"ip_address,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

// Audit action constants
const (
	AuditActionAuthorize         = "authorize"
	AuditActionTokenExchange     = "token_exchange"
	AuditActionTokenRefresh      = "token_refresh"
	AuditActionTokenRevoke       = "token_revoke"
	AuditActionAppCreated        = "app_created"
	AuditActionAppUpdated        = "app_updated"
	AuditActionAppDeleted        = "app_deleted"
	AuditActionSecretRegenerated = "secret_regenerated"
	AuditActionUserTokensRevoked = "user_tokens_revoked"
)

// OAuthError represents an OAuth error response
type OAuthError struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description,omitempty"`
	State            string `json:"state,omitempty"`
}

// Standard OAuth scopes
const (
	ScopeOpenID         = "openid"
	ScopeProfile        = "profile"
	ScopeEmail          = "email"
	ScopeOfflineAccess  = "offline_access"
)

// AllSupportedScopes lists all scopes supported by this server
var AllSupportedScopes = []string{ScopeOpenID, ScopeProfile, ScopeEmail, ScopeOfflineAccess}

// Grant types
const (
	GrantTypeAuthorizationCode = "authorization_code"
	GrantTypeRefreshToken      = "refresh_token"
)

// Response types
const (
	ResponseTypeCode = "code"
)

// Code challenge methods
const (
	CodeChallengeMethodS256  = "S256"
	CodeChallengeMethodPlain = "plain"
)

// OAuth error codes
const (
	ErrorInvalidRequest          = "invalid_request"
	ErrorUnauthorizedClient      = "unauthorized_client"
	ErrorAccessDenied            = "access_denied"
	ErrorUnsupportedResponseType = "unsupported_response_type"
	ErrorInvalidScope            = "invalid_scope"
	ErrorServerError             = "server_error"
	ErrorTemporarilyUnavailable  = "temporarily_unavailable"
	ErrorInvalidGrant            = "invalid_grant"
	ErrorInvalidClient           = "invalid_client"
	ErrorUnsupportedGrantType    = "unsupported_grant_type"
)
