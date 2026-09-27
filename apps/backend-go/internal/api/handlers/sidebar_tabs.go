package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
)

// SidebarTabsHandler serves custom sidebar tabs («вкладки»): a раздел/подраздел
// the viewer pinned to the sidebar, with their own label and an optional
// "open instead of the feed" flag. Private to the owner, synced across devices.
type SidebarTabsHandler struct {
	db *sql.DB
}

func NewSidebarTabsHandler(db *sql.DB) *SidebarTabsHandler {
	return &SidebarTabsHandler{db: db}
}

type sidebarTab struct {
	ID             string  `json:"id"`
	SectionSlug    string  `json:"section_slug"`
	SubsectionSlug *string `json:"subsection_slug"`
	Label          string  `json:"label"`
	IsHome         bool    `json:"is_home"`
}

const sidebarTabColumns = `id, section_slug, subsection_slug, label, is_home`

// listTabs returns the viewer's tabs in creation order.
func (h *SidebarTabsHandler) listTabs(userID string) ([]sidebarTab, error) {
	rows, err := h.db.Query(
		"SELECT "+sidebarTabColumns+" FROM user_sidebar_tabs WHERE user_id = $1 ORDER BY created_at, id",
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tabs := []sidebarTab{}
	for rows.Next() {
		var t sidebarTab
		var subsection sql.NullString
		if err := rows.Scan(&t.ID, &t.SectionSlug, &subsection, &t.Label, &t.IsHome); err != nil {
			return nil, err
		}
		t.SubsectionSlug = nullStringPtr(subsection)
		tabs = append(tabs, t)
	}
	return tabs, rows.Err()
}

// respondTabs writes the full updated list (mutations return it so the client
// never needs a follow-up GET).
func (h *SidebarTabsHandler) respondTabs(c *gin.Context, userID string) {
	tabs, err := h.listTabs(userID)
	if err != nil {
		httpx.ServerError(c, "sidebar tabs list failed", err)
		return
	}
	count := len(tabs)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: tabs, Count: &count})
}

// GetTabs godoc
// @Summary      The viewer's custom sidebar tabs
// @Tags         SidebarTabs
// @Produce      json
// @Router       /sidebar_tabs [get]
func (h *SidebarTabsHandler) GetTabs(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	h.respondTabs(c, userID)
}

// CreateTab godoc
// @Summary      Add a custom sidebar tab
// @Tags         SidebarTabs
// @Accept       json
// @Produce      json
// @Router       /sidebar_tabs [post]
func (h *SidebarTabsHandler) CreateTab(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var body struct {
		SectionSlug    string  `json:"section_slug"`
		SubsectionSlug *string `json:"subsection_slug"`
		Label          string  `json:"label"`
		IsHome         bool    `json:"is_home"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	body.SectionSlug = strings.TrimSpace(body.SectionSlug)
	body.Label = strings.TrimSpace(body.Label)
	if body.SectionSlug == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "section_slug required"})
		return
	}
	if len(body.Label) == 0 {
		body.Label = body.SectionSlug
	}
	if len(body.Label) > 64 {
		body.Label = body.Label[:64]
	}
	if body.SubsectionSlug != nil {
		trimmed := strings.TrimSpace(*body.SubsectionSlug)
		if trimmed == "" {
			body.SubsectionSlug = nil
		} else {
			body.SubsectionSlug = &trimmed
		}
	}

	if body.IsHome {
		if _, err := h.db.Exec("UPDATE user_sidebar_tabs SET is_home = FALSE WHERE user_id = $1", userID); err != nil {
			httpx.ServerError(c, "sidebar tab home reset failed", err)
			return
		}
	}

	if _, err := h.db.Exec(`
		INSERT INTO user_sidebar_tabs (user_id, section_slug, subsection_slug, label, is_home)
		VALUES ($1, $2, $3, $4, $5)`,
		userID, body.SectionSlug, body.SubsectionSlug, body.Label, body.IsHome); err != nil {
		httpx.ServerError(c, "sidebar tab insert failed", err)
		return
	}
	h.respondTabs(c, userID)
}

// UpdateTab godoc
// @Summary      Update a custom sidebar tab (label / home flag)
// @Tags         SidebarTabs
// @Accept       json
// @Produce      json
// @Router       /sidebar_tabs/{id} [put]
func (h *SidebarTabsHandler) UpdateTab(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	id := c.Param("id")
	if !isUUID(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var body struct {
		Label  *string `json:"label"`
		IsHome *bool   `json:"is_home"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	if body.IsHome != nil && *body.IsHome {
		if _, err := h.db.Exec(
			"UPDATE user_sidebar_tabs SET is_home = FALSE WHERE user_id = $1 AND id <> $2", userID, id); err != nil {
			httpx.ServerError(c, "sidebar tab home reset failed", err)
			return
		}
	}
	if body.Label != nil {
		label := strings.TrimSpace(*body.Label)
		if len(label) > 64 {
			label = label[:64]
		}
		if label != "" {
			if _, err := h.db.Exec(
				"UPDATE user_sidebar_tabs SET label = $1 WHERE user_id = $2 AND id = $3", label, userID, id); err != nil {
				httpx.ServerError(c, "sidebar tab label update failed", err)
				return
			}
		}
	}
	if body.IsHome != nil {
		if _, err := h.db.Exec(
			"UPDATE user_sidebar_tabs SET is_home = $1 WHERE user_id = $2 AND id = $3", *body.IsHome, userID, id); err != nil {
			httpx.ServerError(c, "sidebar tab home update failed", err)
			return
		}
	}

	h.respondTabs(c, userID)
}

// DeleteTab godoc
// @Summary      Delete a custom sidebar tab
// @Tags         SidebarTabs
// @Produce      json
// @Router       /sidebar_tabs/{id} [delete]
func (h *SidebarTabsHandler) DeleteTab(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	id := c.Param("id")
	if !isUUID(id) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if _, err := h.db.Exec(
		"DELETE FROM user_sidebar_tabs WHERE user_id = $1 AND id = $2", userID, id); err != nil {
		httpx.ServerError(c, "sidebar tab delete failed", err)
		return
	}
	h.respondTabs(c, userID)
}
