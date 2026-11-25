package messenger

import (
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// ─── Conversation lifecycle ──────────────────────────────────────────────────
// Deleting or editing a message changes the conversation's last-message preview
// (what the chat list shows). The preview is a denormalised copy on
// chat_conversations, so these paths must recompute it in the same transaction
// — otherwise a deleted last message keeps living in the list forever.

// isNewestMessage reports whether messageID is the conversation's newest
// non-deleted message (the one the preview mirrors).
func (h *MessengerHandler) isNewestMessage(c *gin.Context, conversationID, messageID string) (bool, error) {
	var newest string
	err := h.dbFor(c).QueryRow(`
		SELECT id
		FROM chat_messages
		WHERE conversation_id = $1 AND is_deleted = false
		ORDER BY sent_at DESC, event_id DESC
		LIMIT 1
	`, conversationID).Scan(&newest)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return newest == messageID, nil
}

// refreshConversationPreview recomputes last_message_* from the newest
// surviving message. When no message survives, the fields are cleared, so the
// chat list shows an empty conversation instead of a ghost.
//
// Opaque conversations (notes / e2e) store the newest message's ciphertext
// verbatim: the client decrypts the preview locally, exactly like the message
// itself. Server-mode conversations are decrypted, truncated and re-encrypted,
// mirroring the send path.
func (h *MessengerHandler) refreshConversationPreview(c *gin.Context, conversationID string, opaque bool) error {
	var content, senderID string
	var sentAt time.Time
	err := h.dbFor(c).QueryRow(`
		SELECT content, sent_at, sender_user_id
		FROM chat_messages
		WHERE conversation_id = $1 AND is_deleted = false
		ORDER BY sent_at DESC, event_id DESC
		LIMIT 1
	`, conversationID).Scan(&content, &sentAt, &senderID)
	if err == sql.ErrNoRows {
		_, uerr := h.dbFor(c).Exec(`
			UPDATE chat_conversations
			SET last_message_preview = NULL,
			    last_message_at = NULL,
			    last_message_sender_id = NULL,
			    updated_at = NOW()
			WHERE id = $1
		`, conversationID)
		return uerr
	}
	if err != nil {
		return err
	}

	preview := content
	if !opaque {
		plain, derr := decryptContentForConversation(conversationID, content)
		if derr != nil {
			plain, derr = decryptContent(content)
		}
		if derr != nil {
			// Undecryptable (legacy/corrupt): keep the raw ciphertext so the
			// read path renders its neutral placeholder, never plaintext.
			preview = content
		} else {
			enc, eerr := EncryptContentForConversation(conversationID, truncatePreview(plain))
			if eerr != nil {
				return eerr
			}
			preview = enc
		}
	}

	_, err = h.dbFor(c).Exec(`
		UPDATE chat_conversations
		SET last_message_preview = $1,
		    last_message_at = $2,
		    last_message_sender_id = $3,
		    updated_at = NOW()
		WHERE id = $4
	`, preview, sentAt, senderID, conversationID)
	return err
}

// attachmentKeyRow is the projection needed to delete a message's files.
type attachmentKeyRow struct {
	URL  string
	Meta *string
}

// attachmentStorageKeys returns every S3 key a message's attachments own: the
// object itself plus the image preview derivative when present. Video posters
// are not recorded in attachment metadata (only animation/dimension flags), so
// nothing else is derivable here.
func attachmentStorageKeys(rows []attachmentKeyRow) []string {
	keys := make([]string, 0, len(rows)*2)
	for _, row := range rows {
		if row.URL != "" {
			keys = append(keys, row.URL)
		}
		if row.Meta == nil || *row.Meta == "" {
			continue
		}
		var meta struct {
			PreviewKey string `json:"preview_key"`
		}
		if json.Unmarshal([]byte(*row.Meta), &meta) != nil {
			continue
		}
		preview := strings.TrimSpace(meta.PreviewKey)
		if preview != "" && preview != row.URL {
			keys = append(keys, preview)
		}
	}
	return keys
}

// deleteMessageArtifacts removes everything that belongs to a message inside
// the request transaction: attachment metadata, reactions, voice-listening
// markers and per-message receipts. It also unpins the message when it was the
// conversation's pin (a pin must never point at a deleted row).
func (h *MessengerHandler) deleteMessageArtifacts(c *gin.Context, conversationID, messageID string) error {
	db := h.dbFor(c)
	if _, err := db.Exec(`DELETE FROM message_attachments WHERE message_id = $1`, messageID); err != nil {
		return err
	}
	if _, err := db.Exec(`DELETE FROM message_reactions WHERE message_id = $1`, messageID); err != nil {
		return err
	}
	if _, err := db.Exec(`DELETE FROM message_voice_listens WHERE message_id = $1`, messageID); err != nil {
		return err
	}
	if _, err := db.Exec(`DELETE FROM chat_receipts WHERE message_id = $1`, messageID); err != nil {
		return err
	}
	if _, err := db.Exec(`
		UPDATE chat_conversations
		SET pinned_message_id = NULL
		WHERE id = $1 AND pinned_message_id = $2
	`, conversationID, messageID); err != nil {
		return err
	}
	return nil
}

// recomputeUnreadForOthers recalculates the unread badge of every member but
// the deleter. The insert trigger only ever increments, so without this a
// deleted message would keep counting in the peer's badge until they open the
// chat. The recompute mirrors MarkRead: everything newer than the member's read
// line and not deleted.
func (h *MessengerHandler) recomputeUnreadForOthers(c *gin.Context, conversationID, senderID string) error {
	_, err := h.dbFor(c).Exec(`
		UPDATE chat_members cm
		SET unread_count = (
			SELECT COUNT(*)
			FROM chat_messages m
			WHERE m.conversation_id = cm.conversation_id
			  AND m.sender_user_id <> cm.user_id
			  AND m.is_deleted = false
			  AND (cm.last_read_at IS NULL OR m.sent_at > cm.last_read_at)
		)
		WHERE cm.conversation_id = $1 AND cm.user_id <> $2
	`, conversationID, senderID)
	return err
}

// deleteStorageObjects removes uploaded files after the transaction committed.
// Best-effort and bounded: a storage failure must never fail a delete the user
// already completed (the row is gone; the object is unreachable through the
// message anyway).
func (h *MessengerHandler) deleteStorageObjects(keys []string) {
	if h.storage == nil || len(keys) == 0 {
		return
	}
	for _, key := range keys {
		if err := h.storage.DeleteFile("uploads", key); err != nil {
			log.Printf("[Messenger] delete attachment object %q: %v", key, err)
		}
	}
}

// loadAttachmentKeys reads the attachment URLs + metadata of a message.
func (h *MessengerHandler) loadAttachmentKeys(c *gin.Context, messageID string) ([]attachmentKeyRow, error) {
	rows, err := h.dbFor(c).Query(
		`SELECT url, meta FROM message_attachments WHERE message_id = $1`, messageID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]attachmentKeyRow, 0, 2)
	for rows.Next() {
		var row attachmentKeyRow
		var meta sql.NullString
		if err := rows.Scan(&row.URL, &meta); err != nil {
			return nil, err
		}
		if meta.Valid {
			value := meta.String
			row.Meta = &value
		}
		result = append(result, row)
	}
	return result, rows.Err()
}
