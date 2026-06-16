package handlers

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/models"
	"github.com/redis/go-redis/v9"
)

type BoardsHandler struct {
	db    *sql.DB
	redis *redis.Client
}

func NewBoardsHandler(db *sql.DB) *BoardsHandler {
	return &BoardsHandler{db: db}
}

func (h *BoardsHandler) SetRedis(redis *redis.Client) {
	h.redis = redis
}

func generateInviteCode() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *BoardsHandler) GetBoards(c *gin.Context) {
	query := "SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, visibility, gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at FROM boards"

	var args []interface{}
	var conditions []string

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

	if visibility := c.Query("visibility"); visibility != "" {
		v := strings.TrimPrefix(visibility, "eq.")
		if v == "public" || v == "private" {
			conditions = append(conditions, "visibility = $"+strconv.Itoa(len(args)+1))
			args = append(args, v)
		}
	}

	if len(conditions) > 0 {
		query += " WHERE " + conditions[0]
		for i := 1; i < len(conditions); i++ {
			query += " AND " + conditions[i]
		}
	}

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
			&board.Visibility,
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
	slug := c.Param("id")

	query := `
		SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, visibility,
		       gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
		FROM boards 
		WHERE slug = $1
	`

	var board models.Board
	err := h.db.QueryRow(query, slug).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.Visibility,
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

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}

	userClaims := claims.(*auth.Claims)

	// Default visibility to public if not set
	if board.Visibility == "" {
		board.Visibility = "public"
	}

	query := `
		INSERT INTO boards (slug, name, description, is_gomosub, is_rules_board, owner_id, visibility, gomosub_avatar_url, cover_image_url, gomosub_tags)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
		RETURNING id, slug, name, description, is_gomosub, is_rules_board, owner_id, visibility, gomosub_avatar_url, cover_image_url, gomosub_tags, created_at
	`

	err := h.db.QueryRow(query,
		board.Slug, board.Name, board.Description, board.IsGomosub, board.IsRulesBoard,
		userClaims.UserID, board.Visibility, board.GomosubAvatarURL, board.CoverImageURL, board.GomosubTags,
	).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.Visibility,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags, &board.CreatedAt,
	)

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(board))
}

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
		Visibility       *string          `json:"visibility"`
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
	if updates.Visibility != nil {
		v := *updates.Visibility
		if v == "public" || v == "private" {
			sets = append(sets, fmt.Sprintf("visibility = $%d", n))
			args = append(args, v)
			n++
		}
	}
	if updates.RulesMarkdown != nil {
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

	if h.redis != nil {
		var boardSlug string
		if err := h.db.QueryRow(`SELECT slug FROM boards WHERE id = $1`, id).Scan(&boardSlug); err == nil {
			cache.InvalidateForBoard(h.redis, id, boardSlug)
		}
	}

	var board models.Board
	err = h.db.QueryRow(`
		SELECT id, slug, name, description, is_gomosub, is_rules_board, owner_id, visibility,
		       gomosub_avatar_url, cover_image_url, gomosub_tags, rules_markdown, rules_updated_at, created_at
		FROM boards WHERE id = $1
	`, id).Scan(
		&board.ID, &board.Slug, &board.Name, &board.Description,
		&board.IsGomosub, &board.IsRulesBoard, &board.OwnerID,
		&board.Visibility,
		&board.GomosubAvatarURL, &board.CoverImageURL, &board.GomosubTags,
		&board.RulesMarkdown, &board.RulesUpdatedAt, &board.CreatedAt,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(board))
}

// ─── Invite endpoints ──────────────────────────────────────────────────────

