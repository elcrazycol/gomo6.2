package messenger

import (
	"database/sql"
	"net/http"
	"strconv"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

// ─── Mark Read ──────────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/read
//
// Uses a single transaction for consistency.

// MarkRead records a read receipt for a single message.
// POST /api/v1/messenger/conversations/:id/read
//
// MarkRead godoc
// @Summary      Mark messages as read
// @Description  Mark every message up to (and including) the given message as read — the Telegram-style "read line". One request covers the whole prefix, so a scroll burst costs one request instead of one per message. Messages below the line keep read_at NULL (unread). Each message keeps its first real read_at (COALESCE). The last_read_message_id / unread_count marker advances forward when this message is newer than the current marker.
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        request body MarkReadRequest true "Last read message"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/read [post]
// @Security     BearerAuth
func (h *MessengerHandler) MarkRead(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	var req MarkReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
		return
	}

	// Verify membership
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Verify the message exists in this conversation (404 otherwise).
	var exists bool
	err = h.dbFor(c).QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2)",
		req.MessageID, conversationID,
	).Scan(&exists)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}
	if !exists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Single transaction: mark read + delivered + reset unread. The rollback is
	// unconditional-free: when the route middleware owns the transaction
	// (MessengerTransactionMiddleware), rolling it back here would make the
	// middleware's commit fail with ErrTxDone → HTTP 500 on every read request,
	// so the server-side unread counter would never clear. Only a transaction
	// begun by this handler (direct tests / legacy callers) may be rolled back.
	tx, ownsTx, err := h.txFor(c)
	if err != nil {
		httpx.ServerError(c, "begin tx", err)
		return
	}
	defer func() {
		if ownsTx {
			_ = tx.Rollback()
		}
	}()

	// The read line: ONE request marks the whole prefix up to (and including)
	// the given message as read. Everything on screen is covered by a single
	// batch — messages below the fold keep read_at NULL until they are
	// actually scrolled into view. COALESCE preserves each message's FIRST
	// real read time, so individual read_at values survive later batches.
	// The prefix marker (last_read_message_id / unread_count) is advanced
	// separately below and only ever moves forward.
	_, err = tx.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at, read_at)
		SELECT m.id, $2, NOW(), NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $2
		  AND m.sent_at <= (SELECT sent_at FROM chat_messages WHERE id = $3 AND conversation_id = $1)
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET read_at = COALESCE(chat_receipts.read_at, NOW()), delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, conversationID, claims.UserID, req.MessageID)
	if err != nil {
		httpx.ServerError(c, "mark read receipts", err)
		return
	}

	_, err = tx.Exec(`
		UPDATE chat_members cm
		SET unread_count = (
				SELECT COUNT(*)
				FROM chat_messages m
				WHERE m.conversation_id = cm.conversation_id
				  AND m.sender_user_id != cm.user_id
				  AND m.is_deleted = false
				  AND m.sent_at > (SELECT sent_at FROM chat_messages WHERE id = $2)
			),
			last_read_message_id = $2,
			-- The peer's read line (chat_members.last_read_at, surfaced as
			-- other_last_read_at in the conversation list) only moves forward,
			-- guarded by the same marker condition as last_read_message_id.
			last_read_at = (SELECT sent_at FROM chat_messages WHERE id = $2)
		WHERE cm.conversation_id = $1 AND cm.user_id = $3
		  AND (
			cm.last_read_message_id IS NULL
			OR NOT EXISTS (
				SELECT 1
				FROM chat_messages previous_read
				WHERE previous_read.id = cm.last_read_message_id
				  AND previous_read.sent_at > (SELECT sent_at FROM chat_messages WHERE id = $2)
			)
		)
	`, conversationID, req.MessageID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "mark read unread reset", err)
		return
	}

	if ownsTx {
		if err := tx.Commit(); err != nil {
			httpx.ServerError(c, "commit tx", err)
			return
		}
	}

	queueAfterCommit(c, func() {
		if h.hub == nil {
			return
		}
		go func() {
			if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type: "read_receipt",
				Payload: map[string]interface{}{
					"conversation_id": conversationID,
					"user_id":         claims.UserID,
					"message_id":      req.MessageID,
					"event":           "read_receipt",
				},
			}); err != nil {
				// Persistence already succeeded; realtime delivery is best effort.
			}
		}()
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ─── Mark Delivered ─────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/delivered

