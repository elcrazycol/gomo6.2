package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/middleware"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/storage"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

var htmlTagRegex = regexp.MustCompile(`<[^>]*>`)
var uuidRegex = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// isUUID checks if a string is a valid UUID format.
func isUUID(s string) bool {
	return uuidRegex.MatchString(s)
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
	// 1:1 fields (null for groups)
	OtherUserID      *string `json:"other_user_id"`
	OtherUsername    *string `json:"other_username"`
	OtherDisplayName *string `json:"other_display_name"`
	OtherAvatarURL   *string `json:"other_avatar_url"`
	OtherAccountNum  *int    `json:"other_account_number"`
	OtherIsOnline    *bool   `json:"other_is_online"`
	OtherLastSeenAt  *string `json:"other_last_seen_at"`
	// Group fields
	IsGroup     bool    `json:"is_group"`
	GroupName   *string `json:"group_name"`
	GroupAvatar *string `json:"group_avatar_url"`
	MemberCount int     `json:"member_count"`
}

// MessageResponse is returned to the client
type MessageResponse struct {
	ID string `json:"id"`
	// EventID is serialized as a decimal string so JavaScript clients never lose precision on BIGINT cursors.
	EventID          string       `json:"event_id"`
	ConversationID   string       `json:"conversation_id"`
	SenderUserID     string       `json:"sender_user_id"`
	SenderUsername   string       `json:"sender_username,omitempty"`
	ParentMessageID  *string      `json:"parent_message_id"`
	Content          string       `json:"content"`
	EncryptedContent string       `json:"-"` // not serialized to API, used for Redis broadcast
	IsEdited         bool         `json:"is_edited"`
	IsDeleted        bool         `json:"is_deleted"`
	EditedAt         *string      `json:"edited_at"`
	SentAt           string       `json:"sent_at"`
	ClientID         string       `json:"client_id"`
	Attachments      []Attachment `json:"attachments,omitempty"`
}

// Attachment represents a file attached to a message
type Attachment struct {
	ID        string  `json:"id"`
	URL       string  `json:"url"`
	Type      string  `json:"type"`
	Name      string  `json:"name"`
	Size      int64   `json:"size"`
	Mime      string  `json:"mime"`
	Meta      *string `json:"meta,omitempty"`
	SortOrder int     `json:"sort_order"`
}

// SendMessageRequest is the POST body for sending a message
type SendMessageRequest struct {
	Content         string            `json:"content" binding:"max=4000"`
	ClientID        string            `json:"client_id" binding:"required"`
	ParentMessageID *string           `json:"parent_message_id"`
	Attachments     []AttachmentInput `json:"attachments"`
}

// AttachmentInput is the attachment data sent by the client
type AttachmentInput struct {
	URL       string  `json:"url" binding:"required"`
	Type      string  `json:"type" binding:"required,oneof=image video audio file"`
	Name      string  `json:"name" binding:"required"`
	Size      int64   `json:"size" binding:"required"`
	Mime      string  `json:"mime" binding:"required"`
	Meta      *string `json:"meta"`
	SortOrder int     `json:"sort_order"`
}

// EditMessageRequest is the PUT body for editing a message
type EditMessageRequest struct {
	Content string `json:"content" binding:"required,max=4000"`
}

// MarkReadRequest is the POST body for marking messages as read
type MarkReadRequest struct {
	MessageID string `json:"message_id" binding:"required"`
}

// maxGroupSize caps how many members a group conversation can have.
// Enforced in CreateGroupConversation and AddGroupMembers.
const maxGroupSize = 100

// CreateGroupRequest is the POST body for creating a group chat
type CreateGroupRequest struct {
	Name      string   `json:"name" binding:"required,min=1,max=100"`
	MemberIDs []string `json:"member_ids" binding:"max=99"` // creator + 99 = maxGroupSize
}

