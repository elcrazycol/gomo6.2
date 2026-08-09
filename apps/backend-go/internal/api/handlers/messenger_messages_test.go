package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
)

// ─── GetMessages ─────────────────────────────────────────────────────────────

func TestGetMessages_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Notes check (regular conversation)
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).
		AddRow(int64(2), testMsg2, testConv1, testUser2, "bob", nil, "Hi!", false, false, nil, now.Add(time.Minute), "c2").
		AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "Hello!", false, false, nil, now, "c1")

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	// Attachments query (empty result)
	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg2, testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))

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

func TestGetMessages_WithBefore(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", map[string]string{"before": testMsg5, "limit": "10"}, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(3), testMsg3, testConv1, testUser1, "testuser", nil, "Third", false, false, nil, now, "c3")

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1 AND m.sent_at < \(.*SELECT sent_at FROM chat_messages WHERE id = \$2.*ORDER BY m.sent_at DESC.*LIMIT \$3`).
		WithArgs(testConv1, testMsg5, 10).
		WillReturnRows(msgRows)

	// Attachments query (empty result)
	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg3).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetMessages_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetMessages(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGetMessages_Empty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

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
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "not-a-valid-ciphertext!", false, false, nil, now, "c1")

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))

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
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})

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
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Notes check (regular conversation)
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Transaction Begin
	mock.ExpectBegin()

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(10), "20000000-0000-0000-0000-000000000010", testConv1, testUser1, nil, "Hello, world!", false, false, nil, now, testClientID1)

	mock.ExpectQuery(`INSERT INTO chat_messages \(conversation_id, sender_user_id, content, client_id, parent_message_id\).*ON CONFLICT \(conversation_id, client_id\) DO NOTHING.*RETURNING`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID1, nil).
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
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestSendMessage_HtmlRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "<script>alert('xss')</script>", ClientID: testClientID1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSendMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, nil, map[string]string{"id": testConv1})

	handler.SendMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestSendMessage_Duplicate(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: testClientID2}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Transaction Begin
	mock.ExpectBegin()

	// Insert fails with duplicate key error
	mock.ExpectQuery(`INSERT INTO chat_messages \(conversation_id, sender_user_id, content, client_id, parent_message_id\).*ON CONFLICT \(conversation_id, client_id\) DO NOTHING.*RETURNING`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID2, nil).
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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4, is_edited = true, edited_at = NOW\(\).*WHERE id = \$1 AND conversation_id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg()).
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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestEditMessage_HtmlRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "<b>bold</b>"}
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000999", body, claims, map[string]string{"id": testConv1, "msgId": testMsg999})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`UPDATE chat_messages.*SET content.*WHERE id = \$1 AND conversation_id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs(testMsg999, testConv1, testUser1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.EditMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestEditMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := EditMessageRequest{Content: "Edited"}
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, nil, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.EditMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestEditMessage_DBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`UPDATE chat_messages.*`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg()).
		WillReturnError(sqlmock.ErrCancelled)

	handler.EditMessage(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── DeleteMessage ───────────────────────────────────────────────────────────

func TestDeleteMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	mock.ExpectExec(`UPDATE chat_messages.*SET is_deleted = true.*WHERE id = \$1.*AND sender_user_id = \$2.*AND is_deleted = false.*AND conversation_id = \$3.*AND EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$3 AND user_id = \$2\)`).
		WithArgs(testMsg1, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.DeleteMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteMessage_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000999", nil, map[string]string{"id": testConv1, "msgId": testMsg999})
	c.Set("claims", claims)

	mock.ExpectExec(`UPDATE chat_messages.*SET is_deleted = true.*`).
		WithArgs(testMsg999, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.DeleteMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})

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
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	// Notes check — it IS the notes self-chat
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Transaction Begin
	mock.ExpectBegin()

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(10), "20000000-0000-0000-0000-000000000010", testConv1, testUser1, nil, ciphertext, false, false, nil, now, testClientID1)

	// The client ciphertext must be stored verbatim — never server-encrypted.
	mock.ExpectQuery(`INSERT INTO chat_messages \(conversation_id, sender_user_id, content, client_id, parent_message_id\).*ON CONFLICT \(conversation_id, client_id\) DO NOTHING.*RETURNING`).
		WithArgs(testConv1, testUser1, ciphertext, testClientID1, nil).
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
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unmarked notes payload, got %d", w.Code)
	}
}

func TestGetMessages_NotesCiphertextPassthrough(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// It IS the notes self-chat: content and metadata must pass through undecrypted.
	ciphertext := "e2enote1:abcdefghijklmnopqrstuvwxyz0123456789"
	metaBlob := "e2enote1:0123456789abcdefghijklmnopqrstuvwxyz"
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id", "notes_meta",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, ciphertext, false, false, nil, now, "c1", metaBlob)

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)

	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))

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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// Ciphertext is stored verbatim, never server-encrypted.
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4, is_edited = true, edited_at = NOW\(\).*WHERE id = \$1 AND conversation_id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs(testMsg1, testConv1, testUser1, ciphertext).
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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	// It IS the notes self-chat.
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))
	// The client E2E blob is stored verbatim — never server-encrypted.
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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for non-notes conversation, got %d", w.Code)
	}
}

func TestUpdateNotesMeta_UnmarkedRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := UpdateNotesMetaRequest{Meta: "plaintext metadata must never reach the server"}
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000999/notes-meta", body, claims, map[string]string{"id": testConv1, "msgId": testMsg999})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))
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
	c, w := newPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta", body, nil, map[string]string{"id": testConv1, "msgId": testMsg1})

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
