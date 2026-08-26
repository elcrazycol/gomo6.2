package profiles

import "database/sql"

// UsernameByID fetches a username by user ID, falling back to "unknown" on
// lookup errors. Shared by handlers and the crudengine subsystem.
func UsernameByID(db *sql.DB, userID string) string {
	var username string
	err := db.QueryRow("SELECT username FROM profiles WHERE id = $1", userID).Scan(&username)
	if err != nil {
		return "unknown"
	}
	return username
}
