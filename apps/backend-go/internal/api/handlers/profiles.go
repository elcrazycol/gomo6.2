package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type ProfilesHandler struct {
	db                 *sql.DB
	redis              *redis.Client
	achievementChecker *AchievementChecker
}

func NewProfilesHandler(db *sql.DB) *ProfilesHandler {
	return &ProfilesHandler{db: db}
}

func (h *ProfilesHandler) SetAchievementChecker(ac *AchievementChecker) {
	h.achievementChecker = ac
}

// SetRedis sets the Redis client for cache invalidation
func (h *ProfilesHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

// GetProfiles godoc
// @Summary      List profiles
// @Description  Get user profiles with optional filters
// @Tags         Profiles
// @Produce      json
// @Param        id       query string false "Filter by user ID (eq.uuid or in.(uuid,...))"
// @Param        username query string false "Filter by username"
// @Param        domain   query string false "Filter by domain"
// @Param        limit    query int    false "Max results (1-100)" default(50)
// @Param        offset   query int    false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Router       /profiles [get]
func (h *ProfilesHandler) GetProfiles(c *gin.Context) {
	query := `
		SELECT id, username, display_name, email, domain, avatar_url, bio, bio_json, garma, post_count,
		       thread_count, is_online, last_seen_at, created_at, is_remote, is_anonymous
		FROM users
	`

	var args []interface{}
	var conditions []string

	// Handle id filter
	if id := c.Query("id"); id != "" {
		// Support filters: eq.<uuid> and in.(uuid1,uuid2)
		if strings.HasPrefix(id, "eq.") {
			id = id[3:]
			conditions = append(conditions, "id = $"+strconv.Itoa(len(args)+1))
			args = append(args, id)
		} else if strings.HasPrefix(id, "in.(") && strings.HasSuffix(id, ")") {
			rawIDs := strings.TrimSuffix(strings.TrimPrefix(id, "in.("), ")")
			ids := strings.Split(rawIDs, ",")
			placeholders := make([]string, len(ids))
			baseIndex := len(args)
			for i := range ids {
				placeholders[i] = "$" + strconv.Itoa(baseIndex+i+1)
				args = append(args, strings.TrimSpace(ids[i]))
			}
			conditions = append(conditions, "id IN ("+strings.Join(placeholders, ",")+")")
		} else {
			conditions = append(conditions, "id = $"+strconv.Itoa(len(args)+1))
			args = append(args, id)
		}
	}

	// Handle username filter
	if username := c.Query("username"); username != "" {
		username = strings.TrimPrefix(username, "eq.")
		conditions = append(conditions, "username = $"+strconv.Itoa(len(args)+1))
		args = append(args, username)
	}

	// Handle domain filter
	if domain := c.Query("domain"); domain != "" {
		domain = strings.TrimPrefix(domain, "eq.")
		conditions = append(conditions, "domain = $"+strconv.Itoa(len(args)+1))
		args = append(args, domain)
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	if idq := c.Query("id"); idq != "" {
		singleID := ""
		if strings.HasPrefix(idq, "eq.") {
			singleID = strings.TrimPrefix(idq, "eq.")
		} else if !strings.HasPrefix(idq, "in.(") {
			singleID = idq
		}
		if singleID != "" {
			if _, err := uuid.Parse(singleID); err == nil {
				RecomputeUserProfileStats(h.db, singleID)
			}
		}
	}

	// Handle ordering
	query += " ORDER BY created_at DESC"

	// Handle pagination
	limit := 50
	offset := 0

	if limitStr := c.Query("limit"); limitStr != "" {
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 100 {
			limit = l
		}
	}

	if offsetStr := c.Query("offset"); offsetStr != "" {
		if o, err := strconv.Atoi(offsetStr); err == nil && o >= 0 {
			offset = o
		}
	}

	query += " LIMIT $" + strconv.Itoa(len(args)+1) + " OFFSET $" + strconv.Itoa(len(args)+2)
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var profiles []models.User
	for rows.Next() {
		var profile models.User
		var bioJSON sql.NullString
		err := rows.Scan(
			&profile.ID, &profile.Username, &profile.DisplayName, &profile.Email, &profile.Domain,
			&profile.AvatarURL, &profile.Bio, &bioJSON, &profile.Garma, &profile.PostCount,
			&profile.ThreadCount, &profile.IsOnline, &profile.LastSeen, &profile.CreatedAt,
			&profile.IsRemote, &profile.IsAnonymous,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		if bioJSON.Valid && len(bioJSON.String) > 0 {
			profile.BioJSON = json.RawMessage([]byte(bioJSON.String))
		}
		profiles = append(profiles, profile)
	}

	// Private profile: strip sensitive fields for non-friends
	var viewerID string
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok {
			viewerID = uc.UserID
		}
	}
	for i := range profiles {
		shouldFilter, ps, err := ShouldFilterPrivateProfile(h.db, viewerID, profiles[i].ID)
		if err == nil && shouldFilter {
			if ps.PrivateHideAvatar {
				profiles[i].AvatarURL = nil
			}
			profiles[i].Bio = nil
			profiles[i].BioJSON = nil
			profiles[i].Email = nil
			profiles[i].Garma = nil
			profiles[i].PostCount = nil
			profiles[i].ThreadCount = nil
			profiles[i].IsOnline = false
			profiles[i].LastSeen = nil
		}
	}

	profileCount := len(profiles)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: profiles, Count: &profileCount})
}

