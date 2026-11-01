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
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/authz"
	"github.com/gomo6/backend/internal/middleware"
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
	// In production the RP identity MUST come from the environment. Falling
	// back to localhost origins in prod would mint ceremonies bound to the
	// wrong RP ID/origin (passkeys silently break — or worse, a misconfigured
	// origin widens where assertions are accepted). Fail closed: no handler,
	// no passkey routes.
	if env := os.Getenv("ENVIRONMENT"); env == "production" || env == "prod" {
		if os.Getenv("WEBAUTHN_RP_ID") == "" || (os.Getenv("WEBAUTHN_RP_ORIGIN") == "" && os.Getenv("WEBAUTHN_RP_ORIGINS") == "") {
			log.Println("WebAuthn: WEBAUTHN_RP_ID/WEBAUTHN_RP_ORIGIN(S) are required in production — passkeys disabled")
			return nil
		}
	}
	rpID := os.Getenv("WEBAUTHN_RP_ID")
	if rpID == "" {
		rpID = "localhost"
	}
	// Multiple origins (comma-separated WEBAUTHN_RP_ORIGINS): the main app and
	// the dev-dashboard are different origins sharing one RP ID, and admin
	// passkey ceremonies (re-auth for official posts) run from the dashboard.
	var rpOrigins []string
	if plural := os.Getenv("WEBAUTHN_RP_ORIGINS"); plural != "" {
		for _, o := range strings.Split(plural, ",") {
			if o = strings.TrimSpace(o); o != "" {
				rpOrigins = append(rpOrigins, o)
			}
		}
	}
	if len(rpOrigins) == 0 {
		rpOrigin := os.Getenv("WEBAUTHN_RP_ORIGIN")
		if rpOrigin == "" {
			rpOrigin = "http://localhost:8080"
		}
		rpOrigins = []string{rpOrigin}
	}
	rpName := os.Getenv("WEBAUTHN_RP_NAME")
	if rpName == "" {
		rpName = "gomo6"
	}

	wconfig := &webauthn.Config{
		RPDisplayName: rpName,
		RPID:          rpID,
		RPOrigins:     rpOrigins,
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
//
// BeginRegistration godoc
// @Summary      Begin passkey registration
// @Description  Start passkey creation flow for the authenticated user
// @Tags         WebAuthn
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/webauthn/register/begin [post]
// @Security     BearerAuth
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

	// Enforce passkey-grade creation: a discoverable (resident-key) credential
	// with user verification. Without this the browser may create a
	// non-discoverable credential (e.g. on older security keys) that our
	// discoverable-only login flow can never use — a passkey that bricks itself.
	// Exclusions keep the same authenticator from being registered twice.
	existing, err := h.loadCredentials(claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin registration"))
		return
	}
	creation, session, err := h.wa.BeginRegistration(user,
		webauthn.WithAuthenticatorSelection(protocol.AuthenticatorSelection{
			ResidentKey:      protocol.ResidentKeyRequirementRequired,
			UserVerification: protocol.VerificationRequired,
		}),
		webauthn.WithExclusions(webauthn.Credentials(existing).CredentialDescriptors()),
	)
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
//
// FinishRegistration godoc
// @Summary      Finish passkey registration
// @Description  Complete passkey creation flow
// @Tags         WebAuthn
// @Produce      json
// @Param        name query string false "Passkey name"
// @Success      201 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/webauthn/register/finish [post]
// @Security     BearerAuth
func (h *WebAuthnHandler) FinishRegistration(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	// Read name from query param. Rendered in settings UIs: cap the length so
	// a hostile/comical 10KB name cannot become a stored-blob annoyance.
	name := c.Query("name")
	if name == "" {
		name = "Passkey"
	}
	if len(name) > 64 {
		name = name[:64]
	}

	sessionData, ok := h.loadSession(claims.UserID, "register")
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No registration in progress"))
		return
	}

	// One device, one passkey: true per-device identity is not attestable
	// server-side (same model shares AAGUID, UA/IP collide behind NAT), so the
	// enforceable bound is per account. Ten covers phones/tablets/laptops plus
	// spare security keys; beyond that the user is hoarding duplicates — make
	// them delete one first instead of piling an unbounded list.
	const maxCredentialsPerUser = 10
	var existing int
	if err := h.db.QueryRow(
		`SELECT COUNT(*) FROM user_webauthn_credentials WHERE user_id = $1`, claims.UserID,
	).Scan(&existing); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load credentials"))
		return
	}
	if existing >= maxCredentialsPerUser {
		h.deleteSession(claims.UserID, "register")
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Passkey limit reached (10). Remove an old one first."))
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
			 transport, flags, authenticator, attestation, name, user_agent, ip_address)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NULLIF($12, '')::inet)
	`, claims.UserID, credential.ID, credential.PublicKey, credential.AttestationType,
		credential.AttestationFormat, transportJSON, flagsJSON, authJSON, attJSON, name,
		c.GetHeader("User-Agent"), c.ClientIP())

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
//
// BeginLogin godoc
// @Summary      Begin passkey login
// @Description  Start discoverable passkey authentication
// @Tags         WebAuthn
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      500 {object} models.APIResponse
// @Router       /auth/webauthn/login/begin [get]
func (h *WebAuthnHandler) BeginLogin(c *gin.Context) {
	// Require user verification: a passkey login must prove a human unlocked
	// the authenticator (biometric/PIN), not merely that somebody holds a key
	// whose UV was skipped. The library default is "preferred" (not enforced).
	assertion, session, err := h.wa.BeginDiscoverableLogin(
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin login"))
		return
	}

	// Generate a unique session token to prevent collisions between concurrent logins.
	// Fail closed: a predictable (zeroed) session token lets an attacker ride
	// another user's ceremony and finish a passkey login as them.
	sessionToken := make([]byte, 16)
	if _, err := rand.Read(sessionToken); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin login"))
		return
	}
	tokenStr := hex.EncodeToString(sessionToken)

	h.storeSession(tokenStr, "login", session)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"options":       assertion,
		"session_token": tokenStr,
	}))
}

// FinishLogin completes passkey authentication and returns JWT tokens.
// POST /api/v1/auth/webauthn/login/finish?session_token=<hex>
//
// FinishLogin godoc
// @Summary      Finish passkey login
// @Description  Complete passkey authentication and receive JWT tokens
// @Tags         WebAuthn
// @Produce      json
// @Param        session_token query string true "Session token from BeginLogin"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/webauthn/login/finish [post]
func (h *WebAuthnHandler) FinishLogin(c *gin.Context) {
	// The ceremony token rides the JSON body, not the URL: query strings land
	// in access logs, browser history and Referer headers, and this token is a
	// login capability for 5 minutes. The query param stays as a fallback for
	// older clients during rollout.
	// NOTE: the body is restored after peeking — FinishPasskeyLogin parses the
	// same body for the credential, and a consumed body would break it.
	rawBody, _ := io.ReadAll(c.Request.Body)
	c.Request.Body = io.NopCloser(bytes.NewReader(rawBody))
	var finishBody struct {
		SessionToken string `json:"session_token"`
	}
	_ = json.Unmarshal(rawBody, &finishBody)
	sessionToken := finishBody.SessionToken
	if sessionToken == "" {
		sessionToken = c.Query("session_token")
	}
	if sessionToken == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("session_token is required"))
		return
	}

	sessionData, ok := h.loadSession(sessionToken, "login")
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No login in progress or session expired"))
		return
	}

	// Bound assertion attempts per ceremony: without this, the 5-minute
	// session window allows unbounded credential guesses.
	const maxWebAuthnLoginAttempts = 10
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		n, _ := h.redis.Get(ctx, "webauthn:login_attempts:"+sessionToken).Int()
		cancel()
		if n >= maxWebAuthnLoginAttempts {
			h.deleteSession(sessionToken, "login")
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Too many attempts. Please start a new login."))
			return
		}
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
		// Count the failure; burn the ceremony once the budget is spent so a
		// stolen session_token cannot be guessed forever.
		if h.redis != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
			n, _ := h.redis.Incr(ctx, "webauthn:login_attempts:"+sessionToken).Result()
			if n == 1 {
				h.redis.Expire(ctx, "webauthn:login_attempts:"+sessionToken, webauthnSessionTTL)
			}
			if n >= maxWebAuthnLoginAttempts {
				h.deleteSession(sessionToken, "login")
			}
			cancel()
		} else {
			// No Redis backend: sessions are not tracked anyway, but never
			// leave a failed ceremony reusable in-process caches.
			h.deleteSession(sessionToken, "login")
		}
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication failed"))
		return
	}

	h.deleteSession(sessionToken, "login")
	if h.redis != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		h.redis.Del(ctx, "webauthn:login_attempts:"+sessionToken)
		cancel()
	}

	// Belt and braces: the service account must never complete a login
	// ceremony even if a credential row somehow existed for it. authedUserID
	// is resolved by the DiscoverableUserHandler inside FinishPasskeyLogin.
	if svc, serr := authz.IsServiceAccount(c.Request.Context(), h.db, authedUserID); serr == nil && svc {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Service account login is disabled"))
		return
	}

	// Clone detection (spec step 17): a regressed signature counter means the
	// private key exists in two places — the credential may be cloned. Failing
	// the login outright would lock out legitimate users on authenticator
	// quirks (synced passkeys often report 0), so the ceremony still succeeds
	// but the event is impossible to miss: loud security log with everything
	// needed to identify and revoke the credential.
	if credential.Authenticator.CloneWarning {
		log.Printf("[SECURITY] WebAuthn clone warning: user=%s credential=%x sign_count=%d — possible cloned authenticator",
			authedUserID, credential.ID, credential.Authenticator.SignCount)
	}

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
		SELECT id, username, display_name, email, domain, created_at, is_remote
		FROM users WHERE id = $1
	`, authedUserID).Scan(&authedUser.ID, &authedUser.Username, &authedUser.DisplayName, &authedUser.Email,
		&authedUser.Domain, &authedUser.CreatedAt, &authedUser.IsRemote)

	domain := os.Getenv("SERVER_DOMAIN")
	if domain == "" {
		domain = "localhost:8080"
	}

	tokenPair, err := createLoginSession(h.db, h.redis, h.authService, authedUserID, authedUsername, domain, c.GetHeader("User-Agent"), c.ClientIP())
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to generate token"))
		return
	}

	// A passkey login is a full browser login, exactly like password/2FA: it
	// MUST establish the session cookies (access/refresh/CSRF). Without them the
	// session lives only in the frontend's in-memory token, so a page reload
	// loses it — users were randomly logged out on every reload (and in
	// incognito the loss is immediate). SetAuthCookies is also what the client
	// uses to detect the session after a reload (the readable CSRF cookie) and
	// to restore it via /auth/refresh (the HttpOnly refresh cookie).
	if err := middleware.SetAuthCookies(c, authedUserID, tokenPair.AccessToken, tokenPair.RefreshToken, 3600); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to establish session"))
		return
	}

	// The refresh token lives in the HttpOnly cookie only. A passkey login is
	// always a browser flow, so there is no include_tokens opt-in here.
	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"user":       authedUser,
		"token":      tokenPair.AccessToken,
		"expires_in": tokenPair.ExpiresIn,
	}))
}

