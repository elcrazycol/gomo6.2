package wall

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// PreparePostBody fixes a wall post's authorship on PUT: the author is
// always the caller, and the wall owner column must never be moved onto
// another user's wall through a generic update (that would bypass the POST
// privacy check allow_wall_posts_from_others).
func (s *Service) PreparePostBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "PUT" {
		return true
	}
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return false
	}
	data["author_id"] = userID
	if wall, ok := data["user_id"].(string); ok && wall != "" && wall != userID {
		delete(data, "user_id")
	}
	return true
}

// PrepareCommentBody fixes a comment's tree position on PUT: post_id and
// parent_id are fixed at creation — re-pointing them would bypass the
// POST-time privacy check (EnforceTargetPrivacy) and could forge orphan
// comments on a foreign wall or detach a reply subtree from the visible
// branch.
func (s *Service) PrepareCommentBody(c *gin.Context, tableName, method string, data map[string]interface{}) bool {
	if method != "PUT" {
		return true
	}
	delete(data, "post_id")
	delete(data, "parent_id")
	return true
}

// UpsertPostLikes inserts a like or turns the re-like into a
// no-op UPDATE; (xmax = 0) AS inserted tells the caller whether this was a
// genuinely new like (the only case that notifies the post author).
func UpsertPostLikes(data map[string]interface{}) (query string, args []interface{}, ok bool) {
	pid, hasPID := data["post_id"]
	uid, hasUID := data["user_id"]
	if !hasPID || !hasUID {
		return "", nil, false
	}
	q := `INSERT INTO profile_wall_post_likes (post_id, user_id) VALUES ($1, $2)
ON CONFLICT (post_id, user_id) DO UPDATE SET user_id = EXCLUDED.user_id
RETURNING *, (xmax = 0) AS inserted`
	return q, []interface{}{pid, uid}, true
}
