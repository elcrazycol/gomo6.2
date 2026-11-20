package messenger

import (
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/httpx"
	"github.com/gomo6/backend/internal/models"
	"github.com/gomo6/backend/internal/websocket"
)

// ─── Message reactions ──────────────────────────────────────────────────────
// A reaction is (message, user, emoji). Telegram's model: long-press shows a
// curated set, a double-tap applies the quick one, and a tap on a chip toggles
// your own. The server keeps one row per triple, so a user may hold several
// different reactions on the same message (up to maxReactionsPerUser) and the
// same emoji from different people aggregates into one chip.

const (
	// How many different reactions one person may hold on one message. Telegram
	// caps it (1 free / 3 premium) and, when the cap is reached, a new reaction
	// REPLACES the oldest one instead of being refused — see ToggleReaction.
	maxReactionsPerUser = 3
	// A reaction chip's payload is a single emoji (a ZWJ sequence can be a few
	// runes); anything longer is not an emoji and would break the chip layout.
	maxReactionRunes = 8
	maxReactionBytes = 48
)

// ReactionUser is one person behind a chip, for the "who reacted" affordance.
type ReactionUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
}

// ReactionSummary is one chip: an emoji, how many people chose it and whether
// the viewer is one of them (`mine` is viewer-specific and is therefore never
// broadcast — realtime carries deltas instead).
type ReactionSummary struct {
	Emoji string         `json:"emoji"`
	Count int            `json:"count"`
	Mine  bool           `json:"mine"`
	Users []ReactionUser `json:"users"`
	// MineAt is when the VIEWER chose this emoji (RFC3339). It is what the
	// per-message cap evicts by, so the client can predict the eviction exactly
	// instead of guessing.
	MineAt *string `json:"mine_at,omitempty"`
}

// validReactionEmoji accepts a single, printable emoji-ish grapheme and rejects
// control characters, whitespace and anything long enough to break the chip.
func validReactionEmoji(emoji string) bool {
	if emoji == "" || len(emoji) > maxReactionBytes {
		return false
	}
	runes := 0
	for _, r := range emoji {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return false
		}
		// Tags and variation selectors are part of a sequence; letters would
		// let a reaction be plain text.
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsPunct(r) {
			return false
		}
		runes++
	}
	return runes > 0 && runes <= maxReactionRunes
}

