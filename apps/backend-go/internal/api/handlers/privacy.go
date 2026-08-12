package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// PrivacySettings holds the private profile fields from privacy_settings table.
type PrivacySettings struct {
	PrivateProfile          bool
	PrivateHideAvatar       bool
	PrivateHideWall         bool
	PrivateHideThreads      bool
	PrivateHideStats        bool
	PrivateHideFriends      bool
	PrivateHideGifts        bool
	PrivateHideAchievements bool
}

// privacySettingsFlagColumns is the shared SELECT fragment mapping every core
// privacy_settings flag to its NULL default. GetPrivacySettings and
// GetUserPrivacy both embed it, so the COALESCE defaults can never drift
// apart between the content gating and the public visibility endpoint.
const privacySettingsFlagColumns = `COALESCE(private_profile, false),
	       COALESCE(private_hide_avatar, false),
	       COALESCE(private_hide_wall, false),
	       COALESCE(private_hide_threads, true),
	       COALESCE(private_hide_stats, false),
	       COALESCE(private_hide_friends, true),
	       COALESCE(private_hide_gifts, true),
	       COALESCE(private_hide_achievements, true)`

// GetPrivacySettings loads private profile settings for a user.
func GetPrivacySettings(db *sql.DB, userID string) (*PrivacySettings, error) {
	var ps PrivacySettings
	err := db.QueryRow(`SELECT `+privacySettingsFlagColumns+`
		FROM privacy_settings WHERE user_id = $1
	`, userID).Scan(
		&ps.PrivateProfile, &ps.PrivateHideAvatar, &ps.PrivateHideWall,
		&ps.PrivateHideThreads, &ps.PrivateHideStats, &ps.PrivateHideFriends,
		&ps.PrivateHideGifts, &ps.PrivateHideAchievements,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return &PrivacySettings{}, nil
		}
		return nil, err
	}
	return &ps, nil
}

