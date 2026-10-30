package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
)

// QuestsHandler serves the quest/MVP gamification surface: one-shot progress
// for the whole catalog, idempotent reward claims and chest inventory.
//
// Design notes (agreed in the quests-MVP discussion):
//   - Everything is visible with progress — no hidden quests, no silhouettes.
//   - Completion only marks progress; rewards move exclusively through Claim.
//   - Claims are idempotent per (user, quest, level) via quest_claims.
type QuestsHandler struct {
	db     *sql.DB
	engine *achievements.Engine
}

// NewQuestsHandler builds the handler over the achievements engine.
func NewQuestsHandler(db *sql.DB, engine *achievements.Engine) *QuestsHandler {
	return &QuestsHandler{db: db, engine: engine}
}

// QuestProgressLevel is one level of a quest with its completion/claim state.
type QuestProgressLevel struct {
	Level          int                   `json:"level"`
	Threshold      int                   `json:"threshold"`
	NameKey        string                `json:"name_key"`
	DescriptionKey string                `json:"description_key"`
	Rewards        []achievements.Reward `json:"rewards"`
	Completed      bool                  `json:"completed"`
	Claimed        bool                  `json:"claimed"`
	CanClaim       bool                  `json:"can_claim"`
}

// QuestProgress is one catalog quest with the viewer's progress.
type QuestProgress struct {
	GroupKey        string               `json:"group_key"`
	TitleKey        string               `json:"title_key"`
	Category        string               `json:"category"`
	Track           string               `json:"track"`
	Icon            string               `json:"icon"`
	SortOrder       int                  `json:"sort_order"`
	CurrentLevel    int                  `json:"current_level"`
	ProgressCurrent int                  `json:"progress_current"`
	Levels          []QuestProgressLevel `json:"levels"`
}

// QuestChest is one inventory chest row.
type QuestChest struct {
	ID        string  `json:"id"`
	QuestKey  string  `json:"quest_key"`
	Level     int     `json:"level"`
	Mechanic  string  `json:"mechanic"`
	CreatedAt string  `json:"created_at"`
	OpenedAt  *string `json:"opened_at,omitempty"`
}

// GetProgress godoc
// @Summary      Quest progress
// @Description  Whole quest catalog with the target user's progress and claim states. Own chests and claim flags are included only for the authenticated owner.
// @Tags         Quests
// @Produce      json
// @Param        user_id query string false "User UUID (defaults to self)"
// @Success      200 {object} models.APIResponse
// @Router       /quests/progress [get]
func (h *QuestsHandler) GetProgress(c *gin.Context) {
	viewerID := httpx.AuthenticatedUserID(c)
	targetID := c.Query("user_id")
	if targetID == "" {
		targetID = viewerID
	}
	if targetID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return
	}
	// Others' progress honors the achievements privacy flag (moderators and
	// admins bypass, like the legacy user_achievements surface).
	if targetID != viewerID {
		canView, err := privacy.CanViewUserAchievements(h.db, viewerID, targetID)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		if !canView {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Achievements are hidden"))
			return
		}
	}
	isOwner := viewerID != "" && viewerID == targetID

	rows, err := h.db.Query(`
SELECT a.group_key, COALESCE(a.title, a.name, ''), COALESCE(a.category, ''),
       COALESCE(a.icon, 'sparkles'), COALESCE(a.sort_order, 0),
       COALESCE(ua.current_level, 0), COALESCE(ua.progress_current, 0),
       COALESCE(a.levels, '[]'::jsonb),
       COALESCE((
         SELECT json_agg(qc.level ORDER BY qc.level)
         FROM quest_claims qc WHERE qc.user_id = $1 AND qc.achievement_id = a.id
       ), '[]'::json)
FROM achievements a
LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND ua.user_id = $1
WHERE a.origin = 'code' AND COALESCE(a.kind, 'milestone') = 'milestone'
ORDER BY a.sort_order, a.group_key`, targetID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	quests := []QuestProgress{}
	unclaimed := 0
	for rows.Next() {
		var qp QuestProgress
		var levelsJSON []byte
		var claimedJSON []byte
		if err := rows.Scan(&qp.GroupKey, &qp.TitleKey, &qp.Category, &qp.Icon,
			&qp.SortOrder, &qp.CurrentLevel, &qp.ProgressCurrent, &levelsJSON, &claimedJSON); err != nil {
			continue
		}
		var levels []achievements.Level
		if err := json.Unmarshal(levelsJSON, &levels); err != nil {
			continue
		}
		var claimedLevels []int
		_ = json.Unmarshal(claimedJSON, &claimedLevels)
		claimedSet := map[int]bool{}
		for _, l := range claimedLevels {
			claimedSet[l] = true
		}
		qp.Levels = make([]QuestProgressLevel, 0, len(levels))
		for _, lvl := range levels {
			pl := QuestProgressLevel{
				Level: lvl.Level, Threshold: lvl.Threshold,
				NameKey: lvl.NameKey, DescriptionKey: lvl.DescriptionKey,
				Rewards:   lvl.Rewards,
				Completed: qp.CurrentLevel >= lvl.Level,
				Claimed:   claimedSet[lvl.Level],
			}
			pl.CanClaim = isOwner && pl.Completed && !pl.Claimed && len(lvl.Rewards) > 0
			if pl.CanClaim {
				unclaimed++
			}
			qp.Levels = append(qp.Levels, pl)
		}
		// Track comes from the catalog definition, not the mirror row.
		if h.engine != nil {
			if g, ok := h.engine.Catalog().Get(qp.GroupKey); ok {
				qp.Track = string(g.Track)
				if qp.Track == "" {
					qp.Track = "main"
				}
			}
		}
		quests = append(quests, qp)
	}

	var drops int
	_ = h.db.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", targetID).Scan(&drops)

	payload := gin.H{"user_id": targetID, "drops": drops, "unclaimed_count": unclaimed, "quests": quests}
	if isOwner {
		payload["chests"] = h.openChests(targetID)
	}
	c.JSON(http.StatusOK, models.SuccessResponse(payload))
}

