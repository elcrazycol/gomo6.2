package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/cache"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type GiftsHandler struct {
	db    *sql.DB
	redis *redis.Client
	hub   *websocket.Hub
}

func NewGiftsHandler(db *sql.DB) *GiftsHandler {
	return &GiftsHandler{db: db}
}

func (h *GiftsHandler) SetRedis(redis *redis.Client) { h.redis = redis }

func (h *GiftsHandler) SetWebSocketHub(hub *websocket.Hub) { h.hub = hub }

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
	claims := c.MustGet("claims").(*auth.Claims)
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

	// Step 2: Get gift details and deduct drops atomically
	var price int
	var giftName, giftImageURL string
	err = tx.QueryRow("SELECT name, COALESCE(image_url, ''), price FROM gift_catalog WHERE id = $1", giftID).Scan(&giftName, &giftImageURL, &price)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to get gift price"))
		return
	}

	result, err = tx.Exec(`
		UPDATE users SET drops = drops - $1
		WHERE id = $2 AND drops >= $1
	`, price, senderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse("Failed to deduct drops"))
		return
	}
	affected, _ = result.RowsAffected()
	if affected == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Insufficient drops"))
		return
	}

	// Get new balance for transaction record
	var balanceAfter int
	err = tx.QueryRow("SELECT COALESCE(drops, 0) FROM users WHERE id = $1", senderID).Scan(&balanceAfter)
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

	// Record drops transaction (in same TX as gift creation)
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

	// Send notification to recipient
	go h.sendGiftNotification(recipientID.String(), senderID, giftID.String(), giftRecordID, req.IsAnonymous)

	// Send gift message in messenger (best-effort, after gift is committed)
	go h.sendGiftMessengerMessage(senderID, recipientID.String(), giftID.String(), giftName, giftImageURL, giftRecordID)

	// Invalidate cache
	if h.redis != nil {
		cache.InvalidateForProfile(h.redis, recipientID.String(), "")
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

	// Get sender name
	var senderName string
	if isAnonymous {
		senderName = "Аноним"
	} else {
		h.db.QueryRow("SELECT username FROM users WHERE id = $1", senderID).Scan(&senderName)
		if senderName == "" {
			senderName = "Пользователь"
		}
	}

	title := fmt.Sprintf("🎁 %s подарил(а) вам %s", senderName, giftName)
	message := fmt.Sprintf("Вы получили подарок «%s» от %s", giftName, senderName)

	var notificationID string
	var createdAt time.Time
	err := h.db.QueryRow(`
		INSERT INTO notifications (user_id, type, title, message, is_read, created_at)
		VALUES ($1, 'gift_received', $2, $3, false, $4)
		RETURNING id, created_at
	`, recipientID, title, message, time.Now()).Scan(&notificationID, &createdAt)
	if err != nil {
		log.Printf("[Gifts] notification insert error: %v", err)
		return
	}

	if h.redis != nil {
		middleware.InvalidateCacheForNotification(h.redis, recipientID)
	}

	if h.hub != nil {
		if err := h.hub.PublishNewNotification(map[string]interface{}{
			"id":              notificationID,
			"user_id":         recipientID,
			"type":            "gift_received",
			"title":           title,
			"message":         message,
			"notification_id": notificationID,
			"is_read":         false,
			"created_at":      createdAt.Format(time.RFC3339Nano),
		}); err != nil {
			log.Printf("[Gifts] WS notification error: %v", err)
		}
	}
}

func (h *GiftsHandler) sendGiftMessengerMessage(senderID, recipientID string, giftID, giftName, giftImageURL, giftRecordID string) {
	if h.hub == nil {
		return
	}

	convID, err := h.findOrCreateConversation(senderID, recipientID)
	if err != nil {
		log.Printf("[Gifts] find/create conversation error: %v", err)
		return
	}

	giftContent := fmt.Sprintf("__GIFT__:%s:%s:%s", giftID, giftName, giftImageURL)
	clientID := fmt.Sprintf("gift_%s", giftRecordID)

	encryptedContent, err := encryptContent(giftContent)
	if err != nil {
		log.Printf("[Gifts] encrypt gift message error: %v", err)
		return
	}

	var msgID string
	err = h.db.QueryRow(`
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id)
		VALUES ($1, $2, $3, $4)
		RETURNING id
	`, convID, senderID, encryptedContent, clientID).Scan(&msgID)
	if err != nil {
		log.Printf("[Gifts] insert gift message error: %v", err)
		return
	}

	_, err = h.db.Exec(`
		UPDATE chat_conversations
		SET last_message_preview = '🎁 Подарок',
		    last_message_sender_id = $1,
		    last_message_id = $2,
		    updated_at = NOW()
		WHERE id = $3
	`, senderID, msgID, convID)
	if err != nil {
		log.Printf("[Gifts] update conversation preview error: %v", err)
	}

	sentAt := time.Now().UTC().Format(time.RFC3339Nano)
	if err := h.hub.PublishNewChatMessage(gin.H{
		"id":              msgID,
		"conversation_id": convID,
		"sender_user_id":  senderID,
		"content":         giftContent,
		"is_edited":       false,
		"is_deleted":      false,
		"edited_at":       nil,
		"sent_at":         sentAt,
		"client_id":       clientID,
	}); err != nil {
		log.Printf("[Gifts] WS gift message error: %v", err)
	}

	if h.redis != nil {
		go invalidateMessengerCaches(h.redis, convID, senderID)
	}
}