// CreateInvite — POST /api/v1/boards/:id/invites
// Only the board owner can create invites. Only for PRIVATE gomosubs.
func (h *BoardsHandler) CreateInvite(c *gin.Context) {
	boardID := c.Param("id")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var boardOwner sql.NullString
	var boardVisibility string
	err := h.db.QueryRow(`SELECT owner_id, COALESCE(visibility, 'public') FROM boards WHERE id = $1`, boardID).Scan(&boardOwner, &boardVisibility)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !boardOwner.Valid || boardOwner.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the board owner can create invites"))
		return
	}
	if boardVisibility != "private" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invites are only for private gomosubs"))
		return
	}

	var req struct {
		MaxUses   int     `json:"max_uses"`
		ExpiresAt *string `json:"expires_at"` // ISO 8601 or null
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	var expiresAt *time.Time
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid expires_at format, use ISO 8601"))
			return
		}
		expiresAt = &t
	}

	code := generateInviteCode()

	var invite models.GomosubInvite
	err = h.db.QueryRow(`
		INSERT INTO gomosub_invites (board_id, code, created_by, max_uses, expires_at)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, board_id, code, created_by, max_uses, current_uses, expires_at, created_at, is_active
	`, boardID, code, userClaims.UserID, req.MaxUses, expiresAt).Scan(
		&invite.ID, &invite.BoardID, &invite.Code, &invite.CreatedBy,
		&invite.MaxUses, &invite.CurrentUses, &invite.ExpiresAt, &invite.CreatedAt, &invite.IsActive,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Invalidate cache for invites
	if h.redis != nil {
		cache.InvalidateForTable(h.redis, "gomosub_invites", map[string]string{"board_id": boardID})
		// Also invalidate the dedicated handler cache key (GET /api/v1/boards/:id/invites)
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/boards/%s/invites*", boardID))
	}

	c.JSON(http.StatusCreated, models.SuccessResponse(invite))
}

// GetInvites — GET /api/v1/boards/:id/invites
// Returns all invites for a board (only the owner can see them).
func (h *BoardsHandler) GetInvites(c *gin.Context) {
	boardID := c.Param("id")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var boardOwner sql.NullString
	err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&boardOwner)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !boardOwner.Valid || boardOwner.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the board owner can view invites"))
		return
	}

	rows, err := h.db.Query(`
		SELECT id, board_id, code, created_by, max_uses, current_uses, expires_at, created_at, is_active
		FROM gomosub_invites
		WHERE board_id = $1
		ORDER BY created_at DESC
	`, boardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var invites []models.GomosubInvite
	for rows.Next() {
		var inv models.GomosubInvite
		if err := rows.Scan(&inv.ID, &inv.BoardID, &inv.Code, &inv.CreatedBy, &inv.MaxUses, &inv.CurrentUses, &inv.ExpiresAt, &inv.CreatedAt, &inv.IsActive); err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		invites = append(invites, inv)
	}

	count := len(invites)
	c.JSON(http.StatusOK, models.APIResponse{Success: true, Data: invites, Count: &count})
}

// DeleteInvite — DELETE /api/v1/boards/:boardId/invites/:inviteId
func (h *BoardsHandler) DeleteInvite(c *gin.Context) {
	boardID := c.Param("id")
	inviteID := c.Param("inviteId")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	var boardOwner sql.NullString
	err := h.db.QueryRow(`SELECT owner_id FROM boards WHERE id = $1`, boardID).Scan(&boardOwner)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Board not found"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	if !boardOwner.Valid || boardOwner.String != userClaims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only the board owner can delete invites"))
		return
	}

	result, err := h.db.Exec(`UPDATE gomosub_invites SET is_active = FALSE WHERE id = $1 AND board_id = $2`, inviteID, boardID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Invite not found"))
		return
	}

	// Invalidate cache for invites
	if h.redis != nil {
		cache.InvalidateForTable(h.redis, "gomosub_invites", map[string]string{"board_id": boardID})
		// Also invalidate the dedicated handler cache key (GET /api/v1/boards/:id/invites)
		cache.InvalidateByPattern(h.redis, fmt.Sprintf("data:/api/v1/boards/%s/invites*", boardID))
	}

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{"status": "deleted"}))
}

