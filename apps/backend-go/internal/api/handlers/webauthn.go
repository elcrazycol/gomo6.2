package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

// WebAuthn session TTL (registration and login must complete within this window).
const webauthnSessionTTL = 5 * time.Minute

// WebAuthnHandler handles Passkey registration and login.
// Session storage is backed by Redis for horizontal scaling and crash safety.
type WebAuthnHandler struct {
	db          *sql.DB
	redis       *redis.Client
	wa          *webauthn.WebAuthn
	authService *auth.AuthService
}

// NewWebAuthnHandler creates a WebAuthn handler. Returns nil if RP config is invalid.
// redisClient may be nil for single-instance deployments (sessions will be unavailable).
func NewWebAuthnHandler(db *sql.DB, redisClient *redis.Client, authService *auth.AuthService) *WebAuthnHandler {
	rpID := os.Getenv("WEBAUTHN_RP_ID")
	if rpID == "" {
		rpID = "localhost"
	}
	rpOrigin := os.Getenv("WEBAUTHN_RP_ORIGIN")
	if rpOrigin == "" {
		rpOrigin = "http://localhost:8080"
	}
	rpName := os.Getenv("WEBAUTHN_RP_NAME")
	if rpName == "" {
		rpName = "gomo6"
	}

	wconfig := &webauthn.Config{
		RPDisplayName: rpName,
		RPID:          rpID,
		RPOrigins:     []string{rpOrigin},
	}

	wa, err := webauthn.New(wconfig)
	if err != nil {
		log.Printf("WebAuthn init failed: %v", err)
		return nil
	}

	return &WebAuthnHandler{
		db:          db,
		redis:       redisClient,
		wa:          wa,
		authService: authService,
	}
}

// ─── User wrapper for webauthn.User interface ────────────────────────────────

type webAuthnUser struct {
	userID      string
	username    string
	displayName string
	credentials []webauthn.Credential
}

func (u *webAuthnUser) WebAuthnID() []byte {
	id, err := uuid.Parse(u.userID)
	if err != nil {
		// Fallback: pad non-UUID user IDs to 16 bytes.
		raw := []byte(u.userID)
		buf := make([]byte, 16)
		copy(buf, raw)
		return buf
	}
	return id[:]
}

func (u *webAuthnUser) WebAuthnName() string                       { return u.username }
func (u *webAuthnUser) WebAuthnDisplayName() string                { return u.displayName }
func (u *webAuthnUser) WebAuthnCredentials() []webauthn.Credential { return u.credentials }
func (u *webAuthnUser) WebAuthnIcon() string                       { return "" }

// loadCredentials loads stored credentials for a user from the database.
func (h *WebAuthnHandler) loadCredentials(userID string) ([]webauthn.Credential, error) {
	rows, err := h.db.Query(`
		SELECT credential_id, public_key, attestation_type, attestation_format,
		       transport, flags, authenticator, attestation
		FROM user_webauthn_credentials WHERE user_id = $1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var creds []webauthn.Credential
	for rows.Next() {
		var cid, pubKey []byte
		var attType, attFmt string
		var transportJSON, flagsJSON, authJSON, attJSON []byte

		if err := rows.Scan(&cid, &pubKey, &attType, &attFmt, &transportJSON, &flagsJSON, &authJSON, &attJSON); err != nil {
			return nil, err
		}

		var transport []protocol.AuthenticatorTransport
		json.Unmarshal(transportJSON, &transport)

		var flags webauthn.CredentialFlags
		json.Unmarshal(flagsJSON, &flags)

		var authenticator webauthn.Authenticator
		json.Unmarshal(authJSON, &authenticator)

		var attestation webauthn.CredentialAttestation
		json.Unmarshal(attJSON, &attestation)

		creds = append(creds, webauthn.Credential{
			ID:                cid,
			PublicKey:         pubKey,
			AttestationType:   attType,
			AttestationFormat: attFmt,
			Transport:         transport,
			Flags:             flags,
			Authenticator:     authenticator,
			Attestation:       attestation,
		})
	}
	return creds, nil
}

// ─── Registration ────────────────────────────────────────────────────────────

// BeginRegistration starts passkey creation. Requires auth.
// POST /api/v1/auth/webauthn/register/begin
func (h *WebAuthnHandler) BeginRegistration(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	user := &webAuthnUser{
		userID:      claims.UserID,
		username:    claims.Username,
		displayName: claims.Username,
	}

	creation, session, err := h.wa.BeginRegistration(user)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin registration"))
		return
	}

	h.storeSession(claims.UserID, "register", session)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"options": creation,
	}))
}

// FinishRegistration completes passkey creation.
// POST /api/v1/auth/webauthn/register/finish
func (h *WebAuthnHandler) FinishRegistration(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	// Read name from query param.
	name := c.Query("name")
	if name == "" {
		name = "Passkey"
	}

	sessionData, ok := h.loadSession(claims.UserID, "register")
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No registration in progress"))
		return
	}

	user := &webAuthnUser{
		userID:      claims.UserID,
		username:    claims.Username,
		displayName: claims.Username,
	}

	credential, err := h.wa.FinishRegistration(user, *sessionData, c.Request)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Registration failed: "+err.Error()))
		return
	}

	transportJSON, _ := json.Marshal(credential.Transport)
	flagsJSON, _ := json.Marshal(credential.Flags)
	authJSON, _ := json.Marshal(credential.Authenticator)
	attJSON, _ := json.Marshal(credential.Attestation)

	_, err = h.db.Exec(`
		INSERT INTO user_webauthn_credentials
			(user_id, credential_id, public_key, attestation_type, attestation_format,
			 transport, flags, authenticator, attestation, name)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, claims.UserID, credential.ID, credential.PublicKey, credential.AttestationType,
		credential.AttestationFormat, transportJSON, flagsJSON, authJSON, attJSON, name)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to store credential"))
		return
	}

	h.deleteSession(claims.UserID, "register")

	c.JSON(http.StatusCreated, models.SuccessResponse(gin.H{
		"ok":   true,
		"name": name,
	}))
}

