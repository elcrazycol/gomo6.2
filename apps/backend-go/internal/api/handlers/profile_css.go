package handlers

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// L6: username_css / profile_badge_css are user-controlled CSS that is rendered
// inline (via the style attribute) on every viewer's screen — profile pages,
// hover cards, wall posts, chat. Before sanitization an attacker could store
// `position: fixed; z-index: 999999` (phishing overlay / UI redressing),
// `background: url(https://attacker/)` (CSS exfiltration) or legacy script
// hooks (expression/behavior/-moz-binding). The sanitizer below is applied on
// every write AND every read so both new values and legacy rows are
// neutralized. It is intentionally conservative: only self-contained color,
// typography and background styling survives.

// maxProfileCSSLen caps the raw size of a customization CSS field before
// parsing — generous for real usage while bounding work per request.
const maxProfileCSSLen = 4096

// maxProfileBadgeTextLen caps the badge text server-side (the in-app editor
// already limits it to 20 characters).
const maxProfileBadgeTextLen = 60

// maxProfileBackgroundURLLen caps the raw length of a profile background
// storage key before validation.
const maxProfileBackgroundURLLen = 512

// safeStorageKeyRE matches storage keys as uploaded by the storage API:
// <user-id>/<filename> with slug-ish names and dot extensions.
var safeStorageKeyRE = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_.\-/]*$`)

// sanitizeProfileBackgroundURL validates that a profile background value is a
// bare relative storage key (e.g. "<uuid>/background_123.webp"). Absolute
// URLs (http/https/data:, protocol-relative, control characters, path
// traversal) are rejected — the image is always served from our own storage —
// because a stored absolute URL would turn into an <img> src pointing
// anywhere (tracking pixels, phishing, content injection) on every viewer's
// screen. Applied on write AND read so legacy or forged rows never render.
func sanitizeProfileBackgroundURL(s string) string {
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

// allowedProfileCSSProps is the server-side allow-list of CSS properties.
// Anything that could overlay the page (position, z-index, transform, float),
// hide content (display, visibility), load remote resources (url()) or run
// script (expression, behavior, -moz-binding) is never admitted. The list
// covers everything the in-app editors and presets generate — including
// gradient text and animations — and animation values can only reference
// document-level @keyframes, which cannot be injected because at-rules are
// rejected wholesale.
var allowedProfileCSSProps = map[string]bool{
	"color":                     true,
	"background":                true,
	"background-color":          true,
	"background-image":          true,
	"background-size":           true,
	"background-clip":           true,
	"-webkit-background-clip":   true,
	"-webkit-text-fill-color":   true,
	"text-shadow":               true,
	"box-shadow":                true,
	"border-radius":             true,
	"border":                    true,
	"border-color":              true,
	"border-style":              true,
	"border-width":              true,
	"font-weight":               true,
	"font-style":                true,
	"font-size":                 true,
	"line-height":               true,
	"letter-spacing":            true,
	"text-align":                true,
	"text-decoration":           true,
	"text-decoration-line":      true,
	"text-decoration-color":     true,
	"text-decoration-style":     true,
	"text-decoration-thickness": true,
	"text-transform":            true,
	"text-overflow":             true,
	"white-space":               true,
	"word-spacing":              true,
	"word-break":                true, "padding": true,
	"padding-top":               true,
	"padding-right":             true,
	"padding-bottom":            true,
	"padding-left":              true,
	"opacity":                   true,
	"backdrop-filter":           true,
	"-webkit-backdrop-filter":   true,
	"animation":                 true,
	"animation-name":            true,
	"animation-duration":        true,
	"animation-timing-function": true,
	"animation-delay":           true,
	"animation-iteration-count": true,
	"animation-direction":       true,
	"animation-fill-mode":       true,
	"animation-play-state":      true,
}

var cssCommentRE = regexp.MustCompile(`(?s)/\*.*?\*/`)

// sanitizeProfileCSS filters user-supplied CSS down to the allow-list.
// The result is idempotent: sanitizing already-clean CSS returns it unchanged.
func sanitizeProfileCSS(css string) string {
	if css == "" {
		return ""
	}
	if len(css) > maxProfileCSSLen {
		css = css[:maxProfileCSSLen]
	}
	// Neutralize escape tricks and comment obfuscation before parsing:
	// `u\72l(...)` decodes to `url(...)`, `\70 osition` decodes to `position`.
	css = cssUnescape(css)
	css = cssCommentRE.ReplaceAllString(css, "")
	if idx := strings.Index(css, "/*"); idx >= 0 {
		css = css[:idx]
	}
	// At-rules (@import, @keyframes, @media, @font-face, ...) are never
	// allowed; they are the only way to load external CSS or define script-ish
	// keyframe content.
	if strings.Contains(css, "@") {
		return ""
	}

	kept := make([]string, 0, 8)
	for _, decl := range strings.Split(css, ";") {
		decl = strings.TrimSpace(decl)
		if decl == "" {
			continue
		}
		colon := strings.Index(decl, ":")
		if colon <= 0 {
			continue
		}
		prop := strings.ToLower(strings.TrimSpace(decl[:colon]))
		value := strings.TrimSpace(decl[colon+1:])
		if !allowedProfileCSSProps[prop] || value == "" {
			continue
		}
		if !safeProfileCSSValue(value) {
			continue
		}
		kept = append(kept, prop+": "+value)
	}
	return strings.Join(kept, "; ")
}

// safeProfileCSSValue rejects value-level hazards that survive the property
// allow-list: remote resource loading, script execution and !important
// overrides (which could break the host layout).
func safeProfileCSSValue(value string) bool {
	low := strings.ToLower(value)
	// Strip all whitespace so whitespace-split tokens cannot hide hazards:
	// `url (`, `! important`, `exp ression(` all collapse to their compact
	// forms and are caught below.
	compact := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\n', '\r', '\f':
			return -1
		}
		return r
	}, low)
	for _, bad := range []string{
		"url(",
		"expression(",
		"javascript:",
		"behavior",
		"-moz-binding",
		"-moz-element",
		"attr(",
		"!important",
	} {
		if strings.Contains(compact, bad) {
			return false
		}
	}
	// Values must stay self-contained declarations: no nesting braces and no
	// quoted strings (quotes are only needed by properties we forbid, such as
	// content and font-family).
	if strings.ContainsAny(value, `{}'"`) {
		return false
	}
	return true
}