// GetProfile godoc
// @Summary      Get profile
// @Description  Get a user profile by ID
// @Tags         Profiles
// @Produce      json
// @Param        id path string true "User ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /profiles/{id} [get]
func (h *ProfilesHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")
	if _, err := uuid.Parse(id); err == nil {
		RecomputeUserProfileStats(h.db, id)
	}

	query := `
		SELECT id, username, display_name, email, domain, avatar_url, bio, bio_json, garma, post_count,
		       thread_count, is_online, last_seen_at, created_at, is_remote, is_anonymous
		FROM users
		WHERE id = $1
	`

	var profile models.User
	var bioJSON sql.NullString
	err := h.db.QueryRow(query, id).Scan(
		&profile.ID, &profile.Username, &profile.DisplayName, &profile.Email, &profile.Domain,
		&profile.AvatarURL, &profile.Bio, &bioJSON, &profile.Garma, &profile.PostCount,
		&profile.ThreadCount, &profile.IsOnline, &profile.LastSeen, &profile.CreatedAt,
		&profile.IsRemote, &profile.IsAnonymous,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Profile not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if bioJSON.Valid && len(bioJSON.String) > 0 {
		profile.BioJSON = json.RawMessage([]byte(bioJSON.String))
	}

	// Private profile: strip sensitive fields for non-friends
	var viewerID string
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok {
			viewerID = uc.UserID
		}
	}
	shouldFilter, ps, err := ShouldFilterPrivateProfile(h.db, viewerID, id)
	if err == nil && shouldFilter {
		if ps.PrivateHideAvatar {
			profile.AvatarURL = nil
		}
		profile.Bio = nil
		profile.BioJSON = nil
		profile.Email = nil
		profile.Garma = nil
		profile.PostCount = nil
		profile.ThreadCount = nil
		profile.IsOnline = false
		profile.LastSeen = nil
	}

	c.JSON(http.StatusOK, models.SuccessResponse(profile))
}

// UpdateProfile godoc
// @Summary      Update profile
// @Description  Update user profile (own profile only)
// @Tags         Profiles
// @Accept       json
// @Produce      json
// @Param        id path string true "User ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /profiles/{id} [put]
// @Security     BearerAuth
func (h *ProfilesHandler) UpdateProfile(c *gin.Context) {
	id := c.Param("id")

	// Get user ID from context
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Check if user is updating their own profile
	if userClaims.UserID != id {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Can only update your own profile"))
		return
	}

	var updates struct {
		AvatarURL   *string          `json:"avatar_url"`
		Bio         *string          `json:"bio"`
		BioJSON     *json.RawMessage `json:"bio_json"`
		DisplayName *string          `json:"display_name"`
		Username    *string          `json:"username"`
		IsAnonymous *bool            `json:"is_anonymous"`
	}

	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Build dynamic update query
	query := "UPDATE users SET updated_at = NOW()"
	var args []interface{}
	argIndex := 1

	if updates.AvatarURL != nil {
		query += ", avatar_url = $" + strconv.Itoa(argIndex)
		args = append(args, *updates.AvatarURL)
		argIndex++
	}

	if updates.Bio != nil {
		query += ", bio = $" + strconv.Itoa(argIndex)
		args = append(args, *updates.Bio)
		argIndex++
	}

	if updates.BioJSON != nil {
		raw := []byte(*updates.BioJSON)
		if len(raw) == 0 || string(raw) == "null" {
			query += ", bio_json = NULL"
		} else {
			query += ", bio_json = $" + strconv.Itoa(argIndex)
			args = append(args, raw)
			argIndex++
		}
	}

	if updates.DisplayName != nil {
		query += ", display_name = $" + strconv.Itoa(argIndex)
		args = append(args, *updates.DisplayName)
		argIndex++
	}

	if updates.Username != nil {
		newUsername := *updates.Username
		if len(newUsername) < 3 || len(newUsername) > 20 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Юзернейм должен быть от 3 до 20 символов"))
			return
		}
		if !validUsername.MatchString(newUsername) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Юзернейм может содержать только буквы латиницы и цифры (a-z, A-Z, 0-9)"))
			return
		}
		// Check uniqueness
		var exists bool
		err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE username = $1 AND id != $2)", newUsername, id).Scan(&exists)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Database error"))
			return
		}
		if exists {
			c.JSON(http.StatusConflict, models.ErrorResponse("Этот юзернейм уже занят"))
			return
		}
		query += ", username = $" + strconv.Itoa(argIndex)
		args = append(args, newUsername)
		argIndex++
	}

	if updates.IsAnonymous != nil {
		query += ", is_anonymous = $" + strconv.Itoa(argIndex)
		args = append(args, *updates.IsAnonymous)
		argIndex++
	}

	query += " WHERE id = $" + strconv.Itoa(argIndex)
	args = append(args, id)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Invalidate cache for this profile
	if h.redis != nil {
		middleware.InvalidateCacheForProfile(h.redis, id)
	}

	// Check profile achievements (avatar, bio)
	if h.achievementChecker != nil {
		if updates.AvatarURL != nil && *updates.AvatarURL != "" {
			go h.achievementChecker.AwardOneTime(id, "avatar")
		}
		if updates.Bio != nil && *updates.Bio != "" {
			go h.achievementChecker.AwardOneTime(id, "bio")
		}
	}

	// Return updated profile
	h.GetProfile(c)
}
