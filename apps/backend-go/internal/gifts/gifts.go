// Package gifts implements the gift economy: catalog, sending gift records
// (with messenger message delivery, notifications and achievements), gift
// upgrades and the admin CRUD for catalog entries and layers. Extracted from
// the former api/handlers god package as part of the F1 sweep — the domain is
// self-contained (its own SQL, wallet-style ledger and WebSocket fan-out), so
// it lives as a leaf package next to messenger/rpc/drops and is wired into
// the router from routes.go.
package gifts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/messenger"
	"github.com/gomo6/backend/internal/notifications"
	"github.com/gomo6/backend/internal/privacy"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/achievements"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type GiftsHandler struct {
	db        *sql.DB
	redis     *redis.Client
	hub       *websocket.Hub
	achEngine *achievements.Engine
	// messenger is the single write path for gift chat entries (encryption,
	// preview, typed envelope, realtime). Nil-safe: without it the gift still
	// sends, minus the chat bubble.
	messenger *messenger.MessengerHandler
}

func NewGiftsHandler(db *sql.DB) *GiftsHandler {
	return &GiftsHandler{db: db}
}

func (h *GiftsHandler) SetRedis(redis *redis.Client) { h.redis = redis }

func (h *GiftsHandler) SetWebSocketHub(hub *websocket.Hub) { h.hub = hub }

// SetMessenger wires the messenger write path for gift chat entries.
func (h *GiftsHandler) SetMessenger(m *messenger.MessengerHandler) { h.messenger = m }

// SetAchievementEngine wires the achievements engine for auto-unlock events.
func (h *GiftsHandler) SetAchievementEngine(e *achievements.Engine) {
	h.achEngine = e
}

// SendGift — POST /api/v1/gifts/send (protected)
//
// SendGift godoc
// @Summary      Send a gift
// @Description  Send a gift to another user (deducts drops)
// @Tags         Gifts
// @Accept       json
// @Produce      json
// @Param        request body models.SendGiftRequest true "Gift data"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /gifts/send [post]
// @Security     BearerAuth
func (h *GiftsHandler) SendGift(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}
	senderID := claims.UserID

	var req models.SendGiftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	if senderID == req.RecipientID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot send gift to yourself"))
		return
	}

	// Parse UUIDs
	giftID, err := uuid.Parse(req.GiftID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid gift_id"))
		return
	}
	recipientID, err := uuid.Parse(req.RecipientID)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid recipient_id"))
		return
	}

	// Begin transaction
	tx, err := h.db.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Transaction error"))
		return
	}
	defer tx.Rollback()

	// Step 1: Atomically reserve limited gift (prevents race condition)
	result, err := tx.Exec(`
		UPDATE gift_catalog
		SET sold_count = sold_count + 1, updated_at = NOW()
		WHERE id = $1 AND is_active = true
		  AND (is_limited = false OR sold_count < max_quantity)
	`, giftID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to reserve gift"))
		return
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Gift is no longer available"))
		return
	}

	// Step 2: Get gift details and deduct gems atomically
	var price int
	var giftName, giftImageURL string
	err = tx.QueryRow("SELECT name, COALESCE(image_url, ''), price FROM gift_catalog WHERE id = $1", giftID).Scan(&giftName, &giftImageURL, &price)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get gift price"))
		return
	}

	result, err = tx.Exec(`
		UPDATE users SET gems = gems - $1
		WHERE id = $2 AND gems >= $1
	`, price, senderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to deduct gems"))
		return
	}
	affected, _ = result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Insufficient gems"))
		return
	}

	// Get new balance for transaction record
	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(gems, 0) FROM users WHERE id = $1", senderID).Scan(&balanceAfter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get balance"))
		return
	}

	// Step 3: Insert user_gift
	var giftRecordID string
	err = tx.QueryRow(`
		INSERT INTO user_gifts (gift_id, sender_id, recipient_id, message, is_anonymous)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id
	`, giftID, senderID, recipientID, req.Message, req.IsAnonymous).Scan(&giftRecordID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to send gift"))
		return
	}

	// Record gems transaction (in same TX as gift creation)
	_, err = tx.Exec(`
		INSERT INTO drops_transactions (user_id, type, amount, balance_after, reference_id, reference_type, description)
		VALUES ($1, 'gift_send', 0 - $2, $3, $4::uuid, 'gift', $5)
	`, senderID, price, balanceAfter, giftID.String(), fmt.Sprintf("Sent gift to %s", recipientID))
	if err != nil {
		log.Printf("[Gifts] record transaction error: %v", err)
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to record transaction"))
		return
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to complete transaction"))
		return
	}

	// Achievements: the sender sent a gift; the recipient received one.
	achievements.EmitAchievement(h.achEngine, senderID, achievements.EventGiftSent)
	achievements.EmitAchievement(h.achEngine, recipientID.String(), achievements.EventGiftReceived)

	// Send notification to recipient
	go h.sendGiftNotification(recipientID.String(), senderID, giftID.String(), giftRecordID, req.IsAnonymous)

	// Send gift message in messenger (best-effort, after gift is committed)
	go h.sendGiftMessengerMessage(senderID, recipientID.String(), giftID.String(), giftName, giftImageURL, giftRecordID)

	// Invalidate cache
	if h.redis != nil {
		cache.InvalidateCacheForProfile(h.redis, recipientID.String())
		cache.InvalidateForTable(h.redis, "user_gifts", map[string]string{"recipient_id": recipientID.String()})
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"id":      giftRecordID,
		"message": "Gift sent successfully",
	}))
}

