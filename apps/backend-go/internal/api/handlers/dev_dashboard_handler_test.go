package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/oauth"
)

func setupDevDashboardHandler(t *testing.T) (*DevDashboardHandler, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
	})

	authSvc := auth.NewAuthService()
	oauthSvc := oauth.NewOAuthService(db, authSvc)
	handler := NewDevDashboardHandler(db, oauthSvc)
	return handler, mock
}

// =============================================================================
// GetConfig tests
// =============================================================================

func TestGetConfig_Defaults(t *testing.T) {
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_URL")
	defer os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	defer os.Unsetenv("DOMAIN")
	defer os.Unsetenv("ISSUER_URL")
	defer os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data, ok := resp["data"].(map[string]interface{})
	if !ok {
		t.Fatal("Expected 'data' in response")
	}

	if data["client_id"] != "dev_dashboard" {
		t.Errorf("Expected default client_id 'dev_dashboard', got '%v'", data["client_id"])
	}
	if data["app_name"] != "gomo6 Dev Dashboard" {
		t.Errorf("Expected default app_name, got '%v'", data["app_name"])
	}
}

func TestGetConfig_CustomDomain(t *testing.T) {
	os.Setenv("DOMAIN", "example.com")
	defer os.Unsetenv("DOMAIN")
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	if data["authorization_url"] != "http://example.com/oauth/authorize" {
		t.Errorf("Expected authorization_url with custom domain, got '%v'", data["authorization_url"])
	}
	if data["redirect_uri"] != "http://dev.example.com/callback" {
		t.Errorf("Expected redirect_uri with custom domain, got '%v'", data["redirect_uri"])
	}
}

func TestGetConfig_CustomClientID(t *testing.T) {
	os.Setenv("DEV_DASHBOARD_CLIENT_ID", "custom-dev-client")
	defer os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	if data["client_id"] != "custom-dev-client" {
		t.Errorf("Expected custom client_id, got '%v'", data["client_id"])
	}
}

func TestGetConfig_ExplicitIssuerURL(t *testing.T) {
	os.Setenv("ISSUER_URL", "https://auth.example.com")
	defer os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	if data["authorization_url"] != "https://auth.example.com/oauth/authorize" {
		t.Errorf("Expected authorization_url with explicit issuer, got '%v'", data["authorization_url"])
	}
	if data["token_url"] != "https://auth.example.com/oauth/token" {
		t.Errorf("Expected token_url with explicit issuer, got '%v'", data["token_url"])
	}
	if data["userinfo_url"] != "https://auth.example.com/oauth/userinfo" {
		t.Errorf("Expected userinfo_url with explicit issuer, got '%v'", data["userinfo_url"])
	}
	if data["revocation_url"] != "https://auth.example.com/oauth/revoke" {
		t.Errorf("Expected revocation_url with explicit issuer, got '%v'", data["revocation_url"])
	}
	if data["introspection_url"] != "https://auth.example.com/oauth/introspect" {
		t.Errorf("Expected introspection_url with explicit issuer, got '%v'", data["introspection_url"])
	}
}

func TestGetConfig_CustomDashboardURL(t *testing.T) {
	os.Setenv("DEV_DASHBOARD_URL", "https://dashboard.example.com")
	defer os.Unsetenv("DEV_DASHBOARD_URL")
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	if data["redirect_uri"] != "https://dashboard.example.com/callback" {
		t.Errorf("Expected redirect_uri with custom dashboard URL, got '%v'", data["redirect_uri"])
	}
}

func TestGetConfig_Scopes(t *testing.T) {
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_URL")
	defer os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	defer os.Unsetenv("DOMAIN")
	defer os.Unsetenv("ISSUER_URL")
	defer os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	scopes, ok := data["scopes"].([]interface{})
	if !ok {
		t.Fatal("Expected 'scopes' array")
	}
	if len(scopes) != 3 {
		t.Errorf("Expected 3 scopes, got %d", len(scopes))
	}

	scopeSet := make(map[string]bool)
	for _, s := range scopes {
		scopeSet[s.(string)] = true
	}
	for _, expected := range []string{"openid", "profile", "email"} {
		if !scopeSet[expected] {
			t.Errorf("Expected scope '%s' in config", expected)
		}
	}
}

func TestGetConfig_AllFieldsPresent(t *testing.T) {
	os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	os.Unsetenv("DOMAIN")
	os.Unsetenv("ISSUER_URL")
	os.Unsetenv("DEV_DASHBOARD_URL")
	defer os.Unsetenv("DEV_DASHBOARD_CLIENT_ID")
	defer os.Unsetenv("DOMAIN")
	defer os.Unsetenv("ISSUER_URL")
	defer os.Unsetenv("DEV_DASHBOARD_URL")

	h, _ := setupDevDashboardHandler(t)
	c, w := newGETContextWithClaims("/api/v1/dev-dashboard/config", nil, &auth.Claims{UserID: "u1"})
	h.GetConfig(c)

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	data := resp["data"].(map[string]interface{})

	requiredFields := []string{
		"client_id", "authorization_url", "token_url", "userinfo_url",
		"revocation_url", "introspection_url", "redirect_uri", "scopes",
		"app_name", "app_description",
	}
	for _, field := range requiredFields {
		if _, ok := data[field]; !ok {
			t.Errorf("Missing required field '%s' in config", field)
		}
	}
}
