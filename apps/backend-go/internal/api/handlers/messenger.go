package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

// ─── Encryption ─────────────────────────────────────────────────────────────
// AES-256-GCM field-level encryption for message content.
// Protects against DB dumps, backups, and SQL injection data exposure.
// NOT E2EE — server holds the key. For true E2EE, client-side key exchange needed.

var (
	messengerEncryptionKey []byte
	htmlTagRegex           = regexp.MustCompile(`<[^>]*>`)
)

func init() {
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY") // fallback
	}
	if key != "" {
		// Key must be exactly 32 bytes for AES-256
		k := []byte(key)
		if len(k) < 32 {
			// Pad or truncate — in production, use a proper 32-byte key
			padded := make([]byte, 32)
			copy(padded, k)
			messengerEncryptionKey = padded
		} else {
			messengerEncryptionKey = k[:32]
		}
	}
}

func encryptContent(plaintext string) (string, error) {
	if messengerEncryptionKey == nil {
		return plaintext, nil // encryption disabled
	}

	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce gen: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

func decryptContent(encoded string) (string, error) {
	if messengerEncryptionKey == nil || encoded == "" {
		return encoded, nil
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		// Data may not be encrypted (migration period) — return as-is
		return encoded, nil
	}

	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return encoded, nil // not encrypted
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return encoded, nil // decryption failed — return as-is (unencrypted data)
	}

	return string(plaintext), nil
}

// ─── Types ──────────────────────────────────────────────────────────────────

// ConversationResponse is returned to the client for conversation list
type ConversationResponse struct {
	ID                  string  `json:"id"`
	LastMessageAt       *string `json:"last_message_at"`
	LastMessagePreview  *string `json:"last_message_preview"`
	LastMessageSenderID *string `json:"last_message_sender_id"`
	PinnedMessageID     *string `json:"pinned_message_id"`
	UpdatedAt           string  `json:"updated_at"`
	UnreadCount         int     `json:"unread_count"`
	LastReadAt          *string `json:"last_read_at"`
	IsMuted             bool    `json:"is_muted"`
	OtherUserID         string  `json:"other_user_id"`
	OtherUsername       string  `json:"other_username"`
	OtherAvatarURL      *string `json:"other_avatar_url"`
	OtherAccountNum     *int    `json:"other_account_number"`
	OtherIsOnline       *bool   `json:"other_is_online"`
	OtherLastSeenAt     *string `json:"other_last_seen_at"`
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
// Content is encrypted at rest with AES-256-GCM (when MESSENGER_ENCRYPTION_KEY is set).
// Security: TLS in transit, encryption at rest, RLS on tables, plaintext-only content filter.
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

// serverError logs the real error and returns a generic 500 to the client.
// NEVER leaks raw error messages to the client.
func serverError(c *gin.Context, context string, err error) {
	log.Printf("[Messenger] %s: %v", context, err)
	c.JSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
}

// isMember checks if a user is a member of a conversation.
func (h *MessengerHandler) isMember(conversationID, userID string) (bool, error) {
	var ok bool
	err := h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, userID,
	).Scan(&ok)
	return ok, err
}

// hasHTML checks if content contains HTML tags — we only allow plaintext.
func hasHTML(s string) bool {
	return htmlTagRegex.MatchString(s)
}

// sanitizeContent validates and normalizes message content.
func sanitizeContent(s string) (string, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return "", fmt.Errorf("content cannot be empty")
	}
	if len([]rune(s)) > 4000 {
		return "", fmt.Errorf("content exceeds 4000 characters")
	}
	if hasHTML(s) {
		return "", fmt.Errorf("HTML content is not allowed")
	}
	return s, nil
}

// generateClientID creates a client-side idempotency key.
func GenerateClientID() string {
	return fmt.Sprintf("c%d", time.Now().UnixNano())
}

