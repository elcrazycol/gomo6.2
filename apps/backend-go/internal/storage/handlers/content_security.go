package handlers

import (
	"path/filepath"
	"strings"
)

// contentTypeForUpload derives the stored Content-Type from the file extension
// (server-controlled), never from the client-supplied multipart part header
// (H2.1). This closes the stored-XSS vector where a client uploaded HTML bytes
// under an allowed extension while declaring Content-Type: text/html — such a
// type can now never be stored, and safe inline types are only the image/audio
// formats the platform legitimately hosts. SVG is deliberately absent: it is
// not an allowed upload extension and must never map to image/svg+xml.
func contentTypeForUpload(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".mp3":
		return "audio/mpeg"
	case ".ogg":
		return "audio/ogg"
	case ".wav":
		return "audio/wav"
	case ".flac":
		return "audio/flac"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".pdf":
		return "application/pdf"
	case ".txt":
		return "text/plain"
	case ".md":
		return "text/markdown"
	default:
		return "application/octet-stream"
	}
}

// safeContentHeaders decides how a stored object may be served. MIME types in
// the inline allow-list are rendered in the browser as before; every other type
// — including legacy objects stored with a client-forged text/html,
// image/svg+xml, application/xml or application/javascript Content-Type — is
// downgraded to application/octet-stream with Content-Disposition: attachment,
// so the bytes can never be interpreted as a document in the app origin.
// The check uses the media type only (parameters like charset are ignored).
func safeContentHeaders(storedContentType string) (ctype string, disposition string) {
	base := storedContentType
	if i := strings.IndexByte(base, ';'); i >= 0 {
		base = base[:i]
	}
	base = strings.ToLower(strings.TrimSpace(base))
	switch base {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
		"audio/mpeg", "audio/ogg", "audio/wav", "audio/flac", "audio/mp4", "audio/aac",
		"video/mp4", "video/webm", "video/ogg",
		"application/pdf", "text/plain", "text/markdown":
		return storedContentType, "inline"
	default:
		return "application/octet-stream", "attachment"
	}
}
