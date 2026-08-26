package wall

import (
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
)

// InvalidatePostsCache clears the standalone wall-post page.
func (s *Service) InvalidatePostsCache(_ *gin.Context, result map[string]interface{}) {
	id := crud.WallResultString(result["id"])
	userID := crud.WallResultString(result["user_id"])
	cache.InvalidateCacheForWallPostOfUser(s.redis, id, userID)
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
