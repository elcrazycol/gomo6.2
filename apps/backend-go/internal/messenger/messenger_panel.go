package messenger

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/lib/pq"
)

// ─── Conversation panel ─────────────────────────────────────────────────────
// The chat-header profile panel needs two things the message stream cannot
// answer cheaply: whether this chat is muted, and the media/files already
// exchanged in it. Both are read paths of their own so opening the panel never
// walks the message history.

// maxSharedAttachments caps the shared-media page. The panel shows a compact
// grid; older items are a "show in chat" concern, not a download-everything
// one.
const maxSharedAttachments = 60

// SetMuted toggles the caller's own notification mute for a conversation.
//
//	PUT /api/v1/messenger/conversations/:id/mute
//	{"muted": true}
func (h *MessengerHandler) SetMuted(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if conversationID == "" || !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}

	var body struct {
		Muted *bool `json:"muted"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Muted == nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("muted is required"))
		return
	}

	if h.requireMember(c, conversationID, claims.UserID) == nil {
		return
	}

	res, err := h.dbFor(c).Exec(`
		UPDATE chat_members
		SET is_muted = $3
		WHERE conversation_id = $1 AND user_id = $2
	`, conversationID, claims.UserID, *body.Muted)
	if err != nil {
		httpx.ServerError(c, "set muted", err)
		return
	}
	// The membership check above already passed; a zero-row update here means
	// the row disappeared between the two statements (left the chat).
	if affected, _ := res.RowsAffected(); affected == 0 {
		c.JSON(http.StatusForbidden, models.ErrorResponse("Not a member of this conversation"))
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{"muted": *body.Muted}))
}

// SharedAttachment is one media/file row of the panel's shared grid.
type SharedAttachment struct {
	ID        string  `json:"id"`
	MessageID string  `json:"message_id"`
	URL       string  `json:"url"`
	Type      string  `json:"type"`
	Name      string  `json:"name"`
	Size      int64   `json:"size"`
	Mime      string  `json:"mime"`
	Meta      *string `json:"meta"`
	CreatedAt string  `json:"created_at"`
}

// ListSharedAttachments returns the newest media/files of one conversation.
//
//	GET /api/v1/messenger/conversations/:id/attachments?types=image,video&limit=60
//
// Privacy is the caller's membership check: only members reach the query, and
// the conversation id in the WHERE clause is what scopes the rows.
func (h *MessengerHandler) ListSharedAttachments(c *gin.Context) {
	claims := ensureAuth(c)
	if claims == nil {
		return
	}

	conversationID := c.Param("id")
	if conversationID == "" || !isUUID(conversationID) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid conversation_id"))
		return
	}
	if h.requireMember(c, conversationID, claims.UserID) == nil {
		return
	}

	limit := maxSharedAttachments
	if raw := c.Query("limit"); raw != "" {
		parsed, convErr := strconv.Atoi(raw)
		if convErr != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid limit"))
			return
		}
		if parsed < limit {
			limit = parsed
		}
	}
	types := []string{"image", "video", "audio", "file"}
	if raw := c.Query("types"); raw != "" {
		parsed, ok := parseAttachmentTypes(raw)
		if !ok {
			c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid types"))
			return
		}
		types = parsed
	}

	rows, err := h.dbFor(c).Query(`
		SELECT a.id, a.message_id, a.url, a.type, a.name, a.size, a.mime,
		       a.meta::text, m.sent_at
		FROM message_attachments a
		JOIN chat_messages m ON m.id = a.message_id
		WHERE m.conversation_id = $1
		  AND m.is_deleted = false
		  AND a.type = ANY($2)
		ORDER BY m.sent_at DESC, a.sort_order ASC, a.id ASC
		LIMIT $3
	`, conversationID, pq.Array(types), limit)
	if err != nil {
		httpx.ServerError(c, "list shared attachments", err)
		return
	}
	defer rows.Close()

	attachments := []SharedAttachment{}
	for rows.Next() {
		var item SharedAttachment
		if err := rows.Scan(
			&item.ID, &item.MessageID, &item.URL, &item.Type, &item.Name,
			&item.Size, &item.Mime, &item.Meta, &item.CreatedAt,
		); err != nil {
			httpx.ServerError(c, "scan shared attachment", err)
			return
		}
		attachments = append(attachments, item)
	}
	if err := rows.Err(); err != nil {
		httpx.ServerError(c, "iterate shared attachments", err)
		return
	}

	c.JSON(http.StatusOK, models.SuccessResponse(attachments))
}

// parseAttachmentTypes accepts a comma-separated allow-list, bounded to the
// four types the schema actually stores. Unknown values are rejected rather
// than silently dropped so a client typo cannot look like "no media".
func parseAttachmentTypes(raw string) ([]string, bool) {
	allowed := map[string]struct{}{"image": {}, "video": {}, "audio": {}, "file": {}}
	types := make([]string, 0, 4)
	for _, part := range splitCommaList(raw) {
		if _, ok := allowed[part]; !ok {
			return nil, false
		}
		types = append(types, part)
	}
	if len(types) == 0 {
		return nil, false
	}
	return types, true
}

// splitCommaList trims and drops empty segments.
func splitCommaList(raw string) []string {
	parts := make([]string, 0, 4)
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			parts = append(parts, trimmed)
		}
	}
	return parts
}
