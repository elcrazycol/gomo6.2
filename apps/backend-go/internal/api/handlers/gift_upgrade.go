package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// UpgradeGift upgrades a static gift to a unique layered combination.
// POST /api/v1/gifts/:giftRecordID/upgrade (protected)
func (h *GiftsHandler) UpgradeGift(c *gin.Context) {
	claims := c.MustGet("claims").(*auth.Claims)
	userID := claims.UserID
	giftRecordID := c.Param("giftRecordID")

	// Validate UUID
	_, err := uuid.Parse(giftRecordID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid gift record ID"))
		return
	}

	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	// Verify ownership, check not already upgraded, and get gift catalog info
	var giftCatalogID string
	var upgradeCost int
	var alreadyUpgraded bool
	err = tx.QueryRow(`
		SELECT gc.id, gc.upgrade_cost, ug.is_upgraded
		FROM user_gifts ug
		JOIN gift_catalog gc ON gc.id = ug.gift_id
		WHERE ug.id = $1 AND ug.recipient_id = $2
		FOR UPDATE OF ug
	`, giftRecordID, userID).Scan(&giftCatalogID, &upgradeCost, &alreadyUpgraded)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Gift not found or not yours"))
		return
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check gift"))
		return
	}

	if alreadyUpgraded {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Gift already upgraded"))
		return
	}

	if upgradeCost <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("This gift cannot be upgraded"))
		return
	}

	// Check that all three layer types exist for this gift
	var hasGift, hasBg, hasSym bool
	rows, err := tx.Query(`
		SELECT layer_type FROM gift_layers WHERE gift_catalog_id = $1
	`, giftCatalogID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to check layers"))
		return
	}
	for rows.Next() {
		var lt string
		rows.Scan(&lt)
		switch lt {
		case "gift":
			hasGift = true
		case "background":
			hasBg = true
		case "symbol":
			hasSym = true
		}
	}
	rows.Close()

	if !hasGift || !hasBg || !hasSym {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Gift layers not fully configured for this gift"))
		return
	}

	// Deduct drops atomically
	result, err := tx.Exec(`
		UPDATE users SET drops = drops - $1
		WHERE id = $2 AND drops >= $1
	`, upgradeCost, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to deduct drops"))
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Insufficient drops"))
		return
	}

	// Get new balance
	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&balanceAfter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get balance"))
		return
	}

	// Pick ONE random layer from each type
	var giftLayerID, bgLayerID, symLayerID string
	var giftLayerURL, bgLayerURL, symLayerURL string

	err = tx.QueryRow(`
		SELECT id, image_url FROM gift_layers
		WHERE gift_catalog_id = $1 AND layer_type = 'gift'
		ORDER BY RANDOM() LIMIT 1
	`, giftCatalogID).Scan(&giftLayerID, &giftLayerURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to pick gift layer"))
		return
	}

	err = tx.QueryRow(`
		SELECT id, image_url FROM gift_layers
		WHERE gift_catalog_id = $1 AND layer_type = 'background'
		ORDER BY RANDOM() LIMIT 1
	`, giftCatalogID).Scan(&bgLayerID, &bgLayerURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to pick background layer"))
		return
	}

	err = tx.QueryRow(`
		SELECT id, image_url FROM gift_layers
		WHERE gift_catalog_id = $1 AND layer_type = 'symbol'
		ORDER BY RANDOM() LIMIT 1
	`, giftCatalogID).Scan(&symLayerID, &symLayerURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to pick symbol layer"))
		return
	}

	now := time.Now()

	// Update the user_gifts record
	_, err = tx.Exec(`
		UPDATE user_gifts
		SET is_upgraded = TRUE,
		    gift_layer_id = $1,
		    background_layer_id = $2,
		    symbol_layer_id = $3,
		    upgraded_at = $4
		WHERE id = $5
	`, giftLayerID, bgLayerID, symLayerID, now, giftRecordID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to save upgrade"))
		return
	}

	// Record drops transaction
	_, err = tx.Exec(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'gift_upgrade', 0 - $2, $3, $4::uuid, 'gift_upgrade', $5)
	`, userID, upgradeCost, balanceAfter, giftRecordID,
		"Upgraded gift to unique combination")
	if err != nil {
		log.Printf("[GiftUpgrade] record transaction error: %v", err)
		// Non-fatal: gift is already upgraded
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to complete upgrade"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(models.GiftUpgradeResponse{
		GiftRecordID:       giftRecordID,
		GiftLayerID:        giftLayerID,
		GiftLayerImageURL:  giftLayerURL,
		BackgroundLayerID:  bgLayerID,
		BackgroundImageURL: bgLayerURL,
		SymbolLayerID:      symLayerID,
		SymbolImageURL:     symLayerURL,
		UpgradedAt:         now.Format(time.RFC3339Nano),
	}))
}
