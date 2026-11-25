package messenger

import (
	"encoding/json"
	"sort"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/lib/pq"
)

// ─── Message extras: one round trip ──────────────────────────────────────────
// A message page carries three satellite sets: attachments, reaction chips and
// the per-user voice "listened" marks. They used to cost three sequential
// queries per page (after the message query itself), i.e. four round trips
// before the list could paint.
//
// They are now fetched with ONE query that returns three JSON arrays, assembled
// in PostgreSQL. The JSON shapes are the API shapes, so a page costs three
// round trips in total: access, the message page, and this extras query.

type reactionRow struct {
	MessageID string    `json:"message_id"`
	Emoji     string    `json:"emoji"`
	UserID    string    `json:"user_id"`
	Username  string    `json:"username"`
	CreatedAt time.Time `json:"created_at"`
}

type voiceListenRow struct {
	MessageID string `json:"message_id"`
	UserID    string `json:"user_id"`
}

// buildReactionChips folds flat reaction rows into the per-message chip list:
// aggregated per emoji, popular first, `mine` resolved for the viewer, and ties
// kept in first-appearance order (Telegram's stable chip order).
func buildReactionChips(rows []reactionRow, viewerID string) map[string][]ReactionSummary {
	type chip struct {
		summary ReactionSummary
	}
	perMessage := make(map[string]map[string]*chip)
	order := make(map[string][]string)

	for _, row := range rows {
		chips := perMessage[row.MessageID]
		if chips == nil {
			chips = make(map[string]*chip)
			perMessage[row.MessageID] = chips
		}
		current := chips[row.Emoji]
		if current == nil {
			current = &chip{summary: ReactionSummary{Emoji: row.Emoji}}
			chips[row.Emoji] = current
			order[row.MessageID] = append(order[row.MessageID], row.Emoji)
		}
		current.summary.Count++
		if row.UserID == viewerID {
			current.summary.Mine = true
			at := row.CreatedAt.UTC().Format(time.RFC3339Nano)
			current.summary.MineAt = &at
		}
		current.summary.Users = append(current.summary.Users, ReactionUser{ID: row.UserID, Username: row.Username})
	}

	result := make(map[string][]ReactionSummary, len(perMessage))
	for messageID, chips := range perMessage {
		positions := make(map[string]int, len(order[messageID]))
		for at, emoji := range order[messageID] {
			positions[emoji] = at
		}
		list := make([]ReactionSummary, 0, len(chips))
		for _, emoji := range order[messageID] {
			list = append(list, chips[emoji].summary)
		}
		sort.SliceStable(list, func(i, j int) bool {
			if list[i].Count != list[j].Count {
				return list[i].Count > list[j].Count
			}
			return positions[list[i].Emoji] < positions[list[j].Emoji]
		})
		result[messageID] = list
	}
	return result
}

const messageExtrasQuery = `
	SELECT
		COALESCE((
			SELECT json_agg(json_build_object(
				'id', a.id, 'message_id', a.message_id, 'url', a.url, 'type', a.type,
				'name', a.name, 'size', a.size, 'mime', a.mime,
				-- meta is JSONB; the API field is a JSON *string* (clients do
				-- JSON.parse), so cast it to text instead of nesting the object.
				'meta', a.meta::text,
				'sort_order', a.sort_order
			) ORDER BY a.sort_order, a.id)
			FROM message_attachments a
			WHERE a.message_id = ANY($1::uuid[])
		), '[]'::json),
		COALESCE((
			SELECT json_agg(json_build_object(
				'message_id', r.message_id, 'emoji', r.emoji, 'user_id', r.user_id,
				'username', COALESCE(u.username, ''), 'created_at', r.created_at
			) ORDER BY r.created_at, r.id)
			FROM message_reactions r
			LEFT JOIN users u ON u.id = r.user_id
			WHERE r.message_id = ANY($1::uuid[])
		), '[]'::json),
		COALESCE((
			SELECT json_agg(json_build_object(
				'message_id', v.message_id, 'user_id', v.user_id
			) ORDER BY v.listened_at, v.message_id, v.user_id)
			FROM message_voice_listens v
			WHERE v.message_id = ANY($1::uuid[])
		), '[]'::json)`

// fetchMessageExtras loads attachments, reactions and voice-listen marks for a
// page in one query and returns them keyed by message id.
func (h *MessengerHandler) fetchMessageExtras(
	c *gin.Context,
	messageIDs []string,
	viewerID string,
) (attachments map[string][]Attachment, reactions map[string][]ReactionSummary, voice map[string][]string, err error) {
	attachments = make(map[string][]Attachment)
	reactions = make(map[string][]ReactionSummary)
	voice = make(map[string][]string)
	if len(messageIDs) == 0 {
		return attachments, reactions, voice, nil
	}

	var attachmentsJSON, reactionsJSON, voiceJSON []byte
	if err := h.dbFor(c).QueryRow(messageExtrasQuery, pq.Array(messageIDs)).Scan(
		&attachmentsJSON, &reactionsJSON, &voiceJSON,
	); err != nil {
		return nil, nil, nil, err
	}

	var attachmentRows []struct {
		ID        string  `json:"id"`
		MessageID string  `json:"message_id"`
		URL       string  `json:"url"`
		Type      string  `json:"type"`
		Name      string  `json:"name"`
		Size      int64   `json:"size"`
		Mime      string  `json:"mime"`
		Meta      *string `json:"meta"`
		SortOrder int     `json:"sort_order"`
	}
	if err := json.Unmarshal(attachmentsJSON, &attachmentRows); err != nil {
		return nil, nil, nil, err
	}
	for _, row := range attachmentRows {
		attachments[row.MessageID] = append(attachments[row.MessageID], Attachment{
			ID:        row.ID,
			URL:       row.URL,
			Type:      row.Type,
			Name:      row.Name,
			Size:      row.Size,
			Mime:      row.Mime,
			Meta:      row.Meta,
			SortOrder: row.SortOrder,
		})
	}

	var reactionRows []reactionRow
	if err := json.Unmarshal(reactionsJSON, &reactionRows); err != nil {
		return nil, nil, nil, err
	}
	reactions = buildReactionChips(reactionRows, viewerID)

	var voiceRows []voiceListenRow
	if err := json.Unmarshal(voiceJSON, &voiceRows); err != nil {
		return nil, nil, nil, err
	}
	for _, row := range voiceRows {
		voice[row.MessageID] = append(voice[row.MessageID], row.UserID)
	}

	return attachments, reactions, voice, nil
}