// ─── Login ───────────────────────────────────────────────────────────────────

// BeginLogin starts passkey authentication (discoverable — no username required).
// GET /api/v1/auth/webauthn/login/begin
func (h *WebAuthnHandler) BeginLogin(c *gin.Context) {
	assertion, session, err := h.wa.BeginDiscoverableLogin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin login"))
		return
	}

	// Generate a unique session token to prevent collisions between concurrent logins.
	sessionToken := make([]byte, 16)
	rand.Read(sessionToken)
	tokenStr := hex.EncodeToString(sessionToken)

	h.storeSession(tokenStr, "login", session)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"options":       assertion,
		"session_token": tokenStr,
	}))
}

// FinishLogin completes passkey authentication and returns JWT tokens.
// POST /api/v1/auth/webauthn/login/finish?session_token=<hex>
func (h *WebAuthnHandler) FinishLogin(c *gin.Context) {
	sessionToken := c.Query("session_token")
	if sessionToken == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("session_token query parameter is required"))
		return
	}

	sessionData, ok := h.loadSession(sessionToken, "login")
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No login in progress or session expired"))
		return
	}

	// DiscoverableUserHandler looks up the user by credential rawID + userHandle.
	var authedUserID, authedUsername string
	handler := func(rawID, userHandle []byte) (webauthn.User, error) {
		err := h.db.QueryRow(`
			SELECT u.id, u.username FROM user_webauthn_credentials c
			JOIN users u ON u.id = c.user_id
			WHERE c.credential_id = $1
		`, rawID).Scan(&authedUserID, &authedUsername)
		if err != nil {
			return nil, fmt.Errorf("unknown credential")
		}

		// Verify userHandle matches if provided.
		if len(userHandle) > 0 {
			uid, _ := uuid.Parse(authedUserID)
			if !bytes.Equal(userHandle, uid[:]) {
				return nil, fmt.Errorf("user handle mismatch")
			}
		}

		creds, err := h.loadCredentials(authedUserID)
		if err != nil {
			return nil, fmt.Errorf("failed to load credentials: %w", err)
		}

		return &webAuthnUser{
			userID:      authedUserID,
			username:    authedUsername,
			displayName: authedUsername,
			credentials: creds,
		}, nil
	}

	_, credential, err := h.wa.FinishPasskeyLogin(handler, *sessionData, c.Request)
	if err != nil {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication failed"))
		return
	}

	h.deleteSession(sessionToken, "login")

	// Update credential counters and last_used_at.
	flagsJSON, _ := json.Marshal(credential.Flags)
	authJSON, _ := json.Marshal(credential.Authenticator)

	if _, err := h.db.Exec(`
		UPDATE user_webauthn_credentials
		SET sign_count = $3, flags = $4, authenticator = $5, last_used_at = NOW()
		WHERE credential_id = $1 AND user_id = $2
	`, credential.ID, authedUserID, credential.Authenticator.SignCount,
		flagsJSON, authJSON); err != nil {
		log.Printf("WebAuthn: failed to update credential sign_count for user %s: %v", authedUserID, err)
	}

	// Get the user struct for the response.
	var authedUser models.User
	h.db.QueryRow(`
		SELECT id, username, email, domain, created_at, is_remote
		FROM users WHERE id = $1
	`, authedUserID).Scan(&authedUser.ID, &authedUser.Username, &authedUser.Email,
		&authedUser.Domain, &authedUser.CreatedAt, &authedUser.IsRemote)

	domain := os.Getenv("SERVER_DOMAIN")
	if domain == "" {
		domain = "localhost:8080"
	}

	tokenPair, err := h.authService.GenerateTokenPair(authedUserID, authedUsername, domain)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user":          authedUser,
		"token":         tokenPair.AccessToken,
		"refresh_token": tokenPair.RefreshToken,
		"expires_in":    tokenPair.ExpiresIn,
	}))
}

