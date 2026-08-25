package universal

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── sanitizeProfileCSS: legitimate styles are preserved ─────────────────────

func TestSanitizeProfileCSS_KeepsPresetStyles(t *testing.T) {
	cases := []struct{ name, css string }{
		{"solid color", "color: #ff4500"},
		{"text shadow", "color: #ffd700; text-shadow: 0 0 3px #ffd700, 0 1px 2px rgba(0,0,0,0.5)"},
		{"gradient text", "background: linear-gradient(90deg, #667eea, #764ba2); -webkit-background-clip: text; -webkit-text-fill-color: transparent"},
		{"sunset with animation", "background: linear-gradient(90deg, #ff6b35, #f7c948, #ff6b35); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-size: 200% auto; animation: gradient-shift 3s linear infinite"},
		{"badge gradient", "color: #fff; background: linear-gradient(135deg, #2563eb, #1d4ed8); font-weight: bold; box-shadow: 0 0 6px rgba(37,99,235,0.3)"},
		{"italic", "color: #b8b8d0; font-style: italic"},
		{"background color", "background-color: #1a1a2e; border-radius: 8px"},
		{"backdrop filter", "color: #fff; backdrop-filter: blur(4px)"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeProfileCSS(tc.css)
			if got != tc.css {
				t.Fatalf("sanitizer must keep legit CSS %q, got %q", tc.css, got)
			}
		})
	}
}

// ─── sanitizeProfileCSS: attacks are stripped ────────────────────────────────

func TestSanitizeProfileCSS_StripsAttacks(t *testing.T) {
	cases := []struct{ name, css, want string }{
		{"position overlay", "color: red; position: fixed; z-index: 999999", "color: red"},
		{"url exfil", "background: url(https://evil.example/leak)", ""},
		{"url with space", "background: url (https://evil.example/x)", ""},
		{"import", "@import url(https://evil.example/x); color: red", ""},
		{"keyframes", "@keyframes spin { to { transform: rotate(360deg) } }", ""},
		{"expression", "color: expression(alert(1))", ""},
		{"behavior", "behavior: url(#default#time2)", ""},
		{"moz binding", "-moz-binding: url(data:text/html;base64,xxx)", ""},
		{"css escape url", "background: u\\72l(https://evil.example/x)", ""},
		{"css escape prop", "\\70 osition: fixed", ""},
		{"comment obfuscation", "pos/**/ition: fixed", ""},
		{"important", "color: red !important", ""},
		{"important with space", "color: red ! important", ""},
		{"important with newline", "color: red !\nimportant", ""},
		{"url with newline", "background: url(\nhttps://evil.example/x\n)", ""},
		{"expression with space", "color: exp ression(alert(1))", ""},
		{"content injection", "content: 'hacked'", ""},
		{"font family", "font-family: 'Comic Sans'", ""},
		{"display none", "display: none", ""},
		{"transform overlay", "transform: translateY(-9999px)", ""},
		{"attr hook", "background: attr(data-x)", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := sanitizeProfileCSS(tc.css)
			if got != tc.want {
				t.Fatalf("sanitize(%q) = %q, want %q", tc.css, got, tc.want)
			}
		})
	}
}

func TestSanitizeProfileCSS_Idempotent(t *testing.T) {
	clean := "color: #fff; background: linear-gradient(90deg, #ff0000, #0000ff)"
	once := sanitizeProfileCSS(clean)
	twice := sanitizeProfileCSS(once)
	if once != clean {
		t.Fatalf("first pass must not change clean CSS: got %q", once)
	}
	if twice != once {
		t.Fatalf("sanitizer must be idempotent: once=%q twice=%q", once, twice)
	}
}

func TestSanitizeProfileCSS_LengthCap(t *testing.T) {
	long := "color: red; " + strings.Repeat("padding: 1px; ", 2000)
	got := sanitizeProfileCSS(long)
	if len(long) <= maxProfileCSSLen {
		t.Fatal("test input must exceed the cap to be meaningful")
	}
	if len(got) > maxProfileCSSLen {
		t.Fatalf("sanitized output must not exceed cap, got %d", len(got))
	}
}

// ─── sanitizeProfileBadgeText ────────────────────────────────────────────────

func TestSanitizeProfileBadgeText(t *testing.T) {
	if got := sanitizeProfileBadgeText("VIP"); got != "VIP" {
		t.Fatalf("expected VIP, got %q", got)
	}
	if got := sanitizeProfileBadgeText("V\tI\rP\n"); got != "VIP" {
		t.Fatalf("expected control chars stripped, got %q", got)
	}
	if got := sanitizeProfileBadgeText(strings.Repeat("x", 200)); len([]rune(got)) != maxProfileBadgeTextLen {
		t.Fatalf("expected cap %d, got %d", maxProfileBadgeTextLen, len([]rune(got)))
	}
	// Bidi controls (RLO etc.) must be stripped so a badge cannot render
	// misleadingly.
	if got := sanitizeProfileBadgeText("A\u202EB"); got != "AB" {
		t.Fatalf("expected bidi controls stripped, got %q", got)
	}
}

// ─── sanitizeProfileCustomizationRow (read path, legacy rows) ────────────────

