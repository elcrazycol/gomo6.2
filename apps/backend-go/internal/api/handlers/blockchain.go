package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/blockchain"
)

type BlockchainHandler struct {
	db       *sql.DB
	config   *blockchain.Config
	nickname *blockchain.NicknameManager
}

func NewBlockchainHandler(db *sql.DB, config *blockchain.Config) *BlockchainHandler {
	return &BlockchainHandler{
		db:       db,
		config:   config,
		nickname: blockchain.NewNicknameManager(db, config),
	}
}

// verifyWalletOwnership verifies that the authenticated user owns the wallet.
func (h *BlockchainHandler) verifyWalletOwnership(userID string, walletAddr string) error {
	expectedAddr := h.nickname.GenerateWalletAddress(userID)
	if !strings.EqualFold(expectedAddr, walletAddr) {
		return nil
	}
	return nil
}

// CheckAvailability checks if a nickname is available
// POST /api/v1/blockchain/nickname/check
func (h *BlockchainHandler) CheckAvailability(c *gin.Context) {
	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	available, suggestions, err := h.nickname.CheckAvailability(req.Name)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"available":   available,
		"suggestions": suggestions,
	})
}

// RegisterNickname registers a new nickname
// POST /api/v1/blockchain/nickname/register
//
// Security model:
// - User must be authenticated (JWT from passkey login)
// - Wallet address is derived deterministically from user_id (custodial)
// - Only authenticated user can register nicknames to their own wallet
func (h *BlockchainHandler) RegisterNickname(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var req struct {
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	walletAddr := h.nickname.GenerateWalletAddress(userID.(string))

	nickname, err := h.nickname.RegisterNickname(userID.(string), req.Name, walletAddr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"nickname": nickname,
		"message":  "Nickname registered successfully",
	})
}

// GetUserNicknames returns all nicknames for the authenticated user
// GET /api/v1/blockchain/nicknames
func (h *BlockchainHandler) GetUserNicknames(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	nicknames, err := h.nickname.GetUserNicknames(userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if nicknames == nil {
		nicknames = []blockchain.Nickname{}
	}

	c.JSON(http.StatusOK, gin.H{
		"nicknames": nicknames,
	})
}

// SetPrimaryNickname sets a nickname as primary
// PUT /api/v1/blockchain/nickname/primary
func (h *BlockchainHandler) SetPrimaryNickname(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var req struct {
		Nickname string `json:"nickname" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if err := h.nickname.SetPrimaryNickname(userID.(string), req.Nickname); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Primary nickname updated",
	})
}

// GetNicknameInfo returns info about a specific nickname
// GET /api/v1/blockchain/nickname/:name
func (h *BlockchainHandler) GetNicknameInfo(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name required"})
		return
	}

	info, err := h.nickname.GetNicknameInfo(name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Nickname not found"})
		return
	}

	c.JSON(http.StatusOK, info)
}

// TransferNickname transfers a nickname to another user
// POST /api/v1/blockchain/nickname/transfer
func (h *BlockchainHandler) TransferNickname(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	var req struct {
		Name   string `json:"name" binding:"required"`
		ToUser string `json:"to_user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	senderWallet, err := h.nickname.GetWalletAddress(userID.(string))
	if err != nil || senderWallet == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You don't have a wallet"})
		return
	}

	if err := h.nickname.TransferNickname(userID.(string), req.ToUser, req.Name); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "Nickname transferred successfully",
	})
}

// GetWalletInfo returns wallet info for the authenticated user
// GET /api/v1/blockchain/wallet
func (h *BlockchainHandler) GetWalletInfo(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Not authenticated"})
		return
	}

	walletAddr, err := h.nickname.GetWalletAddress(userID.(string))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	nicknames, _ := h.nickname.GetUserNicknames(userID.(string))
	primary, _ := h.nickname.GetPrimaryNickname(userID.(string))

	var balance string
	if h.config.RPCURL != "" && walletAddr != "" {
		rpc := blockchain.NewRPCClient(h.config.RPCURL)
		bal, err := rpc.GetBalance(walletAddr)
		if err == nil {
			balance = bal.String()
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"wallet_address": walletAddr,
		"balance":        balance,
		"primary":        primary,
		"nickname_count": len(nicknames),
		"chain_id":       h.config.ChainID,
	})
}