// MarkDelivered marks messages as delivered.
// POST /api/v1/messenger/conversations/:id/delivered
//
// MarkDelivered godoc
// @Summary      Mark messages as delivered
// @Description  Mark all messages up to a given message as delivered
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        request body object true "Last delivered message"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/delivered [post]
// @Security     BearerAuth
func (h *MessengerHandler) MarkDelivered(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	var req struct {
		MessageID string `json:"message_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
		return
	}

	// Verify membership
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Get the message time
	var sentAt time.Time
	err = h.dbFor(c).QueryRow("SELECT sent_at FROM chat_messages WHERE id = $1 AND conversation_id = $2",
		req.MessageID, conversationID,
	).Scan(&sentAt)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Mark delivered
	_, err = h.dbFor(c).Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at)
		SELECT m.id, $2, NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $2
		  AND m.sent_at <= $3
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, conversationID, claims.UserID, sentAt)
	if err != nil {
		httpx.ServerError(c, "mark delivered", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ─── Get Unread Count ───────────────────────────────────────────────────────
// GET /api/v1/messenger/unread-count

// GetUnreadCount returns total unread message count across all conversations.
// GET /api/v1/messenger/unread-count
//
// GetUnreadCount godoc
// @Summary      Get unread message count
// @Description  Get total unread message count across all conversations
// @Tags         Messenger
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /messenger/unread-count [get]
// @Security     BearerAuth
func (h *MessengerHandler) GetUnreadCount(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var count int
	err := h.dbFor(c).QueryRow(`
		SELECT COALESCE(SUM(unread_count), 0)
		FROM chat_members
		WHERE user_id = $1
	`, claims.UserID).Scan(&count)
	if err != nil {
		httpx.ServerError(c, "get unread count", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}

// ─── Get Receipts ───────────────────────────────────────────────────────────
// GET /api/v1/messenger/conversations/:id/receipts

// GetReceipts returns read/delivered receipts for messages in a conversation.
// GET /api/v1/messenger/conversations/:id/receipts
//
// GetReceipts godoc
// @Summary      Get message receipts
// @Description  Get read and delivered receipts for messages in a conversation
// @Tags         Messenger
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        limit  query int    false "Max results" default(500)
// @Param        before query string false "Cursor: get receipts before this message ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/receipts [get]
// @Security     BearerAuth
func (h *MessengerHandler) GetReceipts(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member"))
		return
	}

	// Pagination
	limit := 500
	before := c.Query("before")
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 2000 {
			limit = n
		}
	}

	query := `
		SELECT r.message_id, r.user_id, r.delivered_at, r.read_at
		FROM chat_receipts r
		INNER JOIN chat_messages m ON m.id = r.message_id
		WHERE m.conversation_id = $1
	`
	args := []interface{}{conversationID}

	if before != "" {
		query += ` AND r.message_id < $2`
		args = append(args, before)
		query += ` ORDER BY r.message_id DESC LIMIT $3`
		args = append(args, limit)
	} else {
		query += ` ORDER BY r.message_id DESC LIMIT $2`
		args = append(args, limit)
	}

	rows, err := h.dbFor(c).Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "get receipts", err)
		return
	}
	defer rows.Close()

	type ReceiptRow struct {
		MessageID   string  `json:"message_id"`
		UserID      string  `json:"user_id"`
		DeliveredAt *string `json:"delivered_at"`
		ReadAt      *string `json:"read_at"`
	}

	receipts := []ReceiptRow{}
	for rows.Next() {
		var r ReceiptRow
		var deliveredAt, readAt sql.NullTime
		if err := rows.Scan(&r.MessageID, &r.UserID, &deliveredAt, &readAt); err != nil {
			continue
		}
		if deliveredAt.Valid {
			s := deliveredAt.Time.Format(time.RFC3339)
			r.DeliveredAt = &s
		}
		if readAt.Valid {
			s := readAt.Time.Format(time.RFC3339)
			r.ReadAt = &s
		}
		receipts = append(receipts, r)
	}

	if receipts == nil {
		receipts = []ReceiptRow{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(receipts))
}

// ─── Toggle Pin ─────────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/pin

// TogglePin pins or unpins a message in a conversation.
// POST /api/v1/messenger/conversations/:id/pin
//
// TogglePin godoc
// @Summary      Toggle pin message
// @Description  Pin or unpin a message in a conversation
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        request body object true "Message to pin"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/pin [post]
// @Security     BearerAuth
func (h *MessengerHandler) TogglePin(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	var req struct {
		MessageID string `json:"message_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
		return
	}

	// Check membership
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member"))
		return
	}

	// Verify the message belongs to this conversation
	var msgExists bool
	err = h.dbFor(c).QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND is_deleted = false)",
		req.MessageID, conversationID,
	).Scan(&msgExists)
	if err != nil {
		httpx.ServerError(c, "check message exists", err)
		return
	}
	if !msgExists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Get current pinned message
	var currentPin sql.NullString
	err = h.dbFor(c).QueryRow("SELECT pinned_message_id FROM chat_conversations WHERE id = $1", conversationID).Scan(&currentPin)
	if err != nil {
		httpx.ServerError(c, "get current pin", err)
		return
	}

	if currentPin.Valid && currentPin.String == req.MessageID {
		// Unpin
		_, err = h.dbFor(c).Exec("UPDATE chat_conversations SET pinned_message_id = NULL WHERE id = $1", conversationID)
		if err != nil {
			httpx.ServerError(c, "unpin message", err)
			return
		}
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": nil}))
	} else {
		// Pin
		_, err = h.dbFor(c).Exec("UPDATE chat_conversations SET pinned_message_id = $2 WHERE id = $1", conversationID, req.MessageID)
		if err != nil {
			httpx.ServerError(c, "pin message", err)
			return
		}
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": req.MessageID}))
	}
}
