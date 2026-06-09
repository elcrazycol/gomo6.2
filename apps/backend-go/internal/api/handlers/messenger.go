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
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// ─── Types ──────────────────────────────────────────────────────────────────

// ConversationResponse is returned to the client for conversation list
type ConversationResponse struct {
	ID                  string  `json:"id"`
	LastMessageAt       *string `json:"last_message_at"`
	LastMessagePreview  *string `json:"last_message_preview"`
	LastMessageSenderID *string `json:"last_message_sender_id"`
	PinnedMessageID     *string `json:"pinned_message_id"`
	UpdatedAt           string  `json:"updated_at"`
	// Joined from chat_members
	UnreadCount int     `json:"unread_count"`
	LastReadAt  *string `json:"last_read_at"`
	IsMuted     bool    `json:"is_muted"`
	// Other user info (for 1:1)
	OtherUserID     string  `json:"other_user_id"`
	OtherUsername   string  `json:"other_username"`
	OtherAvatarURL  *string `json:"other_avatar_url"`
	OtherAccountNum *int    `json:"other_account_number"`
	OtherIsOnline   *bool   `json:"other_is_online"`
	OtherLastSeenAt *string `json:"other_last_seen_at"`
}

// MessageResponse is returned to the client
type MessageResponse struct {
	ID              string  `json:"id"`
	ConversationID  string  `json:"conversation_id"`
	SenderUserID    string  `json:"sender_user_id"`
	ParentMessageID *string `json:"parent_message_id"`
	Content         string  `json:"content"`
	IsEdited        bool    `json:"is_edited"`
	IsDeleted       bool    `json:"is_deleted"`
	EditedAt        *string `json:"edited_at"`
	SentAt          string  `json:"sent_at"`
	ClientID        string  `json:"client_id"`
}

// SendMessageRequest is the POST body for sending a message
type SendMessageRequest struct {
	Content         string  `json:"content" binding:"required,max=4000"`
	ClientID        string  `json:"client_id" binding:"required"`
	ParentMessageID *string `json:"parent_message_id"`
}

// EditMessageRequest is the PUT body for editing a message
type EditMessageRequest struct {
	Content string `json:"content" binding:"required,max=4000"`
}

// MarkReadRequest is the POST body for marking messages as read
type MarkReadRequest struct {
	MessageID string `json:"message_id" binding:"required"`
}

// ─── Handler ────────────────────────────────────────────────────────────────

// MessengerHandler handles all messenger REST endpoints.
// No encryption, no E2EE — plaintext in DB, security via RLS + TLS.
type MessengerHandler struct {
	db    *sql.DB
	hub   *websocket.Hub
	redis *redis.Client
}

func NewMessengerHandler(db *sql.DB, hub *websocket.Hub) *MessengerHandler {
	return &MessengerHandler{db: db, hub: hub}
}

func (h *MessengerHandler) SetRedis(r *redis.Client) { h.redis = r }

// ─── Helpers ────────────────────────────────────────────────────────────────

func getClaims(c *gin.Context) *auth.Claims {
	claimsInterface, exists := c.Get("claims")
	if !exists {
		return nil
	}
	claims, ok := claimsInterface.(*auth.Claims)
	if !ok {
		return nil
	}
	return claims
}

func ensureAuth(c *gin.Context) *auth.Claims {
	claims := getClaims(c)
	if claims == nil || claims.UserID == "" {
		c.JSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return nil
	}
	return claims
}

// ─── List Conversations ─────────────────────────────────────────────────────
// GET /api/v1/messenger/conversations

