package handlers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gomo6/backend/internal/httpx"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/push"
	"github.com/gomo6/backend/internal/storage"
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
// @Param        since_event_id query string false "Decimal BIGINT cursor; return messages after this monotonic event cursor"
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
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	// Notes conversations carry client-side E2E ciphertext: the server forwards
	// it verbatim and never attempts to decrypt it.
	isNotes, err := h.isNotesConversation(c, conversationID)
	if err != nil {
		httpx.ServerError(c, "check notes conversation", err)
		return
	}

	// Pagination and reconnect delta cursor. The two cursor modes are
	// deliberately mutually exclusive so a reconnect cannot silently turn into
	// an unrelated backwards page.
	limit := 50
	before := c.Query("before")
	sinceEventRaw := c.Query("since_event_id")
	if before != "" && sinceEventRaw != "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("before and since_event_id cannot be combined"))
		return
	}
	var sinceEventID int64
	if sinceEventRaw != "" {
		var parseErr error
		sinceEventID, parseErr = strconv.ParseInt(sinceEventRaw, 10, 64)
		if parseErr != nil || sinceEventID < 0 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid since_event_id"))
			return
		}
	}

	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}

	// Notes conversations additionally carry client-encrypted metadata
	// (pin/folder/tags): select the column only for the notes self-chat so
	// regular conversations keep the lean projection.
	selectColumns := `SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,
			m.parent_message_id, m.content, m.is_edited, m.is_deleted,
			m.edited_at, m.sent_at, m.client_id`
	if isNotes {
		selectColumns += `, m.notes_meta`
	}

	var rows *sql.Rows
	if sinceEventRaw != "" {
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1 AND m.event_id > $2
			ORDER BY m.event_id ASC
			LIMIT $3
		`, conversationID, sinceEventID, limit)
	} else if before != "" {
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1 AND m.sent_at < (
				SELECT sent_at FROM chat_messages WHERE id = $2
			)
			ORDER BY m.sent_at DESC
			LIMIT $3
		`, conversationID, before, limit)
	} else {
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1
			ORDER BY m.sent_at DESC
			LIMIT $2
		`, conversationID, limit)
	}

	if err != nil {
		httpx.ServerError(c, "get messages", err)
		return
	}
	defer rows.Close()

	messages := []MessageResponse{}
	for rows.Next() {
		var msg MessageResponse
		var parentID, editedAt, senderUsername sql.NullString
		var encryptedContent string
		var isDeleted bool

		var notesMeta sql.NullString
		dest := []interface{}{
			&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &senderUsername,
			&parentID, &encryptedContent, &msg.IsEdited, &isDeleted,
			&editedAt, &msg.SentAt, &msg.ClientID,
		}
		if isNotes {
			dest = append(dest, &notesMeta)
		}

		if err := rows.Scan(dest...); err != nil {
			httpx.ServerError(c, "scan message row", err)
			return
		}

		if senderUsername.Valid {
			msg.SenderUsername = senderUsername.String
		}

		if isNotes && notesMeta.Valid {
			// Client-encrypted pin/folder/tags blob — forward verbatim, the
			// device decrypts it locally.
			msg.NotesMeta = &notesMeta.String
		}

		msg.IsDeleted = isDeleted
		if isDeleted {
			msg.Content = ""
		} else if isNotes {
			// Client-side E2E blob: forward as-is, the device decrypts locally.
			msg.Content = encryptedContent
		} else {
			// Try per-conversation key first, fall back to master key (for legacy messages).
			// If decryption fails, replace the ciphertext with a placeholder — the
			// encrypted blob must never be returned to the client.
			decrypted, decErr := decryptContentForConversation(conversationID, encryptedContent)
			if decErr != nil {
				decrypted, decErr = decryptContent(encryptedContent)
			}
			if decErr == nil {
				msg.Content = decrypted
			} else {
				msg.Content = crypto.DecryptionFailedPlaceholder
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
		attMap, err := h.getAttachmentsByMessageIDs(c, ids)
		if err != nil {
			httpx.ServerError(c, "get attachments", err)
			return
		}
		for i := range messages {
			if atts, ok := attMap[messages[i].ID]; ok {
				messages[i].Attachments = atts
			}
		}
	}

	// Backward pages are returned by sent_at DESC and must be reversed. Delta
	// pages are already event_id ASC so they can be appended directly.
	if sinceEventRaw == "" {
		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
		}
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

	cleanContent := strings.TrimSpace(req.Content)
	if cleanContent == "" && len(req.Attachments) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Content or attachments required"))
		return
	}

	// The personal notes conversation carries client-side E2E ciphertext: the
	// server stores the opaque blob verbatim and never holds the key. Regular
	// conversations keep the server-side AES-GCM encryption.
	isNotes, err := h.isNotesConversation(c, conversationID)
	if err != nil {
		httpx.ServerError(c, "check notes conversation", err)
		return
	}

	var encryptedContent string
	if isNotes {
		// Client E2E payload: require the marker and enforce a generous cap
		// (base64 of up to ~4k runes of plaintext). Stored verbatim — the
		// server must never attempt to decrypt it.
		if cleanContent != "" {
			if !strings.HasPrefix(cleanContent, notesContentMarker) {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid encrypted note payload"))
				return
			}
			if len(cleanContent) > maxNotesContentLen {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("note payload too large"))
				return
			}
		}
		encryptedContent = cleanContent
	} else {
		// Regular server-encrypted message: validate plaintext before encryption.
		if len([]rune(cleanContent)) > 4000 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("content exceeds 4000 characters"))
			return
		}
		if hasHTML(cleanContent) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("HTML content is not allowed"))
			return
		}
		encryptedContent, err = encryptContentForConversation(conversationID, cleanContent)
		if err != nil {
			httpx.ServerError(c, "encrypt content", err)
			return
		}
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

	// Validate attachment ownership and object existence before inserting the
	// message. This prevents a failed attachment check from leaving a message
	// row behind in a middleware-owned transaction.
	if len(req.Attachments) > 0 {
		if err := h.validateAttachments(c, claims.UserID, req.Attachments); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
	}

	// Use the request-scoped transaction supplied by middleware. The fallback
	// transaction is only for direct handler tests/legacy callers.
	tx, ownsTx, err := h.txFor(c)
	if err != nil {
		httpx.ServerError(c, "begin transaction", err)
		return
	}
	defer func() {
		if ownsTx {
			_ = tx.Rollback()
		}
	}()

	// ON CONFLICT avoids aborting the transaction on an idempotent retry. That
	// matters when this handler is running inside the middleware transaction:
	// after a constraint error PostgreSQL would reject every subsequent query.
	var msg MessageResponse
	msg.EncryptedContent = encryptedContent
	var parentID, editedAt sql.NullString
	err = tx.QueryRow(`
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id, parent_message_id)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (conversation_id, client_id) DO NOTHING
		RETURNING event_id, id, conversation_id, sender_user_id, parent_message_id,
			content, is_edited, is_deleted, edited_at, sent_at, client_id
	`, conversationID, claims.UserID, encryptedContent, req.ClientID, req.ParentMessageID).Scan(
		&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
		&msg.Content, &msg.IsEdited, &msg.IsDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	)
	if err == sql.ErrNoRows {
		// Idempotent retry: read the already-persisted message in the same tx.
		err = tx.QueryRow(`
			SELECT event_id, id, conversation_id, sender_user_id, parent_message_id,
				content, is_edited, is_deleted, edited_at, sent_at, client_id
			FROM chat_messages
			WHERE conversation_id = $1 AND client_id = $2
		`, conversationID, req.ClientID).Scan(
			&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
			&msg.Content, &msg.IsEdited, &msg.IsDeleted,
			&editedAt, &msg.SentAt, &msg.ClientID,
		)
		if err == nil {
			if !isNotes {
				decryptMessageContent(conversationID, &msg)
			}
			if parentID.Valid {
				msg.ParentMessageID = &parentID.String
			}
			atts, _ := h.getAttachmentsByMessageIDs(c, []string{msg.ID})
			if a, ok := atts[msg.ID]; ok {
				msg.Attachments = a
			}
			c.JSON(http.StatusOK, models.SuccessResponse(msg))
			return
		}
	}
	if err != nil {
		httpx.ServerError(c, "insert message", err)
		return
	}

	// Persist only attachment references that were validated before the message
	// insert. A client cannot attach an arbitrary URL or another user's key.
	if len(req.Attachments) > 0 {
		if err := h.insertAttachments(tx, msg.ID, req.Attachments); err != nil {
			httpx.ServerError(c, "insert attachments", err)
			return
		}
	}

	// Return plaintext only after the server has persisted its ciphertext.
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

	// Update the preview in the same transaction as the message. This keeps
	// the request-scoped RLS binding intact and avoids using a closed tx from a
	// background goroutine.
	previewContent := cleanContent
	if !isNotes {
		previewContent = truncatePreview(cleanContent)
	}
	// For notes the preview must be the full client ciphertext — truncating it
	// would break local decryption (GCM authentication). The device decrypts
	// the preview locally.
	var encryptedPreview string
	if isNotes {
		encryptedPreview = previewContent
	} else {
		var encErr error
		encryptedPreview, encErr = encryptContentForConversation(conversationID, previewContent)
		if encErr != nil {
			httpx.ServerError(c, "encrypt preview", encErr)
			return
		}
	}
	if _, err := tx.Exec(`
		UPDATE chat_conversations
		SET last_message_preview = $1, last_message_sender_id = $2, updated_at = NOW()
		WHERE id = $3
	`, encryptedPreview, claims.UserID, conversationID); err != nil {
		httpx.ServerError(c, "update conversation preview", err)
		return
	}

	// Commit only a handler-owned transaction. Route middleware commits the
	// request-scoped transaction after the handler returns, so the preview and
	// message are committed atomically there.
	if ownsTx {
		if err := tx.Commit(); err != nil {
			httpx.ServerError(c, "commit transaction", err)
			return
		}
	}

	// These side effects must run only after the middleware-owned transaction
	// commits. Otherwise a client can fetch a message before PostgreSQL exposes it.
	queueAfterCommit(c, func() {
		if h.redis != nil {
			go invalidateMessengerCaches(h.redis, conversationID, claims.UserID)
		}
		if h.hub != nil {
			go h.broadcastNewMessage(conversationID, msg, claims, isNotes)
		}
		// Web Push (PWA): deliver to the other conversation members. Notes
		// (self-chat) have no other members, so nothing is sent — and the notes
		// payload is client-side E2E ciphertext we cannot (and must not) read.
		if !isNotes {
			body := messagePushBody(cleanContent, len(req.Attachments) > 0)
			go h.deliverMessagePush(context.Background(), conversationID, claims.UserID, claims.Username, body)
		}
	})

	c.JSON(http.StatusOK, models.SuccessResponse(msg))
}

// messagePushBody builds the short human-readable push body for a message:
// the plaintext when present, otherwise a placeholder for an attachment-only
// message. Truncated so a long message never floods the OS notification.
func messagePushBody(content string, hasAttachments bool) string {
	const max = 140
	trimmed := strings.TrimSpace(content)
	runes := []rune(trimmed)
	if len(runes) > max {
		trimmed = string(runes[:max]) + "…"
	}
	if trimmed == "" && hasAttachments {
		return "📎 Вложение"
	}
	if trimmed == "" {
		return "Новое сообщение"
	}
	return trimmed
}

// deliverMessagePush sends a Web Push to every conversation member except the
// sender and muted members. push.Service.SendToUser additionally honors the
// recipient's per-type push preferences (notifType "message"), so a user who
// turned off message pushes receives nothing here even though they still get
// the in-app unread badge. Best-effort: failures are logged, never propagated
// (the message is already committed and delivered over WebSocket).
func (h *MessengerHandler) deliverMessagePush(ctx context.Context, conversationID, senderID, senderUsername, body string) {
	if h.push == nil {
		return
	}

	// Other, non-muted members only. The sender gets nothing (they already see
	// the message); muted conversations stay quiet for the recipient.
	rows, err := h.db.QueryContext(ctx, `
		SELECT user_id FROM chat_members
		WHERE conversation_id = $1 AND user_id != $2 AND COALESCE(is_muted, false) = false
	`, conversationID, senderID)
	if err != nil {
		log.Printf("[Messenger] list push recipients %s: %v", conversationID, err)
		return
	}
	defer rows.Close()

	var recipients []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			log.Printf("[Messenger] scan push recipient: %v", err)
			return
		}
		recipients = append(recipients, uid)
	}
	if err := rows.Err(); err != nil {
		log.Printf("[Messenger] push recipients rows error: %v", err)
		return
	}

	for _, recipientID := range recipients {
		h.push.SendToUser(ctx, recipientID, "message", push.Notification{
			Title: "@" + senderUsername,
			Body:  body,
			URL:   "/messages",
			Icon:  "/pwa-192x192.png",
		})
	}
}

func (h *MessengerHandler) broadcastNewMessage(convID string, msg MessageResponse, claims *auth.Claims, isNotes bool) {
	// Broadcast encrypted content, not decrypted — Redis sees ciphertext only.
	// For the notes self-chat the "ciphertext" is the client-side E2E blob the
	// client sent; it is forwarded verbatim under the plain "content" key so
	// the hub passes it through unchanged and the owning device decrypts it
	// locally.
	payload := gin.H{
		"id":                msg.ID,
		"event_id":          msg.EventID,
		"conversation_id":   msg.ConversationID,
		"sender_user_id":    msg.SenderUserID,
		"parent_message_id": msg.ParentMessageID,
		"is_edited":         msg.IsEdited,
		"is_deleted":        msg.IsDeleted,
		"edited_at":         msg.EditedAt,
		"sent_at":           msg.SentAt,
		"client_id":         msg.ClientID,
		"sender_username":   claims.Username,
	}
	if isNotes {
		payload["content"] = msg.Content
	} else {
		payload["encrypted_content"] = msg.EncryptedContent
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

	if strings.TrimSpace(req.Content) == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("content cannot be empty"))
		return
	}

	// Notes messages carry client-encrypted ciphertext, stored verbatim.
	isNotes, err := h.isNotesConversation(c, conversationID)
	if err != nil {
		httpx.ServerError(c, "check notes conversation", err)
		return
	}

	var encryptedContent string
	if isNotes {
		if !strings.HasPrefix(req.Content, notesContentMarker) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid encrypted note payload"))
			return
		}
		if len(req.Content) > maxNotesContentLen {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("note payload too large"))
			return
		}
		encryptedContent = req.Content
	} else {
		cleanContent, sErr := sanitizeContent(req.Content)
		if sErr != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(sErr.Error()))
			return
		}
		req.Content = cleanContent // keep plaintext for the broadcast below
		encryptedContent, err = encryptContentForConversation(conversationID, cleanContent)
		if err != nil {
			httpx.ServerError(c, "encrypt edit content", err)
			return
		}
	}

	// Membership is checked explicitly before the update. The UPDATE repeats
	// membership-relevant message predicates, so a user cannot edit across a
	// conversation boundary even if a message ID is guessed.
	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check edit membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	result, err := h.dbFor(c).Exec(`
		UPDATE chat_messages
		SET content = $4, is_edited = true, edited_at = NOW()
		WHERE id = $1 AND conversation_id = $2 AND sender_user_id = $3 AND is_deleted = false
	`, messageID, conversationID, claims.UserID, encryptedContent)
	if err != nil {
		httpx.ServerError(c, "edit message", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or not editable"))
		return
	}

	queueAfterCommit(c, func() {
		if h.hub != nil {
			go h.broadcastMessageEdited(messageID, req.Content, conversationID, isNotes)
		}
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *MessengerHandler) broadcastMessageEdited(msgID, newContent, conversationID string, isNotes bool) {
	var payload map[string]interface{}
	if isNotes {
		// Forward the client ciphertext verbatim — the hub passes payloads
		// without "encrypted_content" through unchanged, and the device
		// decrypts locally.
		payload = map[string]interface{}{
			"id":              msgID,
			"content":         newContent,
			"conversation_id": conversationID,
			"edited_at":       time.Now().UTC().Format(time.RFC3339),
			"event":           "message_edited",
		}
	} else {
		// Encrypt content before Redis broadcast. If encryption fails, drop the
		// event instead of publishing plaintext as if it were ciphertext — the
		// recipient decrypt path would otherwise replace it with a placeholder
		// anyway, and plaintext must never travel over Redis.
		encrypted, err := encryptContentForConversation(conversationID, newContent)
		if err != nil {
			log.Printf("[Messenger] encrypt edit broadcast: %v — skipping broadcast", err)
			return
		}
		payload = map[string]interface{}{
			"id":                msgID,
			"encrypted_content": encrypted,
			"conversation_id":   conversationID,
			"edited_at":         time.Now().UTC().Format(time.RFC3339),
			"event":             "message_edited",
		}
	}
	if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
		Type:    "message_edited",
		Payload: payload,
	}); err != nil {
		log.Printf("[Messenger] WS edit broadcast error: %v", err)
	}
}

// ─── Update Notes Meta ───────────────────────────────────────────────────────
// PUT /api/v1/messenger/conversations/:convId/messages/:msgId/notes-meta

// UpdateNotesMeta godoc
// @Summary      Update notes message metadata (pin/folder/tags)
// @Description  Stores the client-encrypted metadata blob for a note verbatim.
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        msgId path string true "Message ID"
// @Param        request body UpdateNotesMetaRequest true "Encrypted metadata blob"
// @Success      200 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages/{msgId}/notes-meta [put]
// @Security     BearerAuth
func (h *MessengerHandler) UpdateNotesMeta(c *gin.Context) {
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

	var req UpdateNotesMetaRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	req.Meta = strings.TrimSpace(req.Meta)
	if req.Meta == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("meta is required"))
		return
	}

	// Notes metadata exists only in the personal notes self-chat.
	isNotes, err := h.isNotesConversation(c, conversationID)
	if err != nil {
		httpx.ServerError(c, "check notes conversation", err)
		return
	}
	if !isNotes {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Notes metadata is only available in the notes chat"))
		return
	}

	// Client E2E payload: require the marker and enforce a cap. The blob is
	// stored verbatim — the server must never attempt to decrypt it.
	if !strings.HasPrefix(req.Meta, notesContentMarker) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid encrypted notes metadata"))
		return
	}
	if len(req.Meta) > maxNotesMetaLen {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("notes metadata too large"))
		return
	}

	// Only the author of the note can update its metadata; the UPDATE repeats
	// the message predicates so a guessed message id cannot escape the chat.
	result, err := h.dbFor(c).Exec(`
		UPDATE chat_messages
		SET notes_meta = $1
		WHERE id = $2 AND conversation_id = $3 AND sender_user_id = $4 AND is_deleted = false
	`, req.Meta, messageID, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "update notes meta", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or not editable"))
		return
	}

	queueAfterCommit(c, func() {
		if h.hub != nil {
			go h.broadcastMessageNotesMeta(messageID, conversationID, req.Meta)
		}
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *MessengerHandler) broadcastMessageNotesMeta(msgID, conversationID, meta string) {
	// Forward the client ciphertext verbatim — the hub passes payloads without
	// "encrypted_content" through unchanged, and other devices of the owner
	// decrypt it locally.
	payload := map[string]interface{}{
		"id":              msgID,
		"conversation_id": conversationID,
		"notes_meta":      meta,
		"event":           "message_notes_meta",
	}
	if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
		Type:    "message_notes_meta",
		Payload: payload,
	}); err != nil {
		log.Printf("[Messenger] WS notes meta broadcast error: %v", err)
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
	result, err := h.dbFor(c).Exec(`
		UPDATE chat_messages
		SET is_deleted = true
		WHERE id = $1
		  AND sender_user_id = $2
		  AND is_deleted = false
		  AND conversation_id = $3
		  AND EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $3 AND user_id = $2)
	`, messageID, claims.UserID, conversationID)
	if err != nil {
		httpx.ServerError(c, "delete message", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or already deleted"))
		return
	}

	queueAfterCommit(c, func() {
		if h.hub == nil {
			return
		}
		go func() {
			if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type: "message_deleted",
				Payload: map[string]interface{}{
					"id":              messageID,
					"conversation_id": conversationID,
					"event":           "message_deleted",
				},
			}); err != nil {
				log.Printf("[Messenger] WS delete broadcast error: %v", err)
			}
		}()
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"deleted": true}))
}

// getAttachmentsByMessageIDs fetches attachments for multiple messages in one query
func (h *MessengerHandler) getAttachmentsByMessageIDs(c *gin.Context, messageIDs []string) (map[string][]Attachment, error) {
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

	rows, err := h.dbFor(c).Query(query, args...)
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

func (h *MessengerHandler) validateAttachments(c *gin.Context, userID string, attachments []AttachmentInput) error {
	if len(attachments) > 10 {
		return fmt.Errorf("too many attachments")
	}
	if h.storage == nil {
		return fmt.Errorf("attachment storage unavailable")
	}
	for _, att := range attachments {
		if att.Size <= 0 || att.Size > 10*1024*1024 {
			return fmt.Errorf("invalid attachment size")
		}
		if att.Type == "image" {
			// New image messages must reference the derivative generated by the
			// upload endpoint. Existing rows are read-only legacy data and are
			// handled by the frontend without revalidating them here.
			if att.Meta == nil || strings.TrimSpace(*att.Meta) == "" {
				return fmt.Errorf("image preview metadata is required")
			}
			if len(*att.Meta) > 128*1024 {
				return fmt.Errorf("image metadata is too large")
			}
			var meta struct {
				PreviewKey string `json:"preview_key"`
				LQIP       string `json:"lqip"`
				ThumbHash  string `json:"thumb_hash"`
				Width      int    `json:"width"`
				Height     int    `json:"height"`
			}
			if err := json.Unmarshal([]byte(*att.Meta), &meta); err != nil {
				return fmt.Errorf("invalid image metadata")
			}
			if meta.PreviewKey != att.URL+".preview.jpg" {
				return fmt.Errorf("invalid image preview key")
			}
			// New uploads carry a ThumbHash placeholder (~30 bytes of base64);
			// clients on an older web build still send an inline LQIP data URL.
			// Accept either — never both-empty, never oversized/garbage.
			if meta.ThumbHash != "" {
				if len(meta.ThumbHash) > 128 {
					return fmt.Errorf("invalid image placeholder")
				}
				if _, err := base64.StdEncoding.DecodeString(meta.ThumbHash); err != nil {
					return fmt.Errorf("invalid image placeholder")
				}
			} else if !strings.HasPrefix(meta.LQIP, "data:image/jpeg;base64,") || len(meta.LQIP) > 16*1024 {
				return fmt.Errorf("invalid image placeholder")
			}
			if meta.Width <= 0 || meta.Height <= 0 || meta.Width > 12000 || meta.Height > 12000 {
				return fmt.Errorf("invalid image dimensions")
			}
			previewExists, err := h.storage.ObjectExists(c.Request.Context(), "uploads", meta.PreviewKey)
			if err != nil {
				return fmt.Errorf("image preview validation failed")
			}
			if !previewExists {
				return fmt.Errorf("image preview not found")
			}
		}
		if att.URL == "" || strings.Contains(att.URL, "://") ||
			!strings.HasPrefix(att.URL, userID+"/messenger/") {
			return fmt.Errorf("attachment is not owned by the sender")
		}
		if err := storage.ValidateObjectKey(att.URL); err != nil {
			return fmt.Errorf("invalid attachment URL")
		}
		exists, err := h.storage.ObjectExists(c.Request.Context(), "uploads", att.URL)
		if err != nil {
			return fmt.Errorf("attachment validation failed")
		}
		if !exists {
			return fmt.Errorf("attachment not found")
		}
	}
	return nil
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
