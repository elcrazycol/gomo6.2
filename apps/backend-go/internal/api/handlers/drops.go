package handlers

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

type DropsHandler struct {
	db         *sql.DB
	publicKey  *rsa.PublicKey
	privateKey *rsa.PrivateKey
}

func NewDropsHandler(db *sql.DB) *DropsHandler {
	h := &DropsHandler{db: db}
	h.loadKeys()
	return h
}

func (h *DropsHandler) loadKeys() {
	// Load DePay public key for verifying incoming signatures
	pubKeyPEM := os.Getenv("DEPAY_PUBLIC_KEY")
	if pubKeyPEM != "" {
		pubKeyPEM = strings.ReplaceAll(pubKeyPEM, "\\n", "\n")
		block, _ := pem.Decode([]byte(pubKeyPEM))
		if block != nil {
			pub, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err == nil {
				h.publicKey = pub.(*rsa.PublicKey)
				log.Println("[Drops] DePay public key loaded OK")
			} else {
				log.Printf("[Drops] Failed to parse DEPAY_PUBLIC_KEY: %v", err)
			}
		} else {
			log.Println("[Drops] Failed to decode DEPAY_PUBLIC_KEY PEM block")
		}
	} else {
		log.Println("[Drops] DEPAY_PUBLIC_KEY not set")
	}

	// Load our private key for signing dynamic config responses
	privKeyPEM := os.Getenv("DEPAY_PRIVATE_KEY")
	if privKeyPEM != "" {
		privKeyPEM = strings.ReplaceAll(privKeyPEM, "\\n", "\n")
		block, _ := pem.Decode([]byte(privKeyPEM))
		if block != nil {
			priv, err := x509.ParsePKCS8PrivateKey(block.Bytes)
			if err == nil {
				h.privateKey = priv.(*rsa.PrivateKey)
				log.Println("[Drops] DePay private key loaded OK")
			} else {
				log.Printf("[Drops] Failed to parse DEPAY_PRIVATE_KEY: %v", err)
			}
		} else {
			log.Println("[Drops] Failed to decode DEPAY_PRIVATE_KEY PEM block")
		}
	} else {
		log.Println("[Drops] DEPAY_PRIVATE_KEY not set")
	}
}

// GetDropsBalance — GET /api/v1/user/drops (protected)
//
// GetDropsBalance godoc
// @Summary      Get drops balance
// @Description  Get the authenticated user's drops balance
// @Tags         Drops
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /user/drops [get]
// @Security     BearerAuth
func (h *DropsHandler) GetDropsBalance(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	userID := claims.UserID

	var drops int
	err := h.db.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&drops)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get drops balance"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"drops": drops}))
}

