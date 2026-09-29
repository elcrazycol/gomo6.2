package handlers

import (
	"context"
	"database/sql"

	"github.com/gomo6/backend/internal/authz"
)

// isModeratorOrAdmin reports whether the user holds the platform 'moderator'
// or 'admin' role in user_roles. It gates content-moderation actions such as
// deleting another user's post or thread (H1): the frontend moderation UI
// (ModerationPosts, ModeratorMenu) deletes foreign content through the same
// DELETE /posts and /threads endpoints, so the delete handlers must accept
// both the content author and platform staff.
func isModeratorOrAdmin(db *sql.DB, userID string) (bool, error) {
	return authz.IsModerator(context.Background(), db, userID)
}
