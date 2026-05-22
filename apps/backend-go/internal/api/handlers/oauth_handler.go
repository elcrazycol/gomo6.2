package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"net/url"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/oauth"
)

type OAuthHandler struct {
	db       *sql.DB
	oauthSvc *oauth.OAuthService
	authSvc  *auth.AuthService
}

func NewOAuthHandler(db *sql.DB, oauthSvc *oauth.OAuthService, authSvc *auth.AuthService) *OAuthHandler {
	return &OAuthHandler{
		db:       db,
		oauthSvc: oauthSvc,
		authSvc:  authSvc,
	}
}

// GET /oauth/authorize
func (h *OAuthHandler) Authorize(c *gin.Context) {
	var req oauth.AuthorizeRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "Invalid request parameters",
		})
		return
	}

	// Validate required params
	if req.ResponseType != oauth.ResponseTypeCode {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorUnsupportedResponseType,
			"error_description": "Only 'code' response type is supported",
			"state":             req.State,
		})
		return
	}
	if req.ClientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "client_id is required",
			"state":             req.State,
		})
		return
	}
	if req.RedirectURI == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "redirect_uri is required",
			"state":             req.State,
		})
		return
	}

	// Look up the application
	app, err := h.oauthSvc.GetApplicationByClientID(req.ClientID)
	if err != nil || app == nil || !app.IsActive {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorUnauthorizedClient,
			"error_description": "Invalid or inactive client_id",
			"state":             req.State,
		})
		return
	}

	// Validate redirect URI
	if !isValidRedirectURI(app.RedirectURIs, req.RedirectURI) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "redirect_uri is not registered for this application",
			"state":             req.State,
		})
		return
	}

	// Validate scopes
	requestedScopes := oauth.ParseScopeString(req.Scope)
	for _, s := range requestedScopes {
		if s == oauth.ScopeOpenID {
			continue // always allow openid
		}
		if !isScopeAllowed(app.AllowedScopes, s) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error":             oauth.ErrorInvalidScope,
				"error_description": "Scope '" + s + "' is not allowed for this application",
				"state":             req.State,
			})
			return
		}
	}

	// Check if user is authenticated
	claimsInterface, exists := c.Get("claims")
	if !exists {
		// User not logged in, redirect to auth page
		redirectURL := "/auth?redirect=" + url.QueryEscape("/oauth/authorize?"+c.Request.URL.RawQuery)
		c.Redirect(http.StatusTemporaryRedirect, redirectURL)
		return
	}

	claims := claimsInterface.(*auth.Claims)

	// User is authenticated, render consent page
	// For now, auto-approve (like Google does for first-party apps)
	// In production, show a consent page
	code, err := h.oauthSvc.GenerateAuthorizationCode(
		req.ClientID,
		claims.UserID,
		req.RedirectURI,
		req.CodeChallenge,
		req.CodeChallengeMethod,
		req.Scope,
		req.Nonce,
	)
	if err != nil {
		log.Printf("Failed to generate auth code: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":             oauth.ErrorServerError,
			"error_description": "Failed to generate authorization code",
			"state":             req.State,
		})
		return
	}

	// Build redirect URL with code and state
	redirectURL, _ := url.Parse(req.RedirectURI)
	q := redirectURL.Query()
	q.Set("code", code)
	if req.State != "" {
		q.Set("state", req.State)
	}
	redirectURL.RawQuery = q.Encode()

	// If the request came via fetch/XHR (has Authorization header), return JSON
	// instead of a 302 redirect. Browser CORS blocks fetch redirects to different origins
	// when Authorization header is present (OPTIONS preflight to redirect target fails).
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		c.JSON(http.StatusOK, gin.H{
			"redirect_url": redirectURL.String(),
			"code":         code,
			"state":        req.State,
		})
		return
	}

	c.Redirect(http.StatusFound, redirectURL.String())
}

// POST /oauth/token
func (h *OAuthHandler) Token(c *gin.Context) {
	var req oauth.TokenRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "Invalid request parameters",
		})
		return
	}

	// Validate client
	clientID := req.ClientID

	// For confidential clients, validate client_secret
	app, err := h.oauthSvc.GetApplicationByClientID(clientID)
	if err != nil || app == nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidClient,
			"error_description": "Invalid client_id",
		})
		return
	}

	if app.IsConfidential {
		if req.ClientSecret == "" {
			// Try Basic Auth
			clientID, clientSecret, ok := c.Request.BasicAuth()
			if ok {
				req.ClientID = clientID
				req.ClientSecret = clientSecret
			}
		}
		if !h.oauthSvc.VerifyClientSecret(req.ClientSecret, app.ClientSecretHash) {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             oauth.ErrorInvalidClient,
				"error_description": "Invalid client_secret",
			})
			return
		}
	}

	switch req.GrantType {
	case oauth.GrantTypeAuthorizationCode:
		h.handleAuthorizationCodeGrant(c, req, app)
	case oauth.GrantTypeRefreshToken:
		h.handleRefreshTokenGrant(c, req, app)
	default:
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorUnsupportedGrantType,
			"error_description": "Unsupported grant_type",
		})
	}
}

// POST /oauth/revoke
func (h *OAuthHandler) Revoke(c *gin.Context) {
	var req oauth.RevokeRequest
	if err := c.ShouldBind(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "Invalid request",
		})
		return
	}

	if req.Token == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "token is required",
		})
		return
	}

	err := h.oauthSvc.RevokeToken(req.Token, req.TokenTypeHint, req.ClientID)
	if err != nil {
		log.Printf("Token revocation error: %v", err)
	}

	// RFC 7009: The authorization server responds with HTTP 200 OK
	c.JSON(http.StatusOK, gin.H{})
}