// ─── Re-authentication ("use passkey instead of password") ───────────────────
// Sensitive account actions (password change, 2FA enrollment, passkey
// deletion) accept EITHER the current password OR a fresh passkey ceremony.
// These two endpoints run that ceremony and mint a 5-minute single-use reauth
// token the action endpoints consume. The ceremony is non-discoverable and
// scoped to the caller's own credentials (the user is already authenticated),
// user verification is required, and the session binds ceremony to account.

// BeginReauth starts a passkey re-authentication ceremony for the caller.
// POST /api/v1/auth/webauthn/reauth/begin
func (h *WebAuthnHandler) BeginReauth(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	creds, err := h.loadCredentials(claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load credentials"))
		return
	}
	if len(creds) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No passkeys registered"))
		return
	}

	user := &webAuthnUser{
		userID:      claims.UserID,
		username:    claims.Username,
		displayName: claims.Username,
		credentials: creds,
	}

	assertion, session, err := h.wa.BeginLogin(user,
		webauthn.WithUserVerification(protocol.VerificationRequired),
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to begin re-authentication"))
		return
	}

	h.storeSession(claims.UserID, "reauth", session)

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"options": assertion,
	}))
}

// FinishReauth completes the ceremony and returns a single-use reauth token.
// POST /api/v1/auth/webauthn/reauth/finish
func (h *WebAuthnHandler) FinishReauth(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	sessionData, ok := h.loadSession(claims.UserID, "reauth")
	if !ok {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No re-authentication in progress"))
		return
	}

	// Throttle like the other auth oracles: a stolen session must not get
	// unlimited assertion guesses (the ceremony itself already bounds them).
	if isAuthActionLockedRDB(h.redis, claims.UserID) {
		c.JSON(http.StatusTooManyRequests, models.ErrorResponse("Too many attempts. Please try again later."))
		return
	}

	creds, err := h.loadCredentials(claims.UserID)
	if err != nil || len(creds) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("No passkeys registered"))
		return
	}
	user := &webAuthnUser{
		userID:      claims.UserID,
		username:    claims.Username,
		displayName: claims.Username,
		credentials: creds,
	}

	if _, err := h.wa.FinishLogin(user, *sessionData, c.Request); err != nil {
		recordAuthActionFailureRDB(h.redis, claims.UserID)
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Re-authentication failed"))
		return
	}
	clearAuthActionLockRDB(h.redis, claims.UserID)
	h.deleteSession(claims.UserID, "reauth")

	token, err := h.authService.GenerateReauthToken(claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to issue re-auth token"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"reauth_token": token,
		"expires_in":   auth.ReauthTTLSeconds(),
	}))
}