// GetDropsPackages — GET /api/v1/drops/packages (public)
//
// GetDropsPackages godoc
// @Summary      Get drops packages
// @Description  List available drops purchase packages
// @Tags         Drops
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Router       /drops/packages [get]
func (h *DropsHandler) GetDropsPackages(c *gin.Context) {
	rows, err := h.db.Query(`
		SELECT id, name, drops_amount, price_usd, is_active, sort_order
		FROM drops_packages
		WHERE is_active = true
		ORDER BY sort_order
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get packages"))
		return
	}
	defer rows.Close()

	var packages []models.DropsPackage
	for rows.Next() {
		var pkg models.DropsPackage
		if err := rows.Scan(&pkg.ID, &pkg.Name, &pkg.DropsAmount, &pkg.PriceUSD, &pkg.IsActive, &pkg.SortOrder); err != nil {
			continue
		}
		packages = append(packages, pkg)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(packages))
}

// DropsConfigRequest — payload from DePay Widget
type DropsConfigRequest struct {
	DropsAmount int    `json:"drops_amount"`
	UserID      string `json:"user_id"`
}

// Price per drop in USD
const pricePerDropUSD = 0.02

// DropsConfig — POST /api/v1/drops/config (public, dynamic config for DePay Widget)
//
// DropsConfig godoc
// @Summary      Get drops payment config
// @Description  Dynamic payment configuration for DePay Widget integration
// @Tags         Drops
// @Accept       json
// @Produce      json
// @Param        request body DropsConfigRequest true "Payment request"
// @Success      200 {object} object
// @Failure      400 {object} models.APIResponse
// @Router       /drops/config [post]
func (h *DropsHandler) DropsConfig(c *gin.Context) {
	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Printf("[Drops] Failed to read config body: %v", err)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Failed to read body"))
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	sigHeader := c.GetHeader("x-signature")
	log.Printf("[Drops] Config request from %s, hasSig=%v, publicKey=%v",
		c.ClientIP(), sigHeader != "", h.publicKey != nil)

	if h.publicKey != nil && sigHeader != "" {
		sigBytes, err := base64.RawURLEncoding.DecodeString(sigHeader)
		if err != nil {
			sigBytes, err = base64.StdEncoding.DecodeString(sigHeader)
		}
		if err != nil {
			log.Printf("[Drops] Config signature decode failed: %v", err)
		} else {
			hash := sha256.Sum256(rawBody)
			opts := &rsa.PSSOptions{SaltLength: 64, Hash: crypto.SHA256}
			if err := rsa.VerifyPSS(h.publicKey, crypto.SHA256, hash[:], sigBytes, opts); err != nil {
				log.Printf("[Drops] Config signature verification FAILED: %v", err)
			} else {
				log.Printf("[Drops] Config signature verified OK")
			}
		}
	} else if h.publicKey == nil {
		log.Printf("[Drops] WARNING: No public key loaded, skipping config signature verification")
	}

	var req DropsConfigRequest
	if err := json.Unmarshal(rawBody, &req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request"))
		return
	}

	if req.DropsAmount < 1 || req.DropsAmount > 100000 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid drops amount (1-100000)"))
		return
	}

	if req.UserID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id is required"))
		return
	}
	var userExists bool
	if err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", req.UserID).Scan(&userExists); err != nil || !userExists {
		log.Printf("[Drops] Config: invalid user_id=%s err=%v exists=%v", req.UserID, err, userExists)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user"))
		return
	}
	log.Printf("[Drops] Config: user validated: %s", req.UserID)

	priceUSD := float64(req.DropsAmount) * pricePerDropUSD

	var pendingID string
	_ = h.db.QueryRow(`
		INSERT INTO drops_pending (user_id, drops_amount, price_usd)
		VALUES ($1, $2, $3) RETURNING id
	`, req.UserID, req.DropsAmount, priceUSD).Scan(&pendingID)
	log.Printf("[Drops] Pending created: id=%s user=%s amount=%d price=%.2f",
		pendingID, req.UserID, req.DropsAmount, priceUSD)

	type chainConfig struct {
		envKey     string
		blockchain string
		token      string
	}
	chains := []chainConfig{
		{"DEPAY_RECEIVER_ETH", "ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"},
		{"DEPAY_RECEIVER_ETH", "ethereum", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"},
		{"DEPAY_RECEIVER_POLYGON", "polygon", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"},
		{"DEPAY_RECEIVER_BASE", "base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},
		{"DEPAY_RECEIVER_BASE", "base", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"},
		{"DEPAY_RECEIVER_SOLANA", "solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"},
	}

	accept := []gin.H{}
	for _, ch := range chains {
		receiver := os.Getenv(ch.envKey)
		if receiver != "" {
			accept = append(accept, gin.H{
				"blockchain": ch.blockchain,
				"token":      ch.token,
				"receiver":   receiver,
			})
		}
	}

	if len(accept) == 0 {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("No payment receivers configured"))
		return
	}

	config := gin.H{
		"amount": gin.H{
			"currency": "USD",
			"fix":      priceUSD,
		},
		"accept": accept,
	}

	if h.privateKey != nil {
		configJSON, _ := json.Marshal(config)
		hash := sha256.Sum256(configJSON)
		opts := &rsa.PSSOptions{
			SaltLength: 64,
			Hash:       crypto.SHA256,
		}
		sig, err := rsa.SignPSS(rand.Reader, h.privateKey, crypto.SHA256, hash[:], opts)
		if err == nil {
			sigB64 := base64.RawURLEncoding.EncodeToString(sig)
			c.Header("x-signature", sigB64)
		}
	}

	c.JSON(http.StatusOK, config)
}

// DePayCallbackRequest — payload from DePay callback
type DePayCallbackRequest struct {
	Blockchain  string          `json:"blockchain"`
	Transaction string          `json:"transaction"`
	Sender      string          `json:"sender"`
	Receiver    string          `json:"receiver"`
	Token       string          `json:"token"`
	Amount      string          `json:"amount"`
	Payload     json.RawMessage `json:"payload"`
}

// DropsCallback — POST /api/v1/drops/callback (public, DePay webhook)
//
// DropsCallback godoc
// @Summary      DePay payment callback
// @Description  Webhook callback from DePay after successful payment
// @Tags         Drops
// @Accept       json
// @Produce      json
// @Param        request body DePayCallbackRequest true "Payment callback"
// @Success      200 {object} object
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /drops/callback [post]
func (h *DropsHandler) DropsCallback(c *gin.Context) {
	log.Printf("[Drops] Callback received from %s", c.ClientIP())

	rawBody, err := io.ReadAll(c.Request.Body)
	if err != nil {
		log.Printf("[Drops] Failed to read callback body: %v", err)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Failed to read body"))
		return
	}
	c.Request.Body = io.NopCloser(bytes.NewBuffer(rawBody))

	if h.publicKey != nil {
		sigHeader := c.GetHeader("x-signature")
		if sigHeader == "" {
			log.Printf("[Drops] WARNING: No signature on callback")
		} else {
			sigBytes, err := base64.RawURLEncoding.DecodeString(sigHeader)
			if err != nil {
				sigBytes, err = base64.StdEncoding.DecodeString(sigHeader)
			}
			if err != nil {
				log.Printf("[Drops] Callback signature decode failed: %v", err)
			} else {
				hash := sha256.Sum256(rawBody)
				opts := &rsa.PSSOptions{SaltLength: 64, Hash: crypto.SHA256}
				if err := rsa.VerifyPSS(h.publicKey, crypto.SHA256, hash[:], sigBytes, opts); err != nil {
					log.Printf("[Drops] Callback signature verification FAILED: %v", err)
					c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid signature"))
					return
				}
				log.Printf("[Drops] Callback signature verified OK")
			}
		}
	} else {
		log.Printf("[Drops] WARNING: No public key loaded, skipping callback signature verification")
	}

	var req DePayCallbackRequest
	if err := json.Unmarshal(rawBody, &req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request"))
		return
	}

	var payload struct {
		DropsAmount int    `json:"drops_amount"`
		UserID      string `json:"user_id"`
	}
	if err := json.Unmarshal(req.Payload, &payload); err != nil {
		log.Printf("[Drops] Callback: failed to parse payload: %v", err)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid payload"))
		return
	}

	if payload.UserID == "" {
		log.Printf("[Drops] Callback: no user_id in payload, tx=%s", req.Transaction)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Missing user_id in payload"))
		return
	}

	var exists bool
	err = h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM drops_transactions WHERE tx_hash = $1)", req.Transaction).Scan(&exists)
	if err != nil {
		log.Printf("[Drops] Callback: failed to check tx existence: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check transaction"))
		return
	}
	if exists {
		log.Printf("[Drops] Callback: duplicate tx: %s", req.Transaction)
		c.JSON(http.StatusOK, gin.H{"status": "already_processed"})
		return
	}

	dropsAmount := payload.DropsAmount
	if dropsAmount < 1 || dropsAmount > 100000 {
		log.Printf("[Drops] Callback: invalid drops amount=%d user=%s", dropsAmount, payload.UserID)
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid drops amount in payload"))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		log.Printf("[Drops] Callback: begin tx failed: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec("UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2", dropsAmount, payload.UserID)
	if err != nil {
		log.Printf("[Drops] Callback: credit drops failed user=%s err=%v", payload.UserID, err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to credit drops"))
		return
	}

	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", payload.UserID).Scan(&balanceAfter)
	if err != nil {
		log.Printf("[Drops] Callback: get balance failed user=%s err=%v", payload.UserID, err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get balance"))
		return
	}

	_, err = tx.Exec(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, description, blockchain, tx_hash)
		VALUES ($1, 'purchase', $2, $3, $4, $5, $6)
	`, payload.UserID, dropsAmount, balanceAfter,
		fmt.Sprintf("Purchased %d drops", dropsAmount),
		req.Blockchain, req.Transaction)
	if err != nil {
		log.Printf("[Drops] Callback: record tx failed user=%s err=%v", payload.UserID, err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to record transaction"))
		return
	}

	_, _ = tx.Exec(`
		UPDATE drops_pending
		SET status = 'credited', credited_at = NOW(), blockchain = $1, tx_hash = $2
		WHERE user_id = $3 AND drops_amount = $4 AND status = 'initiated'
		  AND created_at > NOW() - INTERVAL '1 hour'
	`, req.Blockchain, req.Transaction, payload.UserID, dropsAmount)

	if err := tx.Commit(); err != nil {
		log.Printf("[Drops] Callback: COMMIT FAILED user=%s err=%v", payload.UserID, err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to commit"))
		return
	}

	log.Printf("[Drops] Drops credited: user=%s amount=%d tx=%s blockchain=%s", payload.UserID, dropsAmount, req.Transaction, req.Blockchain)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetDropsHistory — GET /api/v1/drops/history (protected)
//
// GetDropsHistory godoc
// @Summary      Get drops transaction history
// @Description  Get drops transaction history for the authenticated user
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
	claims := c.MustGet("claims").(*auth.Claims)
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

// ManualVerifyRequest — user-initiated verification
type ManualVerifyRequest struct {
	TxHash     string `json:"tx_hash" binding:"required"`
	Blockchain string `json:"blockchain" binding:"required"`
}

// ManualVerify — POST /api/v1/drops/manual-verify (protected)
//
// ManualVerify godoc
// @Summary      Manually verify drops payment
// @Description  Manually verify a drops payment by transaction hash
// @Tags         Drops
// @Accept       json
// @Produce      json
// @Param        request body ManualVerifyRequest true "Transaction details"
// @Success      200 {object} object
// @Failure      400 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /drops/manual-verify [post]
// @Security     BearerAuth
func (h *DropsHandler) ManualVerify(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	userID := claims.UserID

	var req ManualVerifyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("tx_hash and blockchain required"))
		return
	}

	var exists bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM drops_transactions WHERE tx_hash = $1)", req.TxHash).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("DB error"))
		return
	}
	if exists {
		c.JSON(http.StatusOK, gin.H{"status": "already_credited"})
		return
	}

	var pendingAmount int
	err = h.db.QueryRow(`
		SELECT drops_amount FROM drops_pending
		WHERE user_id = $1 AND status = 'initiated' AND created_at > NOW() - INTERVAL '24 hours'
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&pendingAmount)
	if err != nil {
		log.Printf("[Drops] Manual verify: no pending for user=%s err=%v", userID, err)
		c.JSON(http.StatusNotFound, gin.H{"status": "no_pending_payment_found"})
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("TX error"))
		return
	}
	defer tx.Rollback()

	_, _ = tx.Exec("UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2", pendingAmount, userID)

	var balanceAfter int
	_ = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&balanceAfter)

	_, _ = tx.Exec(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, description, blockchain, tx_hash)
		VALUES ($1, 'purchase', $2, $3, $4, $5, $6)
	`, userID, pendingAmount, balanceAfter, fmt.Sprintf("Manual verify: %d drops", pendingAmount), req.Blockchain, req.TxHash)

	_, _ = tx.Exec(`
		UPDATE drops_pending SET status = 'credited', credited_at = NOW(), tx_hash = $1
		WHERE user_id = $2 AND status = 'initiated' AND drops_amount = $3
	`, req.TxHash, userID, pendingAmount)

	if err := tx.Commit(); err != nil {
		log.Printf("[Drops] Manual verify: commit failed user=%s err=%v", userID, err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Commit failed"))
		return
	}

	log.Printf("[Drops] Manual verify OK: user=%s amount=%d tx=%s", userID, pendingAmount, req.TxHash)
	c.JSON(http.StatusOK, gin.H{"status": "credited", "drops": pendingAmount})
}