func (h *GiftsHandler) findOrCreateConversation(user1, user2 string) (string, error) {
	for attempt := 0; attempt < 3; attempt++ {
		var convID string
		err := h.db.QueryRow(`
			SELECT cm1.conversation_id
			FROM chat_members cm1
			INNER JOIN chat_members cm2 ON cm1.conversation_id = cm2.conversation_id
			WHERE cm1.user_id = $1 AND cm2.user_id = $2
			  AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id = cm1.conversation_id) = 2
			LIMIT 1
		`, user1, user2).Scan(&convID)
		if err == nil {
			return convID, nil
		}
		if err != sql.ErrNoRows {
			return "", err
		}

		tx, err := h.db.Begin()
		if err != nil {
			return "", err
		}
		err = tx.QueryRow(`INSERT INTO chat_conversations DEFAULT VALUES RETURNING id`).Scan(&convID)
		if err != nil {
			tx.Rollback()
			continue
		}
		_, err = tx.Exec(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`, convID, user1, user2)
		if err != nil {
			tx.Rollback()
			continue
		}
		if err := tx.Commit(); err != nil {
			continue
		}
		return convID, nil
	}
	return "", fmt.Errorf("failed to create conversation after retries")
}

// GetUserGifts — GET /api/v1/user_gifts (public)
func (h *GiftsHandler) GetUserGifts(c *gin.Context) {
	recipientID := c.Query("recipient_id")
	if recipientID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("recipient_id is required"))
		return
	}
	recipientID = strings.TrimPrefix(recipientID, "eq.")

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

	// Get total count
	var totalCount int
	h.db.QueryRow(`SELECT COUNT(*) FROM user_gifts WHERE recipient_id = $1`, recipientID).Scan(&totalCount)

	// If limit=0, return only count
	if limit == 0 {
		c.JSON(http.StatusOK, models.SuccessResponseWithCount([]models.UserGift{}, totalCount))
		return
	}

	rows, err := h.db.Query(`
		SELECT ug.id, ug.gift_id, ug.sender_id, ug.recipient_id, ug.message,
		       ug.is_anonymous, ug.created_at,
		       gc.name AS gift_name, gc.image_url AS gift_image_url, gc.price AS gift_price,
		       u.username AS sender_username, u.avatar_url AS sender_avatar_url
		FROM user_gifts ug
		JOIN gift_catalog gc ON gc.id = ug.gift_id
		LEFT JOIN users u ON u.id = ug.sender_id
		WHERE ug.recipient_id = $1
		ORDER BY ug.created_at DESC
		LIMIT $2 OFFSET $3
	`, recipientID, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var gifts []models.UserGift
	for rows.Next() {
		var g models.UserGift
		err := rows.Scan(
			&g.ID, &g.GiftID, &g.SenderID, &g.RecipientID, &g.Message,
			&g.IsAnonymous, &g.CreatedAt,
			&g.GiftName, &g.GiftImageURL, &g.GiftPrice, &g.SenderUsername, &g.SenderAvatarURL,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		// Hide sender info for anonymous gifts
		if g.IsAnonymous {
			g.SenderID = nil
			g.SenderUsername = nil
		}
		gifts = append(gifts, g)
	}

	if gifts == nil {
		gifts = []models.UserGift{}
	}

	c.JSON(http.StatusOK, models.SuccessResponseWithCount(gifts, totalCount))
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
		       created_at, updated_at
		FROM gift_catalog
		WHERE is_active = true
		ORDER BY sort_order ASC, created_at DESC
		LIMIT $1 OFFSET $2
	`, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	var gifts []models.GiftCatalog
	for rows.Next() {
		var g models.GiftCatalog
		err := rows.Scan(
			&g.ID, &g.Name, &g.Description, &g.ImageURL, &g.Price, &g.Category,
			&g.IsActive, &g.IsLimited, &g.MaxQuantity, &g.SoldCount, &g.SortOrder,
			&g.CreatedAt, &g.UpdatedAt,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}
		gifts = append(gifts, g)
	}

	if gifts == nil {
		gifts = []models.GiftCatalog{}
	}

	c.JSON(http.StatusOK, models.SuccessResponseWithCount(gifts, len(gifts)))
}
