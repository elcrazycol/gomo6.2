package messenger

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
	"github.com/gomo6/backend/internal/logsafe"

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

	// Membership + conversation kind + encryption mode in one round trip.
	access := h.requireMember(c, conversationID, claims.UserID)
	if access == nil {
		return
	}

	limit, before, sinceEventRaw, sinceEventID, ok := parseMessageCursor(c)
	if !ok {
		return
	}

	messages, ok := h.fetchMessagePage(c, conversationID, access.IsNotes, access.IsE2E(), limit, before, sinceEventID, sinceEventRaw != "")
	if !ok {
		return
	}

	if messages == nil {
		messages = []MessageResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(messages))
}

// parseMessageCursor reads the pagination and reconnect-delta cursor of a
// GetMessages request. The two cursor modes are deliberately mutually
// exclusive so a reconnect cannot silently turn into an unrelated backwards
// page. On invalid input it writes a 400 and returns ok=false.
func parseMessageCursor(c *gin.Context) (limit int, before string, sinceEventRaw string, sinceEventID int64, ok bool) {
	limit = 50
	before = c.Query("before")
	sinceEventRaw = c.Query("since_event_id")
	if before != "" && sinceEventRaw != "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("before and since_event_id cannot be combined"))
		return 0, "", "", 0, false
	}
	if sinceEventRaw != "" {
		var parseErr error
		sinceEventID, parseErr = strconv.ParseInt(sinceEventRaw, 10, 64)
		if parseErr != nil || sinceEventID < 0 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid since_event_id"))
			return 0, "", "", 0, false
		}
	}
	if l := c.Query("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	return limit, before, sinceEventRaw, sinceEventID, true
}

// buildMessageSelectColumns returns the lean message projection of GetMessages.
// Notes conversations additionally carry client-encrypted metadata
// (pin/folder/tags): the column is selected only for the notes self-chat so
// regular conversations keep the lean projection. The E2E envelope version
// travels on every row (cheap ints) so clients can tell opaque blobs apart.
func buildMessageSelectColumns(isNotes bool) string {
	selectColumns := `SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,
			m.parent_message_id, m.content, m.type, m.payload, m.enc_v, m.enc_alg, m.is_edited, m.is_deleted,
			m.edited_at, m.sent_at, m.client_id`
	if isNotes {
		selectColumns += `, m.notes_meta`
	}
	return selectColumns
}

// fetchMessagePage runs the cursor-mode query, decodes every row (server-side
// decryption for regular conversations, verbatim forwarding for opaque ones)
// and attaches the batch-fetched attachments. Delta pages are returned in
// event_id ASC order so they can be appended directly; backward pages return
// in chronological order (sent_at DESC was reversed).
func (h *MessengerHandler) fetchMessagePage(c *gin.Context, conversationID string, isNotes, isE2E bool, limit int, before string, sinceEventID int64, delta bool) ([]MessageResponse, bool) {
	selectColumns := buildMessageSelectColumns(isNotes)

	var rows *sql.Rows
	var err error
	switch {
	case delta:
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1 AND m.event_id > $2
			ORDER BY m.event_id ASC
			LIMIT $3
		`, conversationID, sinceEventID, limit)
	case before != "":
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1 AND m.sent_at < (
				SELECT sent_at FROM chat_messages WHERE id = $2
			)
			ORDER BY m.sent_at DESC, m.event_id DESC
			LIMIT $3
		`, conversationID, before, limit)
	default:
		rows, err = h.dbFor(c).Query(`
			`+selectColumns+`
			FROM chat_messages m
			LEFT JOIN users u ON u.id = m.sender_user_id
			WHERE m.conversation_id = $1
			ORDER BY m.sent_at DESC, m.event_id DESC
			LIMIT $2
		`, conversationID, limit)
	}
	if err != nil {
		httpx.ServerError(c, "get messages", err)
		return nil, false
	}
	defer rows.Close()

	messages := []MessageResponse{}
	for rows.Next() {
		msg, scanErr := scanMessageRow(rows, conversationID, isNotes, isE2E)
		if scanErr != nil {
			httpx.ServerError(c, "scan message row", scanErr)
			return nil, false
		}
		messages = append(messages, *msg)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate messages", err)
		return nil, false
	}

	// Attachments, reaction chips and voice-listened marks arrive in ONE query:
	// a page costs three round trips in total (access, page, extras) instead of
	// the previous seven.
	if len(messages) > 0 {
		ids := make([]string, len(messages))
		for i := range messages {
			ids[i] = messages[i].ID
		}
		viewerID := ""
		if claims := getClaims(c); claims != nil {
			viewerID = claims.UserID
		}
		attachments, reactions, voice, extrasErr := h.fetchMessageExtras(c, ids, viewerID)
		if extrasErr != nil {
			httpx.ServerError(c, "get message extras", extrasErr)
			return nil, false
		}
		for i := range messages {
			if atts, ok := attachments[messages[i].ID]; ok {
				messages[i].Attachments = atts
			}
			if chips, ok := reactions[messages[i].ID]; ok {
				messages[i].Reactions = chips
			}
			if listeners, ok := voice[messages[i].ID]; ok {
				messages[i].VoiceListenedBy = listeners
			}
			normalizeMessageEnvelope(&messages[i])
		}
	}

	// Backward pages are returned by sent_at DESC and must be reversed. Delta
	// pages are already event_id ASC so they can be appended directly.
	if !delta {
		for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
			messages[i], messages[j] = messages[j], messages[i]
		}
	}

	return messages, true
}

