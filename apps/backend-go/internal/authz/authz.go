// Package authz centralizes platform role lookups against user_roles.
//
// The role predicate used to be copy-pasted across the websocket hub, the
// moderation queue, the drops/gifts admin paths, the upload gate and the route
// middlewares. Those copies already diverged (some check admin only, some
// moderator-or-admin, one ignored the query error). Any future role rename or
// new gate must not have to be repeated in eight places, so every call site goes
// through this package. Every function fails closed: an empty user id, a nil DB
// or a query error reports "no role" rather than granting access.
package authz

import (
	"context"
	"database/sql"
)

// Role names stored in user_roles.role.
const (
	RoleAdmin     = "admin"
	RoleModerator = "moderator"
)

// isModeratorQuery and isAdminQuery are constants — no user input ever reaches
// the SQL text, so the role names cannot be injected.
const (
	isModeratorQuery = `SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role IN ('moderator', 'admin'))`
	isAdminQuery     = `SELECT EXISTS (SELECT 1 FROM user_roles WHERE user_id = $1 AND role = 'admin')`
)

// IsModerator reports whether userID holds the platform moderator or admin role.
func IsModerator(ctx context.Context, db *sql.DB, userID string) (bool, error) {
	return hasRole(ctx, db, userID, isModeratorQuery)
}

// IsAdmin reports whether userID holds the platform admin role.
func IsAdmin(ctx context.Context, db *sql.DB, userID string) (bool, error) {
	return hasRole(ctx, db, userID, isAdminQuery)
}

func hasRole(ctx context.Context, db *sql.DB, userID, query string) (bool, error) {
	if db == nil || userID == "" {
		return false, nil
	}
	var ok bool
	if err := db.QueryRowContext(ctx, query, userID).Scan(&ok); err != nil {
		return false, err
	}
	return ok, nil
}
