package messenger

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/lib/pq"
)

// ─── GetMessages ─────────────────────────────────────────────────────────────

func TestGetMessages_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).
		AddRow(int64(2), testMsg2, testConv1, testUser2, "bob", nil, "Hi!", "text", nil, 0, nil, false, false, nil, now.Add(time.Minute), "c2").
		AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "Hello!", "text", nil, 0, nil, false, false, nil, now, "c1")

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	// One extras query: attachments + reactions + voice listens.
	expectMessageExtras(mock, pq.Array([]string{testMsg2, testMsg1}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	if first["id"] != testMsg1 {
		t.Fatalf("expected oldest first (msg-1), got %v", first["id"])
	}
}

func TestGetMessages_ReactionLookupFailure(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "Hello!", "text", nil, 0, nil, false, false, nil, now, "c1")

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	// The extras query fails: the page must not be served.
	mock.ExpectQuery(`SELECT\s+COALESCE\(\(`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnError(errReactionInsert)

	handler.GetMessages(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 when the chips cannot be loaded, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetMessages_WithBefore(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", map[string]string{"before": testMsg5, "limit": "10"}, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(3), testMsg3, testConv1, testUser1, "testuser", nil, "Third", "text", nil, 0, nil, false, false, nil, now, "c3")

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1 AND m.sent_at < \(.*SELECT sent_at FROM chat_messages WHERE id = \$2.*ORDER BY m.sent_at DESC.*LIMIT \$3`).
		WithArgs(testConv1, testMsg5, 10).
		WillReturnRows(msgRows)

	// One extras query: attachments + reactions + voice listens.
	expectMessageExtras(mock, pq.Array([]string{testMsg3}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetMessages_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// Not a member: RLS makes the conversation row invisible.
	expectNoConversationAccess(mock, testConv1, testUser1)
	handler.GetMessages(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGetMessages_Empty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id.*FROM chat_messages m.*`).
		WithArgs(testConv1, 50).
		WillReturnRows(sqlmock.NewRows([]string{"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id", "content", "is_edited", "is_deleted", "edited_at", "sent_at", "client_id"}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected 0 messages, got %d", len(data))
	}
}

func TestGetMessages_DecryptionFailureNoCiphertextLeak(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "not-a-valid-ciphertext!", "text", nil, 0, nil, false, false, nil, now, "c1")

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	// One extras query: attachments + reactions + voice listens.
	expectMessageExtras(mock, pq.Array([]string{testMsg1}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 message, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	content := first["content"]
	if content == "not-a-valid-ciphertext!" {
		t.Fatal("ciphertext must never be returned to the client")
	}
	if content != crypto.DecryptionFailedPlaceholder {
		t.Errorf("expected placeholder %q, got %v", crypto.DecryptionFailedPlaceholder, content)
	}
}

func TestGetMessages_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})

	handler.GetMessages(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── SendMessage ─────────────────────────────────────────────────────────────

func TestSendMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "Hello, world!", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Transaction Begin

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectBegin()

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(10), "20000000-0000-0000-0000-000000000010", testConv1, testUser1, nil, "Hello, world!", "text", nil, 0, nil, false, false, nil, now, testClientID1)

	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID1, nil, "text", nil, 0, nil).
		WillReturnRows(msgRows)

	mock.ExpectExec(`UPDATE chat_conversations.*SET last_message_preview = \$1, last_message_sender_id = \$2, updated_at = NOW\(\).*WHERE id = \$3`).
		WithArgs(sqlmock.AnyArg(), testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Transaction Commit
	mock.ExpectCommit()

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_EmptyContent(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "   ", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestSendMessage_HtmlRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "<script>alert('xss')</script>", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Not a member: RLS makes the conversation row invisible.
	expectNoConversationAccess(mock, testConv1, testUser1)
	handler.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSendMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, nil, map[string]string{"id": testConv1})

	handler.SendMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestSendMessage_Duplicate(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID2}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Transaction Begin

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectBegin()

	// Insert fails with duplicate key error
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID2, nil, "text", nil, 0, nil).
		WillReturnError(sqlmock.ErrCancelled)

	// Transaction Rollback (deferred)
	mock.ExpectRollback()

	handler.SendMessage(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for non-duplicate error, got %d", w.Code)
	}
}

// ─── EditMessage ─────────────────────────────────────────────────────────────

func TestEditMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4, enc_v = \$5, enc_alg = \$6, is_edited = true`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg(), 0, nil).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.EditMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["updated"] != true {
		t.Fatalf("expected updated=true, got %v", data["updated"])
	}
}

func TestEditMessage_EmptyContent(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "   "}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestEditMessage_HtmlRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "<b>bold</b>"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000999", body, claims, map[string]string{"id": testConv1, "msgId": testMsg999})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET content.*WHERE id = \$1 AND conversation_id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs(testMsg999, testConv1, testUser1, sqlmock.AnyArg(), 0, nil).
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.EditMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestEditMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := EditMessageRequest{Content: "Edited"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, nil, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.EditMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestEditMessage_DBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg(), 0, nil).
		WillReturnError(sqlmock.ErrCancelled)

	handler.EditMessage(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── DeleteMessage ───────────────────────────────────────────────────────────

// expectDeleteCascade mocks the satellite cleanup of a deleted message.
func expectDeleteCascade(mock sqlmock.Sqlmock, messageID string) {
	mock.ExpectExec(`DELETE FROM message_attachments WHERE message_id = \$1`).
		WithArgs(messageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1`).
		WithArgs(messageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM message_voice_listens WHERE message_id = \$1`).
		WithArgs(messageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`DELETE FROM chat_receipts WHERE message_id = \$1`).
		WithArgs(messageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE chat_conversations\s+SET pinned_message_id = NULL`).
		WithArgs(testConv1, messageID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`UPDATE chat_members cm\s+SET unread_count =`).
		WithArgs(testConv1, testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func TestDeleteMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	sentAt := time.Now().Add(-time.Minute)
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")

	// Ownership check.
	mock.ExpectQuery(`SELECT EXISTS\(\s+SELECT 1 FROM chat_messages`).
		WithArgs(testMsg1, testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Storage keys are read BEFORE the rows disappear.
	mock.ExpectQuery(`SELECT url, meta FROM message_attachments WHERE message_id = \$1`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"url", "meta"}).
			AddRow(testUser1+"/messenger/a.jpg", `{"preview_key":"`+testUser1+`/messenger/a.jpg.preview.jpg"}`))

	// The row is wiped: no content, no payload, no envelope.
	mock.ExpectExec(`UPDATE chat_messages\s+SET is_deleted = true,`).
		WithArgs(testMsg1, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	expectDeleteCascade(mock, testMsg1)

	// The preview is recomputed from the newest surviving message.
	mock.ExpectQuery(`SELECT content, sent_at, sender_user_id\s+FROM chat_messages`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"content", "sent_at", "sender_user_id"}).
			AddRow("ciphertext-of-previous", sentAt, testUser2))
	mock.ExpectExec(`UPDATE chat_conversations\s+SET last_message_preview = \$1`).
		WithArgs(sqlmock.AnyArg(), sentAt, testUser2, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeleteMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteMessage_ClearsPreviewWhenConversationBecomesEmpty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(\s+SELECT 1 FROM chat_messages`).
		WithArgs(testMsg1, testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT url, meta FROM message_attachments WHERE message_id = \$1`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"url", "meta"}))
	mock.ExpectExec(`UPDATE chat_messages\s+SET is_deleted = true,`).
		WithArgs(testMsg1, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectDeleteCascade(mock, testMsg1)

	// No message survives → the preview fields are cleared.
	mock.ExpectQuery(`SELECT content, sent_at, sender_user_id\s+FROM chat_messages`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"content", "sent_at", "sender_user_id"}))
	mock.ExpectExec(`UPDATE chat_conversations\s+SET last_message_preview = NULL`).
		WithArgs(testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeleteMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestDeleteMessage_CannotDeleteSomeoneElsesMessage(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000002", nil, map[string]string{"id": testConv1, "msgId": testMsg2})
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")

	// The message exists but belongs to the peer.
	mock.ExpectQuery(`SELECT EXISTS\(\s+SELECT 1 FROM chat_messages`).
		WithArgs(testMsg2, testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.DeleteMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for someone else's message, got %d", w.Code)
	}
}

func TestDeleteMessage_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	expectNoConversationAccess(mock, testConv1, testUser1)

	handler.DeleteMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestDeleteMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.DeleteMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── Notes (client-side E2E self-chat) ───────────────────────────────────────

func TestSendMessage_NotesE2E(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	ciphertext := "e2enote1:abcdefghijklmnopqrstuvwxyz0123456789"
	body := SendMessageRequest{Content: ciphertext, ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Transaction Begin

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	mock.ExpectBegin()

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(10), "20000000-0000-0000-0000-000000000010", testConv1, testUser1, nil, ciphertext, "text", nil, 0, nil, false, false, nil, now, testClientID1)

	// The client ciphertext must be stored verbatim — never server-encrypted.
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, ciphertext, testClientID1, nil, "text", nil, 0, nil).
		WillReturnRows(msgRows)

	// The preview is the full client ciphertext (truncating would break GCM).
	mock.ExpectExec(`UPDATE chat_conversations.*SET last_message_preview = \$1, last_message_sender_id = \$2, updated_at = NOW\(\).*WHERE id = \$3`).
		WithArgs(ciphertext, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Transaction Commit
	mock.ExpectCommit()

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	// The response echoes the ciphertext (the device decrypts locally).
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["content"] != ciphertext {
		t.Errorf("expected ciphertext echoed back, got %v", data["content"])
	}
}

func TestSendMessage_NotesRejectsNonMarkedPayload(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "plaintext must never reach the server", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unmarked notes payload, got %d", w.Code)
	}
}

