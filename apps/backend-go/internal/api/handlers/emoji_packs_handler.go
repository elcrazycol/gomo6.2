package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
)

type EmojiPacksHandler struct {
	db *sql.DB
}

func NewEmojiPacksHandler(db *sql.DB) *EmojiPacksHandler {
	return &EmojiPacksHandler{db: db}
}

type EmojiData struct {
	ID              string   `json:"id"`
	PackID          string   `json:"pack_id"`
	Name            string   `json:"name"`
	ImageURL        string   `json:"image_url"`
	IsAnimated      bool     `json:"is_animated"`
	UnicodeTriggers []string `json:"unicode_triggers"`
}

type EmojiPackWithEmojis struct {
	ID              string      `json:"id"`
	Name            string      `json:"name"`
	Slug            string      `json:"slug"`
	Description     *string     `json:"description"`
	IconURL         *string     `json:"icon_url"`
	AuthorID        string      `json:"author_id"`
	EmojiCount      int         `json:"emoji_count"`
	SubscriberCount int         `json:"subscriber_count"`
	IsPublic        bool        `json:"is_public"`
	CreatedAt       string      `json:"created_at"`
	UpdatedAt       string      `json:"updated_at"`
	Emojis          []EmojiData `json:"emojis,omitempty"`
}

func decodeUnicodeTriggers(raw []byte) []string {
	if len(raw) == 0 {
		return []string{}
	}
	var triggers []string
	if err := json.Unmarshal(raw, &triggers); err != nil || triggers == nil {
		return []string{}
	}
	return triggers
}

func scanEmojiRow(scanner interface{ Scan(...any) error }) (EmojiData, error) {
	var emoji EmojiData
	var triggersRaw []byte
	err := scanner.Scan(
		&emoji.ID,
		&emoji.PackID,
		&emoji.Name,
		&emoji.ImageURL,
		&emoji.IsAnimated,
		&triggersRaw,
	)
	if err == nil {
		emoji.UnicodeTriggers = decodeUnicodeTriggers(triggersRaw)
	}
	return emoji, err
}

// loadEmojisForPacks fetches every emoji of the given packs in ONE query and
// returns them grouped by pack id (stable order preserved). This replaces the
// previous N+1 loop (one emoji query per pack) that made the subscriptions /
// own-packs endpoints slow for users with several installed packs.
func loadEmojisForPacks(db *sql.DB, packIDs []string) map[string][]EmojiData {
	result := make(map[string][]EmojiData, len(packIDs))
	if len(packIDs) == 0 {
		return result
	}
	rows, err := db.Query(`
		SELECT id, pack_id, name, image_url, is_animated, unicode_triggers
		FROM custom_emojis WHERE pack_id = ANY($1::uuid[])
		ORDER BY sort_order, created_at
	`, pq.Array(packIDs))
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		emoji, scanErr := scanEmojiRow(rows)
		if scanErr != nil {
			continue
		}
		result[emoji.PackID] = append(result[emoji.PackID], emoji)
	}
	return result
}