// AcceptInvite — POST /api/v1/invites/:code/accept
// Anyone authenticated can accept an invite. They get added as a member.
func (h *BoardsHandler) AcceptInvite(c *gin.Context) {
	code := c.Param("code")

	claims, exists := c.Get("claims")
	if !exists {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Not authenticated"))
		return
	}
	userClaims := claims.(*auth.Claims)

	// Find and validate the invite
	var inv models.GomosubInvite
	err := h.db.QueryRow(`
		SELECT id, board_id, code, created_by, max_uses, current_uses, expires_at, created_at, is_active
		FROM gomosub_invites
		WHERE code = $1 AND is_active = TRUE
	`, code).Scan(
		&inv.ID, &inv.BoardID, &inv.Code, &inv.CreatedBy,
		&inv.MaxUses, &inv.CurrentUses, &inv.ExpiresAt, &inv.CreatedAt, &inv.IsActive,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Invite not found or expired"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Check expiry
	if inv.ExpiresAt != nil && time.Now().After(*inv.ExpiresAt) {
		c.JSON(http.StatusGone, models.ErrorResponse("Invite has expired"))
		return
	}

	// Check usage limit
	if inv.MaxUses > 0 && inv.CurrentUses >= inv.MaxUses {
		c.JSON(http.StatusGone, models.ErrorResponse("Invite has reached maximum uses"))
		return
	}

	// Check if already a member
	var existingID string
	err = h.db.QueryRow(`SELECT user_id FROM gomosub_memberships WHERE board_id = $1 AND user_id = $2`, inv.BoardID, userClaims.UserID).Scan(&existingID)
	if err == nil {
		c.JSON(http.StatusConflict, models.ErrorResponse("You are already a member of this gomosub"))
		return
	}
	if err != sql.ErrNoRows {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Atomically increment usage counter (prevents race conditions).
	// Only succeeds if limit not reached (or unlimited when max_uses=0).
	var ok bool
	err = h.db.QueryRow(`
		UPDATE gomosub_invites
		SET current_uses = current_uses + 1
		WHERE id = $1 AND is_active = TRUE
		  AND (max_uses = 0 OR current_uses < max_uses)
		  AND (expires_at IS NULL OR expires_at > NOW())
		RETURNING TRUE
	`, inv.ID).Scan(&ok)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusGone, models.ErrorResponse("Invite has expired or reached maximum uses"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Add membership
	_, err = h.db.Exec(`INSERT INTO gomosub_memberships (board_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, inv.BoardID, userClaims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Invalidate cache for memberships and board
	if h.redis != nil {
		cache.InvalidateForTable(h.redis, "gomosub_memberships", map[string]string{"board_id": inv.BoardID})
		cache.InvalidateForTable(h.redis, "boards", map[string]string{"id": inv.BoardID})
	}

	// Get board slug for redirect
	var boardSlug string
	_ = h.db.QueryRow(`SELECT slug FROM boards WHERE id = $1`, inv.BoardID).Scan(&boardSlug)

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]string{
		"status":     "joined",
		"board_id":   inv.BoardID,
		"board_slug": boardSlug,
	}))
}

// GetInviteInfo — GET /api/v1/invites/:code (public)
// Returns info about an invite without accepting it.
func (h *BoardsHandler) GetInviteInfo(c *gin.Context) {
	code := c.Param("code")

	var inv models.GomosubInvite
	var boardName string
	err := h.db.QueryRow(`
		SELECT i.id, i.board_id, i.code, i.created_by, i.max_uses, i.current_uses, i.expires_at, i.created_at, i.is_active,
		       COALESCE(b.name, '')
		FROM gomosub_invites i
		JOIN boards b ON b.id = i.board_id
		WHERE i.code = $1 AND i.is_active = TRUE
	`, code).Scan(
		&inv.ID, &inv.BoardID, &inv.Code, &inv.CreatedBy,
		&inv.MaxUses, &inv.CurrentUses, &inv.ExpiresAt, &inv.CreatedAt, &inv.IsActive,
		&boardName,
	)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Invite not found or expired"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	// Check if expired
	expired := inv.ExpiresAt != nil && time.Now().After(*inv.ExpiresAt)
	maxedOut := inv.MaxUses > 0 && inv.CurrentUses >= inv.MaxUses

	c.JSON(http.StatusOK, models.SuccessResponse(map[string]interface{}{
		"board_id":     inv.BoardID,
		"board_name":   boardName,
		"expired":      expired,
		"maxed_out":    maxedOut,
		"max_uses":     inv.MaxUses,
		"current_uses": inv.CurrentUses,
	}))
}
