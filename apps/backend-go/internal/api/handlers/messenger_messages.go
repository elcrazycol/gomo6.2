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

// GetMessages godoc
// @Summary      Get messages
// @Description  Get messages in a conversation (member only)
// @Tags         Messenger
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        limit  query int    false "Max results (1-100)" default(50)
// @Param        before query string false "Cursor: get messages before this message ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages [get]
// @Security     BearerAuth
func (h *MessengerHandler) GetMessages(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if conversationID == "" || !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
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

	// Batch-fetch attachments for all messages
	if len(messages) > 0 {
		ids := make([]string, len(messages))
		for i, m := range messages {
			ids[i] = m.ID
		}
		attMap, err := h.getAttachmentsByMessageIDs(ids)
		if err != nil {
			serverError(c, "get attachments", err)
			return
		}
		for i := range messages {
			if atts, ok := attMap[messages[i].ID]; ok {
				messages[i].Attachments = atts
			}
		}
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

// SendMessage godoc
// @Summary      Send message
// @Description  Send a message to a conversation
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        request body SendMessageRequest true "Message content"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages [post]
// @Security     BearerAuth
func (h *MessengerHandler) SendMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	var req SendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	// Sanitize content (allow empty if attachments present)
	cleanContent := strings.TrimSpace(req.Content)
	if cleanContent == "" && len(req.Attachments) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Content or attachments required"))
		return
	}
	if cleanContent != "" {
		if len([]rune(cleanContent)) > 4000 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("content exceeds 4000 characters"))
			return
		}
		if hasHTML(cleanContent) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("HTML content is not allowed"))
			return
		}
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

	// Start transaction for message + attachments
	tx, err := h.db.Begin()
	if err != nil {
		serverError(c, "begin transaction", err)
		return
	}
	defer tx.Rollback()

	// Insert message
	var msg MessageResponse
	var parentID, editedAt sql.NullString
	err = tx.QueryRow(`
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
			_ = tx.Rollback()
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
			// Fetch attachments for duplicate message
			atts, _ := h.getAttachmentsByMessageIDs([]string{msg.ID})
			if a, ok := atts[msg.ID]; ok {
				msg.Attachments = a
			}
			c.JSON(http.StatusOK, models.SuccessResponse(msg))
			return
		}
		serverError(c, "insert message", err)
		return
	}

	// Insert attachments
	if len(req.Attachments) > 0 {
		if err := h.insertAttachments(tx, msg.ID, req.Attachments); err != nil {
			serverError(c, "insert attachments", err)
			return
		}
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		serverError(c, "commit transaction", err)
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

	// Build attachment response
	if len(req.Attachments) > 0 {
		msg.Attachments = make([]Attachment, len(req.Attachments))
		for i, att := range req.Attachments {
			msg.Attachments[i] = Attachment{
				Type:      att.Type,
				URL:       att.URL,
				Name:      att.Name,
				Size:      att.Size,
				Mime:      att.Mime,
				Meta:      att.Meta,
				SortOrder: i,
			}
		}
	}

	// Update conversation preview fields (trigger handles last_message_at, but not preview)
	go func() {
		encryptedPreview, encErr := encryptContent(truncatePreview(cleanContent))
		if encErr != nil {
			log.Printf("[Messenger] encrypt preview: %v", encErr)
			encryptedPreview = truncatePreview(cleanContent)
		}
		_, err := h.db.Exec(`
			UPDATE chat_conversations
			SET last_message_preview = $1, last_message_sender_id = $2, updated_at = NOW()
			WHERE id = $3
		`, encryptedPreview, claims.UserID, conversationID)
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
	if len(msg.Attachments) > 0 {
		payload["attachments"] = msg.Attachments
	}
	if err := h.hub.PublishNewChatMessage(payload); err != nil {
		log.Printf("[Messenger] WS broadcast error: %v", err)
	}
}

// ─── Edit Message ───────────────────────────────────────────────────────────
// PUT /api/v1/messenger/conversations/:convId/messages/:msgId

// EditMessage godoc
// @Summary      Edit message
// @Description  Edit a message (sender only)
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        msgId path string true "Message ID"
// @Param        request body EditMessageRequest true "New content"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages/{msgId} [put]
// @Security     BearerAuth
func (h *MessengerHandler) EditMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	messageID := c.Param("msgId")
	if !isUUID(conversationID) || !isUUID(messageID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id or message_id"))
		return
	}

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

// DeleteMessage godoc
// @Summary      Delete message
// @Description  Soft-delete a message (sender only)
// @Tags         Messenger
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        msgId path string true "Message ID"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages/{msgId} [delete]
// @Security     BearerAuth
func (h *MessengerHandler) DeleteMessage(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	messageID := c.Param("msgId")
	conversationID := c.Param("id")
	if !isUUID(conversationID) || !isUUID(messageID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id or message_id"))
		return
	}

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

// getAttachmentsByMessageIDs fetches attachments for multiple messages in one query
func (h *MessengerHandler) getAttachmentsByMessageIDs(messageIDs []string) (map[string][]Attachment, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	// Build IN clause
	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = id
	}

	query := `
		SELECT id, message_id, url, type, name, size, mime, meta, sort_order
		FROM message_attachments
		WHERE message_id IN (` + strings.Join(placeholders, ",") + `)
		ORDER BY message_id, sort_order
	`

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]Attachment)
	for rows.Next() {
		var att Attachment
		var msgID string
		var meta sql.NullString
		if err := rows.Scan(&att.ID, &msgID, &att.URL, &att.Type, &att.Name, &att.Size, &att.Mime, &meta, &att.SortOrder); err != nil {
			return nil, err
		}
		if meta.Valid {
			att.Meta = &meta.String
		}
		result[msgID] = append(result[msgID], att)
	}
	return result, nil
}

// insertAttachments inserts attachments for a message in a transaction
func (h *MessengerHandler) insertAttachments(tx *sql.Tx, messageID string, attachments []AttachmentInput) error {
	for i, att := range attachments {
		_, err := tx.Exec(`
			INSERT INTO message_attachments (message_id, url, type, name, size, mime, meta, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		`, messageID, att.URL, att.Type, att.Name, att.Size, att.Mime, att.Meta, i)
		if err != nil {
			return err
		}
	}
	return nil
}