// ─── Credential Management ───────────────────────────────────────────────────

// ListCredentials returns all passkeys for the authenticated user.
// GET /api/v1/auth/webauthn/credentials
//
// ListCredentials godoc
// @Summary      List passkeys
// @Description  Get all registered passkeys for the authenticated user
// @Tags         WebAuthn
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/webauthn/credentials [get]
// @Security     BearerAuth
func (h *WebAuthnHandler) ListCredentials(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	rows, err := h.db.Query(`
		SELECT credential_id, name, attestation_type, created_at, last_used_at,
			COALESCE(user_agent, '')
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
		UserAgent       string  `json:"user_agent,omitempty"`
	}

	var credentials []credInfo
	for rows.Next() {
		var ci credInfo
		var lastUsed sql.NullTime
		var rawCredID []byte
		if err := rows.Scan(&rawCredID, &ci.Name, &ci.AttestationType, &ci.CreatedAt, &lastUsed, &ci.UserAgent); err != nil {
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
//
// Removing a passkey with a stolen session alone would silently strip the
// account's strongest factor, so this endpoint requires RE-AUTHENTICATION:
// the current password (when the account has one) and a current 2FA code
// (when 2FA is enabled). Passkey-only accounts have no other factor — the
// session itself is the proof — and may delete directly.
//
// DeleteCredential godoc
// @Summary      Delete passkey
// @Description  Remove a registered passkey (requires re-authentication)
// @Tags         WebAuthn
// @Produce      json
// @Param        credentialId path string true "Credential ID (base64url)"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /auth/webauthn/credentials/{credentialId} [delete]
// @Security     BearerAuth
func (h *WebAuthnHandler) DeleteCredential(c *gin.Context) {
	claimsI, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	claims := claimsI.(*auth.Claims)

	var req struct {
		CurrentPassword string `json:"current_password"`
		Code            string `json:"code"`
		// Fresh passkey ceremony as an alternative to password/code below.
		ReauthToken string `json:"reauth_token"`
	}
	_ = c.ShouldBindJSON(&req)
	reauthOK := consumeReauthToken(h.authService, claims.UserID, req.ReauthToken)

	var passwordHash sql.NullString
	var totpSecret *string
	var totpEnabled bool
	if err := h.db.QueryRow(
		`SELECT password_hash, totp_secret, totp_enabled FROM users WHERE id = $1`, claims.UserID,
	).Scan(&passwordHash, &totpSecret, &totpEnabled); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load account state"))
		return
	}

	hasPassword := passwordHash.Valid && passwordHash.String != ""
	if hasPassword || totpEnabled {
		// Re-auth attempts are throttled per account like the other
		// password/code oracles, so a stolen session cannot brute-force them.
		if isAuthActionLockedRDB(h.redis, claims.UserID) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Too many attempts. Please try again later."))
			return
		}
	}
	if hasPassword && !reauthOK {
		if strings.TrimSpace(req.CurrentPassword) == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Current password or re-authentication is required"))
			return
		}
		if verifyPassword(passwordHash.String, req.CurrentPassword) != nil {
			recordAuthActionFailureRDB(h.redis, claims.UserID)
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Current password is incorrect"))
			return
		}
	}
	if totpEnabled && !reauthOK {
		if strings.TrimSpace(req.Code) == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Current 2FA code or re-authentication is required"))
			return
		}
		plain := ""
		if totpSecret != nil && *totpSecret != "" {
			var err error
			plain, err = openTOTPSecret(h.authService, *totpSecret)
			if err != nil {
				c.JSON(http.StatusInternalServerError, models.ErrorResponse("2FA is not available"))
				return
			}
		}
		valid, err := validateTOTPWithRecoveryDB(h.db, claims.UserID, plain, strings.TrimSpace(req.Code))
		if err != nil || !valid {
			if err == nil {
				recordAuthActionFailureRDB(h.redis, claims.UserID)
			}
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid 2FA code"))
			return
		}
	}
	if hasPassword || totpEnabled {
		clearAuthActionLockRDB(h.redis, claims.UserID)
	}

	// Footgun guard: a passkey-only account (no password, no 2FA) whose last
	// passkey is deleted is locked out permanently — there is no password
	// reset flow. Refuse; the user must set a password first.
	if !hasPassword && !totpEnabled {
		var remaining int
		if err := h.db.QueryRow(
			`SELECT COUNT(*) FROM user_webauthn_credentials WHERE user_id = $1`, claims.UserID,
		).Scan(&remaining); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to load credentials"))
			return
		}
		if remaining <= 1 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot remove your last passkey without setting a password first"))
			return
		}
	}

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