// scanMessageRow decodes a single chat_messages row. Regular conversations
// are decrypted server-side (per-conversation key first, then master key for
// legacy messages); a failed decryption is replaced with a placeholder — the
// encrypted blob must never be returned to the client. Opaque rows (notes and
// e2e conversations) are forwarded verbatim, the device decrypts them locally.
func scanMessageRow(rows *sql.Rows, conversationID string, isNotes, isE2E bool) (*MessageResponse, error) {
	var msg MessageResponse
	var parentID, editedAt, senderUsername sql.NullString
	var encryptedContent, msgType, encAlg sql.NullString
	var payload []byte
	var encV sql.NullInt64
	var isDeleted bool

	var notesMeta sql.NullString
	dest := []interface{}{
		&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &senderUsername,
		&parentID, &encryptedContent, &msgType, &payload, &encV, &encAlg, &msg.IsEdited, &isDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	}
	if isNotes {
		dest = append(dest, &notesMeta)
	}

	if err := rows.Scan(dest...); err != nil {
		return nil, err
	}

	if senderUsername.Valid {
		msg.SenderUsername = senderUsername.String
	}
	if msgType.Valid && msgType.String != "" {
		msg.Type = msgType.String
	}
	if len(payload) > 0 {
		msg.Payload = append(json.RawMessage(nil), payload...)
	}
	if encV.Valid && encV.Int64 > 0 {
		enc := &MessageEnc{V: int(encV.Int64)}
		if encAlg.Valid && encAlg.String != "" {
			enc.Alg = encAlg.String
		}
		msg.Enc = enc
	}

	if isNotes && notesMeta.Valid {
		// Client-encrypted pin/folder/tags blob — forward verbatim, the
		// device decrypts it locally.
		msg.NotesMeta = &notesMeta.String
	}

	opaque := isNotes || isE2E
	msg.IsDeleted = isDeleted
	if isDeleted {
		msg.Content = ""
	} else if opaque {
		// Opaque client blob: forward as-is, the device decrypts locally.
		msg.Content = encryptedContent.String
		// `enc` (from enc_v/enc_alg) is set only for real E2E envelopes. Notes
		// are identified by the conversation's is_notes flag, so they need no
		// extra envelope hint.
	} else {
		// Try per-conversation key first, fall back to master key (for legacy
		// messages). If decryption fails, replace the ciphertext with a
		// placeholder — the encrypted blob must never be returned to the client.
		decrypted, decErr := decryptContentForConversation(conversationID, encryptedContent.String)
		if decErr != nil {
			decrypted, decErr = decryptContent(encryptedContent.String)
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

	return &msg, nil
} // ─── Send Message ───────────────────────────────────────────────────────────
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
	if cleanContent == "" && len(req.Attachments) == 0 && len(req.Payload) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Content or attachments required"))
		return
	}
	// If a client sends typed share payload without raw content, synthesize the
	// canonical __SHARE__ token so older clients and preview logic see it.
	if cleanContent == "" && req.Type == "share" && len(req.Payload) > 0 {
		var sharePayload struct {
			TargetType string `json:"target_type"`
			TargetID   string `json:"target_id"`
		}
		if json.Unmarshal(req.Payload, &sharePayload) == nil &&
			(sharePayload.TargetType == "thread" || sharePayload.TargetType == "wall") &&
			sharePayload.TargetID != "" {
			cleanContent = fmt.Sprintf("__SHARE__:%s:%s", sharePayload.TargetType, sharePayload.TargetID)
		}
	}
	if cleanContent == "" && len(req.Attachments) == 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Content or attachments required"))
		return
	}

	// Service threads are read-only; the conversation kind, encryption mode and
	// membership all come from one access query. Membership is answered first so
	// a non-member learns nothing about the conversation's kind.
	access, ok := h.loadAccess(c, conversationID, claims.UserID)
	if !ok || access == nil {
		return
	}
	if !access.IsMember {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}
	if access.IsService {
		c.JSON(http.StatusForbidden, models.ErrorResponse("This is a notification thread and does not accept messages"))
		return
	}

	// 1:1 policy: blocks (either direction) and a friends-only inbox are
	// enforced on every send, not only when the chat is created.
	if !h.enforceDirectWritePolicy(c, access, claims.UserID) {
		return
	}

	// Opaque conversations (notes / e2e) carry client ciphertext: the server
	// stores the blob verbatim and never holds the key.
	isNotes, isE2E := access.IsNotes, access.IsE2E()
	opaque := access.IsOpaque()

	encryptedContent, encV, encAlg, prepared := prepareOutgoingContent(c, conversationID, isNotes, isE2E, cleanContent, len(req.Attachments) > 0)
	if !prepared {
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
	msg, err := insertChatMessageRow(tx, conversationID, claims.UserID, req, encryptedContent, encV, encAlg)
	if err == sql.ErrNoRows {
		// Idempotent retry: read the already-persisted message in the same tx.
		msg, err = h.loadMessageForRetry(c, tx, conversationID, req.ClientID, opaque)
		if err == nil {
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
	// For opaque conversations the "plaintext" IS the client ciphertext.
	msg.Content = cleanContent
	msg.Type = req.Type
	if len(req.Payload) > 0 {
		msg.Payload = req.Payload
	}
	if encV > 0 {
		msg.Enc = &MessageEnc{V: encV, Alg: encAlg}
	}
	if len(req.Attachments) > 0 {
		msg.Attachments = buildAttachmentResponse(req.Attachments)
	}
	normalizeMessageEnvelope(&msg)

	// A message that is only a voice note has blank content: preview it
	// as the voice message it is instead of leaving the chat list empty.
	previewBody := cleanContent
	if strings.TrimSpace(previewBody) == "" {
		if label := voicePreviewLabel(req.Attachments); label != "" {
			previewBody = label
		}
	}
	if !updateConversationPreview(c, tx, conversationID, opaque, previewBody, claims.UserID) {
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
	// commits. Otherwise a client can fetch a message before PostgreSQL exposes
	// it.
	queueAfterCommit(c, func() {
		scheduleMessageSideEffects(h, conversationID, claims, msg, opaque, cleanContent, len(req.Attachments) > 0, isE2E)
	})

	c.JSON(http.StatusOK, models.SuccessResponse(msg))
}

// prepareOutgoingContent validates and encrypts the outgoing message content.
// Notes conversations require the client-E2E marker and enforce a generous cap
// (base64 of up to ~4k runes of plaintext); the blob is stored verbatim — the
// server must never attempt to decrypt it. E2E 1:1 conversations require the
// `e2e1:<alg>:...` envelope with the same verbatim rule (an attachment-only
// message has no envelope, exactly like a regular attachment-only message).
// Regular conversations validate the plaintext before server-side encryption.
// On any rejection it writes the error response and returns ok=false.
func prepareOutgoingContent(c *gin.Context, conversationID string, isNotes, isE2E bool, cleanContent string, hasAttachments bool) (encrypted string, encV int, encAlg string, ok bool) {
	if isNotes {
		// Client E2E payload: require the marker and enforce a generous cap
		// (base64 of up to ~4k runes of plaintext). Stored verbatim — the
		// server must never attempt to decrypt it.
		if cleanContent != "" {
			if !strings.HasPrefix(cleanContent, notesContentMarker) {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid encrypted note payload"))
				return "", 0, "", false
			}
			if len(cleanContent) > maxNotesContentLen {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("note payload too large"))
				return "", 0, "", false
			}
		}
		return cleanContent, 0, "", true
	}
	if isE2E {
		// Opaque 1:1 E2E payload: require the versioned envelope, enforce the
		// cap, and record the envelope version for clients. Stored verbatim —
		// the server must never attempt to decrypt it. An attachment-only
		// message (no caption) is allowed and carries no envelope.
		if cleanContent == "" {
			if !hasAttachments {
				c.JSON(http.StatusBadRequest, models.ErrorResponse("Content required"))
				return "", 0, "", false
			}
			return "", 0, "", true
		}
		if err := validateE2EPayload(cleanContent); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return "", 0, "", false
		}
		alg, _, _ := parseE2EEnvelope(cleanContent)
		return cleanContent, e2eEnvelopeVersion, alg, true
	}

	// Regular server-encrypted message: validate plaintext before encryption.
	if len([]rune(cleanContent)) > 4000 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("content exceeds 4000 characters"))
		return "", 0, "", false
	}
	if hasHTML(cleanContent) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("HTML content is not allowed"))
		return "", 0, "", false
	}
	encryptedContent, err := EncryptContentForConversation(conversationID, cleanContent)
	if err != nil {
		httpx.ServerError(c, "encrypt content", err)
		return "", 0, "", false
	}
	return encryptedContent, 0, "", true
}

