package handlers

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/linkpreview"
	"github.com/gomo6/backend/internal/models"
)

// LinkPreviewHandler serves OpenGraph previews for link cards.
type LinkPreviewHandler struct {
	fetcher *linkpreview.Fetcher
}

func NewLinkPreviewHandler(fetcher *linkpreview.Fetcher) *LinkPreviewHandler {
	return &LinkPreviewHandler{fetcher: fetcher}
}

type linkPreviewRequest struct {
	URL string `json:"url"`
}

// Get fetches a preview for the posted URL.
func (h *LinkPreviewHandler) Get(c *gin.Context) {
	var body linkPreviewRequest
	if err := c.ShouldBindJSON(&body); err != nil || strings.TrimSpace(body.URL) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("url is required"))
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
	defer cancel()

	preview, err := h.fetcher.Fetch(ctx, body.URL)
	if err != nil {
		c.JSON(http.StatusUnprocessableEntity, models.ErrorResponse("Could not fetch link preview"))
		return
	}
	c.JSON(http.StatusOK, models.SuccessResponse(preview))
}
