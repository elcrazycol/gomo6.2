package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
	"github.com/google/uuid"
)

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
// # GetUserPrivacy godoc
//
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

	// Core flags come from the shared privacy.SettingsFlagColumns fragment (the
	// same NULL defaults as privacy.GetSettings — see the constant), plus the
	// display/stats toggles that only this endpoint surfaces. Note:
	// show_threads_tab / show_online_status are NOT in the DB schema (the
	// frontend falls back to true for them), so they are omitted.
	var (
		resp UserPrivacyResponse
		vis  json.RawMessage
	)
	err := h.db.QueryRow(`SELECT `+privacy.SettingsFlagColumns+`,
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
			httpx.ServerError(c, "handler error", err)
			return
		}
	}
	resp.StatsVisibility = vis

	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}
