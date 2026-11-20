package messenger

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
)

// ─── Integration write path ──────────────────────────────────────────────────
// Gifts (and any future server-authored chat entry) must write through the
// messenger package, not with their own INSERT:
//
//   - the write needs the RLS binding (app.current_user_id), which only a
//     transaction opened here can scope with SET LOCAL;
//   - the conversation preview must be encrypted with the conversation key
//     (a plaintext 'Подарок' preview used to decrypt to the placeholder);
//   - the realtime frame, the attachment-free message shape and the typed
//     envelope are the messenger's contract, and a second writer drifts.
//
// E2E conversations are deliberately skipped: the server cannot produce client
// ciphertext, so an integration entry there would have to be plaintext. The
// caller still delivers its own notification; the chat stays untouched.

// DeliverIntegrationMessage inserts a server-authored message between two
// users' 1:1 conversation and returns it (nil when the conversation is E2E).
// idempotencyKey deduplicates a retried delivery: the same key returns the
// existing message instead of a duplicate bubble. Empty generates a random one.
func (h *MessengerHandler) DeliverIntegrationMessage(
	ctx context.Context,
	senderID, recipientID, content, msgType string, payload json.RawMessage,
	idempotencyKey string,
) (*MessageResponse, error) {
	if h.db == nil {
		return nil, fmt.Errorf("integration message: no database")
	}
	if senderID == "" || recipientID == "" || senderID == recipientID || content == "" {
		return nil, fmt.Errorf("integration message: bad arguments")
	}
	if msgType == "" {
		msgType = "system"
	}

	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	// Act as the sender for RLS (mirrors MessengerTransactionMiddleware).
	if _, err := tx.ExecContext(ctx, "SELECT set_config('app.current_user_id', $1, true)", senderID); err != nil {
		return nil, err
	}

	var convID string
	if err := tx.QueryRowContext(ctx, "SELECT find_or_create_conversation($1, $2)", senderID, recipientID).Scan(&convID); err != nil {
		return nil, fmt.Errorf("integration message: find_or_create: %w", err)
	}

	// A block is absolute: even a purchased gift must not inject a chat bubble
	// into a conversation the recipient has cut off. The gift itself is already
	// recorded and notified by the caller.
	var blocked bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM user_blocks
			WHERE (blocker_id = $1 AND blocked_id = $2)
			   OR (blocker_id = $2 AND blocked_id = $1)
		)`, senderID, recipientID).Scan(&blocked); err != nil {
		return nil, err
	}
	if blocked {
		return nil, nil
	}

	// E2E chats cannot hold a server-authored entry (see the package comment).
	var encryptionMode string
	if err := tx.QueryRowContext(ctx,
		`SELECT COALESCE(encryption_mode, 'server') FROM chat_conversations WHERE id = $1`, convID,
	).Scan(&encryptionMode); err != nil {
		return nil, err
	}
	if encryptionMode == encryptionModeE2E {
		return nil, nil
	}

	encrypted, err := EncryptContentForConversation(convID, content)
	if err != nil {
		return nil, fmt.Errorf("integration message: encrypt: %w", err)
	}

	clientID := idempotencyKey
	if clientID == "" {
		random := make([]byte, 8)
		if _, err := rand.Read(random); err != nil {
			return nil, fmt.Errorf("integration message: random id: %w", err)
		}
		clientID = fmt.Sprintf("intg_%s_%x", msgType, random)
	}
	var msgID, eventID string
	var sentAt time.Time
	err = tx.QueryRowContext(ctx, `
		INSERT INTO chat_messages (conversation_id, sender_user_id, content, client_id, type, payload)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb)
		ON CONFLICT (conversation_id, client_id) DO NOTHING
		RETURNING id, event_id, sent_at
	`, convID, senderID, encrypted, clientID, msgType, nullableJSON(payload)).Scan(&msgID, &eventID, &sentAt)
	if err == sql.ErrNoRows {
		// A retry with the same idempotency key: the bubble already exists, so
		// return it instead of inventing a duplicate or failing the caller.
		if lookupErr := tx.QueryRowContext(ctx, `
			SELECT id, event_id, sent_at FROM chat_messages
			WHERE conversation_id = $1 AND client_id = $2
		`, convID, clientID).Scan(&msgID, &eventID, &sentAt); lookupErr == nil {
			if commitErr := tx.Commit(); commitErr != nil {
				return nil, fmt.Errorf("integration message: commit: %w", commitErr)
			}
			return &MessageResponse{
				ID:             msgID,
				EventID:        eventID,
				ConversationID: convID,
				SenderUserID:   senderID,
				Type:           msgType,
				Content:        content,
				SentAt:         sentAt.UTC().Format(time.RFC3339Nano),
				ClientID:       clientID,
				Payload:        payload,
			}, nil
		}
	}
	if err != nil {
		return nil, fmt.Errorf("integration message: insert: %w", err)
	}

	preview, err := EncryptContentForConversation(convID, truncatePreview(content))
	if err != nil {
		return nil, fmt.Errorf("integration message: encrypt preview: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE chat_conversations
		SET last_message_preview = $1,
		    last_message_sender_id = $2,
		    last_message_at = $3,
		    updated_at = NOW()
		WHERE id = $4
	`, preview, senderID, sentAt, convID); err != nil {
		return nil, fmt.Errorf("integration message: preview: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("integration message: commit: %w", err)
	}

	msg := &MessageResponse{
		ID:             msgID,
		EventID:        eventID,
		ConversationID: convID,
		SenderUserID:   senderID,
		Type:           msgType,
		Content:        content,
		SentAt:         sentAt.UTC().Format(time.RFC3339Nano),
		ClientID:       clientID,
	}
	if len(payload) > 0 && string(payload) != "null" {
		msg.Payload = payload
	}

	// Realtime fan-out (ciphertext only on the wire).
	if h.hub != nil {
		frame := map[string]interface{}{
			"id":                msgID,
			"event_id":          eventID,
			"conversation_id":   convID,
			"sender_user_id":    senderID,
			"parent_message_id": nil,
			"type":              msgType,
			"is_edited":         false,
			"is_deleted":        false,
			"edited_at":         nil,
			"sent_at":           sentAt,
			"client_id":         clientID,
			"encrypted_content": encrypted,
			"recipient_ids":     []string{senderID, recipientID},
		}
		if msg.Payload != nil {
			frame["payload"] = msg.Payload
		}
		publishPool.Go(func() {
			if err := h.hub.PublishNewChatMessage(frame); err != nil {
				// Persistence already succeeded; realtime delivery is best effort.
				_ = err
			}
		})
	}
	return msg, nil
}

// nullableJSON maps an empty/`null` payload to a SQL NULL.
func nullableJSON(payload json.RawMessage) interface{} {
	if len(payload) == 0 || string(payload) == "null" {
		return nil
	}
	return string(payload)
}
