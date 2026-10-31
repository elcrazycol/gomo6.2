package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// Daily quest surface: the rotating server-day set. Self only — every read
// settles yesterday (auto-grant + streak), so reads write and there is
// nothing to show another user.

// GetDaily godoc
// @Summary      Daily quests
// @Description  Today's three quests with progress, the streak and unopened daily chests. Settles yesterday first (completed-but-unclaimed auto-grants).
// @Tags         Quests
// @Produce      json
// @Router       /quests/daily [get]
// @Security     BearerAuth
func (h *QuestsHandler) GetDaily(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	progress, err := h.engine.GetDailyProgress(c.Request.Context(), claims.UserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(progress))
}

// DailyClaimRequest is the body of POST /quests/daily/claim.
type DailyClaimRequest struct {
	QuestKey string `json:"quest_key" binding:"required"`
}

// ClaimDaily godoc
// @Summary      Claim a daily quest reward
// @Description  Grants one completed quest of today. Closing the set drops the day's chest in the same transaction. Idempotent per (user, day, quest): repeats return 409.
// @Tags         Quests
// @Accept       json
// @Produce      json
// @Param        request body DailyClaimRequest true "Daily quest key"
// @Router       /quests/daily/claim [post]
// @Security     BearerAuth
func (h *QuestsHandler) ClaimDaily(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	var req DailyClaimRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("quest_key is required"))
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	granted, err := h.engine.ClaimDaily(c.Request.Context(), claims.UserID, req.QuestKey)
	switch err {
	case nil:
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"granted": granted}))
	case achievements.ErrQuestUnknown:
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
	case achievements.ErrQuestNotCompleted:
		c.JSON(http.StatusUnprocessableEntity, models.ErrorResponse(err.Error()))
	case achievements.ErrQuestClaimed:
		c.JSON(http.StatusConflict, models.ErrorResponse(err.Error()))
	default:
		httpx.ServerError(c, "claim failed", err)
	}
}

// RestoreDailyStreak godoc
// @Summary      Buy back a missed daily streak day
// @Description  Restores exactly one missed day (yesterday) for drops (base × streak, capped), so the series continues as if unbroken. Longer gaps are gone.
// @Tags         Quests
// @Produce      json
// @Router       /quests/daily/restore [post]
// @Security     BearerAuth
func (h *QuestsHandler) RestoreDailyStreak(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	streak, price, err := h.engine.RestoreStreak(c.Request.Context(), claims.UserID)
	switch err {
	case nil:
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"streak": streak, "price": price}))
	case achievements.ErrDailyNothingRestorable:
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
	case achievements.ErrDailyInsufficientDrops:
		c.JSON(http.StatusPaymentRequired, models.ErrorResponse(err.Error()))
	default:
		httpx.ServerError(c, "restore failed", err)
	}
}

// OpenDailyChest godoc
// @Summary      Open a daily chest
// @Description  Plays the full chest session server-side the moment the modal opens (credited at once, no backing out), and returns the outcome with the tap-by-tap trace the client replays. One chest opens exactly once.
// @Tags         Quests
// @Produce      json
// @Param        id path string true "Daily chest ID"
// @Router       /quests/daily/chests/{id}/open [post]
// @Security     BearerAuth
func (h *QuestsHandler) OpenDailyChest(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	if h.engine == nil {
		c.JSON(http.StatusServiceUnavailable, models.ErrorResponse("Quests unavailable"))
		return
	}
	res, err := h.engine.OpenDailyChest(c.Request.Context(), claims.UserID, c.Param("id"))
	switch err {
	case nil:
		c.JSON(http.StatusOK, models.SuccessResponse(res))
	case achievements.ErrChestUnknown, achievements.ErrChestOpened:
		c.JSON(http.StatusConflict, models.ErrorResponse(err.Error()))
	default:
		httpx.ServerError(c, "open failed", err)
	}
}
