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
		// Convert literal \n to real newlines (for env var storage)
		pubKeyPEM = strings.ReplaceAll(pubKeyPEM, "\\n", "\n")
		block, _ := pem.Decode([]byte(pubKeyPEM))
		if block != nil {
			pub, err := x509.ParsePKIXPublicKey(block.Bytes)
			if err == nil {
				h.publicKey = pub.(*rsa.PublicKey)
			}
		}
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
			}
		}
	}
}

// GetDropsBalance — GET /api/v1/user/drops (protected)
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
func (h *DropsHandler) DropsConfig(c *gin.Context) {
	// Verify DePay signature
	if h.publicKey != nil {
		sigHeader := c.GetHeader("x-signature")
		if sigHeader != "" {
			bodyBytes, err := io.ReadAll(c.Request.Body)
			if err != nil {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("Failed to read body"))
				return
			}
			// Restore body for later reading
			c.Request.Body = io.NopCloser(
				bytes.NewBuffer(bodyBytes),
			)

			sigBytes, err := base64.RawURLEncoding.DecodeString(sigHeader)
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid signature format"))
				return
			}

			hash := sha256.Sum256(bodyBytes)
			err = rsa.VerifyPSS(h.publicKey, crypto.SHA256, hash[:], sigBytes, &rsa.PSSOptions{
				SaltLength: 64,
				Hash:       crypto.SHA256,
			})
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid signature"))
				return
			}
		}
	}

	var req DropsConfigRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request"))
		return
	}

	// Validate drops amount
	if req.DropsAmount < 1 || req.DropsAmount > 100000 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid drops amount (1-100000)"))
		return
	}

	// Calculate price from drops amount — NEVER trust frontend price
	priceUSD := float64(req.DropsAmount) * pricePerDropUSD

	// Multi-chain receiver addresses — each chain added only if receiver env is set
	type chainConfig struct {
		envKey     string
		blockchain string
		token      string
	}
	chains := []chainConfig{
		{"DEPAY_RECEIVER_ETH", "ethereum", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"},    // ETH USDC
		{"DEPAY_RECEIVER_ETH", "ethereum", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"},    // ETH native
		{"DEPAY_RECEIVER_POLYGON", "polygon", "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"}, // Polygon USDC
		{"DEPAY_RECEIVER_BASE", "base", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"},       // Base USDC
		{"DEPAY_RECEIVER_BASE", "base", "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"},       // Base native ETH
		{"DEPAY_RECEIVER_SOLANA", "solana", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"}, // Solana USDC
	}

	accept := []gin.H{}
	for _, c := range chains {
		receiver := os.Getenv(c.envKey)
		if receiver != "" {
			accept = append(accept, gin.H{
				"blockchain": c.blockchain,
				"token":      c.token,
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

	// Sign the response with our private key
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
func (h *DropsHandler) DropsCallback(c *gin.Context) {
	// Verify DePay signature
	if h.publicKey != nil {
		sigHeader := c.GetHeader("x-signature")
		bodyBytes, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Failed to read body"))
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		if sigHeader != "" {
			sigBytes, err := base64.RawURLEncoding.DecodeString(sigHeader)
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid signature format"))
				return
			}

			hash := sha256.Sum256(bodyBytes)
			err = rsa.VerifyPSS(h.publicKey, crypto.SHA256, hash[:], sigBytes, &rsa.PSSOptions{
				SaltLength: 64,
				Hash:       crypto.SHA256,
			})
			if err != nil {
				c.JSON(http.StatusUnauthorized, models.ErrorResponse("Invalid signature"))
				return
			}
		}
	}

	var req DePayCallbackRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request"))
		return
	}

	// Parse payload to get drops_amount and user_id
	var payload struct {
		DropsAmount int    `json:"drops_amount"`
		UserID      string `json:"user_id"`
	}
	if err := json.Unmarshal(req.Payload, &payload); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid payload"))
		return
	}

	// REPLAY PROTECTION: check if tx_hash already exists
	var exists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM drops_transactions WHERE tx_hash = $1)", req.Transaction).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check transaction"))
		return
	}
	if exists {
		// Already processed — return 200 so DePay doesn't retry
		c.JSON(http.StatusOK, gin.H{"status": "already_processed"})
		return
	}

	// Get drops amount from payload
	dropsAmount := payload.DropsAmount
	if dropsAmount < 1 || dropsAmount > 100000 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid drops amount in payload"))
		return
	}

	// Begin transaction: credit drops + record transaction
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	// Credit drops
	_, err = tx.Exec("UPDATE users SET drops = COALESCE(drops, 0) + $1 WHERE id = $2", dropsAmount, payload.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to credit drops"))
		return
	}

	// Get new balance
	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", payload.UserID).Scan(&balanceAfter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get balance"))
		return
	}

	// Record transaction
	_, err = tx.Exec(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, description, blockchain, tx_hash)
		VALUES ($1, 'purchase', $2, $3, $4, $5, $6)
	`, payload.UserID, dropsAmount, balanceAfter,
		fmt.Sprintf("Purchased %d drops", dropsAmount),
		req.Blockchain, req.Transaction)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to record transaction"))
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to commit"))
		return
	}

	log.Printf("Drops credited: user=%s amount=%d tx=%s", payload.UserID, dropsAmount, req.Transaction)
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// GetDropsHistory — GET /api/v1/drops/history (protected)
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

	rows, err := h.db.Query(`
		SELECT id, user_id, type, amount, balance_after, reference_id, reference_type,
		       description, blockchain, tx_hash, created_at
		FROM drops_transactions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2 OFFSET $3
	`, userID, limit, offset)
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
