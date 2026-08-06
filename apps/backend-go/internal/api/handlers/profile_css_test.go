package handlers

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

	// Non-string values must be left untouched.
	row2 := map[string]interface{}{"username_css": nil, "profile_badge_css": 42}
	sanitizeProfileCustomizationRow(row2)
	if row2["username_css"] != nil || row2["profile_badge_css"] != 42 {
		t.Fatalf("non-string values must be left as-is: %#v", row2)
	}
}

// ─── Write path: POST /profile_customization stores sanitized CSS ────────────

func TestUniversalPost_ProfileCustomization_SanitizesCSS(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	const cleanUsername = "color: red; text-shadow: 0 0 4px #ff4500"
	mock.ExpectQuery(`(?s).*INSERT INTO profile_customization \(.*\).*RETURNING \*`).
		WithArgs("u1", cleanUsername, "VIP", "color: #fff").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "username_css", "profile_badge_text", "profile_badge_css"}).
			AddRow("1", "u1", cleanUsername, "VIP", "color: #fff"))

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
