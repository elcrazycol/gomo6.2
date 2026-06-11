package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
)

// ─── GomoSub RPC handlers ───────────────────────────────────────────────────

// Reserved gomosub slugs (mirrors frontend list)
var reservedGomoSubSlugs = []string{
	"b", "pol", "a", "v", "mu", "fit", "d", "tv", "co", "int",
	"rules", "faq", "bugs", "g", "tech", "meta", "admin", "mod", "news",
}

func isReservedSlug(slug string) bool {
	for _, r := range reservedGomoSubSlugs {
		if slug == r {
			return true
		}
	}
	return false
}

var gomosubSlugRegex = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,24}$`)

// CreateGomoSub creates a new gomosub (board with is_gomosub=true).
// POST /api/rpc/create_gomosub — protected, requires auth.
func (h *RPCHandler) CreateGomoSub(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authorization required"))
		return
	}

	var req struct {
		Slug             string   `json:"slug"`
		Name             string   `json:"name"`
		Description      string   `json:"description"`
		RulesMarkdown    *string  `json:"rules_markdown"`
		CoverImageURL    *string  `json:"cover_image_url"`
		GomosubAvatarURL *string  `json:"gomosub_avatar_url"`
		GomosubTags      []string `json:"gomosub_tags"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Validate required fields
	req.Slug = strings.TrimSpace(strings.ToLower(req.Slug))
	req.Name = strings.TrimSpace(req.Name)
	req.Description = strings.TrimSpace(req.Description)

	if req.Slug == "" || req.Name == "" || req.Description == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("slug, name, and description are required"))
		return
	}

	// Validate slug format: /^[a-z0-9][a-z0-9_-]{1,24}$/
	if !gomosubSlugRegex.MatchString(req.Slug) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Слаг: латиница, цифры, - или _, от 2 до 25 символов"))
		return
	}

	// Check reserved slugs
	if isReservedSlug(req.Slug) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Слаг зарезервирован системой"))
		return
	}

	// Check slug uniqueness
	var existingID string
	err := h.db.QueryRow(`SELECT id FROM boards WHERE slug = $1`, req.Slug).Scan(&existingID)
	if err == nil {
		c.JSON(http.StatusConflict, models.ErrorResponse("Такой слаг уже занят"))
		return
	}
	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Build gomosub_tags JSON
	tagsJSON := "[]"
	if len(req.GomosubTags) > 0 {
		b, err := json.Marshal(req.GomosubTags)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Invalid tags format"))
			return
		}
		tagsJSON = string(b)
	}

	query := `
		INSERT INTO boards (slug, name, description, is_gomosub, is_rules_board, owner_id, 
		                   gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown)
		VALUES ($1, $2, $3, true, false, $4, $5, $6, $7::jsonb, $8)
		RETURNING id, slug, name, description, is_gomosub, is_rules_board, owner_id, 
		          gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
	`

	var board models.Board
	err = h.db.QueryRow(query,
		req.Slug, req.Name, req.Description,
		claims.UserID,
		req.GomosubAvatarURL, req.CoverImageURL,
		tagsJSON,
		req.RulesMarkdown,
	).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
		&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
	)

	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
			c.JSON(http.StatusConflict, models.ErrorResponse("Такой слаг уже занят"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(board))
}
