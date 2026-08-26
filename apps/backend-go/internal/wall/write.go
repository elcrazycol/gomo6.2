package wall

import (
	"database/sql"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/privacy"
	"github.com/gomo6/backend/internal/profiles"
	"github.com/gomo6/backend/internal/textutil"
)

// invalidateWallListCache clears the owner's wall-list cache entry after an
// interaction write. The wall GET now embeds per-post interaction counts
// (likes/comments/reposts + viewer state), so a like/comment/repost must
// invalidate the owner's list key (user_id=eq.<owner>) — the post-scoped
// patterns alone only match the standalone post page.
func (s *Service) invalidateWallListCache(c *gin.Context, postID string) {
	if s.redis == nil || postID == "" {
		return
	}
	var ownerID string
	if err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&ownerID); err != nil || ownerID == "" {
		return
	}
	cache.InvalidateCacheForProfileWall(s.redis, ownerID)
}

// invalidateCommentLikesCache invalidates every cache whose response embeds
// comment like counts: the post's comments list and the owner's wall list.
func (s *Service) invalidateCommentLikesCache(c *gin.Context, commentID string) {
	if s.redis == nil || commentID == "" {
		return
	}
	var postID string
	if err := s.db.QueryRowContext(c.Request.Context(),
		"SELECT post_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&postID); err != nil || postID == "" {
		return
	}
	cache.InvalidateCacheForWallComment(s.redis, commentID, postID)
	s.invalidateWallListCache(c, postID)
}

// recomputeStatsForPostLike refreshes the unified stats of everyone whose
// counters a wall-post like changes: the post's author (likes_received) and
// the liker (likes_given). The author is resolved from the DB because the
// generic CRUD result only carries the like's foreign key.
func (s *Service) recomputeStatsForPostLike(c *gin.Context, postID, likerID string) {
	if postID != "" {
		var authorID string
		if err := s.db.QueryRowContext(c.Request.Context(),
			"SELECT author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&authorID); err == nil && authorID != "" {
			profiles.RecomputeUserProfileStats(s.db, authorID)
		}
	}
	if likerID != "" {
		profiles.RecomputeUserProfileStats(s.db, likerID)
	}
}

// recomputeStatsForCommentLike — same as recomputeStatsForPostLike but
// for likes on wall comments: the comment's author (likes_received) and the
// liker (likes_given).
func (s *Service) recomputeStatsForCommentLike(c *gin.Context, commentID, likerID string) {
	if commentID != "" {
		var authorID string
		if err := s.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&authorID); err == nil && authorID != "" {
			profiles.RecomputeUserProfileStats(s.db, authorID)
		}
	}
	if likerID != "" {
		profiles.RecomputeUserProfileStats(s.db, likerID)
	}
}