func (h *GiftsHandler) sendGiftNotification(recipientID, senderID, giftID, giftRecordID string, isAnonymous bool) {
	// Get gift name
	var giftName string
	h.db.QueryRow("SELECT name FROM gift_catalog WHERE id = $1", giftID).Scan(&giftName)

	// Get sender name (empty for anonymous gifts — the frontend localizes the
	// "anonymous" marker itself).
	var senderName string
	if !isAnonymous {
		h.db.QueryRow("SELECT username FROM users WHERE id = $1", senderID).Scan(&senderName)
	}

	params := models.NotificationParams{Actor: senderName, Anonymous: isAnonymous, GiftName: giftName}
	paramsJSON := string(notifications.MarshalNotificationParams(&params))

	var notificationID string
	var createdAt time.Time
	err := h.db.QueryRow(`
		INSERT INTO notifications (user_id, type, title, message, is_read, created_at, params)
		VALUES ($1, 'gift_received', '', '', false, $2, $3::jsonb)
		RETURNING id, created_at
	`, recipientID, time.Now(), paramsJSON).Scan(&notificationID, &createdAt)
	if err != nil {
		log.Printf("[Gifts] notification insert error: %v", err)
		return
	}

	if h.redis != nil {
		cache.InvalidateCacheForNotification(h.redis, recipientID)
	}

	if h.hub != nil {
		if err := h.hub.PublishNewNotification(map[string]interface{}{
			"id":      notificationID,
			"user_id": recipientID,
			"type":    "gift_received",
			"title":   "",
			"message": "",
			"params": map[string]interface{}{
				"actor":     senderName,
				"anonymous": isAnonymous,
				"gift_name": giftName,
			},
			"notification_id": notificationID,
			"is_read":         false,
			"created_at":      createdAt.Format(time.RFC3339Nano),
		}); err != nil {
			log.Printf("[Gifts] WS notification error: %v", err)
		}
	}
}

func (h *GiftsHandler) sendGiftMessengerMessage(senderID, recipientID string, giftID, giftName, giftImageURL, giftRecordID string) {
	if h.messenger == nil {
		return
	}
	giftPayload, err := json.Marshal(map[string]string{
		"gift_id":        giftID,
		"gift_name":      giftName,
		"image_url":      giftImageURL,
		"gift_record_id": giftRecordID,
	})
	if err != nil {
		log.Printf("[Gifts] marshal gift payload error: %v", err)
		return
	}
	// The messenger owns the write: encryption at rest, the conversation
	// preview, the typed envelope and the realtime frame. An E2E conversation
	// yields nil (the server cannot author client ciphertext); the gift
	// notification still reaches the recipient.
	if _, err := h.messenger.DeliverIntegrationMessage(
		context.Background(), senderID, recipientID,
		fmt.Sprintf("__GIFT__:%s:%s:%s", giftID, giftName, giftImageURL),
		"gift", giftPayload,
		// One gift record → one bubble, even if delivery is retried.
		"gift_"+giftRecordID,
	); err != nil {
		log.Printf("[Gifts] deliver gift message error: %v", err)
	}
}

