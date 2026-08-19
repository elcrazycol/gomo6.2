package handlers

import "testing"

func TestContentTypeForUpload_NeverHTMLCapable(t *testing.T) {
	cases := map[string]string{
		"note.txt":         "text/plain",
		"readme.md":        "text/markdown",
		"photo.jpg":        "image/jpeg",
		"photo.jpeg":       "image/jpeg",
		"icon.png":         "image/png",
		"anim.gif":         "image/gif",
		"anim.webp":        "image/webp",
		"clip.mp4":         "video/mp4",
		"clip.m4v":         "video/mp4",
		"clip.webm":        "video/webm",
		"clip.mov":         "video/quicktime",
		"voice.mp3":        "audio/mpeg",
		"voice.ogg":        "audio/ogg",
		"voice.wav":        "audio/wav",
		"voice.flac":       "audio/flac",
		"voice.m4a":        "audio/mp4",
		"voice.aac":        "audio/aac",
		"doc.pdf":          "application/pdf",
		"UPPER.TXT":        "text/plain",
		"noext":            "application/octet-stream",
		"evil.svg":         "application/octet-stream",
		"evil.html":        "application/octet-stream",
		"evil.js":          "application/octet-stream",
		"evil.xml":         "application/octet-stream",
		"weird.unknownext": "application/octet-stream",
	}
	for filename, want := range cases {
		if got := contentTypeForUpload(filename); got != want {
			t.Errorf("contentTypeForUpload(%q) = %q, want %q", filename, got, want)
		}
	}
}

func TestSafeContentHeaders_DowngradesHTMLCapableTypes(t *testing.T) {
	cases := []struct {
		stored   string
		wantType string
		wantDisp string
	}{
		{"text/html", "application/octet-stream", "attachment"},
		{"text/html; charset=utf-8", "application/octet-stream", "attachment"},
		{"application/xhtml+xml", "application/octet-stream", "attachment"},
		{"image/svg+xml", "application/octet-stream", "attachment"},
		{"application/xml", "application/octet-stream", "attachment"},
		{"text/xml", "application/octet-stream", "attachment"},
		{"application/javascript", "application/octet-stream", "attachment"},
		{"application/json", "application/octet-stream", "attachment"},
		{"application/octet-stream", "application/octet-stream", "attachment"},
		{"", "application/octet-stream", "attachment"},
		// Safe inline media keeps its type and renders inline as before.
		{"image/jpeg", "image/jpeg", "inline"},
		{"image/png", "image/png", "inline"},
		{"image/webp", "image/webp", "inline"},
		{"video/mp4", "video/mp4", "inline"},
		{"video/webm", "video/webm", "inline"},
		{"audio/mpeg", "audio/mpeg", "inline"},
		{"application/pdf", "application/pdf", "inline"},
		{"text/plain", "text/plain", "inline"},
		{"image/jpeg; charset=binary", "image/jpeg; charset=binary", "inline"},
	}
	for _, tc := range cases {
		ctype, disp := safeContentHeaders(tc.stored)
		if ctype != tc.wantType || disp != tc.wantDisp {
			t.Errorf("safeContentHeaders(%q) = (%q, %q), want (%q, %q)",
				tc.stored, ctype, disp, tc.wantType, tc.wantDisp)
		}
	}
}