// GetWalletInfo — GET /api/v1/drops/wallet (protected)
//
// GetWalletInfo godoc
// @Summary      Get wallet info
// @Description  Get wallet address and drops balance for the authenticated user
// @Tags         Drops
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /drops/wallet [get]
// @Security     BearerAuth
func (h *DropsHandler) GetWalletInfo(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	userID := claims.UserID

	var info models.WalletInfo
	err := h.db.QueryRow(
		"SELECT wallet_address, COALESCE(drops, 0) FROM users WHERE id = $1", userID,
	).Scan(&info.Address, &info.Balance)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get wallet info"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(info))
}

// TransferDrops — POST /api/v1/drops/transfer (protected)
//
// TransferDrops godoc
// @Summary      Transfer drops
// @Description  Transfer drops to another user
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
	claims := c.MustGet("claims").(*auth.Claims)
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

	// Start transaction
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	// Deterministic lock ordering: smaller ID first → no deadlock
	minID, maxID := senderID, recipientID
	if minID > maxID {
		minID, maxID = recipientID, senderID
	}

	// Lock both rows in deterministic order
	var minDrops, maxDrops int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1 FOR UPDATE", minID).Scan(&minDrops)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to lock rows"))
		return
	}
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1 FOR UPDATE", maxID).Scan(&maxDrops)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to lock rows"))
		return
	}

	// Map drops to sender
	var senderDrops int
	if minID == senderID {
		senderDrops = minDrops
	} else {
		senderDrops = maxDrops
	}

	// Check balance
	if senderDrops < req.Amount {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Insufficient drops"))
		return
	}

	// Atomic balance updates
	_, err = tx.Exec("UPDATE users SET drops = drops - $1 WHERE id = $2", req.Amount, senderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to debit sender"))
		return
	}
	_, err = tx.Exec("UPDATE users SET drops = drops + $1 WHERE id = $2", req.Amount, recipientID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to credit recipient"))
		return
	}

	// Read final balances
	var senderBalance, recipientBalance int
	_ = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", senderID).Scan(&senderBalance)
	_ = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", recipientID).Scan(&recipientBalance)

	// Ledger entries
	description := ""
	if req.Description != nil {
		description = *req.Description
	}

	var senderTxID, recipientTxID string
	err = tx.QueryRow(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'transfer_send', $2, $3, $4, 'user', $5)
		RETURNING id
	`, senderID, -req.Amount, senderBalance, recipientID, description).Scan(&senderTxID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to record sender transaction"))
		return
	}

	err = tx.QueryRow(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'transfer_receive', $2, $3, $4, 'user', $5)
		RETURNING id
	`, recipientID, req.Amount, recipientBalance, senderID, description).Scan(&recipientTxID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to record recipient transaction"))
		return
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[Drops] Transfer commit failed: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transfer failed"))
		return
	}

	log.Printf("[Drops] Transfer: %s → %s amount=%d", senderID, recipientID, req.Amount)
	c.JSON(http.StatusOK, models.SuccessResponse(models.TransferResult{
		TransactionID: senderTxID,
		Amount:        req.Amount,
		Recipient:     recipientUsername,
		BalanceAfter:  senderBalance,
	}))
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
