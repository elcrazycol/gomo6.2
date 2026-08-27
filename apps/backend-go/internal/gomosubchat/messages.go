package gomosubchat

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/channelaccess"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

const messageColumns = `m.id, m.channel_id, m.user_id, u.username, u.avatar_url,
	m.content, m.edited_at, m.deleted_at, m.created_at`

const messageFrom = `
FROM channel_messages m
JOIN users u ON u.id = m.user_id`

func scanMessage(row interface{ Scan(...any) error }) (MessageResponse, error) {
	var msg MessageResponse
	var editedAt, deletedAt sql.NullTime
	err := row.Scan(&msg.ID, &msg.ChannelID, &msg.UserID, &msg.Username,
		&msg.AvatarURL, &msg.Content, &editedAt, &deletedAt, &msg.CreatedAt)
	if err != nil {
		return msg, err
	}
	if editedAt.Valid {
		msg.EditedAt = &editedAt.Time
	}
	if deletedAt.Valid {
		msg.DeletedAt = &deletedAt.Time
	}
	return msg, nil
}

// ─── History ────────────────────────────────────────────────────────────────
// GET /api/v1/gomosubchat/channels/:id/messages?before=<id>&limit=<n>
//
// Keyset pagination identical in spirit to the messenger: fetch the newest
// `limit` messages (or the newest ones strictly before `before`), return them
// oldest→newest so clients can append straight into the timeline.

// GetMessages godoc
// @Summary      Channel message history
// @Description  Get a page of messages of a gomosub text channel (read access applies)
// @Tags         GomoSubChat
// @Produce      json
// @Param        id     path string true "Channel ID"
// @Param        limit  query int    false "Max results (1-100)" default(50)
// @Param        before query string false "Cursor: only messages with id < this value"
// @Success      200 {object} models.APIResponse
// @Router       /gomosubchat/channels/{id}/messages [get]
func (h *Handler) GetMessages(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	channelID := c.Param("id")
	if !isUUID(channelID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid channel_id"))
		return
	}

	ok, err := channelaccess.CanReadChannel(h.db, claims.UserID, channelID)
	if err != nil {
		httpx.ServerError(c, "check channel access", err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, models.ErrorResponse("No access to this channel"))
		return
	}

	limit := 50
	if l := c.Query("limit"); l != "" {
		if n, perr := strconv.Atoi(l); perr == nil && n > 0 && n <= 100 {
			limit = n
		}
	}
	before := int64(0)
	if b := c.Query("before"); b != "" {
		if n, perr := strconv.ParseInt(b, 10, 64); perr == nil && n > 0 {
			before = n
		} else {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid before cursor"))
			return
		}
	}

	query := "SELECT " + messageColumns + messageFrom + " WHERE m.channel_id = $1"
	args := []interface{}{channelID}
	if before > 0 {
		query += " AND m.id < $2"
		args = append(args, before)
	}
	query += " ORDER BY m.id DESC LIMIT " + strconv.Itoa(limit)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		httpx.ServerError(c, "load messages", err)
		return
	}
	defer rows.Close()

	page := make([]MessageResponse, 0, limit)
	for rows.Next() {
		msg, serr := scanMessage(rows)
		if serr != nil {
			httpx.ServerError(c, "scan message", serr)
			return
		}
		page = append(page, msg)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate messages", err)
		return
	}
	// The query walks newest→oldest; clients consume oldest→newest.
	for i, j := 0, len(page)-1; i < j; i, j = i+1, j-1 {
		page[i], page[j] = page[j], page[i]
	}

	c.JSON(http.StatusOK, models.SuccessResponse(page))
}

// ─── Send ───────────────────────────────────────────────────────────────────
// POST /api/v1/gomosubchat/channels/:id/messages

type sendMessageRequest struct {
	Content string `json:"content"`
}

