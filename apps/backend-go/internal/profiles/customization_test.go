package profiles

import (
	"fmt"
	"strings"
	"testing"
)

func TestSanitizeProfileBackgroundURL(t *testing.T) {
	valid := []string{
		"u1/background_123.webp",
		"550e8400-e29b-41d4-a716-446655440000/bg.png",
		"u1/folder/image.avif",
	}
	for _, s := range valid {
		if got := SanitizeProfileBackgroundURL(s); got != s {
			t.Fatalf("expected %q to survive sanitization, got %q", s, got)
		}
	}

	invalid := map[string]string{
		"https://evil.example/x.png":   "absolute http URL",
		"http://evil.example/x.png":    "absolute http URL",
		"data:text/html;base64,xxx":    "data URI",
		"//evil.example/x.png":         "protocol-relative URL",
		"u1/background.png?track=1":    "query string",
		"u1/background.png#frag":       "fragment",
		"u1/../secret.png":             "path traversal",
		"u1/background.png\n<script>":  "control characters",
		"u1/back\"ground.png":          "double quote",
		"javascript:alert(1)":          "javascript scheme",
		"u1/background with space.png": "whitespace",
		"u1/background.png'":           "single quote",
	}
	for s, reason := range invalid {
		if got := SanitizeProfileBackgroundURL(s); got != "" {
			t.Fatalf("expected %q (%s) to be rejected, got %q", s, reason, got)
		}
	}

	// Empty input stays empty; over-long input is capped then validated.
	if got := SanitizeProfileBackgroundURL(""); got != "" {
		t.Fatalf("expected empty input to stay empty, got %q", got)
	}
	long := "u1/bg_" + strings.Repeat("a", maxProfileBackgroundURLLen) + ".png"
	if got := SanitizeProfileBackgroundURL(long); len(got) > maxProfileBackgroundURLLen {
		t.Fatalf("sanitized output must not exceed cap, got %d", len(got))
	}
}

func TestSanitizeProfileBackgroundVariant(t *testing.T) {
	for _, v := range []string{"banner", "card", "page", "page_dim"} {
		if got := SanitizeProfileBackgroundVariant(v); got != v {
			t.Fatalf("expected %q to survive, got %q", v, got)
		}
	}
	if got := SanitizeProfileBackgroundVariant("evil"); got != "banner" {
		t.Fatalf("expected unknown variant to fall back to banner, got %q", got)
	}
}

func TestSanitizeProfileThemeTokens(t *testing.T) {
	// Allow-listed keys with HSL triplets survive.
	in := map[string]interface{}{
		"--primary":    "120 60% 35%",
		"--background": "120 20% 95%",
		"--ring":       "200 70% 50%",
	}
	out := SanitizeProfileThemeTokens(in)
	if out["--primary"] != "120 60% 35%" {
		t.Fatalf("expected --primary to survive, got %q", out["--primary"])
	}
	if out["--background"] != "120 20% 95%" {
		t.Fatalf("expected --background to survive, got %q", out["--background"])
	}
	if len(out) != 3 {
		t.Fatalf("expected 3 tokens, got %d", len(out))
	} // Non-allow-listed keys, non-HSL values and non-strings are dropped.
	bad := map[string]interface{}{
		"--position":          "fixed",
		"--primary":           "red",
		"--primary-url":       "url(https://evil.example/x)",
		"--primary-important": "120 60% 35% !important",
		"--muted-foreground":  "calc(100% - 1px)",
		"--ring":              42,
		"--nope":              "120 60% 35%",
	}
	out2 := SanitizeProfileThemeTokens(bad)
	if len(out2) != 0 {
		t.Fatalf("expected all bad tokens dropped, got %v", out2)
	}

	// Oversized payloads are capped.
	huge := map[string]interface{}{}
	for i := 0; i < maxThemeTokens+10; i++ {
		huge["--primary"] = "120 60% 35%"
		huge[fmt.Sprintf("--custom%d", i)] = "120 60% 35%"
	}
	out3 := SanitizeProfileThemeTokens(huge)
	if len(out3) > maxThemeTokens {
		t.Fatalf("expected cap at %d, got %d", maxThemeTokens, len(out3))
	}

	// Non-object payloads yield an empty map.
	if got := SanitizeProfileThemeTokens(nil); len(got) != 0 {
		t.Fatalf("expected empty for nil, got %v", got)
	}
	if got := SanitizeProfileThemeTokens("nope"); len(got) != 0 {
		t.Fatalf("expected empty for string, got %v", got)
	}

	// The write path hands over a JSON blob (normalizeJSONValuesForDB
	// marshals nested objects to []byte) — that must sanitize the same way.
	blob := []byte(`{"--primary":"120 60% 35%","--background":"120 20% 95%","--position":"fixed","--evil":"url(https://x)"}`)
	out4 := SanitizeProfileThemeTokens(blob)
	if out4["--primary"] != "120 60% 35%" || out4["--background"] != "120 20% 95%" {
		t.Fatalf("expected blob tokens to survive, got %v", out4)
	}
	if len(out4) != 2 {
		t.Fatalf("expected 2 tokens from blob, got %d: %v", len(out4), out4)
	}
	if got := SanitizeProfileThemeTokens([]byte(`not json`)); len(got) != 0 {
		t.Fatalf("expected empty for invalid blob, got %v", got)
	}

	// map[string]string input (read path after sanitize returns this shape).
	out5 := SanitizeProfileThemeTokens(map[string]string{"--primary": "120 60% 35%", "--position": "fixed"})
	if out5["--primary"] != "120 60% 35%" || len(out5) != 1 {
		t.Fatalf("expected map[string]string sanitized, got %v", out5)
	}
}
