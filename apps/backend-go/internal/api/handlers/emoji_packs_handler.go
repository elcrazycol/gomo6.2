package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
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
	for rows.Next() {
		var pack EmojiPackWithEmojis
		if err := rows.Scan(
			&pack.ID, &pack.Name, &pack.Slug, &pack.Description, &pack.IconURL,
			&pack.AuthorID, &pack.EmojiCount, &pack.SubscriberCount, &pack.IsPublic,
			&pack.CreatedAt, &pack.UpdatedAt,
		); err != nil {
			continue
		}

		emojiRows, queryErr := h.db.Query(`
			SELECT id, pack_id, name, image_url, is_animated, unicode_triggers
			FROM custom_emojis WHERE pack_id = $1 ORDER BY sort_order, created_at
		`, pack.ID)
		if queryErr == nil {
			pack.Emojis = make([]EmojiData, 0)
			for emojiRows.Next() {
				emoji, scanErr := scanEmojiRow(emojiRows)
				if scanErr == nil {
					pack.Emojis = append(pack.Emojis, emoji)
				}
			}
			emojiRows.Close()
		}
		packs = append(packs, pack)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(packs))
}

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

	type packWithEmojis struct {
		EmojiPackWithEmojis
		Emojis []EmojiData `json:"emojis"`
	}

	packs := make([]packWithEmojis, 0)
	for rows.Next() {
		var pack packWithEmojis
		if err := rows.Scan(
			&pack.ID, &pack.Name, &pack.Slug, &pack.Description, &pack.IconURL,
			&pack.AuthorID, &pack.EmojiCount, &pack.SubscriberCount, &pack.IsPublic,
			&pack.CreatedAt, &pack.UpdatedAt,
		); err != nil {
			continue
		}

		emojiRows, queryErr := h.db.Query(`
			SELECT id, pack_id, name, image_url, is_animated, unicode_triggers
			FROM custom_emojis WHERE pack_id = $1 ORDER BY sort_order, created_at
		`, pack.ID)
		if queryErr == nil {
			pack.Emojis = make([]EmojiData, 0)
			for emojiRows.Next() {
				emoji, scanErr := scanEmojiRow(emojiRows)
				if scanErr == nil {
					pack.Emojis = append(pack.Emojis, emoji)
				}
			}
			emojiRows.Close()
		}

		packs = append(packs, pack)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(packs))
}

type ResolveRequest struct {
	IDs []string `json:"ids"`
}

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