// IsMutualFriend checks if viewerID and targetID are mutual friends.
func IsMutualFriend(db *sql.DB, viewerID, targetID string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE (user1_id = $1 AND user2_id = $2)
			   OR (user1_id = $2 AND user2_id = $1)
		)
	`, viewerID, targetID).Scan(&exists)
	return exists, err
}

// ShouldFilterPrivateProfile returns true if the target user has private_profile enabled
// and the viewer is not the owner and not a mutual friend. Anonymous visitors
// (viewerID == "") are never the owner or a friend, so they must be filtered:
// previously an empty viewer was treated as "no filtering", which let anonymous
// clients read the bio/garma/last_seen of private profiles in full.
func ShouldFilterPrivateProfile(db *sql.DB, viewerID, targetID string) (bool, *PrivacySettings, error) {
	ps, err := GetPrivacySettings(db, targetID)
	if err != nil {
		return false, nil, err
	}
	if !ps.PrivateProfile {
		return false, ps, nil
	}
	// Only the profile owner may view it in full; an empty viewer (anonymous)
	// or any non-friend is filtered.
	if viewerID != "" && viewerID == targetID {
		return false, ps, nil
	}
	if viewerID == "" {
		return true, ps, nil
	}
	isFriend, err := IsMutualFriend(db, viewerID, targetID)
	if err != nil {
		return false, ps, err
	}
	if isFriend {
		return false, ps, nil
	}
	return true, ps, nil
}

// CanViewUserContent returns true if the viewer can see the target user's content.
// Returns true if: profile is not private, viewer is empty/owner, or viewer is mutual friend.
func CanViewUserContent(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	shouldFilter, _, err := ShouldFilterPrivateProfile(db, viewerID, targetUserID)
	if err != nil {
		return false, err
	}
	return !shouldFilter, nil
}

// CanViewUserAchievements applies both profile visibility and the dedicated
// private_hide_achievements setting. A visible profile does not implicitly
// make the user's achievement history public.
func CanViewUserAchievements(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetPrivacySettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideAchievements {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}

// CanViewUserGifts applies both profile visibility and the dedicated
// private_hide_gifts setting, mirroring CanViewUserAchievements. A public
// profile that hides gifts must still keep them from non-friends.
func CanViewUserGifts(db *sql.DB, viewerID, targetUserID string) (bool, error) {
	settings, err := GetPrivacySettings(db, targetUserID)
	if err != nil {
		return false, err
	}
	if viewerID == targetUserID {
		return true, nil
	}
	if settings.PrivateHideGifts {
		return false, nil
	}
	if !settings.PrivateProfile {
		return true, nil
	}
	if viewerID == "" {
		return false, nil
	}
	return IsMutualFriend(db, viewerID, targetUserID)
}

// ─── Public visibility flags endpoint ───────────────────────────────────────

// PrivacyHandler exposes the profile-visibility flags of any user to any
// viewer. The generic privacy_settings CRUD surface is viewer-scoped (a user
// may only read their own row), which left the profile page blind to foreign
// private profiles — it rendered every tab and the misleading "empty wall"
// state instead of the "private profile" notice. The flags below are NOT
// content: they are the exact rules the server already enforces when serving
// the user's wall, threads, friends, achievements and gifts, so returning them
// leaks nothing that was hidden.
type PrivacyHandler struct {
	db *sql.DB
}

func NewPrivacyHandler(db *sql.DB) *PrivacyHandler {
	return &PrivacyHandler{db: db}
}

// UserPrivacyResponse is the viewer-agnostic visibility subset of
// privacy_settings that the profile page needs to render tabs and the
// private-profile notice, plus the stats-visibility toggles the stats page
// needs (show_profile_stats / show_detailed_stats / stats_visibility). These
// are all *rules* the server already enforces when serving the user's content
// — the response contains no content itself.
type UserPrivacyResponse struct {
	PrivateProfile           bool            `json:"private_profile"`
	PrivateHideAvatar        bool            `json:"private_hide_avatar"`
	PrivateHideWall          bool            `json:"private_hide_wall"`
	PrivateHideThreads       bool            `json:"private_hide_threads"`
	PrivateHideStats         bool            `json:"private_hide_stats"`
	PrivateHideFriends       bool            `json:"private_hide_friends"`
	PrivateHideGifts         bool            `json:"private_hide_gifts"`
	PrivateHideAchievements  bool            `json:"private_hide_achievements"`
	ShowProfileWall          bool            `json:"show_profile_wall"`
	AllowWallPostsFromOthers bool            `json:"allow_wall_posts_from_others"`
	ShowProfileStats         bool            `json:"show_profile_stats"`
	ShowDetailedStats        bool            `json:"show_detailed_stats"`
	ShowLastSeen             bool            `json:"show_last_seen"`
	StatsVisibility          json.RawMessage `json:"stats_visibility"`
}

// GetUserPrivacy returns the privacy-visibility flags for a user.
//
// GetUserPrivacy godoc
// @Summary      Get profile visibility flags
// @Description  Returns what sections of a user's profile are hidden from
//
//	non-friends (private_profile + private_hide_*) plus the stats
//	visibility toggles. These are the same flags the server enforces
//	when serving the user's content — the response contains no
//	content itself.
//
// @Tags         Users
// @Produce      json
// @Param        id path string true "User ID"
// @Success      200 {object} models.APIResponse
// @Router       /users/{id}/privacy [get]
func (h *PrivacyHandler) GetUserPrivacy(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id required"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}

	// Core flags come from the shared privacySettingsFlagColumns fragment (the
	// same NULL defaults as GetPrivacySettings — see the constant), plus the
	// display/stats toggles that only this endpoint surfaces. Note:
	// show_threads_tab / show_online_status are NOT in the DB schema (the
	// frontend falls back to true for them), so they are omitted.
	var (
		resp UserPrivacyResponse
		vis  json.RawMessage
	)
	err := h.db.QueryRow(`SELECT `+privacySettingsFlagColumns+`,
	       COALESCE(show_profile_wall, true),
	       COALESCE(allow_wall_posts_from_others, true),
	       COALESCE(show_profile_stats, false),
	       COALESCE(show_detailed_stats, false),
	       COALESCE(show_last_seen, true),
	       COALESCE(stats_visibility, '{}'::jsonb)
		FROM privacy_settings WHERE user_id = $1
	`, userID).Scan(
		&resp.PrivateProfile, &resp.PrivateHideAvatar, &resp.PrivateHideWall,
		&resp.PrivateHideThreads, &resp.PrivateHideStats, &resp.PrivateHideFriends,
		&resp.PrivateHideGifts, &resp.PrivateHideAchievements,
		&resp.ShowProfileWall, &resp.AllowWallPostsFromOthers,
		&resp.ShowProfileStats, &resp.ShowDetailedStats,
		&resp.ShowLastSeen,
		&vis,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			// No privacy row → fully public defaults.
			resp.ShowProfileWall = true
			resp.AllowWallPostsFromOthers = true
			resp.ShowLastSeen = true
			vis = json.RawMessage("{}")
		} else {
			serverError(c, "handler error", err)
			return
		}
	}
	resp.StatsVisibility = vis

	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}
