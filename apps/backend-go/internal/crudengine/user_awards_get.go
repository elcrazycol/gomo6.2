package crudengine

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/privacy"
)

// handleUserAwardsGet returns a user's active hand-granted awards, each with its
// definition embedded as an "award" object (mirroring handleUserAchievementsGet).
// Only active rows (revoked_at IS NULL) are returned; the grant history stays in
// the table but is not part of the public profile surface.
//
// Visibility follows the same rule as achievements: the owner always sees them,
// friends of a private profile see them, and moderators/admins bypass the
// privacy flag. Everyone else gets an empty list.
func (h *Engine) handleUserAwardsGet(c *gin.Context) {
	viewerID := httpx.AuthenticatedUserID(c)
	targetUserID := strings.TrimPrefix(c.Query("user_id"), "eq.")
	if targetUserID == "" {
		if viewerID == "" {
			c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
			return
		}
		targetUserID = viewerID
	}

	canView, err := privacy.CanViewUserAchievements(h.db, viewerID, targetUserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if !canView && !h.isModeratorOrAdmin(viewerID) {
		c.JSON(http.StatusOK, models.SuccessResponse([]map[string]interface{}{}))
		return
	}

	rows, err := h.db.Query(`
SELECT ua.id, ua.user_id, ua.award_key, ua.awarded_by, ua.reason, ua.awarded_at,
  au.username AS awarded_by_username,
  COALESCE(
    json_build_object(
      'id', a.id::text,
      'group_key', a.group_key,
      'title', COALESCE(a.title, a.name),
      'name', a.name,
      'description', a.description,
      'icon', COALESCE(a.icon, 'sparkles'),
      'category', a.category,
      'origin', COALESCE(a.origin, 'code'),
      'image_url', a.image_url,
      'level_images', COALESCE(a.level_images, '{}'::jsonb),
      'owner_share', COALESCE(a.owner_share, '{}'::jsonb)
    ),
    '{}'::json
  ) AS award
FROM user_awards ua
LEFT JOIN achievements a ON a.group_key = ua.award_key
LEFT JOIN users au ON au.id = ua.awarded_by
WHERE ua.revoked_at IS NULL AND ua.user_id = $1
ORDER BY ua.awarded_at DESC`, targetUserID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	columns, _ := rows.Columns()
	var results []map[string]interface{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		valuePtrs := make([]interface{}, len(columns))
		for i := range columns {
			valuePtrs[i] = &values[i]
		}
		if err := rows.Scan(valuePtrs...); err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		row := make(map[string]interface{})
		for i, col := range columns {
			val := values[i]
			if col == "award" {
				row[col] = crud.DecodeJSONBMap(val)
				continue
			}
			if b, ok := val.([]byte); ok {
				row[col] = string(b)
			} else {
				row[col] = val
			}
		}
		results = append(results, row)
	}
	if results == nil {
		results = []map[string]interface{}{}
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}

// isModeratorOrAdmin reports whether the user holds the platform moderator or
// admin role. Used to let staff see hidden award lists (privacy bypass).
func (h *Engine) isModeratorOrAdmin(userID string) bool {
	if userID == "" {
		return false
	}
	var count int
	if err := h.db.QueryRow(
		`SELECT COUNT(*) FROM user_roles WHERE user_id = $1 AND role IN ('moderator', 'admin')`,
		userID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}
