package gifts

import (
	"database/sql"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/google/uuid"
)

// UpgradeGift upgrades a static gift to a unique layered combination.
// POST /api/v1/gifts/:giftRecordID/upgrade (protected)
// UpgradeGift godoc
// @Summary      Upgrade gift
// @Description  Upgrade a static gift into a unique layered combination (costs drops)
// @Tags         Gifts
// @Produce      json
// @Param        giftRecordID path string true "User gift record ID"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /gifts/{giftRecordID}/upgrade [post]
// @Security     BearerAuth
func (h *GiftsHandler) UpgradeGift(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	giftRecordID := c.Param("giftRecordID")

	// Validate UUID
	if _, err := uuid.Parse(giftRecordID); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid gift record ID"))
		return
	}

	resp, err := h.performGiftUpgrade(claims.UserID, giftRecordID)
	if err != nil {
		var uf *upgradeFailure
		if errors.As(err, &uf) {
			c.JSON(uf.status, models.ErrorResponse(uf.msg))
		} else {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to upgrade gift"))
		}
		return
	}

	// Invalidate caches
	if h.redis != nil {
		cache.InvalidateByPattern(h.redis, "data:/api/v1/user_gifts*")
		cache.InvalidateByPattern(h.redis, "data:/api/v1/gift_catalog*")
	}

	c.JSON(http.StatusOK, models.SuccessResponse(resp))
}

// upgradeFailure carries the HTTP-facing error class produced inside the
// upgrade transaction so the handler can map it onto a status. Client-class
// failures (missing/foreign gift, already upgraded, insufficient drops) keep
// their original status codes exactly.
type upgradeFailure struct {
	status int
	msg    string
}

func (e *upgradeFailure) Error() string { return e.msg }

// performGiftUpgrade runs the whole upgrade inside a transaction: ownership
// and upgradeability checks, atomic drops deduction, random layered pick and
// ledger recording. Extracted from UpgradeGift so the handler stays thin and
// the transactional core is a separable unit.
func (h *GiftsHandler) performGiftUpgrade(userID, giftRecordID string) (*models.GiftUpgradeResponse, error) {
	tx, err := h.db.Begin()
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Transaction error"}
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
		return nil, &upgradeFailure{http.StatusNotFound, "Gift not found or not yours"}
	}
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to check gift"}
	}

	if alreadyUpgraded {
		return nil, &upgradeFailure{http.StatusBadRequest, "Gift already upgraded"}
	}

	if upgradeCost <= 0 {
		return nil, &upgradeFailure{http.StatusBadRequest, "This gift cannot be upgraded"}
	}

	// Check that all three layer types exist for this gift
	var hasGift, hasBg, hasSym bool
	rows, err := tx.Query(`
		SELECT layer_type FROM gift_layers WHERE gift_catalog_id = $1
	`, giftCatalogID)
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to check layers"}
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
		return nil, &upgradeFailure{http.StatusBadRequest, "Gift layers not fully configured for this gift"}
	}

	// Deduct drops atomically
	result, err := tx.Exec(`
		UPDATE users SET drops = drops - $1
		WHERE id = $2 AND drops >= $1
	`, upgradeCost, userID)
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to deduct drops"}
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, &upgradeFailure{http.StatusBadRequest, "Insufficient drops"}
	}

	// Get new balance
	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", userID).Scan(&balanceAfter)
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to get balance"}
	}

	sel, err := h.pickRandomLayers(tx, giftCatalogID)
	if err != nil {
		return nil, err
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
	`, sel.gift.id, sel.background.id, sel.symbol.id, now, giftRecordID)
	if err != nil {
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to save upgrade"}
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
		return nil, &upgradeFailure{http.StatusInternalServerError, "Failed to complete upgrade"}
	}

	return &models.GiftUpgradeResponse{
		GiftRecordID:       giftRecordID,
		GiftLayerID:        sel.gift.id,
		GiftLayerImageURL:  sel.gift.imageURL,
		BackgroundLayerID:  sel.background.id,
		BackgroundImageURL: sel.background.imageURL,
		SymbolLayerID:      sel.symbol.id,
		SymbolImageURL:     sel.symbol.imageURL,
		UpgradedAt:         now.Format(time.RFC3339Nano),
	}, nil
}

// layerPick is one randomly chosen layer for a catalog entry.
type layerPick struct {
	id       string
	imageURL string
}

// layerSelection holds the three random layer picks (gift/background/symbol)
// chosen for an upgrade, so pickRandomLayers returns a single value instead of
// a six-field tuple whose order is easy to mix up.
type layerSelection struct {
	gift       layerPick
	background layerPick
	symbol     layerPick
}

// pickRandomLayers selects one random layer of each type (gift/background/
// symbol) for the catalog entry, inside the upgrade transaction. Extracted
// from performGiftUpgrade so the upgrade core stays compact.
func (h *GiftsHandler) pickRandomLayers(tx *sql.Tx, giftCatalogID string) (layerSelection, error) {
	var sel layerSelection
	targets := []struct {
		kind string
		pick *layerPick
	}{
		{kind: "gift", pick: &sel.gift},
		{kind: "background", pick: &sel.background},
		{kind: "symbol", pick: &sel.symbol},
	}
	for _, t := range targets {
		err := tx.QueryRow(`
			SELECT id, image_url FROM gift_layers
			WHERE gift_catalog_id = $1 AND layer_type = $2
			ORDER BY RANDOM() LIMIT 1
		`, giftCatalogID, t.kind).Scan(&t.pick.id, &t.pick.imageURL)
		if err != nil {
			return layerSelection{}, &upgradeFailure{http.StatusInternalServerError, "Failed to pick " + t.kind + " layer"}
		}
	}
	return sel, nil
}