// cssUnescape resolves CSS backslash escapes so that obfuscated tokens are
// seen for what they are: \72 → r (u\72l → url), \70 → p (\70 osition →
// position), \{ → {, \u → u. A hex escape consumes 1-6 hex digits plus an
// optional single trailing space; any other escape yields the literal char.
func cssUnescape(s string) string {
	if !strings.Contains(s, `\`) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	i := 0
	for i < len(s) {
		c := s[i]
		if c != '\\' || i+1 >= len(s) {
			b.WriteByte(c)
			i++
			continue
		}
		i++ // skip the backslash
		if i < len(s) && isCSSHexDigit(s[i]) {
			start := i
			for i < len(s) && i-start < 6 && isCSSHexDigit(s[i]) {
				i++
			}
			end := i
			// A short escape (< 6 digits) may be terminated by one space; when
			// exactly 6 digits were consumed the following space is data.
			if i-start < 6 && i < len(s) && s[i] == ' ' {
				i++
			}
			if v, err := strconv.ParseUint(s[start:end], 16, 32); err == nil {
				b.WriteRune(rune(v))
			}
			continue
		}
		// Non-hex escape: the escaped character is literal.
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

func isCSSHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// sanitizeProfileBadgeText caps the badge text and strips control characters.
// The text is always rendered through React's text escaping, so this is
// defense-in-depth; the cap keeps the badge small no matter what a client
// sends.
func sanitizeProfileBadgeText(s string) string {
	runes := []rune(s)
	if len(runes) > maxProfileBadgeTextLen {
		runes = runes[:maxProfileBadgeTextLen]
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range runes {
		if r < 0x20 || (r >= 0x7f && r <= 0x9f) || isBidiControlRune(r) {
			continue
		}
		b.WriteRune(r)
	}
	return strings.TrimSpace(b.String())
}

// isBidiControlRune reports bidirectional text-control characters that could
// make a badge render misleadingly (RTL overrides, joiners, isolate markers).
func isBidiControlRune(r rune) bool {
	switch {
	case r >= 0x200b && r <= 0x200f: // ZWSP, ZWNJ, ZWJ, LRM, RLM
		return true
	case r >= 0x202a && r <= 0x202e: // LRE, RLE, PDF, LRO, RLO
		return true
	case r >= 0x2066 && r <= 0x2069: // LRI, RLI, FSI, PDI
		return true
	case r == 0x00ad: // soft hyphen
		return true
	}
	return false
}

// allowedThemeTokenVars is the allow-list of CSS variables a profile auto-
// theme may override. It mirrors the tokens the frontend theme system emits
// (theme.ts) — only these variables may come from profile_customization,
// so a stored JSONB payload can never inject arbitrary CSS onto a viewer's
// profile page. Any other --* key is dropped.
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
	"--muted":                   true,
	"--muted-foreground":        true,
	"--accent":                  true,
	"--accent-foreground":       true,
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

// themeTokenHSLRE matches an HSL triplet in the exact format the app's theme
// tokens use: "120 60% 35%" (hue 0-360, saturation/lightness 0-100%). Only
// such self-contained color triplets are admitted — no url(), calc(), var(),
// rgba() or anything that could smuggle CSS or escape the token value.
var themeTokenHSLRE = regexp.MustCompile(`^[0-9]{1,3} [0-9]{1,3}% [0-9]{1,3}%$`)

// maxThemeTokens caps the number of variables in a profile theme payload.
const maxThemeTokens = 64

// sanitizeProfileThemeTokens validates a profile auto-theme payload (a JSON
// object of CSS variables → HSL triplets). Only allow-listed --* keys with
// well-formed HSL values survive; anything else is dropped. Applied on write
// AND read so legacy or forged rows never inject unexpected CSS.
//
// Accepts either a decoded map (generic CRUD read path) or a raw JSON blob
// (write path: normalizeJSONValuesForDB marshals nested objects to []byte).
func sanitizeProfileThemeTokens(v interface{}) map[string]string {
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
			if !allowedThemeTokenVars[key] || !themeTokenHSLRE.MatchString(val) {
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
		if !ok || !themeTokenHSLRE.MatchString(s) {
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

// sanitizeProfileBackgroundVariant validates an owner-set background display
// variant against the allow-list.
func sanitizeProfileBackgroundVariant(s string) string {
	if allowedProfileBackgroundVariants[s] {
		return s
	}
	return "banner"
}

// sanitizeProfileCustomizationRow sanitizes the user-supplied fields of a
// profile_customization row in place. Applied on the read path so rows that
// predate server-side sanitization are neutralized for every viewer.
func sanitizeProfileCustomizationRow(row map[string]interface{}) {
	if s, ok := row["username_css"].(string); ok {
		row["username_css"] = sanitizeProfileCSS(s)
	}
	if s, ok := row["profile_badge_css"].(string); ok {
		row["profile_badge_css"] = sanitizeProfileCSS(s)
	}
	if s, ok := row["profile_badge_text"].(string); ok {
		row["profile_badge_text"] = sanitizeProfileBadgeText(s)
	}
	if s, ok := row["background_url"].(string); ok {
		row["background_url"] = sanitizeProfileBackgroundURL(s)
	}
	if s, ok := row["background_variant"].(string); ok {
		row["background_variant"] = sanitizeProfileBackgroundVariant(s)
	}
	if v, ok := row["theme_tokens"]; ok {
		row["theme_tokens"] = sanitizeProfileThemeTokens(v)
	}
}
