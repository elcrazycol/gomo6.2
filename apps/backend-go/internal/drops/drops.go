// Package drops implements the wallet domain for the paid currency (gems):
// balance and history, wallet info and user-to-user transfers. Purchase flows
// (packages, payment callbacks, manual verification) were removed with DePay;
// a new payment provider starts from this clean slate, crediting users.gems
// with a 'purchase' row in drops_transactions.
package drops

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/logsafe"
	"github.com/gomo6/backend/internal/models"
)

type DropsHandler struct {
	db *sql.DB
}

func NewDropsHandler(db *sql.DB) *DropsHandler {
	return &DropsHandler{db: db}
}

// GetDropsBalance — GET /api/v1/user/drops (protected)
//
// GetDropsBalance godoc
// @Summary      Get currency balances
// @Description  Get the authenticated user's paid gems and earnable drops balances
// @Tags         Drops
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /user/drops [get]
// @Security     BearerAuth
func (h *DropsHandler) GetDropsBalance(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID := claims.UserID

	var gems, drops int
	err := h.db.QueryRow("SELECT COALESCE(gems, 0), COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&gems, &drops)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get balances"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"gems": gems, "drops": drops}))
}

// GetDropsHistory godoc
// @Summary      Get gems transaction history
// @Description  Get paid gems transaction history for the authenticated user
// @Tags         Drops
// @Produce      json
// @Param        offset query int    false "Offset for pagination"
// @Param        limit  query int    false "Max results (1-50)" default(20)
// @Param        type   query string false "Filter by transaction type"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /drops/history [get]
// @Security     BearerAuth
func (h *DropsHandler) GetDropsHistory(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID := claims.UserID

	offset := 0
	if v := c.Query("offset"); v != "" {
		fmt.Sscanf(v, "%d", &offset)
	}
	limit := 20
	if v := c.Query("limit"); v != "" {
		fmt.Sscanf(v, "%d", &limit)
	}
	if limit > 50 {
		limit = 50
	}

	typeFilter := ""
	queryArgs := []interface{}{userID, limit, offset}
	if v := c.Query("type"); v != "" {
		typeFilter = "AND type = ANY(string_to_array($" + fmt.Sprintf("%d", len(queryArgs)+1) + ", ','))"
		queryArgs = append(queryArgs, v)
	} else {
		// The wallet is the paid-gems surface: earned drops (quest rewards,
		// daily rewards, streak restores) never touch the gems balance and
		// live in the drops-mode history. Keep them out of this history
		// unless explicitly requested via ?type=.
		typeFilter = "AND type NOT IN ('quest_reward', 'daily_reward', 'daily_restore')"
	}

	rows, err := h.db.Query(`
		SELECT id, user_id, type, amount, balance_after, reference_id, reference_type,
		       description, blockchain, tx_hash, created_at
		FROM drops_transactions
		WHERE user_id = $1
		`+typeFilter+`
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, queryArgs...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get history"))
		return
	}
	defer rows.Close()

	var transactions []models.DropsTransaction
	for rows.Next() {
		var tx models.DropsTransaction
		if err := rows.Scan(&tx.ID, &tx.UserID, &tx.Type, &tx.Amount, &tx.BalanceAfter,
			&tx.ReferenceID, &tx.ReferenceType, &tx.Description, &tx.Blockchain, &tx.TxHash, &tx.CreatedAt); err != nil {
			continue
		}
		transactions = append(transactions, tx)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(transactions))
}

// GetWalletInfo — GET /api/v1/drops/wallet (protected)
//
// GetWalletInfo godoc
// @Summary      Get wallet info
// @Description  Get wallet address and paid gems balance for the authenticated user
// @Tags         Drops
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /drops/wallet [get]
// @Security     BearerAuth
func (h *DropsHandler) GetWalletInfo(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	userID := claims.UserID

	var info models.WalletInfo
	err := h.db.QueryRow(
		"SELECT wallet_address, COALESCE(gems, 0), COALESCE(drops, 0) FROM users WHERE id = $1", userID,
	).Scan(&info.Address, &info.Balance, &info.Drops)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get wallet info"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(info))
}

// TransferDrops — POST /api/v1/drops/transfer (protected)
//
// TransferDrops godoc
// @Summary      Transfer gems
// @Description  Transfer paid gems to another user
// @Tags         Drops
// @Accept       json
// @Produce      json
// @Param        request body models.TransferDropsRequest true "Transfer details"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /drops/transfer [post]
// @Security     BearerAuth
func (h *DropsHandler) TransferDrops(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	senderID := claims.UserID

	var req models.TransferDropsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Validate: exactly one recipient identifier
	if (req.RecipientUsername == nil && req.RecipientAddress == nil) ||
		(req.RecipientUsername != nil && req.RecipientAddress != nil) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Provide either recipient_username or recipient_address"))
		return
	}

	// Resolve recipient
	var recipientID, recipientUsername string
	var recipientArg string
	if req.RecipientUsername != nil {
		recipientArg = *req.RecipientUsername
	} else {
		recipientArg = *req.RecipientAddress
	}

	err := h.db.QueryRow(
		"SELECT id, username FROM users WHERE username = $1 OR wallet_address = $1",
		recipientArg,
	).Scan(&recipientID, &recipientUsername)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}

	// Self-transfer check
	if recipientID == senderID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot transfer to yourself"))
		return
	}

	// Rate limit: max 10 transfers per hour
	var transferCount int
	_ = h.db.QueryRow(`
		SELECT COUNT(*) FROM drops_transactions
		WHERE user_id = $1 AND type = 'transfer_send'
		  AND created_at > NOW() - INTERVAL '1 hour'
	`, senderID).Scan(&transferCount)
	if transferCount >= 10 {
		c.JSON(http.StatusTooManyRequests, models.ErrorResponse("Transfer limit reached (10 per hour)"))
		return
	}

	description := ""
	if req.Description != nil {
		description = *req.Description
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	senderTxID, senderBalance, err := h.transferInTx(tx, senderID, recipientID, req.Amount, description)
	if err != nil {
		if errors.Is(err, errInsufficientGems) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Insufficient gems"))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transfer failed"))
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[Drops] Transfer commit failed: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transfer failed"))
		return
	}

	logsafe.Printf("[Drops] Transfer: %s → %s amount=%d", senderID, recipientID, req.Amount)
	c.JSON(http.StatusOK, models.SuccessResponse(models.TransferResult{
		TransactionID: senderTxID,
		Amount:        req.Amount,
		Recipient:     recipientUsername,
		BalanceAfter:  senderBalance,
	}))
}

// errInsufficientGems marks the one client-class failure inside the transfer
// transaction so TransferDrops can map it onto 400 while every other failure
// stays a 500.
var errInsufficientGems = errors.New("insufficient gems")

// transferInTx performs the atomic transfer on an open transaction: rows are
// locked in deterministic (ID-sorted) order to avoid deadlocks, the balance
// is checked, both sides are updated and the ledger entries are recorded.
// Returns the sender's ledger id and final balance. Extracted from
// TransferDrops so the handler stays thin and the transactional core is a
// separable unit.
func (h *DropsHandler) transferInTx(tx *sql.Tx, senderID, recipientID string, amount int, description string) (senderTxID string, senderBalance int, err error) {
	// Deterministic lock ordering: smaller ID first → no deadlock
	minID, maxID := senderID, recipientID
	if minID > maxID {
		minID, maxID = recipientID, senderID
	}

	// Lock both rows in deterministic order
	var minGems, maxGems int
	err = tx.QueryRow("SELECT COALESCE(gems, 0) FROM users WHERE id = $1 FOR UPDATE", minID).Scan(&minGems)
	if err != nil {
		return "", 0, err
	}
	err = tx.QueryRow("SELECT COALESCE(gems, 0) FROM users WHERE id = $1 FOR UPDATE", maxID).Scan(&maxGems)
	if err != nil {
		return "", 0, err
	}

	// Map gems to sender
	var senderGems int
	if minID == senderID {
		senderGems = minGems
	} else {
		senderGems = maxGems
	}

	// Check balance
	if senderGems < amount {
		return "", 0, errInsufficientGems
	}

	// Atomic balance updates
	_, err = tx.Exec("UPDATE users SET gems = gems - $1 WHERE id = $2", amount, senderID)
	if err != nil {
		return "", 0, err
	}
	_, err = tx.Exec("UPDATE users SET gems = gems + $1 WHERE id = $2", amount, recipientID)
	if err != nil {
		return "", 0, err
	}

	// Read final balances. A failure must abort: balance_after is written to the
	// ledger, and a zero-value read would record a wrong figure.
	if err := tx.QueryRow("SELECT COALESCE(gems, 0) FROM users WHERE id = $1", senderID).Scan(&senderBalance); err != nil {
		return "", 0, err
	}
	var recipientBalance int
	if err := tx.QueryRow("SELECT COALESCE(gems, 0) FROM users WHERE id = $1", recipientID).Scan(&recipientBalance); err != nil {
		return "", 0, err
	}

	// Ledger entries
	err = tx.QueryRow(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'transfer_send', $2, $3, $4, 'user', $5)
		RETURNING id
	`, senderID, -amount, senderBalance, recipientID, description).Scan(&senderTxID)
	if err != nil {
		return "", 0, err
	}

	var recipientTxID string
	err = tx.QueryRow(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'transfer_receive', $2, $3, $4, 'user', $5)
		RETURNING id
	`, recipientID, amount, recipientBalance, senderID, description).Scan(&recipientTxID)
	if err != nil {
		return "", 0, err
	}

	return senderTxID, senderBalance, nil
}

// SearchUsers — GET /api/v1/drops/users/search?q=... (protected)
//
// SearchUsers godoc
// @Summary      Search users for drops transfer
// @Description  Search users by username or wallet address
// @Tags         Drops
// @Produce      json
// @Param        q query string true "Search query"
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /drops/users/search [get]
// @Security     BearerAuth
func (h *DropsHandler) SearchUsers(c *gin.Context) {
	q := strings.TrimSpace(c.Query("q"))
	if len(q) < 1 {
		c.JSON(http.StatusOK, models.SuccessResponse([]models.UserSearchResult{}))
		return
	}

	limit := 10
	rows, err := h.db.Query(`
		SELECT id, username, display_name, avatar_url, wallet_address
		FROM users
		WHERE username ILIKE '%' || $1 || '%' OR wallet_address ILIKE '%' || $1 || '%'
		LIMIT $2
	`, q, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Search failed"))
		return
	}
	defer rows.Close()

	var results []models.UserSearchResult
	for rows.Next() {
		var u models.UserSearchResult
		if err := rows.Scan(&u.ID, &u.Username, &u.DisplayName, &u.AvatarURL, &u.WalletAddress); err != nil {
			continue
		}
		results = append(results, u)
	}

	if results == nil {
		results = []models.UserSearchResult{}
	}
	c.JSON(http.StatusOK, models.SuccessResponse(results))
}
