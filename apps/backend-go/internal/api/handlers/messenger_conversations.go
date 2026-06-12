package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

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