// insertChatMessageRow persists a message with ON CONFLICT DO NOTHING so an
// idempotent retry cannot abort the middleware-owned transaction. ErrNoRows
// from the RETURNING clause signals that the row already existed — the caller
// must read it back instead.
func insertChatMessageRow(tx *sql.Tx, conversationID, userID string, req SendMessageRequest, encryptedContent string, encV int, encAlg string) (MessageResponse, error) {
	var msg MessageResponse
	msg.EncryptedContent = encryptedContent
	var parentID, editedAt sql.NullString
	msgType := req.Type
	if msgType == "" {
		msgType = "text"
	}
	var payloadParam interface{}
	if len(req.Payload) > 0 && string(req.Payload) != "null" {
		payloadParam = string(req.Payload)
	}
	var encAlgParam interface{}
	if encAlg != "" {
		encAlgParam = encAlg
	}
	var encVScan sql.NullInt64
	var encAlgScan sql.NullString
	var payloadScan []byte
	err := tx.QueryRow(`
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id, parent_message_id, type, payload, enc_v, enc_alg)
		VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
		ON CONFLICT (conversation_id, client_id) DO NOTHING
		RETURNING event_id, id, conversation_id, sender_user_id, parent_message_id,
			content, type, payload, enc_v, enc_alg, is_edited, is_deleted, edited_at, sent_at, client_id
	`, conversationID, userID, encryptedContent, req.ClientID, req.ParentMessageID, msgType, payloadParam, encV, encAlgParam).Scan(
		&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
		&msg.Content, &msg.Type, &payloadScan, &encVScan, &encAlgScan, &msg.IsEdited, &msg.IsDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	)
	if err != nil {
		return msg, err
	}
	if len(payloadScan) > 0 {
		msg.Payload = append(json.RawMessage(nil), payloadScan...)
	}
	setMessageEnc(&msg, encVScan, encAlgScan)
	if parentID.Valid {
		msg.ParentMessageID = &parentID.String
	}
	if editedAt.Valid {
		s := editedAt.String
		msg.EditedAt = &s
	}
	return msg, nil
}

