package textutil

import "unicode/utf8"

// TruncateRunes truncates s to at most max runes, adding an ellipsis.
func TruncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	if max <= 0 {
		return ""
	}
	return string(runes[:max-1]) + "…"
}