func TestGetMessages_NotesCiphertextPassthrough(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// It IS the notes self-chat: content and metadata must pass through undecrypted.
	ciphertext := "e2enote1:abcdefghijklmnopqrstuvwxyz0123456789"
	metaBlob := "e2enote1:0123456789abcdefghijklmnopqrstuvwxyz"

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id", "notes_meta",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, ciphertext, "text", nil, 0, nil, false, false, nil, now, "c1", metaBlob)

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	// One extras query: attachments + reactions + voice listens.
	expectMessageExtras(mock, pq.Array([]string{testMsg1}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 message, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	if first["content"] != ciphertext {
		t.Errorf("expected ciphertext passthrough for notes, got %v", first["content"])
	}
	if first["notes_meta"] != metaBlob {
		t.Errorf("expected notes_meta passthrough for notes, got %v", first["notes_meta"])
	}
}

func TestEditMessage_NotesE2E(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	ciphertext := "e2enote1:zyxwvutsrqponmlkjihgfedcba0123456789"
	body := EditMessageRequest{Content: ciphertext}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Ciphertext is stored verbatim, never server-encrypted.

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4, enc_v = \$5, enc_alg = \$6, is_edited = true`).
		WithArgs(testMsg1, testConv1, testUser1, ciphertext, 0, nil).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.EditMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

// ─── UpdateNotesMeta ─────────────────────────────────────────────────────────

func TestUpdateNotesMeta_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	meta := "e2enote1:abcdef0123456789abcdef0123456789"
	body := UpdateNotesMetaRequest{Meta: meta}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// The client E2E blob is stored verbatim — never server-encrypted.

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET notes_meta = \$1.*WHERE id = \$2 AND conversation_id = \$3 AND sender_user_id = \$4 AND is_deleted = false`).
		WithArgs(meta, testMsg1, testConv1, testUser1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["updated"] != true {
		t.Fatalf("expected updated=true, got %v", data["updated"])
	}
}

func TestUpdateNotesMeta_NotNotesRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := UpdateNotesMetaRequest{Meta: "e2enote1:abcdef0123456789abcdef0123456789"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-notes conversation, got %d", w.Code)
	}
}

func TestUpdateNotesMeta_UnmarkedRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := UpdateNotesMetaRequest{Meta: "plaintext metadata must never reach the server"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unmarked notes meta, got %d", w.Code)
	}
}

