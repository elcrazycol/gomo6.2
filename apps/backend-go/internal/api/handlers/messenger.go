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
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
	"github.com/redis/go-redis/v9"
)

var htmlTagRegex = regexp.MustCompile(`<[^>]*>`)

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
	OtherDisplayName    *string `json:"other_display_name"`
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

// truncatePreview truncates message content to 80 chars for conversation preview.
func truncatePreview(s string) string {
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
