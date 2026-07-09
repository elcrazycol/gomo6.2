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
			cm.unread_count, cm.is_muted,
			c.is_group, c.group_name, c.group_avatar_url,
			(SELECT COUNT(*) FROM chat_members WHERE conversation_id = c.id) AS member_count,
			-- 1:1 fields (NULL for groups)
			ou.id AS other_id, ou.username AS other_username, ou.display_name AS other_display_name,
			ou.avatar_url AS other_avatar_url, ou.account_number AS other_account_number,
			ou.is_online AS other_is_online, ou.last_seen_at AS other_last_seen_at
		FROM chat_members cm
		INNER JOIN chat_conversations c ON c.id = cm.conversation_id
		LEFT JOIN chat_members cm2 ON cm2.conversation_id = cm.conversation_id AND cm2.user_id != $1
		LEFT JOIN users ou ON ou.id = cm2.user_id AND c.is_group = false
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
		var otherID, otherUsername, otherDisplayName, otherAvatar, otherLastSeen sql.NullString
		var otherAccount sql.NullInt64
		var otherOnline sql.NullBool
		var preview, lastMsgAt, lastMsgSender, pinnedMsg sql.NullString
		var groupName, groupAvatar sql.NullString

		if err := rows.Scan(
			&conv.ID, &lastMsgAt, &preview,
			&lastMsgSender, &pinnedMsg, &conv.UpdatedAt,
			&conv.UnreadCount, &conv.IsMuted,
			&conv.IsGroup, &groupName, &groupAvatar,
			&conv.MemberCount,
			&otherID, &otherUsername, &otherDisplayName,
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
		// Group fields
		if groupName.Valid {
			conv.GroupName = &groupName.String
		}
		if groupAvatar.Valid {
			conv.GroupAvatar = &groupAvatar.String
		}
		// 1:1 fields
		if otherID.Valid {
			conv.OtherUserID = &otherID.String
		}
		if otherUsername.Valid {
			conv.OtherUsername = &otherUsername.String
		}
		if otherDisplayName.Valid {
			conv.OtherDisplayName = &otherDisplayName.String
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

// GetOrCreateConversation creates or finds a 1:1 conversation.
// POST /api/v1/messenger/conversations
//
// GetOrCreateConversation godoc
// @Summary      Get or create conversation
// @Description  Find or create a 1:1 conversation with another user
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        request body object true "Target user"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations [post]
// @Security     BearerAuth
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

// LeaveConversation removes the user from a conversation.
// DELETE /api/v1/messenger/conversations/:id/leave
//
// LeaveConversation godoc
// @Summary      Leave conversation
// @Description  Remove yourself from a conversation
// @Tags         Messenger
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/leave [delete]
// @Security     BearerAuth
func (h *MessengerHandler) LeaveConversation(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
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

// ─── Create Group Conversation ──────────────────────────────────────────────
// POST /api/v1/messenger/groups

func (h *MessengerHandler) CreateGroupConversation(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	var req CreateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request: name and member_ids required"))
		return
	}

	// Convert string IDs to UUIDs
	memberUUIDs := make([]string, 0, len(req.MemberIDs))
	for _, id := range req.MemberIDs {
		if !isUUID(id) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid member ID: "+id))
			return
		}
		memberUUIDs = append(memberUUIDs, id)
	}

	// Use RPC function
	var convID string
	err := h.db.QueryRow(`
		SELECT rpc_create_group_chat($1, $2)
	`, req.Name, memberUUIDs).Scan(&convID)
	if err != nil {
		serverError(c, "create group chat", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"conversation_id": convID,
		"is_group":        true,
		"group_name":      req.Name,
	}))
}

// ─── Update Group ───────────────────────────────────────────────────────────
// PUT /api/v1/messenger/groups/:id