// GetUserGifts — GET /api/v1/user_gifts (public)
//
// GetUserGifts godoc
// @Summary      Get user gifts
// @Description  Get gifts received by a user
// @Tags         Gifts
// @Produce      json
// @Param        recipient_id query string true "Recipient user ID"
// @Param        limit  query int false "Max results (1-100)" default(50)
// @Param        offset query int false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /user_gifts [get]
func (h *GiftsHandler) GetUserGifts(c *gin.Context) {
	recipientID := c.Query("recipient_id")
	if recipientID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("recipient_id is required"))
		return
	}
	recipientID = strings.TrimPrefix(recipientID, "eq.")

	// Private profile: hide gifts from non-friends
	var viewerID string
	if claims, exists := c.Get("claims"); exists {
		if uc, ok := claims.(*auth.Claims); ok {
			viewerID = uc.UserID
		}
	}
	// L2: honor the dedicated private_hide_gifts setting on top of profile
	// visibility. A user who hides gifts must not show them to non-friends even
	// when the rest of the profile is public.
	canView, err := privacy.CanViewUserGifts(h.db, viewerID, recipientID)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	if !canView {
		c.JSON(http.StatusOK, models.SuccessResponseWithCount([]models.UserGift{}, 0))
		return
	}

	limit := 50
	offset := 0
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n >= 0 && n <= 100 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}

	gifts, totalCount, err := h.listUserGifts(recipientID, viewerID, limit, offset)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponseWithCount(gifts, totalCount))
}

