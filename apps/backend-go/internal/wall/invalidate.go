package wall

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
)

// InvalidatePostsCache clears the standalone wall-post page. Deleting a wall
// post cascades it out of every album it belonged to (FK ON DELETE CASCADE), so
// the affected album post lists are cleared too, and any wall-post write keeps
// the owner's album list fresh (its post_count can change on delete).
func (s *Service) InvalidatePostsCache(c *gin.Context, result map[string]interface{}) {
	id := crud.WallResultString(result["id"])
	userID := crud.WallResultString(result["user_id"])
	cache.InvalidateCacheForWallPostOfUser(s.redis, id, userID)

	if s.redis == nil || id == "" {
		return
	}
	if c.Request.Method == "DELETE" {
		rows, err := s.db.QueryContext(c.Request.Context(),
			"SELECT DISTINCT album_id FROM profile_album_posts WHERE post_id = $1", id)
		if err == nil {
			for rows.Next() {
				var albumID string
				if rows.Scan(&albumID) == nil && albumID != "" {
					cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_album_posts*album_id=eq."+albumID+"*")
				}
			}
			rows.Close()
		}
	}
	if userID != "" {
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id=eq."+userID+"*")
		cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_albums*user_id="+userID+"*")
	}
}

// InvalidatePostCommentsCache clears the post's comments list.
func (s *Service) InvalidatePostCommentsCache(_ *gin.Context, result map[string]interface{}) {
	id := crud.WallResultString(result["id"])
	postID := crud.WallResultString(result["post_id"])
	cache.InvalidateCacheForWallComment(s.redis, id, postID)
}

// InvalidatePostLikesCache clears the liked post's standalone page,
// the like list and the unified feed (likes affect feed popularity scores).
// Lives on the upsert path: profile_wall_post_likes writes are all upserts.
func (s *Service) InvalidatePostLikesCache(_ *gin.Context, result map[string]interface{}) {
	postID := crud.WallResultString(result["post_id"])
	if postID == "" {
		return
	}
	cache.InvalidateCacheForWallPost(s.redis, postID)
	cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_wall_post_likes*post_id=eq."+postID+"*")
	cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_wall_post_likes*")
	cache.InvalidateCacheForFeed(s.redis)
}
