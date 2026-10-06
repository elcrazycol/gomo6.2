package handlers

import (
	"database/sql"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
)

// UserSettingsHandler persists a user's appearance preferences (theme, mode,
// time-of-day schedule, custom font, favourite themes) so they follow the user
// across devices. localStorage on the client is only a cache; this is the
// source of truth once the user is logged in.
//
// GET returns the row (or null when the user has never saved anything). PUT is
// a full replace: the client sends its whole appearance state and gets the
// stored row back.
type UserSettingsHandler struct {
	db *sql.DB
}

func NewUserSettingsHandler(db *sql.DB) *UserSettingsHandler {
	return &UserSettingsHandler{db: db}
}

type userSettings struct {
	ThemeID          string   `json:"theme_id"`
	ThemeMode        string   `json:"theme_mode"`
	TimeAuto         bool     `json:"time_auto"`
	CustomFont       string   `json:"custom_font"`
	FavoriteThemeIDs []string `json:"favorite_theme_ids"`
}

const (
	maxThemeIDLen    = 64
	maxThemeModeLen  = 8
	maxCustomFontLen = 64
	maxFavorites     = 64
)

// themeIDRE allows built-in ids (kebab/lowercase) and custom ones ("custom:ab12").
var themeIDRE = regexp.MustCompile(`^[a-zA-Z0-9:_-]+$`)

var allowedThemeModes = map[string]bool{"light": true, "dark": true, "system": true}

// sanitizeThemeID trims and validates a theme id; an invalid value is dropped.
func sanitizeThemeID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > maxThemeIDLen || !themeIDRE.MatchString(value) {
		return ""
	}
	return value
}

// sanitizeFavorites caps the list and drops malformed ids, preserving order.
func sanitizeFavorites(ids []string) []string {
	out := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		id = sanitizeThemeID(id)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
		if len(out) >= maxFavorites {
			break
		}
	}
	return out
}

func scanUserSettings(row *sql.Row) (*userSettings, error) {
	var s userSettings
	var themeID, themeMode, customFont sql.NullString
	var favorites pq.StringArray
	if err := row.Scan(&themeID, &themeMode, &s.TimeAuto, &customFont, &favorites); err != nil {
		return nil, err
	}
	s.ThemeID = themeID.String
	s.ThemeMode = themeMode.String
	s.CustomFont = customFont.String
	s.FavoriteThemeIDs = []string(favorites)
	if s.FavoriteThemeIDs == nil {
		s.FavoriteThemeIDs = []string{}
	}
	return &s, nil
}

// Get godoc
// @Summary      The viewer's appearance settings
// @Tags         UserSettings
// @Produce      json
// @Router       /user/settings [get]
func (h *UserSettingsHandler) Get(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	row := h.db.QueryRow(
		`SELECT theme_id, theme_mode, time_auto, custom_font, favorite_theme_ids
		 FROM user_settings WHERE user_id = $1`, userID)
	settings, err := scanUserSettings(row)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: nil})
		return
	}
	if err != nil {
		httpx.ServerError(c, "user settings read failed", err)
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: settings})
}

// Update godoc
// @Summary      Replace the viewer's appearance settings
// @Tags         UserSettings
// @Accept       json
// @Produce      json
// @Router       /user/settings [put]
func (h *UserSettingsHandler) Update(c *gin.Context) {
	userID := httpx.AuthenticatedUserID(c)
	if userID == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var body struct {
		ThemeID          string   `json:"theme_id"`
		ThemeMode        string   `json:"theme_mode"`
		TimeAuto         bool     `json:"time_auto"`
		CustomFont       string   `json:"custom_font"`
		FavoriteThemeIDs []string `json:"favorite_theme_ids"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}

	themeID := nullableSetting(sanitizeThemeID(body.ThemeID))
	mode := ""
	if m := strings.TrimSpace(body.ThemeMode); allowedThemeModes[m] && len(m) <= maxThemeModeLen {
		mode = m
	}
	modeValue := nullableSetting(mode)
	font := nullableSetting(truncateString(strings.TrimSpace(body.CustomFont), maxCustomFontLen))
	favorites := sanitizeFavorites(body.FavoriteThemeIDs)

	row := h.db.QueryRow(`
		INSERT INTO user_settings (user_id, theme_id, theme_mode, time_auto, custom_font, favorite_theme_ids, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			theme_id = EXCLUDED.theme_id,
			theme_mode = EXCLUDED.theme_mode,
			time_auto = EXCLUDED.time_auto,
			custom_font = EXCLUDED.custom_font,
			favorite_theme_ids = EXCLUDED.favorite_theme_ids,
			updated_at = NOW()
		RETURNING theme_id, theme_mode, time_auto, custom_font, favorite_theme_ids`,
		userID, themeID, modeValue, body.TimeAuto, font, pq.Array(favorites))

	settings, err := scanUserSettings(row)
	if err != nil {
		httpx.ServerError(c, "user settings write failed", err)
		return
	}
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: settings})
}

// nullableSetting turns an empty string into SQL NULL so a cleared setting is
// stored as "unset" rather than an empty value.
func nullableSetting(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

func truncateString(value string, max int) string {
	if len(value) > max {
		return value[:max]
	}
	return value
}