// SendMessage godoc
// @Summary      Send channel message
// @Description  Post a message to a gomosub text channel (member write rules apply)
// @Tags         GomoSubChat
// @Accept       json
// @Produce      json
// @Param        id     path string              true "Channel ID"
// @Param        request body sendMessageRequest true "Message content"
// @Success      201 {object} models.APIResponse
// @Router       /gomosubchat/channels/{id}/messages [post]
func (h *Handler) SendMessage(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	channelID := c.Param("id")
	if !isUUID(channelID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid channel_id"))
		return
	}

	var req sendMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	content := trimContent(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Message is empty"))
		return
	}
	if utf8.RuneCountInString(content) > MaxContentLength {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Message is too long"))
		return
	}

	// Forum channels never accept direct chat — their flow is threads+posts.
	var kind string
	if err := h.db.QueryRow(`SELECT kind FROM channels WHERE id = $1`, channelID).Scan(&kind); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, models.ErrorResponse("Channel not found"))
			return
		}
		httpx.ServerError(c, "load channel", err)
		return
	}
	if kind != "text" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("This channel does not accept direct messages"))
		return
	}

	ok, err := channelaccess.CanWriteChannel(h.db, claims.UserID, channelID)
	if err != nil {
		httpx.ServerError(c, "check channel write access", err)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You cannot post in this channel"))
		return
	}

	var (
		id        int64
		createdAt time.Time
	)
	err = h.db.QueryRow(
		`INSERT INTO channel_messages (channel_id, user_id, content) VALUES ($1, $2, $3) RETURNING id, created_at`,
		channelID, claims.UserID, content,
	).Scan(&id, &createdAt)
	if err != nil {
		httpx.ServerError(c, "save message", err)
		return
	}

	msg := MessageResponse{
		ID:        id,
		ChannelID: channelID,
		UserID:    claims.UserID,
		Username:  claims.Username,
		Content:   content,
		CreatedAt: createdAt,
	}
	// Author metadata comes from the same join the history uses so every
	// client renders the row identically whether it came via REST or WS.
	row := h.db.QueryRow(
		`SELECT u.username, u.avatar_url FROM users u WHERE u.id = $1`, claims.UserID)
	var username string
	var avatarURL sql.NullString
	if qerr := row.Scan(&username, &avatarURL); qerr == nil {
		msg.Username = username
		if avatarURL.Valid {
			a := avatarURL.String
			msg.AvatarURL = &a
		}
	}

	h.publish(websocket.MessageTypeNewChannelMessage, map[string]interface{}{
		"id":         msg.ID,
		"channel_id": msg.ChannelID,
		"user_id":    msg.UserID,
		"username":   msg.Username,
		"avatar_url": msg.AvatarURL,
		"content":    msg.Content,
		"created_at": msg.CreatedAt.UTC(),
	})

	c.JSON(http.StatusCreated, models.SuccessResponse(msg))
}

// ─── Edit ───────────────────────────────────────────────────────────────────
// PUT /api/v1/gomosubchat/channels/:id/messages/:msgId

type editMessageRequest struct {
	Content string `json:"content"`
}

// EditMessage godoc
// @Summary      Edit own channel message
// @Description  Freely edit one of your own messages in a gomosub text channel
// @Tags         GomoSubChat
// @Accept       json
// @Produce      json
// @Param        id    path string            true "Channel ID"
// @Param        msgId path string            true "Message ID"
// @Param        request body editMessageRequest true "New content"
// @Success      200 {object} models.APIResponse
// @Router       /gomosubchat/channels/{id}/messages/{msgId} [put]
func (h *Handler) EditMessage(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	channelID := c.Param("id")
	messageID, err := strconv.ParseInt(c.Param("msgId"), 10, 64)
	if !isUUID(channelID) || err != nil || messageID <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid identifiers"))
		return
	}

	var req editMessageRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid request body"))
		return
	}
	content := trimContent(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Message is empty"))
		return
	}
	if utf8.RuneCountInString(content) > MaxContentLength {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Message is too long"))
		return
	}

	var authorID string
	var alive bool
	err = h.db.QueryRow(
		`SELECT user_id, deleted_at IS NULL FROM channel_messages WHERE id = $1 AND channel_id = $2`,
		messageID, channelID).Scan(&authorID, &alive)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "load message", err)
		return
	}
	if authorID != claims.UserID {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You can edit only your own messages"))
		return
	}
	if !alive {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Message is deleted"))
		return
	}

	ok, werr := channelaccess.CanWriteChannel(h.db, claims.UserID, channelID)
	if werr != nil {
		httpx.ServerError(c, "check channel write access", werr)
		return
	}
	if !ok {
		c.JSON(http.StatusForbidden, models.ErrorResponse("You cannot post in this channel anymore"))
		return
	}

	editRes, eerr := h.db.Exec(
		`UPDATE channel_messages SET content = $3, edited_at = NOW() WHERE id = $1 AND channel_id = $2`,
		messageID, channelID, content)
	if eerr != nil {
		httpx.ServerError(c, "update message", eerr)
		return
	}
	if n, _ := editRes.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}
	msg, uerr := fetchMessage(h.db, channelID, messageID)
	if uerr != nil {
		httpx.ServerError(c, "reload message", uerr)
		return
	}

	editedAt := time.Now().UTC()
	if msg.EditedAt != nil {
		editedAt = msg.EditedAt.UTC()
	}
	h.publish(websocket.MessageTypeChannelMessageEdited, map[string]interface{}{
		"id":         msg.ID,
		"channel_id": msg.ChannelID,
		"content":    msg.Content,
		"edited_at":  editedAt,
	})

	c.JSON(http.StatusOK, models.SuccessResponse(msg))
}