// GET /oauth/userinfo
func (h *OAuthHandler) UserInfo(c *gin.Context) {
	// Extract OAuth claims from context
	claimsInterface, exists := c.Get("oauth_claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "Invalid or expired access token",
		})
		return
	}

	claims := claimsInterface.(*oauth.OAuthClaims)

	info, err := h.oauthSvc.GetUserInfo(claims.UserID, claims.Scopes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":             oauth.ErrorServerError,
			"error_description": "Failed to get user info",
		})
		return
	}

	c.JSON(http.StatusOK, info)
}

// GET /.well-known/openid-configuration
func (h *OAuthHandler) OpenIDConfiguration(c *gin.Context) {
	config := h.oauthSvc.GetOpenIDConfiguration()
	c.JSON(http.StatusOK, config)
}

// GET /.well-known/jwks.json
func (h *OAuthHandler) JWKS(c *gin.Context) {
	jwks := h.oauthSvc.GetJWKS()
	c.JSON(http.StatusOK, jwks)
}

// GET /oauth/app-info returns public app info for the consent page
func (h *OAuthHandler) AppInfo(c *gin.Context) {
	clientID := c.Query("client_id")
	if clientID == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "client_id is required",
		})
		return
	}

	app, err := h.oauthSvc.GetApplicationByClientID(clientID)
	if err != nil || app == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Application not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"client_id":      app.ClientID,
		"name":           app.Name,
		"description":    app.Description,
		"logo_url":       app.LogoURL,
		"homepage_url":   app.HomepageURL,
		"allowed_scopes": app.AllowedScopes,
	})
}

// helpers

func (h *OAuthHandler) handleAuthorizationCodeGrant(c *gin.Context, req oauth.TokenRequest, app *oauth.OAuthApplication) {
	if req.Code == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "code is required",
		})
		return
	}

	userID, scopes, nonce, err := h.oauthSvc.ValidateAuthorizationCode(req.Code, req.ClientID, req.RedirectURI, req.CodeVerifier)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidGrant,
			"error_description": err.Error(),
		})
		return
	}

	// Get username
	var username string
	err = h.db.QueryRow(`SELECT username FROM users WHERE id = $1`, userID).Scan(&username)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":             oauth.ErrorServerError,
			"error_description": "User not found",
		})
		return
	}

	// Generate access token
	at, accessTokenStr, err := h.oauthSvc.GenerateAccessToken(req.ClientID, userID, username, scopes)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error":             oauth.ErrorServerError,
			"error_description": "Failed to generate access token",
		})
		return
	}

	// Generate refresh token
	refreshTokenStr, err := h.oauthSvc.GenerateRefreshToken(at.ID, req.ClientID, userID, scopes)
	if err != nil {
		log.Printf("Failed to generate refresh token: %v", err)
	}

	tokenResponse := oauth.TokenResponse{
		AccessToken:  accessTokenStr,
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: refreshTokenStr,
		Scope:        oauth.JoinScopes(scopes),
	}

	// Generate ID token if openid scope
	for _, s := range scopes {
		if s == oauth.ScopeOpenID {
			idToken, err := h.oauthSvc.GenerateIDToken(req.ClientID, userID, username, nonce, scopes)
			if err == nil {
				tokenResponse.IDToken = idToken
			}
			break
		}
	}

	c.JSON(http.StatusOK, tokenResponse)
}

func (h *OAuthHandler) handleRefreshTokenGrant(c *gin.Context, req oauth.TokenRequest, app *oauth.OAuthApplication) {
	if req.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidRequest,
			"error_description": "refresh_token is required",
		})
		return
	}

	newAccessToken, newRefreshToken, idToken, err := h.oauthSvc.RefreshAccessToken(req.RefreshToken, req.ClientID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error":             oauth.ErrorInvalidGrant,
			"error_description": err.Error(),
		})
		return
	}

	c.JSON(http.StatusOK, oauth.TokenResponse{
		AccessToken:  newAccessToken,
		TokenType:    "Bearer",
		ExpiresIn:    3600,
		RefreshToken: newRefreshToken,
		IDToken:      idToken,
	})
}

func isValidRedirectURI(allowedURIs []string, uri string) bool {
	for _, allowed := range allowedURIs {
		if allowed == uri {
			return true
		}
		// Allow wildcard matching for localhost ports
		if allowed == "http://localhost:*" && stringsHasPrefix(uri, "http://localhost:") {
			return true
		}
	}
	return false
}

func isScopeAllowed(allowedScopes []string, scope string) bool {
	if scope == oauth.ScopeOpenID {
		return true
	}
	for _, s := range allowedScopes {
		if s == scope {
			return true
		}
	}
	return false
}

func stringsHasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}

// OAuthBearerMiddleware validates OAuth access tokens
func OAuthBearerMiddleware(oauthSvc *oauth.OAuthService) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             oauth.ErrorInvalidRequest,
				"error_description": "Authorization header required",
			})
			c.Abort()
			return
		}

		tokenParts := splitToken(authHeader)
		if tokenParts == nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             oauth.ErrorInvalidRequest,
				"error_description": "Invalid authorization header format",
			})
			c.Abort()
			return
		}

		claims, err := oauthSvc.ValidateAccessToken(tokenParts[1])
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error":             oauth.ErrorInvalidGrant,
				"error_description": "Invalid or expired access token",
			})
			c.Abort()
			return
		}

		c.Set("oauth_claims", claims)
		c.Next()
	}
}

func splitToken(authHeader string) []string {
	if len(authHeader) < 7 || authHeader[:7] != "Bearer " {
		return nil
	}
	return []string{"Bearer", authHeader[7:]}
}
