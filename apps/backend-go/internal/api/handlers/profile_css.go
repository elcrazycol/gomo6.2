package handlers

import (
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
}
