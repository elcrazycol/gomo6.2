package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"os"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/oauth"
)

type DevDashboardHandler struct {
	db       *sql.DB
	oauthSvc *oauth.OAuthService
}

func NewDevDashboardHandler(db *sql.DB, oauthSvc *oauth.OAuthService) *DevDashboardHandler {
	return &DevDashboardHandler{
		db:       db,
		oauthSvc: oauthSvc,
	}
}

// GET /api/v1/dev-dashboard/config
// Returns the OAuth configuration needed for the dev-dashboard to authenticate
func (h *DevDashboardHandler) GetConfig(c *gin.Context) {
	clientID := os.Getenv("DEV_DASHBOARD_CLIENT_ID")
	if clientID == "" {
		clientID = "dev_dashboard"
	}

	domain := os.Getenv("DOMAIN")
	if domain == "" {
		domain = "localhost"
	}

	baseURL := os.Getenv("ISSUER_URL")
	if baseURL == "" {
		baseURL = "http://" + domain
	}

	frontendURL := os.Getenv("DEV_DASHBOARD_URL")
	if frontendURL == "" {
		frontendURL = "http://dev." + domain
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"client_id":         clientID,
		"authorization_url": baseURL + "/oauth/authorize",
		"token_url":         baseURL + "/oauth/token",
		"userinfo_url":      baseURL + "/oauth/userinfo",
		"revocation_url":    baseURL + "/oauth/revoke",
		"introspection_url": baseURL + "/oauth/introspect",
		"redirect_uri":      frontendURL + "/callback",
		"scopes":            []string{"openid", "profile", "email"},
		"app_name":          "gomo6 Dev Dashboard",
		"app_description":   "Управление OAuth-приложениями и интеграциями gomo6",
	}))
}

// SeedDevDashboardApp creates or ensures the dev-dashboard OAuth app exists
// It first ensures a system user exists to satisfy the owner_id FK constraint.
func SeedDevDashboardApp(db *sql.DB) {
	clientID := os.Getenv("DEV_DASHBOARD_CLIENT_ID")
	if clientID == "" {
		clientID = "dev_dashboard"
	}

	// Build redirect URIs from DEV_DASHBOARD_URL env var (supports both dev and production)
	devDashboardURL := os.Getenv("DEV_DASHBOARD_URL")
	domain := os.Getenv("DOMAIN")
	if devDashboardURL == "" {
		if domain == "" {
			domain = "localhost"
		}
		devDashboardURL = "http://dev." + domain
	}
	if domain == "" {
		domain = "localhost"
	}
	redirectURIs := fmt.Sprintf(`["%s/callback","http://dev.%s/callback"]`, devDashboardURL, domain)

	systemUserID := "00000000-0000-0000-0000-000000000000"
	systemDomain := os.Getenv("DOMAIN")
	if systemDomain == "" {
		systemDomain = "localhost:8080"
	}

	// First ensure a system user exists to satisfy the owner_id FK constraint
	_, _ = db.Exec(`
		INSERT INTO users (id, username, email, password_hash, domain)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id) DO UPDATE SET
			username = EXCLUDED.username,
			email = EXCLUDED.email,
			domain = EXCLUDED.domain
	`,
		systemUserID,
		"__system__",
		"system@gomo6.local",
		"",
		systemDomain,
	)

	// Create or update the dev-dashboard as a system app (public client with PKCE)
	_, err := db.Exec(`
		INSERT INTO oauth_applications 
			(owner_id, name, description, client_id, client_secret_hash, redirect_uris, allowed_scopes, is_confidential, logo_url, homepage_url, is_active, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
		ON CONFLICT (client_id) DO UPDATE SET
			name = EXCLUDED.name,
			description = EXCLUDED.description,
			redirect_uris = EXCLUDED.redirect_uris,
			allowed_scopes = EXCLUDED.allowed_scopes,
			is_confidential = EXCLUDED.is_confidential,
			logo_url = EXCLUDED.logo_url,
			homepage_url = EXCLUDED.homepage_url,
			is_active = EXCLUDED.is_active,
			updated_at = NOW()
	`,
		systemUserID,
		"gomo6 Dev Dashboard",
		"Управление OAuth-приложениями и интеграциями gomo6",
		clientID,
		"", // no client_secret needed (public client with PKCE)
		redirectURIs,
		"{openid,profile,email}",
		false, // public client (PKCE only)
		"",
		devDashboardURL,
		true,
	)

	if err != nil {
		return
	}
}