// listUserGifts queries the user_gifts ledger for recipientID with the layer
// image/rarity enrichment and anonymous-sender masking, returning the page plus
// the total count. Extracted from GetUserGifts so the handler stays thin.
func (h *GiftsHandler) listUserGifts(recipientID, viewerID string, limit, offset int) ([]models.UserGift, int, error) {
	// Get total count
	var totalCount int
	h.db.QueryRow(`SELECT COUNT(*) FROM user_gifts WHERE recipient_id = $1`, recipientID).Scan(&totalCount)

	// If limit=0, return only count
	if limit == 0 {
		return []models.UserGift{}, totalCount, nil
	}

	rows, err := h.db.Query(`
		SELECT ug.id, ug.gift_id, ug.sender_id, ug.recipient_id, ug.message,
		       ug.is_anonymous, ug.created_at,
		       COALESCE(ug.is_upgraded, FALSE), ug.gift_layer_id, ug.background_layer_id, ug.symbol_layer_id, ug.upgraded_at,
		       gc.name AS gift_name, gc.image_url AS gift_image_url, gc.price AS gift_price,
		       COALESCE(gc.is_upgradable, FALSE) AS is_gift_upgradable, gc.upgrade_cost AS gift_upgrade_cost,
		       u.username AS sender_username, u.avatar_url AS sender_avatar_url,
		       gl.image_url AS gift_layer_image_url,
		       bgl.image_url AS background_layer_image_url,
		       sl.image_url AS symbol_layer_image_url,
		       CASE WHEN ug.gift_layer_id IS NOT NULL
		           THEN 100 / NULLIF((SELECT COUNT(*) FROM user_gifts ug2 WHERE ug2.gift_id = ug.gift_id AND ug2.gift_layer_id = ug.gift_layer_id AND ug2.is_upgraded = TRUE), 0)
		           ELSE NULL END AS gift_layer_rarity,
		       CASE WHEN ug.background_layer_id IS NOT NULL
		           THEN 100 / NULLIF((SELECT COUNT(*) FROM user_gifts ug2 WHERE ug2.gift_id = ug.gift_id AND ug2.background_layer_id = ug.background_layer_id AND ug2.is_upgraded = TRUE), 0)
		           ELSE NULL END AS background_layer_rarity,
		       CASE WHEN ug.symbol_layer_id IS NOT NULL
		           THEN 100 / NULLIF((SELECT COUNT(*) FROM user_gifts ug2 WHERE ug2.gift_id = ug.gift_id AND ug2.symbol_layer_id = ug.symbol_layer_id AND ug2.is_upgraded = TRUE), 0)
		           ELSE NULL END AS symbol_layer_rarity
	FROM user_gifts ug
	JOIN gift_catalog gc ON gc.id = ug.gift_id
	LEFT JOIN users u ON u.id = ug.sender_id
	LEFT JOIN gift_layers gl ON gl.id = ug.gift_layer_id
	LEFT JOIN gift_layers bgl ON bgl.id = ug.background_layer_id
	LEFT JOIN gift_layers sl ON sl.id = ug.symbol_layer_id
	WHERE ug.recipient_id = $1
	ORDER BY ug.created_at DESC
	LIMIT $2 OFFSET $3
	`, recipientID, limit, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	type ScanGift struct {
		models.UserGift
		giftLayerURL, bgLayerURL, symLayerURL sql.NullString
		giftRarity, bgRarity, symRarity       sql.NullInt64
	}

	var gifts []models.UserGift
	for rows.Next() {
		var g ScanGift
		if err := rows.Scan(
			&g.ID, &g.GiftID, &g.SenderID, &g.RecipientID, &g.Message,
			&g.IsAnonymous, &g.CreatedAt,
			&g.IsUpgraded, &g.GiftLayerID, &g.BackgroundLayerID, &g.SymbolLayerID, &g.UpgradedAt,
			&g.GiftName, &g.GiftImageURL, &g.GiftPrice,
			&g.IsGiftUpgradable, &g.GiftUpgradeCost,
			&g.SenderUsername, &g.SenderAvatarURL,
			&g.giftLayerURL, &g.bgLayerURL, &g.symLayerURL,
			&g.giftRarity, &g.bgRarity, &g.symRarity,
		); err != nil {
			return nil, 0, err
		}
		if g.giftLayerURL.Valid {
			g.GiftLayerImageURL = &g.giftLayerURL.String
		}
		if g.bgLayerURL.Valid {
			g.BackgroundLayerImageURL = &g.bgLayerURL.String
		}
		if g.symLayerURL.Valid {
			g.SymbolLayerImageURL = &g.symLayerURL.String
		}
		if g.giftRarity.Valid {
			r := int(g.giftRarity.Int64)
			g.GiftLayerRarity = &r
		}
		if g.bgRarity.Valid {
			r := int(g.bgRarity.Int64)
			g.BackgroundLayerRarity = &r
		}
		if g.symRarity.Valid {
			r := int(g.symRarity.Int64)
			g.SymbolLayerRarity = &r
		}

		// Hide sender info for anonymous gifts. The avatar is identity too:
		// an "anonymous" gift with the sender's photo is not anonymous.
		if g.IsAnonymous {
			g.SenderID = nil
			g.SenderUsername = nil
			g.SenderAvatarURL = nil
		}
		gifts = append(gifts, g.UserGift)
	}

	// Sender avatars honor private_hide_avatar for non-friends — on public
	// and private profiles alike. Fail-closed on resolution errors.
	senderIDs := make([]string, len(gifts))
	senderAvatars := make([]*string, len(gifts))
	for i := range gifts {
		if gifts[i].SenderID != nil {
			senderIDs[i] = *gifts[i].SenderID
		}
		senderAvatars[i] = gifts[i].SenderAvatarURL
	}
	if err := privacy.StripHiddenAvatars(h.db, viewerID, senderIDs, senderAvatars); err != nil {
		return nil, 0, err
	}
	for i := range gifts {
		gifts[i].SenderAvatarURL = senderAvatars[i]
	}

	if gifts == nil {
		gifts = []models.UserGift{}
	}

	return gifts, totalCount, nil
}

// GetGiftCatalog — GET /api/v1/gift_catalog (public)
//
// GetGiftCatalog godoc
// @Summary      Get gift catalog
// @Description  List all available gifts in the catalog
// @Tags         Gifts
// @Produce      json
// @Param        limit  query int false "Max results (1-200)" default(100)
// @Param        offset query int false "Offset for pagination"
// @Success      200 {object} models.APIResponse
// @Router       /gift_catalog [get]
func (h *GiftsHandler) GetGiftCatalog(c *gin.Context) {
	limit := 100
	offset := 0
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	if o := c.Query("offset"); o != "" {
		if n, err := strconv.Atoi(o); err == nil && n >= 0 {
			offset = n
		}
	}

	rows, err := h.db.Query(`
		SELECT id, name, description, image_url, price, category,
		       is_active, is_limited, max_quantity, sold_count, sort_order,
		       COALESCE(is_upgradable, FALSE), upgrade_cost,
		       created_at, updated_at
		FROM gift_catalog
		WHERE is_active = true
		ORDER BY sort_order ASC, created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		httpx.ServerError(c, "handler error", err)
		return
	}
	defer rows.Close()

	var gifts []models.GiftCatalog
	for rows.Next() {
		var g models.GiftCatalog
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.ImageURL, &g.Price, &g.Category,
			&g.IsActive, &g.IsLimited, &g.MaxQuantity, &g.SoldCount, &g.SortOrder,
			&g.IsUpgradable, &g.UpgradeCost,
			&g.CreatedAt, &g.UpdatedAt,
		)
		if err != nil {
			httpx.ServerError(c, "handler error", err)
			return
		}
		gifts = append(gifts, g)
	}

	if gifts == nil {
		gifts = []models.GiftCatalog{}
	}

	c.JSON(http.StatusOK, models.SuccessResponseWithCount(gifts, len(gifts)))
}
