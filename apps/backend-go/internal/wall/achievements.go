package wall

import (
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/profiles"
)

// EmitPostsAchievements fires the entry/image events for a wall post write.
func (s *Service) EmitPostsAchievements(result map[string]interface{}) {
	e := s.achEngine
	if uid := profiles.RowUserID(result["author_id"]); uid != "" {
		postID := crud.WallResultString(result["id"])
		achievements.EmitAchievementTarget(e, uid, achievements.EventEntryCreated, "wall_post", postID)
		if postHasImage(result) {
			achievements.EmitAchievementTarget(e, uid, achievements.EventImageUploaded, "wall_post", postID)
		}
	}
}

// EmitPostCommentsAchievements fires the comment event for a wall comment.
func (s *Service) EmitPostCommentsAchievements(result map[string]interface{}) {
	e := s.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievementTarget(e, uid, achievements.EventCommentCreated, "wall_comment", crud.WallResultString(result["id"]))
	}
}

// EmitPostLikesAchievements fires the give/receive like events for a
// wall-post like write.
func (s *Service) EmitPostLikesAchievements(result map[string]interface{}) {
	e := s.achEngine
	postID := crud.WallResultString(result["post_id"])
	if liker := profiles.RowUserID(result["user_id"]); liker != "" {
		achievements.EmitAchievementTarget(e, liker, achievements.EventLikeGiven, "wall_post", postID)
	}
	if postID != "" {
		var authorID string
		_ = s.db.QueryRow("SELECT author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&authorID)
		achievements.EmitAchievementTarget(e, authorID, achievements.EventLikeReceived, "wall_post", postID)
	}
}

// EmitCommentLikesAchievements fires the give/receive like events for a
// wall-comment like write.
func (s *Service) EmitCommentLikesAchievements(result map[string]interface{}) {
	e := s.achEngine
	commentID := crud.WallResultString(result["comment_id"])
	if liker := profiles.RowUserID(result["user_id"]); liker != "" {
		achievements.EmitAchievementTarget(e, liker, achievements.EventLikeGiven, "wall_comment", commentID)
	}
	if commentID != "" {
		var authorID string
		_ = s.db.QueryRow("SELECT user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&authorID)
		achievements.EmitAchievementTarget(e, authorID, achievements.EventLikeReceived, "wall_comment", commentID)
	}
}

// EmitPostRepostsAchievements fires the repost event for a wall repost write.
func (s *Service) EmitPostRepostsAchievements(result map[string]interface{}) {
	e := s.achEngine
	if uid := profiles.RowUserID(result["user_id"]); uid != "" {
		achievements.EmitAchievementTarget(e, uid, achievements.EventRepostCreated, "wall_post", crud.WallResultString(result["id"]))
	}
}

// postHasImage reports whether a wall-post write carries an image
// (image_url set, or a non-empty attachments JSONB array).
func postHasImage(result map[string]interface{}) bool {
	if s := crud.WallResultString(result["image_url"]); s != "" {
		return true
	}
	if v, ok := result["attachments"]; ok {
		if b, ok2 := v.([]byte); ok2 && len(b) > 2 {
			// "[]" is exactly 2 bytes; anything longer is a non-empty array.
			return true
		}
	}
	return false
}
