package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
)

// ─── GetMessages ─────────────────────────────────────────────────────────────

func TestGetMessages_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/messages", nil)
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).
		AddRow("msg-2", "conv-1", "u2", nil, "Hi!", false, false, nil, now.Add(time.Minute), "c2").
		AddRow("msg-1", "conv-1", "u1", nil, "Hello!", false, false, nil, now, "c1")

	mock.ExpectQuery(`SELECT id, conversation_id, sender_user_id, parent_message_id,.*FROM chat_messages.*WHERE conversation_id = \$1.*ORDER BY sent_at DESC.*LIMIT \$2`).
		WithArgs("conv-1", 50).
		WillReturnRows(msgRows)

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
	if first["id"] != "msg-1" {
		t.Fatalf("expected oldest first (msg-1), got %v", first["id"])
	}
}

func TestGetMessages_WithBefore(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/messages", map[string]string{"before": "msg-5", "limit": "10"})
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow("msg-3", "conv-1", "u1", nil, "Third", false, false, nil, now, "c3")

	mock.ExpectQuery(`SELECT id, conversation_id, sender_user_id, parent_message_id,.*FROM chat_messages.*WHERE conversation_id = \$1 AND sent_at < \(.*SELECT sent_at FROM chat_messages WHERE id = \$2.*ORDER BY sent_at DESC.*LIMIT \$3`).
		WithArgs("conv-1", "msg-5", 10).
		WillReturnRows(msgRows)

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestGetMessages_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/messages", nil)
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetMessages(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGetMessages_Empty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/messages", nil)
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT id, conversation_id.*FROM chat_messages.*`).
		WithArgs("conv-1", 50).
		WillReturnRows(sqlmock.NewRows([]string{"id", "conversation_id", "sender_user_id", "parent_message_id", "content", "is_edited", "is_deleted", "edited_at", "sent_at", "client_id"}))

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

func TestGetMessages_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/messages", nil)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	handler.GetMessages(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── SendMessage ─────────────────────────────────────────────────────────────

func TestSendMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := SendMessageRequest{Content: "Hello, world!", ClientID: "client-123"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, claims, map[string]string{"id": "conv-1"})

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow("msg-new", "conv-1", "u1", nil, "Hello, world!", false, false, nil, now, "client-123")

	mock.ExpectQuery(`INSERT INTO chat_messages \(conversation_id, sender_user_id, content, client_id, parent_message_id\).*VALUES \(\$1, \$2, \$3, \$4, \$5\).*RETURNING`).
		WithArgs("conv-1", "u1", "Hello, world!", "client-123", nil).
		WillReturnRows(msgRows)

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_EmptyContent(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := SendMessageRequest{Content: "   ", ClientID: "client-123"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, claims, map[string]string{"id": "conv-1"})

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestSendMessage_HtmlRejected(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := SendMessageRequest{Content: "<script>alert('xss')</script>", ClientID: "client-123"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, claims, map[string]string{"id": "conv-1"})

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: "client-123"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSendMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := SendMessageRequest{Content: "Hello!", ClientID: "client-123"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, nil, map[string]string{"id": "conv-1"})

	handler.SendMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestSendMessage_Duplicate(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := SendMessageRequest{Content: "Hello!", ClientID: "client-dup"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/messages", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Insert fails — not a duplicate error
	mock.ExpectQuery(`INSERT INTO chat_messages.*`).
		WithArgs("conv-1", "u1", "Hello!", "client-dup", nil).
		WillReturnError(sqlmock.ErrCancelled)

	handler.SendMessage(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 for non-duplicate error, got %d", w.Code)
	}
}

// ─── EditMessage ─────────────────────────────────────────────────────────────

func TestEditMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", body, claims, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$1, is_edited = true, edited_at = NOW\(\).*WHERE id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs("Edited content", "msg-1", "u1").
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

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := EditMessageRequest{Content: "   "}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", body, claims, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty content, got %d", w.Code)
	}
}

func TestEditMessage_HtmlRejected(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := EditMessageRequest{Content: "<b>bold</b>"}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", body, claims, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for HTML content, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-999", body, claims, map[string]string{"id": "conv-1", "msgId": "msg-999"})

	mock.ExpectExec(`UPDATE chat_messages.*SET content.*WHERE id = \$2 AND sender_user_id = \$3 AND is_deleted = false`).
		WithArgs("Edited content", "msg-999", "u1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.EditMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestEditMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := EditMessageRequest{Content: "Edited"}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", body, nil, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	handler.EditMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestEditMessage_DBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := EditMessageRequest{Content: "Edited content"}
	c, w := newPUTContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", body, claims, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	mock.ExpectExec(`UPDATE chat_messages.*`).
		WithArgs("Edited content", "msg-1", "u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.EditMessage(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── DeleteMessage ───────────────────────────────────────────────────────────

func TestDeleteMessage_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", nil, map[string]string{"id": "conv-1", "msgId": "msg-1"})
	c.Set("claims", claims)

	mock.ExpectExec(`UPDATE chat_messages.*SET is_deleted = true.*WHERE id = \$1.*AND sender_user_id = \$2.*AND is_deleted = false.*AND conversation_id = \$3.*AND EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$3 AND user_id = \$2\)`).
		WithArgs("msg-1", "u1", "conv-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.DeleteMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteMessage_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/messages/msg-999", nil, map[string]string{"id": "conv-1", "msgId": "msg-999"})
	c.Set("claims", claims)

	mock.ExpectExec(`UPDATE chat_messages.*SET is_deleted = true.*`).
		WithArgs("msg-999", "u1", "conv-1").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.DeleteMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteMessage_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/messages/msg-1", nil, map[string]string{"id": "conv-1", "msgId": "msg-1"})

	handler.DeleteMessage(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