// loadMessageForRetry reloads the message an idempotent replay hit
// (ON CONFLICT DO NOTHING) and — for regular conversations — resolves its
// plaintext so the client sees decryptable content instead of raw ciphertext.
func (h *MessengerHandler) loadMessageForRetry(c *gin.Context, tx *sql.Tx, conversationID, clientID string, opaque bool) (MessageResponse, error) {
	var msg MessageResponse
	var parentID, editedAt sql.NullString
	var encVScan sql.NullInt64
	var encAlgScan sql.NullString
	var payloadScan []byte
	err := tx.QueryRow(`
		SELECT event_id, id, conversation_id, sender_user_id, parent_message_id,
			content, type, payload, enc_v, enc_alg, is_edited, is_deleted, edited_at, sent_at, client_id
		FROM chat_messages
		WHERE conversation_id = $1 AND client_id = $2
	`, conversationID, clientID).Scan(
		&msg.EventID, &msg.ID, &msg.ConversationID, &msg.SenderUserID, &parentID,
		&msg.Content, &msg.Type, &payloadScan, &encVScan, &encAlgScan, &msg.IsEdited, &msg.IsDeleted,
		&editedAt, &msg.SentAt, &msg.ClientID,
	)
	if err != nil {
		return msg, err
	}
	if len(payloadScan) > 0 {
		msg.Payload = append(json.RawMessage(nil), payloadScan...)
	}
	setMessageEnc(&msg, encVScan, encAlgScan)
	if !opaque {
		decryptMessageContent(conversationID, &msg)
	}
	if parentID.Valid {
		msg.ParentMessageID = &parentID.String
	}
	if editedAt.Valid {
		s := editedAt.String
		msg.EditedAt = &s
	}
	atts, _ := h.getAttachmentsByMessageIDs(c, []string{msg.ID})
	if a, ok := atts[msg.ID]; ok {
		msg.Attachments = a
	}
	return msg, nil
}