func (h *MessengerHandler) ListConversations(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	rows, err := h.db.Query(`
		SELECT
			c.id, c.last_message_at, c.last_message_preview,
			c.last_message_sender_id, c.pinned_message_id, c.updated_at,
			cm.unread_count, cm.unread_count AS unread,
			u.id AS other_id, u.username AS other_username,
			u.avatar_url, u.account_number, u.is_online, u.last_seen_at
		FROM chat_members cm
		INNER JOIN chat_conversations c ON c.id = cm.conversation_id
		-- For 1:1 chats: find the other user
		INNER JOIN chat_members cm2 ON cm2.conversation_id = cm.conversation_id AND cm2.user_id != $1
		INNER JOIN users u ON u.id = cm2.user_id
		WHERE cm.user_id = $1
		ORDER BY c.last_message_at DESC NULLS LAST
	`, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	conversations := []ConversationResponse{}
	for rows.Next() {
		var conv ConversationResponse
		var otherAvatar, otherLastSeen sql.NullString
		var otherAccount sql.NullInt64
		var otherOnline sql.NullBool
		var preview sql.NullString

		err := rows.Scan(
			&conv.ID, &conv.LastMessageAt, &preview,
			&conv.LastMessageSenderID, &conv.PinnedMessageID, &conv.UpdatedAt,
			&conv.UnreadCount, &conv.UnreadCount,
			&conv.OtherUserID, &conv.OtherUsername,
			&otherAvatar, &otherAccount, &otherOnline, &otherLastSeen,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		if preview.Valid {
			conv.LastMessagePreview = &preview.String
		}
		if otherAvatar.Valid {
			conv.OtherAvatarURL = &otherAvatar.String
		}
		if otherAccount.Valid {
			v := int(otherAccount.Int64)
			conv.OtherAccountNum = &v
		}
		if otherOnline.Valid {
			conv.OtherIsOnline = &otherOnline.Bool
		}
		if otherLastSeen.Valid {
			conv.OtherLastSeenAt = &otherLastSeen.String
		}

		conversations = append(conversations, conv)
	}

	if conversations == nil {
		conversations = []ConversationResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(conversations))
}

// ─── Get or Create Conversation ─────────────────────────────────────────────
// POST /api/v1/messenger/conversations

func (h *MessengerHandler) GetOrCreateConversation(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req struct {
		UserID string `json:"user_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_id is required"))
		return
	}

	if req.UserID == claims.UserID {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Cannot chat with yourself"))
		return
	}

	var convID string
	err := h.db.QueryRow("SELECT rpc_get_or_create_direct_chat($1, $2)", claims.UserID, req.UserID).Scan(&convID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"conversation_id": convID}))
}

// ─── Get Messages ───────────────────────────────────────────────────────────
// GET /api/v1/messenger/conversations/:id/messages

func (h *MessengerHandler) GetMessages(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("conversation_id required"))
		return
	}

	// Verify membership
	var isMember bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, claims.UserID,
	).Scan(&isMember)
	if err != nil || !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Pagination
	limit := 50
	before := c.Query("before") // cursor-based: messages before this ID

	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	var rows *sql.Rows
	if before != "" {
		rows, err = h.db.Query(`
			SELECT id, conversation_id, sender_user_id, parent_message_id,
				content, is_edited, is_deleted,
				CASE WHEN is_deleted THEN NULL ELSE content END AS visible_content,
				edited_at, sent_at, client_id
			FROM chat_messages
			WHERE conversation_id = $1 AND sent_at < (
				SELECT sent_at FROM chat_messages WHERE id = $2
			)
			ORDER BY sent_at DESC
			LIMIT $3
		`, conversationID, before, limit)
	} else {
		rows, err = h.db.Query(`
			SELECT id, conversation_id, sender_user_id, parent_message_id,
				content, is_edited, is_deleted,
				edited_at, sent_at, client_id
			FROM chat_messages
			WHERE conversation_id = $1
			ORDER BY sent_at DESC
			LIMIT $2
		`, conversationID, limit)
	}

	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}
	defer rows.Close()

	messages := []MessageResponse{}
	for rows.Next() {
		var msg MessageResponse
		var parentID, editedAt sql.NullString
		var rawContent string
		var isDeleted bool

		err := rows.Scan(
			&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
			&rawContent, &msg.IsEdited, &isDeleted,
			&editedAt, &msg.SentAt, &msg.ClientID,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
			return
		}

		msg.IsDeleted = isDeleted
		if isDeleted {
			msg.Content = ""
		} else {
			msg.Content = rawContent
		}

		if parentID.Valid {
			msg.ParentMessageID = &parentID.String
		}
		if editedAt.Valid {
			s := editedAt.String
			msg.EditedAt = &s
		}

		messages = append(messages, msg)
	}

	// Reverse to oldest-first order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	if messages == nil {
		messages = []MessageResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(messages))
}

// ─── Send Message ───────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/messages

func (h *MessengerHandler) SendMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	if strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("content cannot be empty"))
		return
	}

	// Verify membership
	var isMember bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, claims.UserID,
	).Scan(&isMember)
	if err != nil || !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Insert message
	var msg MessageResponse
	var parentID, editedAt sql.NullString
	err = h.db.QueryRow(`
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id, parent_message_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, conversation_id, sender_user_id, parent_message_id,
			content, is_edited, is_deleted, edited_at, sent_at, client_id
	`, conversationID, claims.UserID, req.Content, req.ClientID, req.ParentMessageID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
		&msg.Content, &msg.IsEdited, &msg.IsDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	)
	if err != nil {
		// ClientID conflict = duplicate send, return 409
		if strings.Contains(err.Error(), "unique_client_msg") || strings.Contains(err.Error(), "duplicate key") {
			// Fetch the existing message
			existing := h.db.QueryRow(`
				SELECT id, conversation_id, sender_user_id, parent_message_id,
					content, is_edited, is_deleted, edited_at, sent_at, client_id
				FROM chat_messages
				WHERE conversation_id = $1 AND client_id = $2
			`, conversationID, req.ClientID)
			err2 := existing.Scan(
				&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
				&msg.Content, &msg.IsEdited, &msg.IsDeleted,
				&editedAt, &msg.SentAt, &msg.ClientID,
			)
			if err2 != nil {
				c.JSON(http.StatusConflict, models.ErrorResponse("Duplicate message"))
				return
			}
			if parentID.Valid {
				msg.ParentMessageID = &parentID.String
			}
			c.JSON(http.StatusOK, models.SuccessResponse(msg))
			return
		}
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if parentID.Valid {
		msg.ParentMessageID = &parentID.String
	}
	if editedAt.Valid {
		s := editedAt.String
		msg.EditedAt = &s
	}

	// Broadcast via WebSocket
	if h.hub != nil {
		go h.broadcastNewMessage(conversationID, msg, claims)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(msg))
}

func (h *MessengerHandler) broadcastNewMessage(convID string, msg MessageResponse, claims *auth.Claims) {
	payload := gin.H{
		"id":                msg.ID,
		"conversation_id":   msg.ConversationID,
		"sender_user_id":    msg.SenderUserID,
		"parent_message_id": msg.ParentMessageID,
		"content":           msg.Content,
		"is_edited":         msg.IsEdited,
		"is_deleted":        msg.IsDeleted,
		"edited_at":         msg.EditedAt,
		"sent_at":           msg.SentAt,
		"client_id":         msg.ClientID,
		"sender_username":   claims.Username,
	}
	if err := h.hub.PublishNewChatMessage(payload); err != nil {
		log.Printf("[Messenger] WS broadcast error: %v", err)
	}
}

// ─── Edit Message ───────────────────────────────────────────────────────────
// PUT /api/v1/messenger/conversations/:convId/messages/:msgId

func (h *MessengerHandler) EditMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	messageID := c.Param("msgId")

	var req EditMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	if strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("content cannot be empty"))
		return
	}

	// Only sender can edit, and message must not be deleted
	result, err := h.db.Exec(`
		UPDATE chat_messages
		SET content = $1, is_edited = true, edited_at = NOW()
		WHERE id = $2 AND sender_user_id = $3 AND is_deleted = false
	`, req.Content, messageID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or not editable"))
		return
	}

	// Broadcast edit event
	if h.hub != nil {
		go h.broadcastMessageEdited(messageID, req.Content)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *MessengerHandler) broadcastMessageEdited(msgID, newContent string) {
	payload := map[string]interface{}{
		"id":      msgID,
		"content": newContent,
		"event":   "message_edited",
	}
	// Use publishChatEvent for generic chat events
	if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
		Type:    "message_edited",
		Payload: payload,
	}); err != nil {
		log.Printf("[Messenger] WS edit broadcast error: %v", err)
	}
}

// ─── Delete Message ─────────────────────────────────────────────────────────
// DELETE /api/v1/messenger/conversations/:convId/messages/:msgId

func (h *MessengerHandler) DeleteMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	messageID := c.Param("msgId")

	result, err := h.db.Exec(`
		UPDATE chat_messages
		SET is_deleted = true
		WHERE id = $1 AND sender_user_id = $2 AND is_deleted = false
	`, messageID, claims.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or already deleted"))
		return
	}

	// Broadcast delete event
	if h.hub != nil {
		go func() {
			h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type: "message_deleted",
				Payload: map[string]interface{}{
					"id":    messageID,
					"event": "message_deleted",
				},
			})
		}()
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// ─── Mark Read ──────────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/read

func (h *MessengerHandler) MarkRead(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	var req MarkReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Verify membership
	var isMember bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, claims.UserID,
	).Scan(&isMember)
	if err != nil || !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Get message sent_at for read-receipt scope
	var sentAt time.Time
	err = h.db.QueryRow("SELECT sent_at FROM chat_messages WHERE id = $1", req.MessageID).Scan(&sentAt)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}

	// Mark all messages up to this one as read
	_, err = h.db.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at, read_at)
		SELECT m.id, $4, NOW(), NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $4
		  AND m.sent_at <= $2
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET read_at = NOW()
	`, conversationID, sentAt, req.MessageID, claims.UserID)
	if err != nil {
		log.Printf("[Messenger] mark read error: %v", err)
	}

	// Also mark as delivered for any messages not yet delivered
	_, _ = h.db.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at)
		SELECT m.id, $4, NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $4
		  AND m.sent_at <= $2
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, conversationID, sentAt, req.MessageID, claims.UserID)

	// Reset unread count
	_, _ = h.db.Exec(`
		UPDATE chat_members
		SET unread_count = 0, last_read_message_id = $2
		WHERE conversation_id = $1 AND user_id = $3
	`, conversationID, req.MessageID, claims.UserID)

	// Broadcast read receipt via WebSocket
	if h.hub != nil {
		go func() {
			h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type: "read_receipt",
				Payload: map[string]interface{}{
					"conversation_id": conversationID,
					"user_id":         claims.UserID,
					"message_id":      req.MessageID,
					"event":           "read_receipt",
				},
			})
		}()
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ─── Mark Delivered ─────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/delivered