// decryptMessageContent decrypts a single message's content if encrypted.
func decryptMessageContent(msg *MessageResponse) {
	if msg.Content != "" && !msg.IsDeleted {
		decrypted, err := decryptContent(msg.Content)
		if err == nil {
			msg.Content = decrypted
		}
	}
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
		INNER JOIN chat_members cm2 ON cm2.conversation_id = cm.conversation_id AND cm2.user_id != $1
		INNER JOIN users u ON u.id = cm2.user_id
		WHERE cm.user_id = $1
		ORDER BY c.last_message_at DESC NULLS LAST
	`, claims.UserID)
	if err != nil {
		serverError(c, "list conversations", err)
		return
	}
	defer rows.Close()

	conversations := []ConversationResponse{}
	for rows.Next() {
		var conv ConversationResponse
		var otherAvatar, otherLastSeen sql.NullString
		var otherAccount sql.NullInt64
		var otherOnline sql.NullBool
		var preview, lastMsgAt, lastMsgSender, pinnedMsg sql.NullString

		if err := rows.Scan(
			&conv.ID, &lastMsgAt, &preview,
			&lastMsgSender, &pinnedMsg, &conv.UpdatedAt,
			&conv.UnreadCount, &conv.UnreadCount,
			&conv.OtherUserID, &conv.OtherUsername,
			&otherAvatar, &otherAccount, &otherOnline, &otherLastSeen,
		); err != nil {
			serverError(c, "scan conversation row", err)
			return
		}

		if lastMsgAt.Valid {
			conv.LastMessageAt = &lastMsgAt.String
		}
		if preview.Valid {
			decrypted, err := decryptContent(preview.String)
			if err == nil {
				conv.LastMessagePreview = &decrypted
			} else {
				conv.LastMessagePreview = &preview.String
			}
		}
		if lastMsgSender.Valid {
			conv.LastMessageSenderID = &lastMsgSender.String
		}
		if pinnedMsg.Valid {
			conv.PinnedMessageID = &pinnedMsg.String
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
//
// Race-condition safe: uses a retry loop. If two concurrent requests create
// the same conversation, the retry will find the existing one.

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

	// Verify the other user exists
	var otherExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM users WHERE id = $1)", req.UserID).Scan(&otherExists)
	if err != nil {
		serverError(c, "check user exists", err)
		return
	}
	if !otherExists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("User not found"))
		return
	}

	// Retry loop — up to 3 attempts to handle race conditions
	for attempt := 0; attempt < 3; attempt++ {
		// 1. Find existing 1:1 conversation (exactly 2 members: me + other)
		var convID string
		err := h.db.QueryRow(`
			SELECT cm1.conversation_id
			FROM chat_members cm1
			INNER JOIN chat_members cm2
				ON cm1.conversation_id = cm2.conversation_id
			WHERE cm1.user_id = $1
			  AND cm2.user_id = $2
			  AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id = cm1.conversation_id) = 2
			LIMIT 1
		`, claims.UserID, req.UserID).Scan(&convID)

		if err == nil {
			c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"conversation_id": convID}))
			return
		}

		if err != sql.ErrNoRows {
			serverError(c, "find existing conversation", err)
			return
		}

		// 2. No existing conversation — create one
		tx, err := h.db.Begin()
		if err != nil {
			serverError(c, "begin tx", err)
			return
		}

		err = tx.QueryRow(`INSERT INTO chat_conversations DEFAULT VALUES RETURNING id`).Scan(&convID)
		if err != nil {
			tx.Rollback()
			serverError(c, "insert conversation", err)
			return
		}

		_, err = tx.Exec(`INSERT INTO chat_members (conversation_id, user_id) VALUES ($1, $2), ($1, $3)`,
			convID, claims.UserID, req.UserID)
		if err != nil {
			tx.Rollback()
			// Race condition: another request created the same pair.
			// The unique constraint on (conversation_id, user_id) prevents duplicates,
			// but the race is on creating a SECOND conversation for the same pair.
			// Retry — the next SELECT will find the first one.
			if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "unique") {
				log.Printf("[Messenger] Race detected on conversation create, retrying (attempt %d)", attempt+1)
				continue
			}
			serverError(c, "insert members", err)
			return
		}

		if err := tx.Commit(); err != nil {
			serverError(c, "commit tx", err)
			return
		}

		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"conversation_id": convID}))
		return
	}

	// Exhausted retries — find the existing one (created by race winner)
	var convID string
	err = h.db.QueryRow(`
		SELECT cm1.conversation_id
		FROM chat_members cm1
		INNER JOIN chat_members cm2 ON cm1.conversation_id = cm2.conversation_id
		WHERE cm1.user_id = $1 AND cm2.user_id = $2
		  AND (SELECT COUNT(*) FROM chat_members WHERE conversation_id = cm1.conversation_id) = 2
		LIMIT 1
	`, claims.UserID, req.UserID).Scan(&convID)

	if err != nil {
		serverError(c, "find after retries exhausted", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"conversation_id": convID}))
}

// ─── Leave Conversation ──────────────────────────────────────────────────────
// DELETE /api/v1/messenger/conversations/:id/leave

func (h *MessengerHandler) LeaveConversation(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("conversation_id required"))
		return
	}

	// Check membership
	member, err := h.isMember(conversationID, claims.UserID)
	if err != nil {
		serverError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	result, err := h.db.Exec(
		"DELETE FROM chat_members WHERE conversation_id = $1 AND user_id = $2",
		conversationID, claims.UserID,
	)
	if err != nil {
		serverError(c, "leave conversation", err)
		return
	}

	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Membership not found"))
		return
	}

	// Broadcast leave event if hub is available
	if h.hub != nil {
		go func() {
			h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
				Type: "member_left",
				Payload: map[string]interface{}{
					"conversation_id": conversationID,
					"user_id":         claims.UserID,
				},
			})
		}()
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"left": true}))
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
		go h.broadcastMessageEdited(messageID, cleanContent)
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

func (h *MessengerHandler) broadcastMessageEdited(msgID, newContent string) {
	payload := map[string]interface{}{
		"id":      msgID,
		"content": newContent,
		"event":   "message_edited",
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
	conversationID := c.Param("convId")

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

// ─── Mark Read ──────────────────────────────────────────────────────────────
// POST /api/v1/messenger/conversations/:id/read
//
// Uses a single transaction for consistency.

func (h *MessengerHandler) MarkRead(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")

	var req MarkReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
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

	// Get message sent_at
	var sentAt time.Time
	err = h.db.QueryRow("SELECT sent_at FROM chat_messages WHERE id = $1 AND conversation_id = $2",
		req.MessageID, conversationID,
	).Scan(&sentAt)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Single transaction: mark read + delivered + reset unread
	tx, err := h.db.Begin()
	if err != nil {
		serverError(c, "begin tx", err)
		return
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO chat_receipts (message_id, user_id, delivered_at, read_at)
		SELECT m.id, $2, NOW(), NOW()
		FROM chat_messages m
		WHERE m.conversation_id = $1
		  AND m.sender_user_id != $2
		  AND m.sent_at <= $3
		ON CONFLICT (message_id, user_id)
		DO UPDATE SET read_at = NOW(), delivered_at = COALESCE(chat_receipts.delivered_at, NOW())
	`, conversationID, claims.UserID, sentAt)
	if err != nil {
		log.Printf("[Messenger] mark read receipts: %v", err)
	}

	_, err = tx.Exec(`
		UPDATE chat_members
		SET unread_count = 0, last_read_message_id = $2
		WHERE conversation_id = $1 AND user_id = $3
	`, conversationID, req.MessageID, claims.UserID)
	if err != nil {
		log.Printf("[Messenger] mark read unread reset: %v", err)
	}

	if err := tx.Commit(); err != nil {
		serverError(c, "commit tx", err)
		return
	}

	// Broadcast read receipt
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
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
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

	// Get the message time
	var sentAt time.Time
	err = h.db.QueryRow("SELECT sent_at FROM chat_messages WHERE id = $1 AND conversation_id = $2",
		req.MessageID, conversationID,
	).Scan(&sentAt)
	if err != nil {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Mark delivered
	_, err = h.db.Exec(`
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
		log.Printf("[Messenger] mark delivered: %v", err)
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
		serverError(c, "get unread count", err)
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

	member, err := h.isMember(conversationID, claims.UserID)
	if err != nil {
		serverError(c, "check membership", err)
		return
	}
	if !member {
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
		serverError(c, "get receipts", err)
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
		c.JSON(http.StatusBadRequest, models.ErrorResponse("message_id is required"))
		return
	}

	// Check membership
	member, err := h.isMember(conversationID, claims.UserID)
	if err != nil {
		serverError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member"))
		return
	}

	// Verify the message belongs to this conversation
	var msgExists bool
	err = h.db.QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND is_deleted = false)",
		req.MessageID, conversationID,
	).Scan(&msgExists)
	if err != nil {
		serverError(c, "check message exists", err)
		return
	}
	if !msgExists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	// Get current pinned message
	var currentPin sql.NullString
	err = h.db.QueryRow("SELECT pinned_message_id FROM chat_conversations WHERE id = $1", conversationID).Scan(&currentPin)
	if err != nil {
		serverError(c, "get current pin", err)
		return
	}

	if currentPin.Valid && currentPin.String == req.MessageID {
		// Unpin
		_, err = h.db.Exec("UPDATE chat_conversations SET pinned_message_id = NULL WHERE id = $1", conversationID)
		if err != nil {
			serverError(c, "unpin message", err)
			return
		}
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": nil}))
	} else {
		// Pin
		_, err = h.db.Exec("UPDATE chat_conversations SET pinned_message_id = $2 WHERE id = $1", conversationID, req.MessageID)
		if err != nil {
			serverError(c, "pin message", err)
			return
		}
		c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"pinned_message_id": req.MessageID}))
	}
}
