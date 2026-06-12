package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

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
	member, err := h.isMember(conversationID, claims.UserID)
	if err != nil {
		serverError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Pagination
	limit := 50
	before := c.Query("before")

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
		serverError(c, "get messages", err)
		return
	}
	defer rows.Close()

	messages := []MessageResponse{}
	for rows.Next() {
		var msg MessageResponse
		var parentID, editedAt sql.NullString
		var encryptedContent string
		var isDeleted bool

		if err := rows.Scan(
			&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
			&encryptedContent, &msg.IsEdited, &isDeleted,
			&editedAt, &msg.SentAt, &msg.ClientID,
		); err != nil {
			serverError(c, "scan message row", err)
			return
		}

		msg.IsDeleted = isDeleted
		if isDeleted {
			msg.Content = ""
		} else {
			decrypted, decErr := decryptContent(encryptedContent)
			if decErr == nil {
				msg.Content = decrypted
			} else {
				msg.Content = encryptedContent
			}
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
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Sanitize content (no HTML, no empty)
	cleanContent, err := sanitizeContent(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Verify membership
	member, err := h.isMember(conversationID, claims.UserID)
	if err != nil {
		serverError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Encrypt content before storing
	encryptedContent, err := encryptContent(cleanContent)
	if err != nil {
		serverError(c, "encrypt content", err)
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
	`, conversationID, claims.UserID, encryptedContent, req.ClientID, req.ParentMessageID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
		&msg.Content, &msg.IsEdited, &msg.IsDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	)
	if err != nil {
		// ClientID conflict = duplicate send, return existing message
		if strings.Contains(err.Error(), "unique_client_msg") || strings.Contains(err.Error(), "duplicate key") {
			existing := h.db.QueryRow(`
				SELECT id, conversation_id, sender_user_id, parent_message_id,
					content, is_edited, is_deleted, edited_at, sent_at, client_id
				FROM chat_messages
				WHERE conversation_id = $1 AND client_id = $2
			`, conversationID, req.ClientID)
			if err2 := existing.Scan(
				&msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
				&msg.Content, &msg.IsEdited, &msg.IsDeleted,
				&editedAt, &msg.SentAt, &msg.ClientID,
			); err2 != nil {
				serverError(c, "fetch duplicate message", err2)
				return
			}
			decryptMessageContent(&msg)
			if parentID.Valid {
				msg.ParentMessageID = &parentID.String
			}
			c.JSON(http.StatusOK, models.SuccessResponse(msg))
			return
		}
		serverError(c, "insert message", err)
		return
	}

	// Decrypt content for response
	msg.Content = cleanContent

	if parentID.Valid {
		msg.ParentMessageID = &parentID.String
	}
	if editedAt.Valid {
		s := editedAt.String
		msg.EditedAt = &s
	}

	// Update conversation preview fields (trigger handles last_message_at, but not preview)
	go func() {
		_, err := h.db.Exec(`
			UPDATE chat_conversations
			SET last_message_preview = $1, last_message_sender_id = $2, updated_at = NOW()
			WHERE id = $3
		`, truncatePreview(cleanContent), claims.UserID, conversationID)
		if err != nil {
			log.Printf("[Messenger] update conversation preview: %v", err)
		}
	}()

	// Invalidate messenger caches for this conversation
	if h.redis != nil {
		go invalidateMessengerCaches(h.redis, conversationID, claims.UserID)
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

	conversationID := c.Param("id")
	messageID := c.Param("msgId")

	var req EditMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	cleanContent, err := sanitizeContent(req.Content)
	if err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
		return
	}

	// Encrypt new content
	encryptedContent, err := encryptContent(cleanContent)
	if err != nil {
		serverError(c, "encrypt edit content", err)
		return
	}

	// Only sender can edit, and message must not be deleted
	result, err := h.db.Exec(`
		UPDATE chat_messages
		SET content = $1, is_edited = true, edited_at = NOW()
		WHERE id = $2 AND sender_user_id = $3 AND is_deleted = false
	`, encryptedContent, messageID, claims.UserID)
	if err != nil {
		serverError(c, "edit message", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or not editable"))
		return
	}

	// Broadcast edit event (with decrypted content)
	if h.hub != nil {
		go h.broadcastMessageEdited(messageID, cleanContent, conversationID)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *MessengerHandler) broadcastMessageEdited(msgID, newContent, conversationID string) {
	payload := map[string]interface{}{
		"id":              msgID,
		"content":         newContent,
		"conversation_id": conversationID,
		"edited_at":       time.Now().UTC().Format(time.RFC3339),
		"event":           "message_edited",
	}
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
	conversationID := c.Param("id")

	// Verify user is a conversation member AND message sender
	// This prevents users from deleting messages in conversations they're not part of
	result, err := h.db.Exec(`
		UPDATE chat_messages
		SET is_deleted = true
		WHERE id = $1
		  AND sender_user_id = $2
		  AND is_deleted = false
		  AND conversation_id = $3
		  AND EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $3 AND user_id = $2)
	`, messageID, claims.UserID, conversationID)
	if err != nil {
		serverError(c, "delete message", err)
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
					"id":              messageID,
					"conversation_id": conversationID,
					"event":           "message_deleted",
				},
			})
		}()
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}
