package handlers

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"

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
	// Support Supabase filtering
	query := "SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at FROM boards"

	var args []interface{}
	var conditions []string

	// Handle select filter (Supabase style)
	if selectStr := c.Query("select"); selectStr != "" {
		// Parse select fields - for now, ignore and return all fields
	}

	// Handle eq filter (Supabase style)
	if slug := c.Query("slug"); slug != "" {
		s := slug
		if strings.HasPrefix(s, "eq.") {
			s = strings.TrimPrefix(s, "eq.")
		}
		conditions = append(conditions, "slug = $"+strconv.Itoa(len(args)+1))
		args = append(args, s)
	}

	if isGomosub := c.Query("is_gomosub"); isGomosub != "" {
		v := isGomosub
		if strings.HasPrefix(v, "eq.") {
			v = strings.TrimPrefix(v, "eq.")
		}
		conditions = append(conditions, "is_gomosub = $"+strconv.Itoa(len(args)+1))
		args = append(args, strings.EqualFold(v, "true"))
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

	// Handle ordering
	if order := c.Query("order"); order != "" {
		// Convert Supabase format "column.asc" to SQL "column ASC"
		if strings.Contains(order, ".") {
			parts := strings.Split(order, ".")
			if len(parts) == 2 {
				column := parts[0]
				direction := strings.ToUpper(parts[1])
				query += " ORDER BY " + column + " " + direction
			} else {
				query += " ORDER BY " + order
			}
		} else {
			query += " ORDER BY " + order
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
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
			c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
				Error: stringPtr(err.Error()),
			})
			return
		}
		boards = append(boards, board)
	}

	boardCount := len(boards)
	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data:  boards,
		Count: &boardCount,
	})
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
			c.JSON(http.StatusNotFound, models.SupabaseResponse{
				Error: stringPtr("Board not found"),
			})
			return
		}
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	c.JSON(http.StatusOK, models.SupabaseResponse{
		Data: board,
	})
}

func (h *BoardsHandler) CreateBoard(c *gin.Context) {
	var board models.Board
	if err := c.ShouldBindJSON(&board); err != nil {
		c.JSON(http.StatusBadRequest, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	// Get user ID from context (from JWT middleware)
	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.SupabaseResponse{
			Error: stringPtr("Not authenticated"),
		})
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
		c.JSON(http.StatusInternalServerError, models.SupabaseResponse{
			Error: stringPtr(err.Error()),
		})
		return
	}

	c.JSON(http.StatusCreated, models.SupabaseResponse{
		Data: board,
	})
}
