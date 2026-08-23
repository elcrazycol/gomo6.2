package handlers

import (
	"github.com/gomo6/backend/internal/achievements"
)

// emitAchievement schedules an achievement event for a user. It is async and
// best-effort: the engine logs and swallows its own errors, so an emission can
// never break the action that triggered it. Empty user IDs are no-ops.
func emitAchievement(e *achievements.Engine, userID string, evt achievements.EventType) {
	if e == nil || userID == "" {
		return
	}
	go e.HandleEvent(achievements.Event{UserID: userID, Type: evt})
}

// emitUniversalAchievementEvents fires the achievement events implied by a
// universal-CRUD write. It runs on both the upsert and the INSERT write paths.
//
// The unified content model: записи = threads + profile_wall_posts (by
// author_id — a post on someone else's wall counts for the AUTHOR), comments =
// posts + wall comments, likes = all four like tables.
func (h *UniversalHandler) emitUniversalAchievementEvents(tableName string, result map[string]interface{}) {
	e := h.achEngine
	if e == nil {
		return
	}
	switch tableName {
	case "profile_wall_posts":
		if uid := rowUserID(result["author_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventEntryCreated)
			if wallPostHasImage(result) {
				emitAchievement(e, uid, achievements.EventImageUploaded)
			}
		}
	case "profile_wall_post_comments":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventCommentCreated)
		}
	case "profile_wall_post_likes":
		if liker := rowUserID(result["user_id"]); liker != "" {
			emitAchievement(e, liker, achievements.EventLikeGiven)
		}
		if postID := wallResultString(result["post_id"]); postID != "" {
			var authorID string
			_ = h.db.QueryRow("SELECT author_id FROM profile_wall_posts WHERE id = $1", postID).Scan(&authorID)
			emitAchievement(e, authorID, achievements.EventLikeReceived)
		}
	case "profile_wall_comment_likes":
		if liker := rowUserID(result["user_id"]); liker != "" {
			emitAchievement(e, liker, achievements.EventLikeGiven)
		}
		if commentID := wallResultString(result["comment_id"]); commentID != "" {
			var authorID string
			_ = h.db.QueryRow("SELECT user_id FROM profile_wall_post_comments WHERE id = $1", commentID).Scan(&authorID)
			emitAchievement(e, authorID, achievements.EventLikeReceived)
		}
	case "profile_wall_post_reposts":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventRepostCreated)
		}
	case "user_daily_visits":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventDailyVisit)
		}
	case "gomosub_memberships":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventSubJoined)
		}
	case "gomosub_rules_acceptance":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventSubRulesAccepted)
		}
	case "profile_customization":
		if uid := rowUserID(result["user_id"]); uid != "" {
			emitAchievement(e, uid, achievements.EventProfileStyled)
		}
	}
}

// wallPostHasImage reports whether a wall-post write carries an image
// (image_url set, or a non-empty attachments JSONB array).
func wallPostHasImage(result map[string]interface{}) bool {
	if s := wallResultString(result["image_url"]); s != "" {
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