// fetchReactionsForMessages returns the chips of a page of messages in one
// query, grouped and ordered by popularity (Telegram's chip order), with `mine`
// resolved for the viewer.
func (h *MessengerHandler) fetchReactionsForMessages(c *gin.Context, messageIDs []string, viewerID string) (map[string][]ReactionSummary, error) {
	if len(messageIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(messageIDs))
	args := make([]interface{}, len(messageIDs))
	for i, id := range messageIDs {
		placeholders[i] = "$" + strconv.Itoa(i+1)
		args[i] = id
	}

	rows, err := h.dbFor(c).Query(`
		SELECT r.message_id, r.emoji, r.user_id, COALESCE(u.username, ''), r.created_at
		FROM message_reactions r
		LEFT JOIN users u ON u.id = r.user_id
		WHERE r.message_id IN (`+strings.Join(placeholders, ",")+`)
		ORDER BY r.created_at ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type chip struct {
		summary ReactionSummary
	}
	perMessage := make(map[string]map[string]*chip)
	order := make(map[string][]string)

	for rows.Next() {
		var messageID, emoji, userID, username string
		var createdAt time.Time
		if err := rows.Scan(&messageID, &emoji, &userID, &username, &createdAt); err != nil {
			return nil, err
		}
		chips := perMessage[messageID]
		if chips == nil {
			chips = make(map[string]*chip)
			perMessage[messageID] = chips
		}
		current := chips[emoji]
		if current == nil {
			current = &chip{summary: ReactionSummary{Emoji: emoji}}
			chips[emoji] = current
			order[messageID] = append(order[messageID], emoji)
		}
		current.summary.Count++
		if userID == viewerID {
			current.summary.Mine = true
			at := createdAt.UTC().Format(time.RFC3339Nano)
			current.summary.MineAt = &at
		}
		current.summary.Users = append(current.summary.Users, ReactionUser{ID: userID, Username: username})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result := make(map[string][]ReactionSummary, len(perMessage))
	for messageID, chips := range perMessage {
		list := make([]ReactionSummary, 0, len(chips))
		for _, emoji := range order[messageID] {
			list = append(list, chips[emoji].summary)
		}
		// Popularity first, then the order the reactions first appeared — the
		// same stable order Telegram keeps while counts change.
		positions := make(map[string]int, len(order[messageID]))
		for at, emoji := range order[messageID] {
			positions[emoji] = at
		}
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].Count != list[j].Count {
				return list[i].Count > list[j].Count
			}
			return positions[list[i].Emoji] < positions[list[j].Emoji]
		})
		result[messageID] = list
	}
	return result, nil
}

// addReactionsToMessages attaches the chips to a page of messages in place.
func (h *MessengerHandler) addReactionsToMessages(c *gin.Context, messages []MessageResponse) error {
	if len(messages) == 0 {
		return nil
	}
	viewerID := ""
	if claims := getClaims(c); claims != nil {
		viewerID = claims.UserID
	}
	ids := make([]string, len(messages))
	for i := range messages {
		ids[i] = messages[i].ID
	}
	summaries, err := h.fetchReactionsForMessages(c, ids, viewerID)
	if err != nil {
		return err
	}
	for i := range messages {
		if chips, ok := summaries[messages[i].ID]; ok {
			messages[i].Reactions = chips
		}
	}
	return nil
}

// broadcastReaction fans a delta out to the conversation room. The payload is a
// delta — not a summary — because `mine` is viewer-specific: every client folds
// the event into its own chips and recomputes its own flag.
func (h *MessengerHandler) broadcastReaction(conversationID, messageID, emoji, userID, username, action string) {
	if h.hub == nil {
		return
	}
	payload := map[string]interface{}{
		"message_id":      messageID,
		"conversation_id": conversationID,
		"emoji":           emoji,
		"user_id":         userID,
		"username":        username,
		"action":          action,
		"event":           "message_reaction",
	}
	if memberIDs := h.listConversationMemberIDs(conversationID); len(memberIDs) > 0 {
		payload["recipient_ids"] = memberIDs
	}
	if err := h.hub.PublishToRedis(websocket.RedisChannelChat, websocket.RealtimeEvent{
		Type:    "message_reaction",
		Payload: payload,
	}); err != nil {
		log.Printf("[Messenger] WS reaction broadcast error: %v", err)
	}
}

// ToggleReaction godoc
// @Summary      Toggle a message reaction
// @Description  Adds the emoji if the caller has not chosen it, removes it otherwise. Returns the message's chips.
// @Tags         Messenger
// @Accept       json
// @Produce      json
// @Param        id path string true "Conversation ID"
// @Param        msgId path string true "Message ID"
// @Param        request body ToggleReactionRequest true "Emoji"
// @Success      200 {object} models.APIResponse
// @Failure      400 {object} models.APIResponse
// @Failure      403 {object} models.APIResponse
// @Failure      404 {object} models.APIResponse
// @Failure      409 {object} models.APIResponse
// @Router       /messenger/conversations/{id}/messages/{msgId}/reactions [post]
// @Security     BearerAuth
func (h *MessengerHandler) ToggleReaction(c *gin.Context) {
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

	var req ToggleReactionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("emoji is required"))
		return
	}
	emoji := strings.TrimSpace(req.Emoji)
	if !validReactionEmoji(emoji) {
		c.JSON(http.StatusBadRequest, models.ErrorResponse("Invalid emoji"))
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

	// Toggle: the delete decides it. A row that was there is gone (remove);
	// otherwise it is inserted (add) unless the per-user ceiling is reached.
	result, err := h.dbFor(c).Exec(
		"DELETE FROM message_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3",
		messageID, claims.UserID, emoji,
	)
	if err != nil {
		httpx.ServerError(c, "remove reaction", err)
		return
	}
	removed, _ := result.RowsAffected()
	action := "add"

	if removed == 0 {
		var held int
		if err := h.dbFor(c).QueryRow(
			"SELECT COUNT(*) FROM message_reactions WHERE message_id = $1 AND user_id = $2",
			messageID, claims.UserID,
		).Scan(&held); err != nil {
			httpx.ServerError(c, "count reactions", err)
			return
		}
		if held >= maxReactionsPerUser {
			// Telegram's model: at the cap, the new reaction replaces the OLDEST
			// one you hold. Refusing would make a tap on a peer's chip do nothing
			// at all — from the outside indistinguishable from a broken button.
			if _, err := h.dbFor(c).Exec(`
				DELETE FROM message_reactions
				WHERE id = (
					SELECT id FROM message_reactions
					WHERE message_id = $1 AND user_id = $2
					ORDER BY created_at ASC
					LIMIT 1
				)`, messageID, claims.UserID,
			); err != nil {
				httpx.ServerError(c, "replace oldest reaction", err)
				return
			}
		}

		if _, err := h.dbFor(c).Exec(
			`INSERT INTO message_reactions (message_id, conversation_id, user_id, emoji)
			 VALUES ($1, $2, $3, $4)
			 ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
			messageID, conversationID, claims.UserID, emoji,
		); err != nil {
			httpx.ServerError(c, "add reaction", err)
			return
		}
	} else {
		action = "remove"
	}

	summaries, err := h.fetchReactionsForMessages(c, []string{messageID}, claims.UserID)
	if err != nil {
		httpx.ServerError(c, "load reactions", err)
		return
	}

	queueAfterCommit(c, func() {
		publishPool.Go(func() {
			h.broadcastReaction(conversationID, messageID, emoji, claims.UserID, claims.Username, action)
		})
	})

	chips := summaries[messageID]
	if chips == nil {
		// An empty array, not null: the client replaces the chips wholesale.
		chips = []ReactionSummary{}
	}

	c.JSON(http.StatusOK, models.SuccessResponse(gin.H{
		"message_id": messageID,
		"action":     action,
		"reactions":  chips,
	}))
}