// buildAttachmentResponse mirrors the validated attachment inputs into the
// response shape, keeping the client-supplied sort order.
func buildAttachmentResponse(attachments []AttachmentInput) []Attachment {
	out := make([]Attachment, len(attachments))
	for i, att := range attachments {
		out[i] = Attachment{
			Type:      att.Type,
			URL:       att.URL,
			Name:      att.Name,
			Size:      att.Size,
			Mime:      att.Mime,
			Meta:      att.Meta,
			SortOrder: i,
		}
	}
	return out
}

// updateConversationPreview refreshes the conversation's last-message preview
// in the same transaction as the message. This keeps the request-scoped RLS
// binding intact and avoids using a closed tx from a background goroutine.
// For opaque conversations (notes / e2e) the preview must be the full client
// ciphertext — truncating it would break local decryption (GCM
// authentication); the device decrypts the preview locally.
func updateConversationPreview(c *gin.Context, tx *sql.Tx, conversationID string, opaque bool, cleanContent, userID string) bool {
	previewContent := cleanContent
	if !opaque {
		previewContent = truncatePreview(cleanContent)
	}
	var encryptedPreview string
	if opaque {
		encryptedPreview = previewContent
	} else {
		var encErr error
		encryptedPreview, encErr = EncryptContentForConversation(conversationID, previewContent)
		if encErr != nil {
			httpx.ServerError(c, "encrypt preview", encErr)
			return false
		}
	}
	if _, err := tx.Exec(`
		UPDATE chat_conversations
		SET last_message_preview = $1, last_message_sender_id = $2, updated_at = NOW()
		WHERE id = $3
	`, encryptedPreview, userID, conversationID); err != nil {
		httpx.ServerError(c, "update conversation preview", err)
		return false
	}
	return true
}

// scheduleMessageSideEffects registers the post-commit side effects of a sent
// message: the realtime broadcast and — outside opaque conversations — the Web
// Push (PWA) delivery. Notes (self-chat) have no other members, so nothing is
// sent. E2E conversations get a generic push body: the server cannot read the
// opaque ciphertext and must never put it into a notification.
//
// There is deliberately NO data-cache invalidation here: the shared
// DataCacheMiddleware skips every /messenger path (real-time contract), so the
// old Redis SCAN on each message only walked the whole keyspace to delete
// nothing.
func scheduleMessageSideEffects(h *MessengerHandler, conversationID string, claims *auth.Claims, msg MessageResponse, opaque bool, cleanContent string, hasAttachments bool, isE2E bool) {
	if h.hub != nil {
		publishPool.Go(func() { h.broadcastNewMessage(conversationID, msg, claims, opaque) })
	}
	if opaque && !isE2E {
		return
	}
	body := messagePushBody(cleanContent, hasAttachments)
	if isE2E {
		// Never leak opaque ciphertext into a push notification.
		body = messagePushBody("", hasAttachments)
	}
	publishPool.Go(func() {
		h.deliverMessagePush(context.Background(), conversationID, claims.UserID, claims.Username, body)
	})
} // messagePushBody builds the short human-readable push body for a message:
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
		logsafe.Printf("[Messenger] list push recipients %s: %v", conversationID, err)
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