// postOwnerAuthor resolves the wall owner and author of a wall post.
func (s *Service) postOwnerAuthor(c *gin.Context, postID string) (ownerID, authorID string) {
	if postID == "" {
		return "", ""
	}
	_ = s.db.QueryRowContext(c.Request.Context(),
		"SELECT user_id, author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&ownerID, &authorID)
	return ownerID, authorID
}

// commentPostAndAuthor resolves a wall comment's post_id and author.
func (s *Service) commentPostAndAuthor(c *gin.Context, commentID string) (postID, authorID string) {
	if commentID == "" {
		return "", ""
	}
	_ = s.db.QueryRowContext(c.Request.Context(),
		"SELECT post_id, user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&postID, &authorID)
	return postID, authorID
}

// createWallNotification creates a wall notification for recipientID, skipping
// self-notifications. Best-effort — a failed notification must never fail the
// underlying wall write.
func (s *Service) createWallNotification(c *gin.Context, recipientID, actorID, notifType, message, actorUsername string, wallPostID, wallCommentID, wallUserID *string) {
	if s.notif == nil {
		return
	}
	if recipientID == "" || actorID == "" || recipientID == actorID {
		return
	}
	params := &models.NotificationParams{Actor: actorUsername}
	if _, err := s.notif.CreateWallNotification(notifications.CreateParams{
		RecipientID:          recipientID,
		Type:                 notifType,
		Message:              message,
		Params:               params,
		ActorID:              &actorID,
		RelatedWallPostID:    wallPostID,
		RelatedWallCommentID: wallCommentID,
		WallOwnerID:          wallUserID,
	}); err != nil {
		fmt.Printf("[WallNotifications] error creating %s notification: %v\n", notifType, err)
	}
}

// notifyPostLike creates the "wall_post_like" notification for the wall
// post author.
func (s *Service) notifyPostLike(c *gin.Context, postID, actorID string) {
	if postID == "" || actorID == "" {
		return
	}
	ownerID, authorID := s.postOwnerAuthor(c, postID)
	if authorID == "" || authorID == actorID {
		return
	}
	s.createWallNotification(c, authorID, actorID, "wall_post_like", "", profiles.UsernameByID(s.db, actorID), crud.WallIDPtr(postID), nil, crud.WallIDPtr(ownerID))
}

// notifyComment creates the wall comment / reply notifications for a newly
// inserted wall comment.
func (s *Service) notifyComment(c *gin.Context, result map[string]interface{}) {
	commentID := crud.WallResultString(result["id"])
	postID := crud.WallResultString(result["post_id"])
	actorID := crud.WallResultString(result["user_id"])
	parentID := crud.WallResultString(result["parent_id"])
	if postID == "" || actorID == "" {
		return
	}

	snippet := textutil.TruncateRunes(crud.WallResultString(result["content"]), 100)
	ownerID, postAuthorID := s.postOwnerAuthor(c, postID)

	// Reply to another comment → notify the parent comment's author.
	if parentID != "" {
		_, parentAuthorID := s.commentPostAndAuthor(c, parentID)
		if parentAuthorID != "" && parentAuthorID != actorID {
			s.createWallNotification(c, parentAuthorID, actorID, "wall_comment_reply", snippet, profiles.UsernameByID(s.db, actorID), crud.WallIDPtr(postID), crud.WallIDPtr(commentID), crud.WallIDPtr(ownerID))
		}
		return
	}

	// Top-level comment → notify the post author.
	if postAuthorID != "" && postAuthorID != actorID {
		s.createWallNotification(c, postAuthorID, actorID, "wall_comment", snippet, profiles.UsernameByID(s.db, actorID), crud.WallIDPtr(postID), crud.WallIDPtr(commentID), crud.WallIDPtr(ownerID))
	}
}

// notifyRepost creates the "wall_repost" notification for the author of the
// original wall post.
func (s *Service) notifyRepost(c *gin.Context, result map[string]interface{}) {
	originalPostID := crud.WallResultString(result["post_id"])
	actorID := crud.WallResultString(result["user_id"])
	if originalPostID == "" || actorID == "" {
		return
	}
	ownerID, originalAuthorID := s.postOwnerAuthor(c, originalPostID)
	if originalAuthorID == "" || originalAuthorID == actorID {
		return
	}
	s.createWallNotification(c, originalAuthorID, actorID, "wall_repost", "", profiles.UsernameByID(s.db, actorID), crud.WallIDPtr(originalPostID), nil, crud.WallIDPtr(ownerID))
}

// publishPostEvent enriches the written row with author data and
// broadcasts the new/update event to the wall rooms.
func (s *Service) publishPostEvent(c *gin.Context, op string, result map[string]interface{}) {
	if s.hub == nil {
		return
	}
	var wsPayload map[string]interface{}
	if idStr := fmt.Sprint(result["id"]); idStr != "" {
		if enriched, enrichErr := s.fetchPostWithAuthor(idStr, httpx.AuthenticatedUserID(c)); enrichErr == nil && enriched != nil {
			wsPayload = enriched
		} else {
			wsPayload = result
		}
	} else {
		wsPayload = result
	}
	var err error
	if op == "new" {
		err = s.hub.PublishNewWallPost(wsPayload)
	} else {
		err = s.hub.PublishUpdateWallPost(wsPayload)
	}
	if err != nil {
		fmt.Printf("[WebSocket] Error publishing wall post %s event: %v\n", op, err)
	}
}

// AfterPostWrite carries every side effect of a wall-post write: the
// wall-list / feed / cascade cache invalidations the generic invalidation
// cannot express, the wall_post notification, the WebSocket broadcast and the
// author's unified profile stats.
func (s *Service) AfterPostWrite(c *gin.Context, method string, result map[string]interface{}) {
	ownerID := crud.WallResultString(result["user_id"])
	switch method {
	case "POST":
		if ownerID != "" && s.redis != nil {
			cache.InvalidateCacheForProfileWall(s.redis, ownerID)
			// A new wall post is a candidate for the unified feed.
			cache.InvalidateCacheForFeed(s.redis)
		}
		// Wall notification: someone else posted on this wall.
		authorID := crud.WallResultString(result["author_id"])
		if ownerID != "" && authorID != "" && ownerID != authorID {
			postID := crud.WallResultString(result["id"])
			msg := textutil.TruncateRunes(crud.WallResultString(result["content"]), 100)
			s.createWallNotification(c, ownerID, authorID, "wall_post", msg, profiles.UsernameByID(s.db, authorID), crud.WallIDPtr(postID), nil, crud.WallIDPtr(ownerID))
		}
		s.publishPostEvent(c, "new", result)
		// Unified profile stats: wall content contributes to the AUTHOR's
		// counters (a post written on someone else's wall counts for the author).
		if uid := profiles.RowUserID(result["author_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(s.db, uid)
		}
	case "PUT":
		if ownerID != "" && s.redis != nil {
			cache.InvalidateCacheForProfileWall(s.redis, ownerID)
		}
		s.publishPostEvent(c, "update", result)
	case "DELETE":
		if ownerID != "" && s.redis != nil {
			cache.InvalidateCacheForProfileWall(s.redis, ownerID)
		}
		// Cascade: invalidate comments, likes and reposts of the deleted post.
		if postID := crud.WallResultString(result["id"]); postID != "" && s.redis != nil {
			cache.InvalidateForTable(s.redis, "profile_wall_post_comments", map[string]string{"post_id": postID})
			cache.InvalidateForTable(s.redis, "profile_wall_post_likes", map[string]string{"post_id": postID})
			cache.InvalidateForTable(s.redis, "profile_wall_post_reposts", map[string]string{"post_id": postID})
		}
		if s.hub != nil {
			if err := s.hub.PublishDeleteWallPost(result); err != nil {
				fmt.Printf("[WebSocket] Error publishing wall post delete event: %v\n", err)
			}
		}
		if uid := profiles.RowUserID(result["author_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(s.db, uid)
		}
	}
}

// AfterCommentWrite carries the comment-write side effects: the post's
// comments list + wall-list cache invalidation, the comment/reply
// notifications and the comment author's unified profile stats.
func (s *Service) AfterCommentWrite(c *gin.Context, method string, result map[string]interface{}) {
	postID, _ := result["post_id"].(string)
	if method == "POST" {
		if postID != "" && s.redis != nil {
			commentID, _ := result["id"].(string)
			cache.InvalidateCacheForWallComment(s.redis, commentID, postID)
			s.invalidateWallListCache(c, postID)
		}
		// Wall notifications: comment → post author; reply → parent comment author.
		s.notifyComment(c, result)
		if uid := profiles.RowUserID(result["user_id"]); uid != "" {
			profiles.RecomputeUserProfileStats(s.db, uid)
		}
		return
	}
	// PUT / DELETE: the comments list of the touched post changed.
	if postID != "" && s.redis != nil {
		commentID, _ := result["id"].(string)
		cache.InvalidateCacheForWallComment(s.redis, commentID, postID)
		s.invalidateWallListCache(c, postID)
	}
}

// AfterRepostWrite invalidates the original post and the reposter's wall
// list, and notifies the original post's author.
func (s *Service) AfterRepostWrite(c *gin.Context, method string, result map[string]interface{}) {
	switch method {
	case "POST":
		if postID, ok := result["post_id"].(string); ok && s.redis != nil {
			cache.InvalidateCacheForWallPost(s.redis, postID)
			s.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && s.redis != nil {
			cache.InvalidateCacheForProfileWall(s.redis, userID)
		}
		// Wall notification: the original post's author gets a repost notice.
		s.notifyRepost(c, result)
	case "DELETE":
		if postID, ok := result["post_id"].(string); ok && s.redis != nil {
			cache.InvalidateCacheForWallPost(s.redis, postID)
			s.invalidateWallListCache(c, postID)
		}
		if userID, ok := result["wall_user_id"].(string); ok && s.redis != nil {
			cache.InvalidateCacheForProfileWall(s.redis, userID)
		}
	}
}

// AfterCommentLikeWrite clears the caches embedding comment like counts
// and refreshes the unified stats of the comment author and the liker.
func (s *Service) AfterCommentLikeWrite(c *gin.Context, method string, result map[string]interface{}) {
	commentID, ok := result["comment_id"].(string)
	if !ok {
		return
	}
	if method != "PUT" {
		s.invalidateCommentLikesCache(c, commentID)
	}
	if method == "DELETE" || method == "POST" {
		s.recomputeStatsForCommentLike(c, commentID, profiles.RowUserID(result["user_id"]))
	}
}

// AfterPostLikeWrite refreshes the unified stats of the post author and
// the liker; on a genuinely NEW like (xmax = 0) it also notifies the author.
// DELETE additionally clears the like-list caches (the registry invalidation
// hook covers the standalone post page, list patterns and the feed).
func (s *Service) AfterPostLikeWrite(c *gin.Context, method string, result map[string]interface{}) {
	postID, ok := result["post_id"].(string)
	if !ok {
		return
	}
	likerID := profiles.RowUserID(result["user_id"])
	switch method {
	case "POST":
		s.recomputeStatsForPostLike(c, postID, likerID)
		if inserted, _ := result["inserted"].(bool); inserted {
			s.notifyPostLike(c, postID, crud.WallResultString(result["user_id"]))
		}
	case "DELETE":
		if s.redis != nil {
			cache.InvalidateCacheForWallPost(s.redis, postID)
			cache.InvalidateByPattern(s.redis, fmt.Sprintf("data:/api/v1/profile_wall_post_likes*post_id=eq.%s*", postID))
			cache.InvalidateByPattern(s.redis, "data:/api/v1/profile_wall_post_likes*")
			s.invalidateWallListCache(c, postID)
		}
		s.recomputeStatsForPostLike(c, postID, likerID)
	}
}

// EnforceTargetPrivacy rejects interactions with walls that the caller may
// not view: posting on a private wall, commenting on/liking a post of a private
// wall, or reposting a private wall post onto the caller's own wall.
// It writes the HTTP response and returns false when the request is rejected,
// and returns true for every non-wall table (the write path is generic).
func (s *Service) EnforceTargetPrivacy(c *gin.Context, tableName string, data map[string]interface{}, userID string) bool {
	// Resolve the wall owner this interaction targets.
	var wallOwner string
	switch tableName {
	case "profile_wall_posts":
		wallOwner, _ = data["user_id"].(string)
	case "profile_wall_post_comments", "profile_wall_post_likes":
		// L5: the target post must exist. A nonexistent post would leave
		// wallOwner empty and let the `wallOwner == ""` guard below pass,
		// creating an orphan comment/like whose post is gone — and such orphans
		// were readable by everyone (the LEFT JOIN read path had no wall owner
		// to compare against). Fail closed: missing post → 404.
		postID, _ := data["post_id"].(string)
		if postID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("post_id is required"))
			return false
		}
		err := s.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
			} else {
				httpx.ServerError(c, "lookup wall post", err)
			}
			return false
		}
	case "profile_wall_comment_likes":
		// L5: same fail-closed rule — the commented post must exist. The JOIN
		// also rejects likes on orphan comments whose post is already gone.
		commentID, _ := data["comment_id"].(string)
		if commentID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("comment_id is required"))
			return false
		}
		err := s.db.QueryRowContext(c.Request.Context(), `
			SELECT wp.user_id
			FROM profile_wall_post_comments c
			JOIN profile_wall_posts wp ON wp.id = c.post_id
			WHERE c.id = $1`, commentID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall comment not found"))
			} else {
				httpx.ServerError(c, "lookup wall comment", err)
			}
			return false
		}
	case "profile_wall_post_reposts":
		// post_id references the ORIGINAL post being reposted — it must exist
		// and its wall owner must be visible to the caller, otherwise private
		// content could be mirrored onto a public wall (and a dangling repost
		// would be readable by everyone, exactly like an orphan comment).
		postID, _ := data["post_id"].(string)
		if postID == "" {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("post_id is required"))
			return false
		}
		err := s.db.QueryRowContext(c.Request.Context(),
			"SELECT user_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&wallOwner)
		if err != nil {
			if err == sql.ErrNoRows {
				c.JSON(http.StatusNotFound, models.ErrorResponse("Wall post not found"))
			} else {
				httpx.ServerError(c, "lookup wall post", err)
			}
			return false
		}
		// reposted_wall_post_id is the copy placed on the caller's own wall — it
		// must belong to the caller, otherwise cross-links to other users' posts
		// could be forged on the repost record.
		if copyID, ok := data["reposted_wall_post_id"].(string); ok && copyID != "" {
			var copyOwner string
			err := s.db.QueryRowContext(c.Request.Context(),
				"SELECT user_id FROM profile_wall_posts WHERE id = $1", copyID).Scan(&copyOwner)
			if err == nil && copyOwner != "" && copyOwner != userID {
				c.JSON(http.StatusForbidden, models.ErrorResponse("Invalid repost target"))
				return false
			}
		}
	default:
		return true
	}
	if wallOwner == "" || wallOwner == userID {
		return true
	}
	// Privacy rule lives in the privacy package (privacy.CanViewWall) as the
	// single source of truth — the same predicate the REST read path uses.
	visible, err := privacy.CanViewWall(s.db, userID, wallOwner)
	if err != nil {
		httpx.ServerError(c, "check wall privacy", err)
		return false
	}
	if !visible {
		c.JSON(http.StatusForbidden, models.ErrorResponse("This wall is private"))
		return false
	}
	return true
}
