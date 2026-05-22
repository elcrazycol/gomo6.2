package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/oauth"
)

type DeveloperHandler struct {
	db       *sql.DB
	oauthSvc *oauth.OAuthService
}

func NewDeveloperHandler(db *sql.DB, oauthSvc *oauth.OAuthService) *DeveloperHandler {
	return &DeveloperHandler{
		db:       db,
		oauthSvc: oauthSvc,
	}
}

// GET /api/v1/developer/apps
func (h *DeveloperHandler) ListApps(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	apps, err := h.oauthSvc.GetApplicationsByOwner(claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch applications",
		})
		return
	}

	if apps == nil {
		apps = []oauth.OAuthApplication{}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": apps,
	})
}

// POST /api/v1/developer/apps
func (h *DeveloperHandler) CreateApp(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)

	var req oauth.CreateAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request: " + err.Error(),
		})
		return
	}

	if req.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "name is required",
		})
		return
	}

	if len(req.RedirectURIs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "At least one redirect_uri is required",
		})
		return
	}

	// Set defaults
	isConfidential := true
	if req.IsConfidential != nil {
		isConfidential = *req.IsConfidential
	}

	allowedScopes := req.AllowedScopes
	if len(allowedScopes) == 0 {
		allowedScopes = []string{oauth.ScopeProfile}
	}

	app, clientSecret, err := h.oauthSvc.CreateApplication(
		claims.UserID,
		req.Name,
		req.Description,
		req.RedirectURIs,
		allowedScopes,
		isConfidential,
		req.LogoURL,
		req.HomepageURL,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to create application: " + err.Error(),
		})
		return
	}

	// Audit log: app created
	h.oauthSvc.LogOAuthAction(claims.UserID, app.ClientID, app.Name, oauth.AuditActionAppCreated,
		c.ClientIP(), map[string]interface{}{
			"scopes":          allowedScopes,
			"redirect_uris":   req.RedirectURIs,
			"is_confidential": isConfidential,
		})

	c.JSON(http.StatusCreated, oauth.CreateAppResponse{
		App:          *app,
		ClientSecret: clientSecret,
	})
}

// GET /api/v1/developer/apps/:id
func (h *DeveloperHandler) GetApp(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	app, err := h.oauthSvc.GetApplicationByID(appID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch application",
		})
		return
	}

	if app == nil || app.OwnerID != claims.UserID {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Application not found",
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"data": app,
	})
}

// PUT /api/v1/developer/apps/:id
func (h *DeveloperHandler) UpdateApp(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	var req oauth.UpdateAppRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Invalid request: " + err.Error(),
		})
		return
	}

	app, err := h.oauthSvc.UpdateApplication(appID, claims.UserID, &req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to update application: " + err.Error(),
		})
		return
	}

	if app == nil {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Application not found",
		})
		return
	}

	// Audit log: app updated
	h.oauthSvc.LogOAuthAction(claims.UserID, app.ClientID, app.Name, oauth.AuditActionAppUpdated,
		c.ClientIP(), nil)

	c.JSON(http.StatusOK, gin.H{
		"data": app,
	})
}

// DELETE /api/v1/developer/apps/:id
func (h *DeveloperHandler) DeleteApp(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	err := h.oauthSvc.DeleteApplication(appID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to delete application: " + err.Error(),
		})
		return
	}

	// Audit log: app deleted
	h.oauthSvc.LogOAuthAction(claims.UserID, "", appID, oauth.AuditActionAppDeleted,
		c.ClientIP(), nil)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{"ok": true},
	})
}

// POST /api/v1/developer/apps/:id/regenerate-secret
func (h *DeveloperHandler) RegenerateSecret(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	newSecret, err := h.oauthSvc.RegenerateClientSecret(appID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to regenerate secret: " + err.Error(),
		})
		return
	}

	// Get app name for audit log
	appName := appID
	if app, err := h.oauthSvc.GetApplicationByID(appID); err == nil && app != nil {
		appName = app.Name
	}

	// Audit log: secret regenerated
	h.oauthSvc.LogOAuthAction(claims.UserID, "", appName, oauth.AuditActionSecretRegenerated,
		c.ClientIP(), nil)

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{
			"client_secret": newSecret,
		},
	})
}

// GET /api/v1/developer/apps/:id/tokens
func (h *DeveloperHandler) ListTokens(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	tokens, err := h.oauthSvc.GetTokensByApp(appID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to fetch tokens: " + err.Error(),
		})
		return
	}

	if tokens == nil {
		tokens = []oauth.AccessToken{}
	}

	c.JSON(http.StatusOK, gin.H{
		"data": tokens,
	})
}

// POST /api/v1/developer/apps/:id/revoke-user-tokens
func (h *DeveloperHandler) RevokeUserTokens(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	appID := c.Param("id")

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "user_id is required",
		})
		return
	}

	// Get the app's client_id
	app, err := h.oauthSvc.GetApplicationByID(appID)
	if err != nil || app == nil || app.OwnerID != claims.UserID {
		c.JSON(http.StatusNotFound, gin.H{
			"error": "Application not found",
		})
		return
	}

	err = h.oauthSvc.RevokeAllUserTokens(app.ClientID, req.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "Failed to revoke tokens: " + err.Error(),
		})
		return
	}

	// Audit log: user tokens revoked by developer
	h.oauthSvc.LogOAuthAction(claims.UserID, app.ClientID, app.Name, oauth.AuditActionUserTokensRevoked,
		c.ClientIP(), map[string]interface{}{
			"target_user_id": req.UserID,
		})

	c.JSON(http.StatusOK, gin.H{
		"data": gin.H{"ok": true},
	})
}