// UpdateGroupRequest is the PUT body for updating a group chat
type UpdateGroupRequest struct {
	Name      *string `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

// AddMembersRequest is the POST body for adding members to a group
type AddMembersRequest struct {
	UserIDs []string `json:"user_ids" binding:"required,min=1"`
}

// GroupMemberResponse represents a member of a group
type GroupMemberResponse struct {
	UserID      string  `json:"user_id"`
	Username    string  `json:"username"`
	DisplayName *string `json:"display_name"`
	AvatarURL   *string `json:"avatar_url"`
	Role        string  `json:"role"`
	JoinedAt    string  `json:"joined_at"`
	IsOnline    *bool   `json:"is_online"`
	LastSeenAt  *string `json:"last_seen_at"`
}

// ─── Handler ────────────────────────────────────────────────────────────────

// MessengerHandler handles all messenger REST endpoints.
// Content is encrypted at rest with AES-256-GCM (when MESSENGER_ENCRYPTION_KEY is set).
// Security: TLS in transit, encryption at rest, RLS on tables, plaintext-only content filter.
type MessengerHandler struct {
	db      *sql.DB
	hub     *websocket.Hub
	redis   *redis.Client
	storage *storage.StorageClient
}

func NewMessengerHandler(db *sql.DB, hub *websocket.Hub) *MessengerHandler {
	return &MessengerHandler{db: db, hub: hub}
}

func (h *MessengerHandler) SetRedis(r *redis.Client)            { h.redis = r }
func (h *MessengerHandler) SetStorage(s *storage.StorageClient) { h.storage = s }

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
		c.AbortWithStatusJSON(http.StatusUnauthorized, models.ErrorResponse("Authentication required"))
		return nil
	}
	if required, _ := c.Get("messenger_tx_required"); required == true {
		if tx, ok := c.Value("messenger_tx").(*sql.Tx); !ok || tx == nil {
			serverError(c, "missing request transaction", fmt.Errorf("messenger transaction is missing"))
			return nil
		}
	}
	return claims
}

// serverError logs the real error and returns a generic 500 to the client.
// NEVER leaks raw error messages to the client.
func serverError(c *gin.Context, context string, err error) {
	log.Printf("[Messenger] %s: %v", context, err)
	_ = c.Error(err)
	c.AbortWithStatusJSON(http.StatusInternalServerError, models.ErrorResponse("Internal server error"))
}

// dbExecutor is implemented by both *sql.DB and *sql.Tx. Messenger handlers
// always use the request-scoped transaction when the route middleware provides one.
type dbExecutor interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
}

func (h *MessengerHandler) dbFor(c *gin.Context) dbExecutor {
	if tx, ok := c.Value("messenger_tx").(*sql.Tx); ok && tx != nil {
		return tx
	}
	// Direct handler tests and legacy internal callers may still exercise a
	// handler without route middleware. Public messenger routes always set this
	// marker, making a missing transaction fail closed instead of silently using
	// a pooled connection without SET LOCAL.
	if required, _ := c.Get("messenger_tx_required"); required == true {
		return nil
	}
	return h.db
}

func queueAfterCommit(c *gin.Context, hook func()) {
	middleware.QueueMessengerAfterCommit(c, hook)
}

func (h *MessengerHandler) txFor(c *gin.Context) (*sql.Tx, bool, error) {
	if tx, ok := c.Value("messenger_tx").(*sql.Tx); ok && tx != nil {
		return tx, false, nil
	}
	if required, _ := c.Get("messenger_tx_required"); required == true {
		return nil, false, fmt.Errorf("messenger transaction is missing")
	}
	tx, err := h.db.BeginTx(c.Request.Context(), nil)
	return tx, true, err
}

// isMember checks if a user is a member of a conversation.
func (h *MessengerHandler) isMember(c *gin.Context, conversationID, userID string) (bool, error) {
	var ok bool
	err := h.dbFor(c).QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2)",
		conversationID, userID,
	).Scan(&ok)
	return ok, err
}

// areFriends reports whether two users have a confirmed friendship.
// The friendships table always stores the smaller UUID first, so both column
// orders are checked. The table has no RLS, so the query works from the
// messenger request transaction.
func (h *MessengerHandler) areFriends(c *gin.Context, user1, user2 string) (bool, error) {
	var ok bool
	err := h.dbFor(c).QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM friendships
			WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
		)`, user1, user2).Scan(&ok)
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
// Tries the per-conversation key first, then falls back to the master key for
// legacy messages written before per-conversation encryption was introduced.
// If decryption fails, the ciphertext is replaced with a neutral placeholder
// so the encrypted blob is never returned to the client.
func decryptMessageContent(conversationID string, msg *MessageResponse) {
	if msg.Content == "" || msg.IsDeleted {
		return
	}
	decrypted, err := decryptContentForConversation(conversationID, msg.Content)
	if err == nil {
		msg.Content = decrypted
		return
	}
	decrypted, err = decryptContent(msg.Content)
	if err == nil {
		msg.Content = decrypted
		return
	}
	msg.Content = crypto.DecryptionFailedPlaceholder
}

// FindOrCreateConversation atomically finds or creates a regular 1:1
// conversation. The database function is deliberately called through the
// request-scoped executor so RLS and the user binding remain in force.
func (h *MessengerHandler) FindOrCreateConversation(c *gin.Context, user1, user2 string) (string, error) {
	var convID string
	if err := h.dbFor(c).QueryRow(
		"SELECT find_or_create_conversation($1, $2)", user1, user2,
	).Scan(&convID); err != nil {
		return "", fmt.Errorf("find_or_create_conversation: %w", err)
	}
	return convID, nil
}

// truncatePreview truncates message content to 80 chars for conversation preview.
func truncatePreview(s string) string {
	if strings.HasPrefix(s, "__GIFT__") {
		return "🎁 Подарок"
	}
	runes := []rune(s)
	if len(runes) <= 80 {
		return s
	}
	return string(runes[:80])
}

// invalidateMessengerCaches clears Redis caches for messenger endpoints.
func invalidateMessengerCaches(redis *redis.Client, conversationID, userID string) {
	// Use wildcard patterns to invalidate all cached messenger data
	patterns := []string{
		"data:/api/v1/messenger/conversations*",
		fmt.Sprintf("data:/api/v1/messenger/conversations/%s/messages*", conversationID),
		fmt.Sprintf("data:/api/v1/messenger/conversations/%s/receipts*", conversationID),
		"data:/api/v1/messenger/unread-count*",
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	for _, pattern := range patterns {
		var cursor uint64
		for {
			keys, nextCursor, err := redis.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				log.Printf("[Messenger] cache invalidation scan error: %v", err)
				break
			}
			if len(keys) > 0 {
				redis.Del(ctx, keys...)
			}
			cursor = nextCursor
			if cursor == 0 {
				break
			}
		}
	}
}