func (h *MessengerHandler) UpdateGroup(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	groupID := c.Param("id")
	if !isUUID(groupID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid group_id"))
		return
	}

	// Check if caller is admin
	var isAdmin bool
	err := h.db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM chat_members WHERE conversation_id = $1 AND user_id = $2 AND role = 'admin')
	`, groupID, claims.UserID).Scan(&isAdmin)
	if err != nil || !isAdmin {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Only admins can update group"))
		return
	}

	var req UpdateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}

	if req.Name != nil {
		if _, err := h.db.Exec(`UPDATE chat_conversations SET group_name = $1, updated_at = NOW() WHERE id = $2`, *req.Name, groupID); err != nil {
			serverError(c, "update group name", err)
			return
		}
	}
	if req.AvatarURL != nil {
		if _, err := h.db.Exec(`UPDATE chat_conversations SET group_avatar_url = $1, updated_at = NOW() WHERE id = $2`, *req.AvatarURL, groupID); err != nil {
			serverError(c, "update group avatar", err)
			return
		}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"updated": true}))
}

// ─── Add Members ────────────────────────────────────────────────────────────
// POST /api/v1/messenger/groups/:id/members

func (h *MessengerHandler) AddGroupMembers(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	groupID := c.Param("id")
	if !isUUID(groupID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid group_id"))
		return
	}

	var req AddMembersRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("user_ids required"))
		return
	}

	// Use RPC function
	userUUIDs := make([]string, 0, len(req.UserIDs))
	for _, id := range req.UserIDs {
		if !isUUID(id) {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid user ID: "+id))
			return
		}
		userUUIDs = append(userUUIDs, id)
	}

	_, err := h.db.Exec(`SELECT rpc_add_group_members($1, $2)`, groupID, userUUIDs)
	if err != nil {
		serverError(c, "add group members", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"added": len(userUUIDs)}))
}

// ─── Remove Member ──────────────────────────────────────────────────────────
// DELETE /api/v1/messenger/groups/:id/members/:userId

func (h *MessengerHandler) RemoveGroupMember(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	groupID := c.Param("id")
	userID := c.Param("userId")
	if !isUUID(groupID) || !isUUID(userID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid group_id or user_id"))
		return
	}

	_, err := h.db.Exec(`SELECT rpc_remove_group_member($1, $2)`, groupID, userID)
	if err != nil {
		serverError(c, "remove group member", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"removed": true}))
}

// ─── Get Group Members ──────────────────────────────────────────────────────
// GET /api/v1/messenger/groups/:id/members

func (h *MessengerHandler) GetGroupMembers(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	groupID := c.Param("id")
	if !isUUID(groupID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid group_id"))
		return
	}

	// Verify membership
	member, err := h.isMember(groupID, claims.UserID)
	if err != nil || !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this group"))
		return
	}

	rows, err := h.db.Query(`
		SELECT
			u.id, u.username, u.display_name, u.avatar_url,
			cm.role, cm.joined_at,
			u.is_online, u.last_seen_at
		FROM chat_members cm
		INNER JOIN users u ON u.id = cm.user_id
		WHERE cm.conversation_id = $1
		ORDER BY cm.role DESC, cm.joined_at ASC
	`, groupID)
	if err != nil {
		serverError(c, "get group members", err)
		return
	}
	defer rows.Close()

	members := []GroupMemberResponse{}
	for rows.Next() {
		var m GroupMemberResponse
		var displayName, avatarURL, lastSeen sql.NullString
		var online sql.NullBool

		if err := rows.Scan(
			&m.UserID, &m.Username, &displayName, &avatarURL,
			&m.Role, &m.JoinedAt,
			&online, &lastSeen,
		); err != nil {
			serverError(c, "scan member row", err)
			return
		}
		if displayName.Valid {
			m.DisplayName = &displayName.String
		}
		if avatarURL.Valid {
			m.AvatarURL = &avatarURL.String
		}
		if online.Valid {
			m.IsOnline = &online.Bool
		}
		if lastSeen.Valid {
			m.LastSeenAt = &lastSeen.String
		}
		members = append(members, m)
	}

	if members == nil {
		members = []GroupMemberResponse{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(members))
}