// packVisibleTo reports whether the given viewer may view a (possibly
// private) pack: public packs are visible to everyone, private packs only to
// their author and subscribers.
func packVisibleTo(db *sql.DB, packID, viewerID string) (bool, error) {
	if viewerID == "" {
		return false, nil
	}
	var visible bool
	err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM emoji_packs WHERE id = $1 AND author_id = $2
		) OR EXISTS(
			SELECT 1 FROM user_emoji_subscriptions WHERE user_id = $2 AND pack_id = $1
		)
	`, packID, viewerID).Scan(&visible)
	return visible, err
}

// GetPackBySlug godoc
// @Summary      Get emoji pack by slug
// @Description  Get a public emoji pack with its emojis by slug
// @Tags         Emoji
// @Produce      json
// @Param        slug path string true "Emoji pack slug"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /emoji_packs/by-slug/{slug} [get]
func (h *EmojiPacksHandler) GetPackBySlug(c *gin.Context) {
	slug := c.Param("slug")
	if slug == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("slug required"))
		return
	}

	var pack EmojiPackWithEmojis
	err := h.db.QueryRow(`
		SELECT id, name, slug, description, icon_url, author_id, emoji_count, subscriber_count, is_public, created_at, updated_at
		FROM emoji_packs WHERE slug = $1
	`, slug).Scan(
		&pack.ID, &pack.Name, &pack.Slug, &pack.Description, &pack.IconURL,
		&pack.AuthorID, &pack.EmojiCount, &pack.SubscriberCount, &pack.IsPublic,
		&pack.CreatedAt, &pack.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("pack not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("database error"))
		return
	}

	// Private packs are only visible to their author and subscribers; guessing
	// a slug must not expose a private pack's contents (or even its existence
	// beyond a 404) to strangers.
	if !pack.IsPublic {
		claims, ok := bearerClaims(c)
		if !ok {
			c.JSON(http.StatusNotFound, models.ErrorResponse("pack not found"))
			return
		}
		visible, visErr := packVisibleTo(h.db, pack.ID, claims.UserID)
		if visErr != nil || !visible {
			c.JSON(http.StatusNotFound, models.ErrorResponse("pack not found"))
			return
		}
	}

	rows, err := h.db.Query(`
		SELECT id, pack_id, name, image_url, is_animated, unicode_triggers
		FROM custom_emojis WHERE pack_id = $1 ORDER BY sort_order, created_at
	`, pack.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("database error"))
		return
	}
	defer rows.Close()

	pack.Emojis = make([]EmojiData, 0)
	for rows.Next() {
		emoji, scanErr := scanEmojiRow(rows)
		if scanErr == nil {
			pack.Emojis = append(pack.Emojis, emoji)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(pack))
}

// GetMyPacks godoc
// @Summary      Get my emoji packs
// @Description  List emoji packs authored by the authenticated user
// @Tags         Emoji
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /my-emoji-packs [get]
// @Security     BearerAuth
func (h *EmojiPacksHandler) GetMyPacks(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("unauthorized"))
		return
	}

	rows, err := h.db.Query(`
		SELECT id, name, slug, description, icon_url, author_id, emoji_count, subscriber_count, is_public, created_at, updated_at
		FROM emoji_packs WHERE author_id = $1 ORDER BY created_at DESC
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("database error"))
		return
	}
	defer rows.Close()

	packs := make([]EmojiPackWithEmojis, 0)
	packIDs := make([]string, 0)
	for rows.Next() {
		var pack EmojiPackWithEmojis
		if err := rows.Scan(
			&pack.ID, &pack.Name, &pack.Slug, &pack.Description, &pack.IconURL,
			&pack.AuthorID, &pack.EmojiCount, &pack.SubscriberCount, &pack.IsPublic,
			&pack.CreatedAt, &pack.UpdatedAt,
		); err != nil {
			continue
		}
		packs = append(packs, pack)
		packIDs = append(packIDs, pack.ID)
	}

	// Single batched emoji query instead of one query per pack (N+1).
	emojisByPack := loadEmojisForPacks(h.db, packIDs)
	for i := range packs {
		if emojis, ok := emojisByPack[packs[i].ID]; ok {
			packs[i].Emojis = emojis
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(packs))
}

// GetMySubscriptions godoc
// @Summary      Get my emoji subscriptions
// @Description  List emoji packs subscribed to by the authenticated user
// @Tags         Emoji
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /my-emoji-subscriptions [get]
// @Security     BearerAuth
func (h *EmojiPacksHandler) GetMySubscriptions(c *gin.Context) {
	claims, ok := bearerClaims(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("unauthorized"))
		return
	}

	rows, err := h.db.Query(`
		SELECT p.id, p.name, p.slug, p.description, p.icon_url, p.author_id, p.emoji_count, p.subscriber_count, p.is_public, p.created_at, p.updated_at
		FROM emoji_packs p
		JOIN user_emoji_subscriptions s ON s.pack_id = p.id
		WHERE s.user_id = $1
		ORDER BY s.created_at DESC
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("database error"))
		return
	}
	defer rows.Close()

	packs := make([]EmojiPackWithEmojis, 0)
	packIDs := make([]string, 0)
	for rows.Next() {
		var pack EmojiPackWithEmojis
		if err := rows.Scan(
			&pack.ID, &pack.Name, &pack.Slug, &pack.Description, &pack.IconURL,
			&pack.AuthorID, &pack.EmojiCount, &pack.SubscriberCount, &pack.IsPublic,
			&pack.CreatedAt, &pack.UpdatedAt,
		); err != nil {
			continue
		}
		packs = append(packs, pack)
		packIDs = append(packIDs, pack.ID)
	}

	// Single batched emoji query instead of one query per pack (N+1).
	emojisByPack := loadEmojisForPacks(h.db, packIDs)
	for i := range packs {
		if emojis, ok := emojisByPack[packs[i].ID]; ok {
			packs[i].Emojis = emojis
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(packs))
}

type ResolveRequest struct {
	IDs []string `json:"ids"`
}

// ResolveEmojis godoc
// @Summary      Resolve emojis
// @Description  Resolve custom emoji IDs to emoji data (also exposed as POST /api/rpc/resolve_emojis)
// @Tags         Emoji
// @Accept       json
// @Produce      json
// @Param        request body ResolveRequest true "Emoji IDs to resolve (max 200)"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /custom_emojis/resolve [post]
func (h *EmojiPacksHandler) ResolveEmojis(c *gin.Context) {
	var req ResolveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("invalid request"))
		return
	}

	if len(req.IDs) == 0 {
		c.JSON(http.StatusOK, models.SuccessResponse([]EmojiData{}))
		return
	}
	if len(req.IDs) > 200 {
		req.IDs = req.IDs[:200]
	}

	emojis := make([]EmojiData, 0, len(req.IDs))
	for _, id := range req.IDs {
		row := h.db.QueryRow(`
			SELECT id, pack_id, name, image_url, is_animated, unicode_triggers
			FROM custom_emojis WHERE id = $1
		`, id)
		emoji, err := scanEmojiRow(row)
		if err == nil {
			emojis = append(emojis, emoji)
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(emojis))
}