func (h *QuestsHandler) openChests(userID string) []QuestChest {
	rows, err := h.db.Query(`
SELECT c.id::text, a.group_key, c.level, c.mechanic,
       c.created_at::text, c.opened_at::text
FROM quest_chests c
JOIN achievements a ON a.id = c.achievement_id
WHERE c.user_id = $1 AND c.opened_at IS NULL
ORDER BY c.created_at DESC LIMIT 50`, userID)
	if err != nil {
		return []QuestChest{}
	}
	defer rows.Close()
	out := []QuestChest{}
	for rows.Next() {
		var ch QuestChest
		var opened sql.NullString
		if err := rows.Scan(&ch.ID, &ch.QuestKey, &ch.Level, &ch.Mechanic, &ch.CreatedAt, &opened); err != nil {
			continue
		}
		if opened.Valid {
			ch.OpenedAt = &opened.String
		}
		out = append(out, ch)
	}
	return out
}

// ClaimRequest is the body of POST /quests/claim.
type ClaimRequest struct {
	QuestKey string `json:"quest_key" binding:"required"`
	Level    int    `json:"level" binding:"required"`
}

// Claim godoc
// @Summary      Claim a quest reward
// @Description  Grants the rewards of one completed quest level. Idempotent per (user, quest, level): repeats return 409 with no side effects.
// @Tags         Quests
// @Accept       json
// @Produce      json
// @Param        request body ClaimRequest true "Quest and level"
// @Success      200 {object} models.APIResponse
// @Router       /quests/claim [post]
// @Security     BearerAuth
func (h *QuestsHandler) Claim(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	var req ClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("quest_key and level are required"))
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	granted, err := h.engine.ClaimLevel(c.Request.Context(), claims.UserID, req.QuestKey, req.Level)
	switch err {
	case nil:
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"granted": granted}))
	case achievements.ErrQuestUnknown, achievements.ErrQuestLevelUnknown, achievements.ErrQuestNoReward:
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
	case achievements.ErrQuestNotCompleted:
		c.JSON(http.StatusUnprocessableEntity, models.ErrorResponse(err.Error()))
	case achievements.ErrQuestClaimed:
		c.JSON(http.StatusConflict, models.ErrorResponse(err.Error()))
	default:
		httpx.ServerError(c, "claim failed", err)
	}
}

// OpenChest godoc
// @Summary      Open a quest chest
// @Description  Plays a full chest session server-side and credits the rolled drops. One chest opens exactly once.
// @Tags         Quests
// @Produce      json
// @Param        id path string true "Chest UUID"
// @Success      200 {object} models.APIResponse
// @Router       /quests/chests/{id}/open [post]
// @Security     BearerAuth
func (h *QuestsHandler) OpenChest(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	res, err := h.engine.OpenChest(c.Request.Context(), claims.UserID, c.Param("id"))
	switch err {
	case nil:
		c.JSON(http.StatusOK, models.SuccessResponse(res))
	case achievements.ErrChestUnknown:
		c.JSON(http.StatusNotFound, models.ErrorResponse(err.Error()))
	case achievements.ErrChestOpened:
		c.JSON(http.StatusConflict, models.ErrorResponse(err.Error()))
	default:
		httpx.ServerError(c, "open failed", err)
	}
}
