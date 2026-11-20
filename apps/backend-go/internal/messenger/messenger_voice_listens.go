package messenger

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

// ─── Voice "listened" state ────────────────────────────────────────────────
// The dot on a voice note is per PERSON: an incoming note is unheard until I
// play it, and my own note stays marked for me until the peer plays it. A row in
// `message_voice_listens` means "this user has listened"; the message payload
// carries the ids so both sides can draw the dot without extra requests.

// addVoiceListensToMessages attaches the listener ids to a page of messages in
// one query, the same batching as attachments and reactions.
func (h *MessengerHandler) addVoiceListensToMessages(c *gin.Context, messages []MessageResponse) error {
	if len(messages) == 0 {
		return nil
	}

	placeholders := make([]string, len(messages))
	args := make([]interface{}, len(messages))
	for i := range messages {
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = messages[i].ID
	}

	rows, err := h.dbFor(c).Query(`
		SELECT message_id, user_id
		FROM message_voice_listens
		WHERE message_id IN (`+strings.Join(placeholders, ",")+`)
	`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()

	listeners := make(map[string][]string)
	for rows.Next() {
		var messageID, userID string
		if err := rows.Scan(&messageID, &userID); err != nil {
			return err
		}
		listeners[messageID] = append(listeners[messageID], userID)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for i := range messages {
		if ids, ok := listeners[messages[i].ID]; ok {
			messages[i].VoiceListenedBy = ids
		}
	}
	return nil
}

func (h *MessengerHandler) broadcastVoiceListened(conversationID, messageID, userID string) {
	if h.hub == nil {
		return
	}
	payload := map[string]interface{}{
		"message_id":      messageID,
		"conversation_id": conversationID,
		"user_id":         userID,
		"event":           "message_voice_listened",
	}
	if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
		payload["recipient_ids"] = memberIDs
	}
	if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
		Type:    "message_voice_listened",
		Payload: payload,
	}); err != nil {
		log.Printf("[Messenger] WS voice-listened broadcast error: %v", err)
	}
}

// MarkVoiceListened godoc
// @Summary      Mark a voice note as listened
// @Description  Records that the caller played the note. Idempotent; broadcast to the conversation.
// @Tags         Messenger
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        msgId path string true "Message ID"
// @Success      200 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages/{msgId}/voice-listened [post]
// @Security     BearerAuth
func (h *MessengerHandler) MarkVoiceListened(c *gin.Context) {
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

	member, err := h.isMember(c, conversationID, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "check membership", err)
		return
	}
	if !member {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member"))
		return
	}

	var messageExists bool
	err = h.dbFor(c).QueryRow(
		"SELECT EXISTS(SELECT 1 FROM chat_messages WHERE id = $1 AND conversation_id = $2 AND is_deleted = false)",
		messageID, conversationID,
	).Scan(&messageExists)
	if err != nil {
		httpx.ServerError(c, "check message exists", err)
		return
	}
	if !messageExists {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found in this conversation"))
		return
	}

	if _, err := h.dbFor(c).Exec(`
		INSERT INTO message_voice_listens (message_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT (message_id, user_id) DO NOTHING
	`, messageID, claims.UserID); err != nil {
		httpx.ServerError(c, "mark voice listened", err)
		return
	}

	queueAfterCommit(c, func() {
		publishPool.Go(func() {
			h.broadcastVoiceListened(conversationID, messageID, claims.UserID)
		})
	})

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"listened": true}))
}