// ─── Delete ─────────────────────────────────────────────────────────────────
// DELETE /api/v1/gomosubchat/channels/:id/messages/:msgId

// DeleteMessage godoc
// @Summary      Delete channel message
// @Description  Soft-delete your own message; board owner or can_delete_threads roles may delete anyone's
// @Tags         GomoSubChat
// @Produce      json
// @Param        id    path string true "Channel ID"
// @Param        msgId path string true "Message ID"
// @Success      200 {object} models.APIResponse
// @Router       /gomosubchat/channels/{id}/messages/{msgId} [delete]
func (h *Handler) DeleteMessage(c *gin.Context) {
	claims := httpx.EnsureAuth(c)
	if claims == nil {
		return
	}

	channelID := c.Param("id")
	messageID, err := strconv.ParseInt(c.Param("msgId"), 10, 64)
	if !isUUID(channelID) || err != nil || messageID <= 0 {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid identifiers"))
		return
	}

	var authorID string
	err = h.db.QueryRow(
		`SELECT user_id FROM channel_messages WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
		messageID, channelID).Scan(&authorID)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}
	if err != nil {
		httpx.ServerError(c, "load message", err)
		return
	}

	isOwn := authorID == claims.UserID
	if !isOwn {
		ok, merr := channelaccess.CanModerateChannel(h.db, claims.UserID, channelID)
		if merr != nil {
			httpx.ServerError(c, "check moderation rights", merr)
			return
		}
		if !ok {
			c.JSON(http.StatusForbidden, models.ErrorResponse("Not allowed to delete this message"))
			return
		}
	}

	delRes, derr2 := h.db.Exec(
		`UPDATE channel_messages SET deleted_at = NOW() WHERE id = $1 AND channel_id = $2 AND deleted_at IS NULL`,
		messageID, channelID)
	if derr2 != nil {
		httpx.ServerError(c, "delete message", derr2)
		return
	}
	if n, _ := delRes.RowsAffected(); n == 0 {
		c.JSON(http.StatusNotFound, models.ErrorResponse("Message not found"))
		return
	}
	msg, ferr := fetchMessage(h.db, channelID, messageID)
	if ferr != nil {
		httpx.ServerError(c, "reload message", ferr)
		return
	}
	// Deleted payloads never carry content.
	msg.Content = ""

	h.publish(websocket.MessageTypeChannelMessageDeleted, map[string]interface{}{
		"id":         msg.ID,
		"channel_id": msg.ChannelID,
		"user_id":    msg.UserID,
	})

	c.JSON(http.StatusOK, models.SuccessResponse(msg))
}

// fetchMessage loads one message row (with its author metadata) of a channel.
func fetchMessage(db *sql.DB, channelID string, id int64) (MessageResponse, error) {
	return scanMessage(db.QueryRow(
		"SELECT "+messageColumns+messageFrom+" WHERE m.channel_id = $1 AND m.id = $2",
		channelID, id))
}

// publish fans an event out through the hub's Redis channel so every backend
// replica relays it into the channel_<id> websocket room. A nil or broken hub
// degrades gracefully: REST responses are unaffected.
func (h *Handler) publish(eventType string, payload map[string]interface{}) {
	if h.hub == nil {
		return
	}
	if err := h.hub.PublishToRedis(websocket.RedisChannelChannelChat, websocket.RealtimeEvent{
		Type:    eventType,
		Payload: payload,
	}); err != nil {
		log.Printf("[GomoSubChat] redis publish %s: %v", eventType, err)
	}
}

func trimContent(s string) string {
	start, end := 0, len(s)
	for start < end && isSpaceByte(s[start]) {
		start++
	}
	for end > start && isSpaceByte(s[end-1]) {
		end--
	}
	return s[start:end]
}

func isSpaceByte(b byte) bool { return b == ' ' || b == '\t' || b == '\n' || b == '\r' }
