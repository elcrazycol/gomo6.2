package messenger

import (
	"context"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// ─── Server-authored service notifications ───────────────────────────────────
// The notification account (@gomo6) can never act through the HTTP surface,
// so its messages are authored here, inside the trust boundary: a system
// thread per recipient, encrypted with the same server key as ordinary
// messages, fanned out over WS + push like any other chat message.
// Recipients cannot reply (service dialogs reject sends), and the account
// itself cannot read anything (no membership is ever usable: messenger routes
// and WS rooms refuse it outright).

// SendServiceNotification delivers a plaintext notification from the service
// account to exactly one user. Best-effort: returns an error only for
// programming/config faults (unknown service account); per-message failures
// are logged and swallowed by callers.
func (h *MessengerHandler) SendServiceNotification(serviceID, recipientID, text string) error {
	text = strings.TrimSpace(text)
	if serviceID == "" || recipientID == "" || text == "" || serviceID == recipientID {
		return fmt.Errorf("service notify: bad arguments")
	}
	if h.db == nil {
		return fmt.Errorf("service notify: no database")
	}
	if len([]rune(text)) > 2000 {
		text = string([]rune(text)[:2000])
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("service notify: begin: %w", err)
	}
	defer tx.Rollback()

	// Act as the service account for RLS (mirrors MessengerTransactionMiddleware).
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, true)", serviceID); err != nil {
		return fmt.Errorf("service notify: set_config: %w", err)
	}

	var convID string
	if err := tx.QueryRowContext(ctx, "SELECT find_or_create_conversation($1, $2)", serviceID, recipientID).Scan(&convID); err != nil {
		return fmt.Errorf("service notify: find_or_create: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE chat_conversations SET is_service = true WHERE id = $1`, convID); err != nil {
		return fmt.Errorf("service notify: mark service: %w", err)
	}

	encrypted, err := EncryptContentForConversation(convID, text)
	if err != nil {
		return fmt.Errorf("service notify: encrypt: %w", err)
	}
	clientID := "svc-" + uuid.New().String()
	var msgID string
	var sentAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id, parent_message_id)
		VALUES ($1, $2, $3, $4, NULL)
		ON CONFLICT (conversation_id, client_id) DO NOTHING
		RETURNING id, sent_at
	`, convID, serviceID, encrypted, clientID).Scan(&msgID, &sentAt)
	if err != nil {
		return fmt.Errorf("service notify: insert: %w", err)
	}

	preview, err := EncryptContentForConversation(convID, truncatePreview(text))
	if err != nil {
		return fmt.Errorf("service notify: encrypt preview: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE chat_conversations
		SET last_message_preview = $1, last_message_sender_id = $2, last_message_at = NOW(), updated_at = NOW()
		WHERE id = $3
	`, preview, serviceID, convID); err != nil {
		return fmt.Errorf("service notify: preview: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("service notify: commit: %w", err)
	}

	// Fan-out after commit: WS broadcast (ciphertext only on the wire),
	// unread-badge invalidation, and a push like any ordinary message.
	payload := gin.H{
		"id":                msgID,
		"conversation_id":   convID,
		"sender_user_id":    serviceID,
		"parent_message_id": nil,
		"is_edited":         false,
		"is_deleted":        false,
		"edited_at":         nil,
		"sent_at":           sentAt,
		"client_id":         clientID,
		"sender_username":   "gomo6",
		"encrypted_content": encrypted,
	}
	if h.hub != nil {
		publishPool.Go(func() {
			if err := h.hub.PublishNewChatMessage(payload); err != nil {
				log.Printf("[Messenger] service notify broadcast error: %v", err)
			}
		})
	}
	if h.redis != nil {
		publishPool.Go(func() { InvalidateMessengerCaches(h.redis, convID, recipientID) })
	}
	publishPool.Go(func() {
		h.deliverMessagePush(context.Background(), convID, serviceID, "gomo6", messagePushBody(text, false))
	})
	return nil
}
