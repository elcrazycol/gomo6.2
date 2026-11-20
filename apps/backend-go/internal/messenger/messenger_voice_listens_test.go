package messenger

import (
	"net/http"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── Voice "listened" state ────────────────────────────────────────────────

func TestMarkVoiceListened_MarksAndIsIdempotent(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/voice-listened",
		nil,
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// ON CONFLICT DO NOTHING keeps a second play from failing or duplicating.
	mock.ExpectExec(`INSERT INTO message_voice_listens \(message_id, user_id\)`).
		WithArgs(testMsg1, testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.MarkVoiceListened(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["listened"] != true {
		t.Fatalf("expected listened=true, got %v", data["listened"])
	}
}

func TestMarkVoiceListened_RejectsNonMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser999, Username: "outsider"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/voice-listened",
		nil,
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser999).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkVoiceListened(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestMarkVoiceListened_RejectsDeletedMessage(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/voice-listened",
		nil,
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkVoiceListened(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestVoiceListens_AttachedToThePage(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	// E2E mode check (regular conversation)
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("server"))

	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, " ", "text", nil, 0, nil, false, false, nil, "2026-08-20T10:00:00Z", "c1")

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)
	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at.*FROM message_reactions r`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "emoji", "user_id", "username", "created_at"}))
	mock.ExpectQuery(`SELECT message_id, user_id FROM message_voice_listens WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "user_id"}).
			AddRow(testMsg1, testUser1).
			AddRow(testMsg1, testUser2))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	first := data[0].(map[string]interface{})
	listeners, ok := first["voice_listened_by"].([]interface{})
	if !ok || len(listeners) != 2 {
		t.Fatalf("expected both listeners on the message, got %v", first["voice_listened_by"])
	}
}
