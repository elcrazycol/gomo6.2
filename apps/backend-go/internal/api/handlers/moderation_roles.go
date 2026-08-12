package handlers

import "database/sql"

// isModeratorOrAdmin reports whether the user holds the platform 'moderator'
// or 'admin' role in user_roles. It gates content-moderation actions such as
// deleting another user's post or thread (H1): the frontend moderation UI
// (ModerationPosts, ModeratorMenu) deletes foreign content through the same
// DELETE /posts and /threads endpoints, so the delete handlers must accept
// both the content author and platform staff.
func isModeratorOrAdmin(db *sql.DB, userID string) (bool, error) {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role IN ('moderator', 'admin')`, userID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}
