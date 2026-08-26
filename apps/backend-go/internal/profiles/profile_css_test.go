package profiles

import (
	"strings"
	"testing"
)

// ─── SanitizeProfileCSS: legitimate styles are preserved ─────────────────────

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
			got := SanitizeProfileCSS(tc.css)
			if got != tc.css {
				t.Fatalf("sanitizer must keep legit CSS %q, got %q", tc.css, got)
			}
		})
	}
}

// ─── SanitizeProfileCSS: attacks are stripped ───────────────────────────────

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
			got := SanitizeProfileCSS(tc.css)
			if got != tc.want {
				t.Fatalf("sanitize(%q) = %q, want %q", tc.css, got, tc.want)
			}
		})
	}
}

func TestSanitizeProfileCSS_Idempotent(t *testing.T) {
	clean := "color: #fff; background: linear-gradient(90deg, #ff0000, #0000ff)"
	once := SanitizeProfileCSS(clean)
	twice := SanitizeProfileCSS(once)
	if once != clean {
		t.Fatalf("first pass must not change clean CSS: got %q", once)
	}
	if twice != once {
		t.Fatalf("sanitizer must be idempotent: once=%q twice=%q", once, twice)
	}
}

func TestSanitizeProfileCSS_LengthCap(t *testing.T) {
	long := "color: red; " + strings.Repeat("padding: 1px; ", 2000)
	got := SanitizeProfileCSS(long)
	if len(long) <= maxProfileCSSLen {
		t.Fatal("test input must exceed the cap to be meaningful")
	}
	if len(got) > maxProfileCSSLen {
		t.Fatalf("sanitized output must not exceed cap, got %d", len(got))
	}
}

// ─── SanitizeProfileBadgeText ───────────────────────────────────────────────

func TestSanitizeProfileBadgeText(t *testing.T) {
	if got := SanitizeProfileBadgeText("VIP"); got != "VIP" {
		t.Fatalf("expected VIP, got %q", got)
	}
	if got := SanitizeProfileBadgeText("V\tI\rP\n"); got != "VIP" {
		t.Fatalf("expected control chars stripped, got %q", got)
	}
	if got := SanitizeProfileBadgeText(strings.Repeat("x", 200)); len([]rune(got)) != maxProfileBadgeTextLen {
		t.Fatalf("expected cap %d, got %d", maxProfileBadgeTextLen, len([]rune(got)))
	}
	// Bidi controls (RLO etc.) must be stripped so a badge cannot render
	// misleadingly.
	if got := SanitizeProfileBadgeText("A\u202EB"); got != "AB" {
		t.Fatalf("expected bidi controls stripped, got %q", got)
	}
}

// ─── SanitizeProfileCustomizationRow (read path, legacy rows) ───────────────

func TestSanitizeProfileCustomizationRow(t *testing.T) {
	row := map[string]interface{}{
		"username_css":       "color: red; position: fixed",
		"profile_badge_css":  "background: url(https://evil.example/x)",
		"profile_badge_text": "B\tADGE",
		"background_url":     "https://evil.example/tracker.png",
		"background_variant": "position: fixed",
	}
	SanitizeProfileCustomizationRow(row)
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
		SanitizeProfileCustomizationRow(rv)
		if rv["background_variant"] != v {
			t.Fatalf("valid variant %q must survive, got %v", v, rv["background_variant"])
		}
	}

	// Valid storage keys survive the read path.
	row3 := map[string]interface{}{"background_url": "u1/background_1.webp"}
	SanitizeProfileCustomizationRow(row3)
	if row3["background_url"] != "u1/background_1.webp" {
		t.Fatalf("valid background_url must survive: %v", row3["background_url"])
	}

	// Non-string values must be left untouched.
	row2 := map[string]interface{}{"username_css": nil, "profile_badge_css": 42, "background_url": 42}
	SanitizeProfileCustomizationRow(row2)
	if row2["username_css"] != nil || row2["profile_badge_css"] != 42 || row2["background_url"] != 42 {
		t.Fatalf("non-string values must be left as-is: %#v", row2)
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
	SanitizeProfileCustomizationRow(row)
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