// ─── Credential Management ───────────────────────────────────────────────────

// ListCredentials returns all passkeys for the authenticated user.
// GET /api/v1/auth/webauthn/credentials
func (h *WebAuthnHandler) ListCredentials(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	rows, err := h.db.Query(`
		SELECT credential_id, name, attestation_type, created_at, last_used_at
		FROM user_webauthn_credentials
		WHERE user_id = $1
		ORDER BY created_at DESC
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
		return
	}
	defer rows.Close()

	type credInfo struct {
		CredentialID    string  `json:"credential_id"`
		Name            string  `json:"name"`
		AttestationType string  `json:"attestation_type"`
		CreatedAt       string  `json:"created_at"`
		LastUsedAt      *string `json:"last_used_at,omitempty"`
	}

	var credentials []credInfo
	for rows.Next() {
		var ci credInfo
		var lastUsed sql.NullTime
		var rawCredID []byte
		if err := rows.Scan(&rawCredID, &ci.Name, &ci.AttestationType, &ci.CreatedAt, &lastUsed); err != nil {
			continue
		}
		ci.CredentialID = base64.RawURLEncoding.EncodeToString(rawCredID)
		if lastUsed.Valid {
			t := lastUsed.Time.Format(time.RFC3339)
			ci.LastUsedAt = &t
		}
		credentials = append(credentials, ci)
	}
	if credentials == nil {
		credentials = []credInfo{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"credentials": credentials,
	}))
}

// DeleteCredential removes a passkey for the authenticated user.
// DELETE /api/v1/auth/webauthn/credentials/:credentialId
func (h *WebAuthnHandler) DeleteCredential(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	credB64 := c.Param("credentialId")
	credBytes, err := base64.RawURLEncoding.DecodeString(credB64)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid credential ID"))
		return
	}

	_, err = h.db.Exec(`
		DELETE FROM user_webauthn_credentials
		WHERE user_id = $1 AND credential_id = $2
	`, claims.UserID, credBytes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to delete credential"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ─── Redis-backed Session Storage ─────────────────────────────────────────────
//
// Sessions are stored as JSON-serialised *webauthn.SessionData with a TTL.
// Redis key format: webauthn:session:<type>:<tokenOrUserID>
// Redis automatically evicts expired keys — no cleanup goroutine needed.

func (h *WebAuthnHandler) sessionKey(typ, id string) string {
	return fmt.Sprintf("webauthn:session:%s:%s", typ, id)
}

func (h *WebAuthnHandler) storeSession(id, typ string, session *webauthn.SessionData) {
	if h.redis == nil {
		log.Println("WebAuthn: Redis not available, session storage skipped")
		return
	}

	data, err := json.Marshal(session)
	if err != nil {
		log.Printf("WebAuthn: failed to marshal session: %v", err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	key := h.sessionKey(typ, id)
	if err := h.redis.SetEx(ctx, key, data, webauthnSessionTTL).Err(); err != nil {
		log.Printf("WebAuthn: failed to store session in Redis: %v", err)
	}
}

func (h *WebAuthnHandler) loadSession(id, typ string) (*webauthn.SessionData, bool) {
	if h.redis == nil {
		return nil, false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	key := h.sessionKey(typ, id)
	data, err := h.redis.Get(ctx, key).Bytes()
	if err != nil {
		return nil, false
	}

	var session webauthn.SessionData
	if err := json.Unmarshal(data, &session); err != nil {
		log.Printf("WebAuthn: failed to unmarshal session: %v", err)
		return nil, false
	}

	return &session, true
}

func (h *WebAuthnHandler) deleteSession(id, typ string) {
	if h.redis == nil {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	key := h.sessionKey(typ, id)
	if err := h.redis.Del(ctx, key).Err(); err != nil {
		log.Printf("WebAuthn: failed to delete session from Redis: %v", err)
	}
}
