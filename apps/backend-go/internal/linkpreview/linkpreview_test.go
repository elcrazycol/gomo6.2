package linkpreview

import (
	"net"
	"net/url"
	"strings"
	"testing"
)

func mustURL(t *testing.T, raw string) *url.URL {
	t.Helper()
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return parsed
}

func TestParseOpenGraph(t *testing.T) {
	document := `<!doctype html><html><head>
		<title>Fallback title</title>
		<meta property="og:title" content="Заголовок &amp; ещё" />
		<meta property="og:description" content="Описание страницы" />
		<meta property="og:site_name" content="Example" />
		<meta property="og:image" content="/img/cover.png" />
	</head><body></body></html>`
	preview := Parse(document, mustURL(t, "https://example.com/post/1"))
	if preview.Title != "Заголовок & ещё" {
		t.Fatalf("unexpected title %q", preview.Title)
	}
	if preview.Description != "Описание страницы" {
		t.Fatalf("unexpected description %q", preview.Description)
	}
	if preview.SiteName != "Example" {
		t.Fatalf("unexpected site name %q", preview.SiteName)
	}
	if preview.Image != "https://example.com/img/cover.png" {
		t.Fatalf("unexpected image %q", preview.Image)
	}
}

func TestParseFallsBackToTwitterAndTitle(t *testing.T) {
	document := `<html><head>
		<meta name="twitter:title" content="Twitter title">
		<meta name="twitter:description" content="Twitter description">
		<meta name="twitter:image" content="https://cdn.example.com/x.jpg">
	</head><body></body></html>`
	preview := Parse(document, mustURL(t, "https://example.com/"))
	if preview.Title != "Twitter title" || preview.Description != "Twitter description" {
		t.Fatalf("unexpected twitter fallback: %+v", preview)
	}
	if preview.Image != "https://cdn.example.com/x.jpg" {
		t.Fatalf("unexpected image %q", preview.Image)
	}

	plain := Parse(`<html><head><title>Only title</title></head></html>`, mustURL(t, "https://a.example/"))
	if plain.Title != "Only title" {
		t.Fatalf("expected title fallback, got %q", plain.Title)
	}
	if plain.SiteName != "a.example" {
		t.Fatalf("expected host site name, got %q", plain.SiteName)
	}
}

func TestParseTruncatesLongFields(t *testing.T) {
	long := strings.Repeat("a", 500)
	preview := Parse(`<meta property="og:title" content="`+long+`">`, mustURL(t, "https://example.com/"))
	if len([]rune(preview.Title)) != maxTitleRunes {
		t.Fatalf("expected title truncated to %d, got %d", maxTitleRunes, len([]rune(preview.Title)))
	}
}

func TestIsBlockedIP(t *testing.T) {
	blocked := []string{"127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1"}
	for _, raw := range blocked {
		if !isBlockedIP(net.ParseIP(raw)) {
			t.Errorf("expected %s to be blocked", raw)
		}
	}
	allowed := []string{"8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"}
	for _, raw := range allowed {
		if isBlockedIP(net.ParseIP(raw)) {
			t.Errorf("expected %s to be allowed", raw)
		}
	}
}

func TestValidateURL(t *testing.T) {
	for _, raw := range []string{"ftp://example.com", "file:///etc/passwd", "javascript:alert(1)", "https://"} {
		if err := validateURL(mustURL(t, raw)); err == nil {
			t.Errorf("expected %q to be rejected", raw)
		}
	}
	for _, raw := range []string{"https://example.com/x", "http://example.com"} {
		if err := validateURL(mustURL(t, raw)); err != nil {
			t.Errorf("expected %q to be allowed: %v", raw, err)
		}
	}
}