func TestSanitizeProfileCustomizationRow(t *testing.T) {
	row := map[string]interface{}{
		"username_css":       "color: red; position: fixed",
		"profile_badge_css":  "background: url(https://evil.example/x)",
		"profile_badge_text": "B\tADGE",
		"background_url":     "https://evil.example/tracker.png",
		"background_variant": "position: fixed",
	}
	sanitizeProfileCustomizationRow(row)
	if row["username_css"] != "color: red" {
		t.Fatalf("unexpected username_css: %v", row["username_css"])
	}
	if row["profile_badge_css"] != "" {
		t.Fatalf("unexpected badge_css: %v", row["profile_badge_css"])
	}
	if row["profile_badge_text"] != "BADGE" {
		t.Fatalf("unexpected badge_text: %v", row["profile_badge_text"])
	}
	if row["background_url"] != "" {
		t.Fatalf("unexpected background_url: %v", row["background_url"])
	}
	if row["background_variant"] != "banner" {
		t.Fatalf("unexpected background_variant: %v", row["background_variant"])
	}

	// Valid variants survive the read path; unknown ones fall back to banner.
	for _, v := range []string{"banner", "card", "page", "page_dim"} {
		rv := map[string]interface{}{"background_variant": v}
		sanitizeProfileCustomizationRow(rv)
		if rv["background_variant"] != v {
			t.Fatalf("valid variant %q must survive, got %v", v, rv["background_variant"])
		}
	}

	// Valid storage keys survive the read path.
	row3 := map[string]interface{}{"background_url": "u1/background_1.webp"}
	sanitizeProfileCustomizationRow(row3)
	if row3["background_url"] != "u1/background_1.webp" {
		t.Fatalf("valid background_url must survive: %v", row3["background_url"])
	}

	// Non-string values must be left untouched.
	row2 := map[string]interface{}{"username_css": nil, "profile_badge_css": 42, "background_url": 42}
	sanitizeProfileCustomizationRow(row2)
	if row2["username_css"] != nil || row2["profile_badge_css"] != 42 || row2["background_url"] != 42 {
		t.Fatalf("non-string values must be left as-is: %#v", row2)
	}
}

// ─── Write path: POST /profile_customization stores sanitized CSS ────────────

func TestUniversalPost_ProfileCustomization_SanitizesCSS(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	const cleanUsername = "color: red; text-shadow: 0 0 4px #ff4500"
	// Partial upsert: only the fields present in the body are written.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, username_css, profile_badge_text, profile_badge_css, updated_at\).*RETURNING \*`).
		WithArgs("u1", cleanUsername, "VIP", "color: #fff").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css", "background_url"}).
			AddRow("1", "u1", cleanUsername, "VIP", "color: #fff", nil))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]string{
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

func TestUniversalPost_ProfileCustomization_SanitizesBackgroundURL(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The absolute URL is sanitized down to an empty string before storage.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_url, updated_at\).*RETURNING \*`).
		WithArgs("u1", "").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css", "background_url"}).
			AddRow("1", "u1", nil, nil, nil, ""))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]string{
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

	c2, w2 := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":        "u1",
		"background_url": "u1/background_456.png",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c2)

	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
}

// ─── background_variant: owner-set display variant is allow-listed ──────────

func TestUniversalPost_ProfileCustomization_SanitizesBackgroundVariant(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// An unknown variant falls back to the banner default.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, background_variant, updated_at\).*RETURNING \*`).
		WithArgs("u1", "banner").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "background_variant"}).
			AddRow("1", "u1", "banner"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]string{
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

	c2, w2 := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]string{
		"user_id":            "u1",
		"background_variant": "page",
	}, &auth.Claims{UserID: "u1"})
	h.HandleTableRequest(c2)

	if w2.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", w2.Code, w2.Body.String())
	}
}

// ─── Partial upserts: toggling the theme must not wipe other fields ─────────

func TestUniversalPost_ProfileCustomization_PartialThemeToggle(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The theme toggle sends ONLY user_id + theme_enabled. The partial upsert
	// must touch just that column — background_url and theme_tokens (already
	// stored) must survive.
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(user_id, theme_enabled, updated_at\).*ON CONFLICT \(user_id\) DO UPDATE SET theme_enabled = \$2, updated_at = NOW\(\).*RETURNING \*`).
		WithArgs("u1", true).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "theme_enabled", "background_url", "theme_tokens"}).
			AddRow("1", "u1", true, "u1/background_1.png", `{"--primary":"120 60% 35%"}`))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_customization", map[string]interface{}{
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

// ─── sanitizeProfileBackgroundURL ───────────────────────────────────────────

// ─── Read path: GET /profile_customization neutralizes legacy rows ───────────

func TestUniversalGet_ProfileCustomization_SanitizesLegacyRows(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM profile_customization WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css"}).
			AddRow("1", "u1", "color: red; position: fixed; z-index: 999999", "V\tI\rP", "background: url(https://evil.example/x)"))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_customization", nil, &auth.Claims{UserID: "u1"})
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

// ─── Profile auto-theme tokens ───────────────────────────────────────────────

func TestSanitizeProfileCustomizationRow_ThemeTokens(t *testing.T) {
	row := map[string]interface{}{
		"theme_tokens": map[string]interface{}{
			"--primary":  "120 60% 35%",
			"--position": "fixed",
			"--evil":     "url(https://x)",
		},
	}
	sanitizeProfileCustomizationRow(row)
	tokens, ok := row["theme_tokens"].(map[string]string)
	if !ok {
		t.Fatalf("expected theme_tokens map, got %T", row["theme_tokens"])
	}
	if tokens["--primary"] != "120 60% 35%" {
		t.Fatalf("expected --primary to survive, got %q", tokens["--primary"])
	}
	if len(tokens) != 1 {
		t.Fatalf("expected only 1 token, got %d: %v", len(tokens), tokens)
	}
}
