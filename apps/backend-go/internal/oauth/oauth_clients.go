package oauth

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// ─── Client Registration ────────────────────────────────────────────────────

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

// ─── Developer Panel ────────────────────────────────────────────────────────

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
		SELECT id, owner_id, name, description, client_id, client_secret_hash, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at
		FROM oauth_applications
		WHERE id = $1
	`, id).Scan(
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
