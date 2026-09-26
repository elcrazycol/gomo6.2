package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/oauth"
	"golang.org/x/crypto/bcrypt"
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
// GetConfig godoc
// @Summary      Get dev dashboard OAuth config
// @Description  OAuth endpoint configuration for the dev dashboard app
// @Tags         Developer
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Router       /dev-dashboard/config [get]
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
		if domain == "localhost" {
			// Local dev: the OAuth issuer is the API server on 8080, not the
			// bare "localhost" (which would resolve to port 80).
			baseURL = "http://localhost:8080"
		} else {
			baseURL = "http://" + domain
		}
	}

	frontendURL := os.Getenv("DEV_DASHBOARD_URL")
	if frontendURL == "" {
		if domain == "localhost" {
			// Vite serves the local dashboard on 3002. Keep this fallback in
			// sync with SeedDevDashboardApp and the actual dev server origin.
			frontendURL = "http://localhost:3002"
		} else {
			frontendURL = "http://dev." + domain
		}
	}
	frontendURL = strings.TrimRight(frontendURL, "/")
	// The OAuth redirect must land on the exact origin the dashboard is served
	// from (localhost:3002 vs dev.localhost:3002) so the PKCE verifier — stored
	// per origin — is found again. Echo the request origin when it is one of the
	// app's registered redirect URIs; otherwise fall back to the configured URL.
	frontendURL = h.resolveFrontendURL(c, clientID, frontendURL)

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

// resolveFrontendURL returns the request's own origin+"/callback" base when that
// origin is a registered redirect URI of the app, else the configured fallback.
// This makes login work on every registered origin (localhost vs dev.localhost)
// without opening the door to arbitrary hosts.
func (h *DevDashboardHandler) resolveFrontendURL(c *gin.Context, clientID, fallback string) string {
	origin := requestOrigin(c)
	if origin == "" {
		return fallback
	}
	var raw []byte
	if err := h.db.QueryRow(
		`SELECT redirect_uris FROM oauth_applications WHERE client_id = $1`, clientID,
	).Scan(&raw); err != nil {
		return fallback
	}
	var uris []string
	if err := json.Unmarshal(raw, &uris); err != nil {
		return fallback
	}
	want := origin + "/callback"
	for _, u := range uris {
		if strings.TrimRight(u, "/") == want {
			return origin
		}
	}
	return fallback
}

// requestOrigin extracts the browser origin from the Origin or Referer header.
func requestOrigin(c *gin.Context) string {
	if o := strings.TrimRight(c.GetHeader("Origin"), "/"); o != "" {
		return o
	}
	if ref := c.GetHeader("Referer"); ref != "" {
		if u, err := url.Parse(ref); err == nil && u.Scheme != "" && u.Host != "" {
			return u.Scheme + "://" + u.Host
		}
	}
	return ""
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
	if domain == "" {
		domain = "localhost"
	}
	if devDashboardURL == "" {
		if domain == "localhost" {
			devDashboardURL = "http://localhost:3002"
		} else {
			devDashboardURL = "http://dev." + domain
		}
	}
	devDashboardURL = strings.TrimRight(devDashboardURL, "/")

	redirectURIsList := []string{devDashboardURL + "/callback"}
	redirectURIsJSON, err := json.Marshal(redirectURIsList)
	if err != nil {
		log.Printf("SeedDevDashboardApp: failed to encode redirect URIs: %v", err)
		return
	}
	redirectURIs := string(redirectURIsJSON)

	systemUserID := "00000000-0000-0000-0000-000000000000"
	systemDomain := os.Getenv("DOMAIN")
	if systemDomain == "" {
		systemDomain = "localhost:8080"
	}

	// Generate a random wallet address for the system user (required NOT NULL).
	// The system user is never intended to log in, so the password is random.
	walletAddr := fmt.Sprintf("GM6-%s-%s", randomHex(4), randomHex(4))
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(randomHex(32)), bcrypt.DefaultCost)
	if err != nil {
		log.Printf("SeedDevDashboardApp: failed to hash system user password: %v", err)
		return
	}

	// First ensure a system user exists to satisfy the owner_id FK constraint
	_, err = db.Exec(`
		INSERT INTO users (id, username, email, password_hash, domain, wallet_address)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (id) DO UPDATE SET
			username = EXCLUDED.username,
			email = EXCLUDED.email,
			domain = EXCLUDED.domain,
			wallet_address = EXCLUDED.wallet_address
	`,
		systemUserID,
		"__system__",
		"system@gomo6.local",
		string(hashedPassword),
		systemDomain,
		walletAddr,
	)
	if err != nil {
		log.Printf("SeedDevDashboardApp: failed to seed system user: %v", err)
		return
	}

	// Create or update the dev-dashboard as a system app (public client with PKCE)
	_, err = db.Exec(`
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
		log.Printf("SeedDevDashboardApp: failed to seed dev-dashboard OAuth app: %v", err)
		return
	}
}