func (h *MessengerHandler) broadcastNewMessage(convID string, msg MessageResponse, claims *auth.Claims, opaque bool) {
	// Broadcast encrypted content, not decrypted — Redis sees ciphertext only.
	// For opaque conversations the "ciphertext" is the client-side E2E blob the
	// client sent; it is forwarded verbatim under the plain "content" key so
	// the hub passes it through unchanged and the owning device decrypts it
	// locally.
	payload := gin.H{
		"id":                msg.ID,
		"event_id":          msg.EventID,
		"conversation_id":   msg.ConversationID,
		"sender_user_id":    msg.SenderUserID,
		"parent_message_id": msg.ParentMessageID,
		"type":              msg.Type,
		"is_edited":         msg.IsEdited,
		"is_deleted":        msg.IsDeleted,
		"edited_at":         msg.EditedAt,
		"sent_at":           msg.SentAt,
		"client_id":         msg.ClientID,
		"sender_username":   claims.Username,
	}
	if len(msg.Payload) > 0 {
		payload["payload"] = msg.Payload
	}
	if msg.Enc != nil {
		payload["enc"] = gin.H{"v": msg.Enc.V, "alg": msg.Enc.Alg}
	}
	if opaque {
		payload["content"] = msg.Content
	} else {
		payload["encrypted_content"] = msg.EncryptedContent
	}
	if len(msg.Attachments) > 0 {
		payload["attachments"] = msg.Attachments
	}
	if memberIDs := h.listConversationMemberIDs(convID); len(memberIDs) > 0 {
		payload["recipient_ids"] = memberIDs
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

	// Membership, conversation kind and encryption mode in one round trip.
	access := h.requireMember(c, conversationID, claims.UserID)
	if access == nil {
		return
	}
	if !h.enforceDirectWritePolicy(c, access, claims.UserID) {
		return
	}
	if access.IsService {
		c.JSON(http.StatusForbidden, models.ErrorResponse("This is a notification thread and is read-only"))
		return
	}
	isNotes, isE2E := access.IsNotes, access.IsE2E()

	var encryptedContent string
	var encV int
	var encAlg string
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
	} else if isE2E {
		if err := validateE2EPayload(req.Content); err != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(err.Error()))
			return
		}
		alg, _, _ := parseE2EEnvelope(req.Content)
		encAlg = alg
		encryptedContent = req.Content
		encV = e2eEnvelopeVersion
	} else {
		cleanContent, sErr := sanitizeContent(req.Content)
		if sErr != nil {
			c.JSON(http.StatusBadRequest, models.ErrorResponse(sErr.Error()))
			return
		}
		req.Content = cleanContent // keep plaintext for the broadcast below
		encryptedContent, sErr = EncryptContentForConversation(conversationID, cleanContent)
		if sErr != nil {
			httpx.ServerError(c, "encrypt edit content", sErr)
			return
		}
	}

	// The UPDATE repeats membership-relevant message predicates, so a user
	// cannot edit across a conversation boundary even if a message ID is
	// guessed. membership itself was already answered by loadAccess.
	result, err := h.dbFor(c).Exec(`
		UPDATE chat_messages
		SET content = $4, enc_v = $5, enc_alg = $6, is_edited = true, edited_at = NOW(), event_id = nextval('chat_messages_event_id_seq')
		WHERE id = $1 AND conversation_id = $2 AND sender_user_id = $3 AND is_deleted = false
	`, messageID, conversationID, claims.UserID, encryptedContent, encV, nullString(encAlg))
	if err != nil {
		httpx.ServerError(c, "edit message", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or not editable"))
		return
	}

	// Editing the conversation's newest message changes what the chat list
	// shows. Every other edit leaves the preview alone (one indexed lookup).
	if isNewest, checkErr := h.isNewestMessage(c, conversationID, messageID); checkErr == nil && isNewest {
		if refreshErr := h.refreshConversationPreview(c, conversationID, access.IsOpaque()); refreshErr != nil {
			httpx.ServerError(c, "refresh conversation preview", refreshErr)
			return
		}
	}

	queueAfterCommit(c, func() {
		if h.hub != nil {
			publishPool.Go(func() {
				h.broadcastMessageEdited(messageID, req.Content, conversationID, isNotes, isE2E, encV, encAlg)
			})
		}
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func nullString(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func (h *MessengerHandler) broadcastMessageEdited(msgID, newContent, conversationID string, isNotes, isE2E bool, encV int, encAlg string) {
	var payload map[string]interface{}
	if isNotes || isE2E {
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
		if encV > 0 {
			payload["enc"] = map[string]interface{}{"v": encV, "alg": encAlg}
		}
	} else {
		// Encrypt content before Redis broadcast. If encryption fails, drop the
		// event instead of publishing plaintext as if it were ciphertext — the
		// recipient decrypt path would otherwise replace it with a placeholder
		// anyway, and plaintext must never travel over Redis.
		encrypted, err := EncryptContentForConversation(conversationID, newContent)
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
	if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
		payload["recipient_ids"] = memberIDs
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
	access := h.requireMember(c, conversationID, claims.UserID)
	if access == nil {
		return
	}
	if !access.IsNotes {
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
			publishPool.Go(func() { h.broadcastMessageNotesMeta(messageID, conversationID, req.Meta) })
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
	if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
		payload["recipient_ids"] = memberIDs
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

	// The caller must be a member; the message must be theirs and alive. One
	// access query answers membership + conversation kind/encryption mode.
	access := h.requireMember(c, conversationID, claims.UserID)
	if access == nil {
		return
	}

	var canDelete bool
	if err := h.dbFor(c).QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM chat_messages
			WHERE id = $1 AND conversation_id = $2 AND sender_user_id = $3 AND is_deleted = false
		)
	`, messageID, conversationID, claims.UserID).Scan(&canDelete); err != nil {
		httpx.ServerError(c, "check message ownership", err)
		return
	}
	if !canDelete {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found or already deleted"))
		return
	}

	// Collect the storage keys BEFORE the rows disappear: after the transaction
	// there is nothing left to tell us which S3 objects to remove.
	attachments, err := h.loadAttachmentKeys(c, messageID)
	if err != nil {
		httpx.ServerError(c, "load attachment keys", err)
		return
	}
	storageKeys := attachmentStorageKeys(attachments)

	// Soft-delete + wipe every recoverable payload. The opaque ciphertext, the
	// structured payload and the notes metadata all go; the row keeps only its
	// identity so clients can render "message deleted".
	result, err := h.dbFor(c).Exec(`
		UPDATE chat_messages
		SET is_deleted = true,
		    content = '',
		    notes_meta = NULL,
		    enc_v = 0,
		    enc_alg = NULL,
		    payload = NULL,
		    event_id = nextval('chat_messages_event_id_seq')
		WHERE id = $1
		  AND sender_user_id = $2
		  AND is_deleted = false
		  AND conversation_id = $3
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

	// Cascade the message's satellites (attachments/reactions/voice/receipts)
	// and drop the pin if it pointed here.
	if err := h.deleteMessageArtifacts(c, conversationID, messageID); err != nil {
		httpx.ServerError(c, "delete message artifacts", err)
		return
	}

	// The insert trigger only increments unread counters: without a recompute a
	// deleted message would keep counting in the peer's badge.
	if err := h.recomputeUnreadForOthers(c, conversationID, claims.UserID); err != nil {
		httpx.ServerError(c, "recompute unread", err)
		return
	}

	// The chat list mirrors the newest message: recompute it now that this one
	// is gone (clears the fields when the conversation is now empty).
	if err := h.refreshConversationPreview(c, conversationID, access.IsOpaque()); err != nil {
		httpx.ServerError(c, "refresh conversation preview", err)
		return
	}

	queueAfterCommit(c, func() {
		// Storage cleanup is bounded and best-effort: the message is already
		// gone, and a failed object delete only leaves an unreachable file.
		if len(storageKeys) > 0 {
			publishPool.Go(func() { h.deleteStorageObjects(storageKeys) })
		}
		if h.hub == nil {
			return
		}
		publishPool.Go(func() {
			payload := map[string]interface{}{
				"id":              messageID,
				"conversation_id": conversationID,
				"event":           "message_deleted",
			}
			if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
				payload["recipient_ids"] = memberIDs
			}
			if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type:    "message_deleted",
				Payload: payload,
			}); err != nil {
				log.Printf("[Messenger] WS delete broadcast error: %v", err)
				return
			}
			// The conversation list must drop the deleted preview too.
			updated := map[string]interface{}{
				"conversation_id": conversationID,
				"preview_changed": true,
				"event":           "conversation_updated",
			}
			if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
				updated["recipient_ids"] = memberIDs
			}
			if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type:    "conversation_updated",
				Payload: updated,
			}); err != nil {
				log.Printf("[Messenger] WS conversation preview broadcast error: %v", err)
			}
		})
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
		if att.Type == "audio" && att.Meta != nil && strings.TrimSpace(*att.Meta) != "" {
			if err := validateAudioMeta(*att.Meta); err != nil {
				return err
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