func TestUpdateNotesMeta_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	meta := "e2enote1:abcdef0123456789abcdef0123456789"
	body := UpdateNotesMetaRequest{Meta: meta}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000999/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg999})

	// Conversation access: membership + kind + encryption mode in one query.
	expectConversationAccess(mock, testConv1, testUser1, "", false, true, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET notes_meta = \$1.*`).
		WithArgs(meta, testMsg999, testConv1, testUser1).
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestUpdateNotesMeta_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := UpdateNotesMetaRequest{Meta: "e2enote1:abcdef0123456789abcdef0123456789"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, nil, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── Peer block: the blocked side sees an erased chat ───────────────────────

func TestGetMessages_PeerBlockedReturnsEmptyWithoutQuery(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages",
		nil,
		map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	expectConversationAccessPeerBlocked(mock, testConv1, testUser1, testUser2)

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("a blocked chat must read as empty, got %d messages", len(data))
	}
}

func TestSendMessage_PeerBlockedAcknowledgesButStoresNothing(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "you will never read this", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages",
		body, claims, map[string]string{"id": testConv1},
	)

	expectConversationAccessPeerBlocked(mock, testConv1, testUser1, testUser2)

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("a blocked send must look successful, got %d: %s", w.Code, w.Body.String())
	}
	// No BEGIN/INSERT/COMMIT expectations were registered: sqlmock fails the
	// test if the handler touches the database. The ack echoes the message.
	msg, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if msg["content"] != "you will never read this" {
		t.Fatalf("expected the echo content, got %v", msg["content"])
	}
	if msg["client_id"] != testClientID1 {
		t.Fatalf("expected the client id echo, got %v", msg["client_id"])
	}
	if id, _ := msg["id"].(string); id == "" {
		t.Fatal("expected a synthetic message id")
	}
}
