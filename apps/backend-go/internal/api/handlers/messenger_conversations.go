package handlers

import (
	"database/sql"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

// ─── List Conversations ─────────────────────────────────────────────────────
// GET /api/v1/messenger/conversations

// ListConversations godoc
// @Summary      List conversations
// @Description  Get all conversations for the authenticated user
// @Tags         Messenger
// @Produce      json
// @Success      200 {object} models.APIResponse
// @Failure      401 {object} models.APIResponse
// @Router       /messenger/conversations [get]
// @Security     BearerAuth
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
			u.id AS other_id, u.username AS other_username, u.display_name AS other_display_name,
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
			&conv.OtherUserID, &conv.OtherUsername, &conv.OtherDisplayName,
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
// Race-condition safe: uses the atomic find_or_create_conversation DB function
// which handles concurrent creates via ON CONFLICT on the unique pair index.

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

	// Atomic find-or-create via DB function (race-safe via ON CONFLICT)
	convID, err := h.FindOrCreateConversation(claims.UserID, req.UserID)
	if err != nil {
		serverError(c, "find or create conversation", err)
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
