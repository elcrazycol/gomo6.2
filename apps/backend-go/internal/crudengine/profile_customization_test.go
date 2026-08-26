package crudengine

import (
	"encoding/json"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── Write path: POST /profile_customization stores sanitized CSS ────────────
//
// The sanitizers themselves live in the profiles domain package
// (profiles.SanitizeProfileCSS / SanitizeProfileBadgeText — see
// internal/profiles/profile_css_test.go); these tests pin the engine write
// path end to end: the upsert builder must run them BEFORE the row reaches
// the DB.

func TestEnginePost_ProfileCustomization_SanitizesCSS(t *testing.T) {
	h, mock := setupEngine(t)

	const cleanUsername = "color: red; text-shadow: 0 0 4px #ff4500"
	// Partial upsert: only the fields present in the body are written.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, username_css, profile_badge_text, profile_badge_css, updated_at\).*RETURNING \*`).
		WithArgs("u1", cleanUsername, "VIP", "color: #fff").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css", "background_url"}).
			AddRow("1", "u1", cleanUsername, "VIP", "color: #fff", nil))

	c, w := newRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":            "u1",
		"username_css":       "color: red; position: fixed; z-index: 999999; background: url(https://evil.example/leak); text-shadow: 0 0 4px #ff4500",
		"profile_badge_text": "V\tI\rP\n",
		"profile_badge_css":  "color: #fff; font-family: 'Arial'",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── background_url: write path stores only sanitized storage keys ──────────

func TestEnginePost_ProfileCustomization_SanitizesBackgroundURL(t *testing.T) {
	h, mock := setupEngine(t)

	// The absolute URL is sanitized down to an empty string before storage.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_url, updated_at\).*RETURNING \*`).
		WithArgs("u1", "").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css", "background_url"}).
			AddRow("1", "u1", nil, nil, nil, ""))

	c, w := newRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":        "u1",
		"background_url": "https://evil.example/tracker.png",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// A second write with a valid key stores it verbatim.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_url, updated_at\).*RETURNING \*`).
		WithArgs("u1", "u1/background_456.png").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css", "background_url"}).
			AddRow("1", "u1", nil, nil, nil, "u1/background_456.png"))

	c2, w2 := newRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":        "u1",
		"background_url": "u1/background_456.png",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c2)

	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
}

// ─── background_variant: owner-set display variant is allow-listed ──────────

func TestEnginePost_ProfileCustomization_SanitizesBackgroundVariant(t *testing.T) {
	h, mock := setupEngine(t)

	// An unknown variant falls back to the banner default.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_variant, updated_at\).*RETURNING \*`).
		WithArgs("u1", "banner").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "background_variant"}).
			AddRow("1", "u1", "banner"))

	c, w := newRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":            "u1",
		"background_variant": "evil-overlay",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// A valid variant is stored verbatim.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_variant, updated_at\).*RETURNING \*`).
		WithArgs("u1", "page").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "background_variant"}).
			AddRow("1", "u1", "page"))

	c2, w2 := newRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":            "u1",
		"background_variant": "page",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c2)

	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
}

// ─── Partial upserts: toggling the theme must not wipe other fields ─────────

func TestEnginePost_ProfileCustomization_PartialThemeToggle(t *testing.T) {
	h, mock := setupEngine(t)

	// The theme toggle sends ONLY user_id + theme_enabled. The partial upsert
	// must touch just that column — background_url and theme_tokens (already
	// stored) must survive.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, theme_enabled, updated_at\).*ON CONFLICT \(user_id\) DO UPDATE SET theme_enabled = \$2, updated_at = NOW\(\).*RETURNING \*`).
		WithArgs("u1", true).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "theme_enabled", "background_url", "theme_tokens"}).
			AddRow("1", "u1", true, "u1/background_1.png", `{"--primary":"120 60% 35%"}`))

	c, w := newRequestContext("POST", "/api/v1/profile_customization", map[string]interface{}{
		"user_id":       "u1",
		"theme_enabled": true,
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Data["background_url"] != "u1/background_1.png" {
		t.Fatalf("background_url must survive a theme toggle, got %v", resp.Data["background_url"])
	}
}

// ─── Read path: GET /profile_customization neutralizes legacy rows ───────────

func TestEngineGet_ProfileCustomization_SanitizesLegacyRows(t *testing.T) {
	h, mock := setupEngine(t)

	mock.ExpectQuery(`SELECT \* FROM profile_customization WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css"}).
			AddRow("1", "u1", "color: red; position: fixed; z-index: 999999", "V\tI\rP", "background: url(https://evil.example/x)"))

	c, w := newRequestContext("GET", "/api/v1/profile_customization", nil, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c)

	if w.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Data []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if len(resp.Data) != 1 {
		t.Fatalf("expected 1 row, got %d", len(resp.Data))
	}
	if resp.Data[0]["username_css"] != "color: red" {
		t.Fatalf("expected sanitized username_css, got %v", resp.Data[0]["username_css"])
	}
	if resp.Data[0]["profile_badge_css"] != "" {
		t.Fatalf("expected sanitized badge_css, got %v", resp.Data[0]["profile_badge_css"])
	}
	if resp.Data[0]["profile_badge_text"] != "VIP" {
		t.Fatalf("expected sanitized badge_text, got %v", resp.Data[0]["profile_badge_text"])
	}
}