func (h *MessengerHandler) MarkDelivered(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	var req struct {
		MessageID string `json:"message_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Get the message time
	var sentAt time.Time
	err := h.db.QueryRow("SELECT sent_at FROM chat_messages WHERE id = $1", req.MessageID).Scan(&sentAt)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}

	// Mark delivered
	_, err = h.db.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at)
		SELECT m.id, $4, NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $4
		  AND m.sent_at <= $2
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, conversationID, sentAt, req.MessageID, claims.UserID)
	if err != nil {
		log.Printf("[Messenger] mark delivered error: %v", err)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"ok": true}))
}

// ─── Get Unread Count ───────────────────────────────────────────────────────
// GET /api/v1/messenger/unread-count

func (h *MessengerHandler) GetUnreadCount(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var count int
	err := h.db.QueryRow(`
		SELECT COALESCE(SUM(unread_count), 0)
		FROM chat_members
		WHERE user_id = $1
	`, claims.UserID).Scan(&count)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"unread_count": count}))
}

// ─── Get Receipts ───────────────────────────────────────────────────────────
// GET /api/v1/messenger/conversations/:id/receipts

func (h *MessengerHandler) GetReceipts(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	// Verify membership
	var isMember bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, claims.UserID,
	).Scan(&isMember)
	if err != nil || !isMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member"))
		return
	}

	rows, err := h.db.Query(`
		SELECT r.message_id, r.user_id, r.delivered_at, r.read_at
		FROM chat_receipts r
		INNER JOIN chat_messages m ON m.id = r.message_id
		WHERE m.conversation_id = $1
	`, conversationID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
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
		err := rows.Scan(&r.MessageID, &r.UserID, &deliveredAt, &readAt)
		if err != nil {
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

func (h *MessengerHandler) TogglePin(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	var req struct {
		MessageID string `json:"message_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	var newPinID sql.NullString
	err := h.db.QueryRow("SELECT rpc_toggle_pin_message($1, $2, $3)", claims.UserID, conversationID, req.MessageID).Scan(&newPinID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, models.ErrorResponse(err.Error()))
		return
	}

	if newPinID.Valid {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": newPinID.String}))
	} else {
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": nil}))
	}
}

// sanitizeMessageContent trims and limits message length
func sanitizeMessageContent(s string) string {
	s = strings.TrimSpace(s)
	if len([]rune(s)) > 4000 {
		runes := []rune(s)
		s = string(runes[:4000])
	}
	return s
}

// generateClientID creates a unique client-side idempotency key
// (not used server-side — client sends its own; provided as utility)
func GenerateClientID() string {
	return fmt.Sprintf("c%d", time.Now().UnixNano())
}
