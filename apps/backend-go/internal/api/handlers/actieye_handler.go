package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/actieye"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// ActiEyeHandler serves the ActiEye activity summary.
type ActiEyeHandler struct {
	db *sql.DB
}

// NewActiEyeHandler wires the handler. db may be nil in tests where the
// endpoint is never called.
func NewActiEyeHandler(db *sql.DB) *ActiEyeHandler {
	return &ActiEyeHandler{db: db}
}

// GetSummary returns the authenticated user's activity summary: counters
// feeding the gradient, the daily-visit streak and the last-30-days road.
//
// GetSummary godoc
// @Summary      Get ActiEye activity summary
// @Description  Per-user counters (posts/comments/likes), visit streaks and the last 30 days road.
// @Tags         ActiEye
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Router       /actieye [get]
func (h *ActiEyeHandler) GetSummary(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return
	}

	s, err := actieye.Fetch(c.Request.Context(), h.db, userID)
	if err != nil {
		httpx.ServerError(c, "actieye summary", err)
		return
	}

	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: s})
}
