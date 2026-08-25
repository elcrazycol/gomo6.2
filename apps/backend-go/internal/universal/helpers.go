package universal

import (
	"database/sql"
	"unicode/utf8"
)

// getUsernameFromDB fetches a username by user ID. Local copy of the handlers
// helper (friends.go) so this package stays one-directionally dependent on
// api/handlers.
func getUsernameFromDB(db *sql.DB, userID string) string {
	var username string
	err := db.QueryRow("SELECT username FROM profiles WHERE id = $1", userID).Scan(&username)
	if err != nil {
		return "unknown"
	}
	return username
}

// truncateRunes truncates s to at most max runes, adding an ellipsis. Local
// copy of the handlers helper (social_preview.go).
func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	if max <= 0 {
		return ""
	}
	return string(runes[:max-1]) + "…"
}
