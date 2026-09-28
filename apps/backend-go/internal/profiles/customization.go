package profiles

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// maxProfileBackgroundURLLen caps the raw length of a profile background
// storage key before validation.
const maxProfileBackgroundURLLen = 512

// safeStorageKeyRE matches storage keys as uploaded by the storage API:
// <user-id>/<filename> with slug-ish names and dot extensions.
var safeStorageKeyRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.\-/]*$`)

// SanitizeProfileBackgroundURL validates that a profile background value is a
// bare relative storage key (e.g. "<uuid>/background_123.webp"). Absolute
// URLs (http/https/data:, protocol-relative, control characters, path
// traversal) are rejected — the image is always served from our own storage —
// because a stored absolute URL would turn into an <img> src pointing
// anywhere (tracking pixels, phishing, content injection) on every viewer's
// screen. Applied on write AND read so legacy or forged rows never render.
func SanitizeProfileBackgroundURL(s string) string {
	if s == "" {
		return ""
	}
	if len(s) > maxProfileBackgroundURLLen {
		s = s[:maxProfileBackgroundURLLen]
	}
	// Whitespace and quotes can smuggle URL schemes or attributes.
	if strings.ContainsAny(s, " \t\n\r\f\"'<>`") {
		return ""
	}
	// Absolute / protocol-relative URLs and data: URIs are never admitted.
	if strings.Contains(s, "://") || strings.HasPrefix(s, "//") || strings.HasPrefix(s, "data:") {
		return ""
	}
	// Path traversal and anything outside the safe character set.
	if strings.Contains(s, "..") || !safeStorageKeyRE.MatchString(s) {
		return ""
	}
	return s
}

// allowedThemeTokenVars is the allow-list of CSS variables a profile auto-
// theme may override. It mirrors the tokens the frontend theme registry emits
// (see apps/web/src/theme/tokens.ts) — only these variables may come from
// profile_customization, so a stored JSONB payload can never inject arbitrary
// CSS onto a viewer's profile page. Any other --* key is dropped.
var allowedThemeTokenVars = map[string]bool{
	"--background":              true,
	"--foreground":              true,
	"--card":                    true,
	"--card-foreground":         true,
	"--popover":                 true,
	"--popover-foreground":      true,
	"--primary":                 true,
	"--primary-foreground":      true,
	"--secondary":               true,
	"--secondary-foreground":    true,
	"--accent":                  true,
	"--accent-foreground":       true,
	"--destructive":             true,
	"--destructive-foreground":  true,
	"--success":                 true,
	"--success-foreground":      true,
	"--warning":                 true,
	"--warning-foreground":      true,
	"--info":                    true,
	"--info-foreground":         true,
	"--muted":                   true,
	"--muted-foreground":        true,
	"--border":                  true,
	"--input":                   true,
	"--ring":                    true,
	"--board-header":            true,
	"--board-header-foreground": true,
	"--thread-hover":            true,
	"--post-header":             true,
	"--quote-text":              true,
	"--link-text":               true,
	"--link":                    true,
}

// themeTokenHSLRE matches the legacy token format "120 60% 35%" (hue 0-360,
// saturation/lightness 0-100%). Kept so profiles generated before the OKLCH
// migration still render.
var themeTokenHSLRE = regexp.MustCompile(`^[0-9]{1,3} [0-9]{1,3}% [0-9]{1,3}%$`)

// themeTokenOklchRE matches the current bare-OKLCH triplet "0.627 0.131 145.2"
// (lightness 0-1, chroma 0-0.5, hue 0-360). Digit-only parts make it impossible
// to smuggle url(), calc(), var() or any other CSS through a token value.
var themeTokenOklchRE = regexp.MustCompile(`^[0-9]+(?:\.[0-9]+)? [0-9]+(?:\.[0-9]+)? [0-9]+(?:\.[0-9]+)?$`)

// isValidThemeTokenValue accepts either token format and enforces numeric
// ranges so a forged payload cannot store an out-of-gamut or absurd value.
func isValidThemeTokenValue(s string) bool {
	if themeTokenHSLRE.MatchString(s) {
		return true
	}
	if !themeTokenOklchRE.MatchString(s) {
		return false
	}
	parts := strings.Split(s, " ")
	if len(parts) != 3 {
		return false
	}
	l, err1 := strconv.ParseFloat(parts[0], 64)
	c, err2 := strconv.ParseFloat(parts[1], 64)
	h, err3 := strconv.ParseFloat(parts[2], 64)
	if err1 != nil || err2 != nil || err3 != nil {
		return false
	}
	return l >= 0 && l <= 1 && c >= 0 && c <= 0.5 && h >= 0 && h <= 360
}

// maxThemeTokens caps the number of variables in a profile theme payload.
const maxThemeTokens = 64

// SanitizeProfileThemeTokens validates a profile auto-theme payload (a JSON
// object of CSS variables → HSL triplets). Only allow-listed --* keys with
// well-formed HSL values survive; anything else is dropped. Applied on write
// AND read so legacy or forged rows never inject unexpected CSS.
//
// Accepts either a decoded map (generic CRUD read path) or a raw JSON blob
// (write path: normalizeJSONValuesForDB marshals nested objects to []byte).
func SanitizeProfileThemeTokens(v interface{}) map[string]string {
	out := map[string]string{}
	var m map[string]interface{}
	switch t := v.(type) {
	case map[string]interface{}:
		m = t
	case map[string]string:
		for key, val := range t {
			if len(out) >= maxThemeTokens {
				break
			}
			if !allowedThemeTokenVars[key] || !isValidThemeTokenValue(val) {
				continue
			}
			out[key] = val
		}
		return out
	case []byte:
		if err := json.Unmarshal(t, &m); err != nil {
			return out
		}
	case string:
		if err := json.Unmarshal([]byte(t), &m); err != nil {
			return out
		}
	default:
		return out
	}
	for key, val := range m {
		if len(out) >= maxThemeTokens {
			break
		}
		if !allowedThemeTokenVars[key] {
			continue
		}
		s, ok := val.(string)
		if !ok || !isValidThemeTokenValue(s) {
			continue
		}
		out[key] = s
	}
	return out
}

// allowedProfileBackgroundVariants is the allow-list of owner-set display
// variants for their profile background. Any other value falls back to the
// default (banner).
var allowedProfileBackgroundVariants = map[string]bool{
	"banner":   true,
	"card":     true,
	"page":     true,
	"page_dim": true,
}

// SanitizeProfileBackgroundVariant validates an owner-set background display
// variant against the allow-list.
func SanitizeProfileBackgroundVariant(s string) string {
	if allowedProfileBackgroundVariants[s] {
		return s
	}
	return "banner"
}
