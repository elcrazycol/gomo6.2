package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

type BoardsHandler struct {
	db *sql.DB
}

func NewBoardsHandler(db *sql.DB) *BoardsHandler {
	return &BoardsHandler{db: db}
}

func (h *BoardsHandler) GetBoards(c *gin.Context) {
	// Support filtering
	query := "SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at FROM boards"

	var args []interface{}
	var conditions []string

	// Handle eq filter (query style) — select filter ignored, all fields returned
	if slug := c.Query("slug"); slug != "" {
		s := strings.TrimPrefix(slug, "eq.")
		conditions = append(conditions, "slug = $"+strconv.Itoa(len(args)+1))
		args = append(args, s)
	}

	if isGomosub := c.Query("is_gomosub"); isGomosub != "" {
		v := strings.TrimPrefix(isGomosub, "eq.")
		conditions = append(conditions, "is_gomosub = $"+strconv.Itoa(len(args)+1))
		args = append(args, strings.EqualFold(v, "true"))
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	// Handle ordering — supports multiple order params
	if orders := c.QueryArray("order"); len(orders) > 0 {
		joined := ""
		for i, o := range orders {
			if i > 0 {
				joined += ","
			}
			joined += o
		}
		if s, ok := parseOrderClause(joined, ""); ok {
			query += " ORDER BY " + s
		}
	} else {
		query += " ORDER BY created_at DESC"
	}

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

	var boards []models.Board
	for rows.Next() {
		var board models.Board
		err := rows.Scan(
			&board.ID, &board.Slug, &board.Name, &board.Description,
			&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
			&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
			&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		boards = append(boards, board)
	}

	boardCount := len(boards)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: boards, Count: &boardCount})
}

func (h *BoardsHandler) GetBoard(c *gin.Context) {
	slug := c.Param("slug")

	query := `
		SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, 
		       gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
		FROM boards 
		WHERE slug = $1
	`

	var board models.Board
	err := h.db.QueryRow(query, slug).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
		&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(board))
}

func (h *BoardsHandler) CreateBoard(c *gin.Context) {
	var board models.Board
	if err := c.ShouldBindJSON(&board); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Get user ID from context (from JWT middleware)
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	query := `
		INSERT INTO boards (slug, name, description, is_gomosub, is_rules_board, owner_id, gomosub_avatar_url, cover_image_url, gomosub_tags)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, slug, name, description, is_gomosub, is_rules_board, owner_id, gomosub_avatar_url, cover_image_url, gomosub_tags, created_at
	`

	err := h.db.QueryRow(query,
		board.Slug, board.Name, board.Description, board.IsGomosub, board.IsRulesBoard,
		userClaims.UserID, board.GomosubAvatarURL, board.CoverImageURL, board.GomosubTags,
	).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags, &board.CreatedAt,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(board))
}

// UpdateBoard updates a board; only the owner may change it (gomosub settings, etc.).
func (h *BoardsHandler) UpdateBoard(c *gin.Context) {
	id := c.Param("id")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var ownerID sql.NullString
	err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, id).Scan(&ownerID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !ownerID.Valid || ownerID.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the board owner can update settings"))
		return
	}

	var updates struct {
		Name             *string          `json:"name"`
		Description      *string          `json:"description"`
		RulesMarkdown    *string          `json:"rules_markdown"`
		GomosubAvatarURL *string          `json:"gomosub_avatar_url"`
		CoverImageURL    *string          `json:"cover_image_url"`
		GomosubTags      *json.RawMessage `json:"gomosub_tags"`
	}
	if err := c.ShouldBindJSON(&updates); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var sets []string
	var args []interface{}
	n := 1

	if updates.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", n))
		args = append(args, *updates.Name)
		n++
	}
	if updates.Description != nil {
		sets = append(sets, fmt.Sprintf("description = $%d", n))
		args = append(args, *updates.Description)
		n++
	}
	if updates.RulesMarkdown != nil {
		// Only update rules_updated_at if the content actually changed
		var oldRulesMarkdown sql.NullString
		_ = h.db.QueryRow(`SELECT rules_markdown FROM boards WHERE id = $1`, id).Scan(&oldRulesMarkdown)
		oldVal := ""
		if oldRulesMarkdown.Valid {
			oldVal = oldRulesMarkdown.String
		}
		newVal := *updates.RulesMarkdown
		sets = append(sets, fmt.Sprintf("rules_markdown = $%d", n))
		args = append(args, newVal)
		n++
		if oldVal != newVal {
			sets = append(sets, fmt.Sprintf("rules_updated_at = $%d", n))
			args = append(args, time.Now().UTC())
			n++
		}
	}
	if updates.GomosubAvatarURL != nil {
		sets = append(sets, fmt.Sprintf("gomosub_avatar_url = $%d", n))
		args = append(args, *updates.GomosubAvatarURL)
		n++
	}
	if updates.CoverImageURL != nil {
		sets = append(sets, fmt.Sprintf("cover_image_url = $%d", n))
		args = append(args, *updates.CoverImageURL)
		n++
	}
	if updates.GomosubTags != nil {
		raw := []byte(*updates.GomosubTags)
		if len(raw) == 0 || string(raw) == "null" {
			sets = append(sets, "gomosub_tags = '[]'::jsonb")
		} else {
			sets = append(sets, fmt.Sprintf("gomosub_tags = $%d::jsonb", n))
			args = append(args, raw)
			n++
		}
	}

	if len(sets) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("no fields to update"))
		return
	}

	query := "UPDATE boards SET " + strings.Join(sets, ", ") + fmt.Sprintf(" WHERE id = $%d", n)
	args = append(args, id)

	_, err = h.db.Exec(query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	var board models.Board
	err = h.db.QueryRow(`
		SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id,
		       gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
		FROM boards WHERE id = $1
	`, id).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
		&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(board))
}
