package handlers

import (
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/crud"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	profilepkg "github.com/gomo6/backend/internal/profiles"
	"github.com/google/uuid"
)

// publicCustomizationColumns is the display subset of profile_customization:
// the fields every viewer needs to render this user's nickname style, badge and
// profile background. Owner-only columns are deliberately absent — custom_css
// and language are settings, not appearance, and nothing outside the owner's own
// screens ever reads them.
const publicCustomizationColumns = `username_css, profile_badge_text, profile_badge_css,
	background_url, background_variant, background_color, card_background,
	text_color, theme_color, theme_enabled, theme_tokens, font_family,
	font_size, layout_type`

// GetUserCustomization returns the public (display) part of a user's profile
// customization: nickname CSS, badge, and the profile appearance tokens.
//
// Public by design — a guest must be able to render another user's nickname
// styling, and the generic /profile_customization endpoint cannot serve it
// because TableMeta.UserScopedRead forces every read to the caller's own
// user_id. That scoping is why a foreign viewer always received an empty row and
// never saw anyone else's nickname colour (the same gap /users/:id/privacy
// closes for the viewer-scoped privacy_settings table).
//
// User-supplied CSS is run through the same profiles.SanitizeProfileCustomizationRow
// the owner's own read path uses, so a visitor can never be served more than the
// owner sees, and rows written before the write-path sanitizer existed come out
// neutralized.
func (h *ProfilesHandler) GetUserCustomization(c *gin.Context) {
	userID := c.Param("id")
	if userID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id required"))
		return
	}
	if _, err := uuid.Parse(userID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user_id"))
		return
	}

	rows, err := h.db.Query(
		`SELECT `+publicCustomizationColumns+` FROM profile_customization WHERE user_id = $1`,
		userID,
	)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	if !rows.Next() {
		// No row: the user never customized anything. 200 + an explicit null
		// payload matches what the owner-scoped single-row read returned for
		// "nothing saved" (json.RawMessage because APIResponse.Data is
		// omitempty and would otherwise drop the key entirely), so the
		// frontend renders the neutral defaults with no special case.
		c.JSON(http.StatusOK, models.SuccessResponse(json.RawMessage("null")))
		return
	}

	row, err := crud.ScanRowToMap(rows)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	profilepkg.SanitizeProfileCustomizationRow(row)

	c.JSON(http.StatusOK, models.SuccessResponse(row))
}
