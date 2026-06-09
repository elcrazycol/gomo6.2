package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/models"
)

// ─── Setup ───────────────────────────────────────────────────────────────────

func setupMessengerHandler(t *testing.T) (*MessengerHandler, sqlmock.Sqlmock) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() {
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Errorf("unfulfilled mock expectations: %v", err)
		}
		db.Close()
	})

	handler := NewMessengerHandler(db, nil)
	return handler, mock
}

// stripJSON removes the `data` wrapper from APIResponse and returns the inner data.
func stripJSON(body []byte) (map[string]interface{}, error) {
	var resp models.APIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data == nil {
		return nil, nil
	}
	return resp.Data.(map[string]interface{}), nil
}

// stripJSONArray returns the data field as []interface{}.
func stripJSONArray(body []byte) ([]interface{}, error) {
	var resp models.APIResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	if resp.Data == nil {
		return nil, nil
	}
	return resp.Data.([]interface{}), nil
}

// ─── ListConversations ───────────────────────────────────────────────────────

func TestListConversations_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "unread",
		"other_id", "other_username",
		"avatar_url", "account_number", "is_online", "last_seen_at",
	}).
		AddRow("conv-1", now, "Hello!", "u2", nil, now, 3, 3, "u2", "alice", nil, 1001, true, nil).
		AddRow("conv-2", now.Add(-time.Hour), "Hey there", "u3", nil, now, 0, 0, "u3", "bob", "avatar.jpg", 1002, false, now.Add(-time.Hour))

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*INNER JOIN chat_conversations c.*INNER JOIN chat_members cm2.*INNER JOIN users u.*WHERE cm.user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(rows)

	handler.ListConversations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 2 {
		t.Fatalf("expected 2 conversations, got %d", len(data))
	}
}

func TestListConversations_Empty(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "unread",
		"other_id", "other_username",
		"avatar_url", "account_number", "is_online", "last_seen_at",
	})

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
		WithArgs("u1").
		WillReturnRows(rows)

	handler.ListConversations(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 0 {
		t.Fatalf("expected 0 conversations, got %d", len(data))
	}
}

func TestListConversations_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newGETContext("/api/v1/messenger/conversations", nil)

	handler.ListConversations(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestListConversations_DBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
		WithArgs("u1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.ListConversations(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetOrCreateConversation ─────────────────────────────────────────────────

func TestGetOrCreateConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"user_id": "u2"}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Find existing — returns one
	mock.ExpectQuery(`SELECT cm1.conversation_id.*FROM chat_members cm1.*INNER JOIN chat_members cm2`).
		WithArgs("u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"conversation_id"}).AddRow("conv-existing"))

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != "conv-existing" {
		t.Fatalf("expected conv-existing, got %v", data["conversation_id"])
	}
}

func TestGetOrCreateConversation_CreatesNew(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"user_id": "u2"}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs("u2").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Find existing — no rows
	mock.ExpectQuery(`SELECT cm1.conversation_id.*FROM chat_members cm1`).
		WithArgs("u1", "u2").
		WillReturnError(sql.ErrNoRows)

	// Transaction: begin
	mock.ExpectBegin()

	// Insert conversation
	mock.ExpectQuery(`INSERT INTO chat_conversations DEFAULT VALUES RETURNING id`).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("conv-new"))

	// Insert members
	mock.ExpectExec(`INSERT INTO chat_members`).
		WithArgs("conv-new", "u1", "u2").
		WillReturnResult(sqlmock.NewResult(1, 2))

	// Commit
	mock.ExpectCommit()

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != "conv-new" {
		t.Fatalf("expected conv-new, got %v", data["conversation_id"])
	}
}

func TestGetOrCreateConversation_UserNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"user_id": "u999"}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists — nope
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs("u999").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent user, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_SelfChat(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"user_id": "u1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_MissingUserID(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := map[string]string{"user_id": "u2"}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, nil, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── LeaveConversation ───────────────────────────────────────────────────────

func TestLeaveConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/leave", nil, map[string]string{"id": "conv-1"})
	c.Set("claims", claims)

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Delete membership
	mock.ExpectExec(`DELETE FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2`).
		WithArgs("conv-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.LeaveConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestLeaveConversation_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/leave", nil, map[string]string{"id": "conv-1"})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.LeaveConversation(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestLeaveConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newDELETEPContext("/api/v1/messenger/conversations/conv-1/leave", nil, map[string]string{"id": "conv-1"})

	handler.LeaveConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

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

// ─── MarkRead ────────────────────────────────────────────────────────────────

func TestMarkRead_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := MarkReadRequest{MessageID: "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/read", body, claims, map[string]string{"id": "conv-1"})

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Get message sent_at (now with conversation_id check)
	now := time.Now()
	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs("msg-1", "conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"sent_at"}).AddRow(now))

	// Transaction
	mock.ExpectBegin()

	// Combined mark read + delivered
	mock.ExpectExec(`INSERT INTO chat_receipts \(message_id, user_id, delivered_at, read_at\).*SELECT m.id, \$2.*ON CONFLICT.*DO UPDATE SET read_at = NOW\(\), delivered_at = COALESCE`).
		WithArgs("conv-1", "u1", now).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Reset unread
	mock.ExpectExec(`UPDATE chat_members.*SET unread_count = 0, last_read_message_id = \$2.*WHERE conversation_id = \$1 AND user_id = \$3`).
		WithArgs("conv-1", "msg-1", "u1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectCommit()

	handler.MarkRead(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkRead_MessageNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := MarkReadRequest{MessageID: "msg-999"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/read", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs("msg-999", "conv-1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkRead(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkRead_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := MarkReadRequest{MessageID: "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/read", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkRead(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ─── MarkDelivered ───────────────────────────────────────────────────────────

func TestMarkDelivered_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/delivered", body, claims, map[string]string{"id": "conv-1"})

	// Membership check (NEW)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Message sent_at check (now with conversation_id)
	now := time.Now()
	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs("msg-1", "conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"sent_at"}).AddRow(now))

	mock.ExpectExec(`INSERT INTO chat_receipts \(message_id, user_id, delivered_at\).*SELECT m.id, \$2.*ON CONFLICT.*DO UPDATE SET delivered_at = COALESCE`).
		WithArgs("conv-1", "u1", now).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.MarkDelivered(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkDelivered_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/delivered", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkDelivered(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestMarkDelivered_MessageNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-999"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/delivered", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs("msg-999", "conv-1").
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkDelivered(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ─── GetUnreadCount ──────────────────────────────────────────────────────────

func TestMessengerGetUnreadCount_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COALESCE\(SUM\(unread_count\), 0\).*FROM chat_members.*WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(5))

	handler.GetUnreadCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["unread_count"] != float64(5) {
		t.Fatalf("expected unread_count=5, got %v", data["unread_count"])
	}
}

func TestMessengerGetUnreadCount_Zero(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COALESCE\(SUM\(unread_count\), 0\).*FROM chat_members.*`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"coalesce"}).AddRow(0))

	handler.GetUnreadCount(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestMessengerGetUnreadCount_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newGETContext("/api/v1/messenger/unread-count", nil)

	handler.GetUnreadCount(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── GetReceipts ─────────────────────────────────────────────────────────────

func TestGetReceipts_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/receipts", nil)
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	mock.ExpectQuery(`SELECT r.message_id, r.user_id, r.delivered_at, r.read_at.*FROM chat_receipts r.*INNER JOIN chat_messages m.*WHERE m.conversation_id = \$1`).
		WithArgs("conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "user_id", "delivered_at", "read_at"}).
			AddRow("msg-1", "u2", now, now.Add(time.Minute)))

	handler.GetReceipts(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 receipt, got %d", len(data))
	}
}

func TestGetReceipts_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations/conv-1/receipts", nil)
	c.Set("claims", claims)
	c.Params = []gin.Param{{Key: "id", Value: "conv-1"}}

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetReceipts(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ─── TogglePin ───────────────────────────────────────────────────────────────

func TestTogglePin_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/pin", body, claims, map[string]string{"id": "conv-1"})

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Verify message belongs to conversation (NEW)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs("msg-1", "conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Get current pin — NULL
	mock.ExpectQuery(`SELECT pinned_message_id FROM chat_conversations WHERE id = \$1`).
		WithArgs("conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"pinned_message_id"}).AddRow(nil))

	// Pin
	mock.ExpectExec(`UPDATE chat_conversations SET pinned_message_id = \$2 WHERE id = \$1`).
		WithArgs("conv-1", "msg-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.TogglePin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestTogglePin_Unpin(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/pin", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs("msg-1", "conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Already pinned to msg-1
	mock.ExpectQuery(`SELECT pinned_message_id FROM chat_conversations WHERE id = \$1`).
		WithArgs("conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"pinned_message_id"}).AddRow("msg-1"))

	// Unpin
	mock.ExpectExec(`UPDATE chat_conversations SET pinned_message_id = NULL WHERE id = \$1`).
		WithArgs("conv-1").
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.TogglePin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["pinned_message_id"] != nil {
		t.Fatalf("expected pinned_message_id=nil, got %v", data["pinned_message_id"])
	}
}

func TestTogglePin_MessageNotInConversation(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: "u1", Username: "testuser"}
	body := map[string]string{"message_id": "msg-other-conv"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/pin", body, claims, map[string]string{"id": "conv-1"})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs("conv-1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Message doesn't belong to this conversation
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs("msg-other-conv", "conv-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.TogglePin(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for message not in conversation, got %d", w.Code)
	}
}

func TestTogglePin_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := map[string]string{"message_id": "msg-1"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/conv-1/pin", body, nil, map[string]string{"id": "conv-1"})

	handler.TogglePin(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func TestGetClaims_Valid(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("claims", &auth.Claims{UserID: "u1", Username: "test"})

	claims := getClaims(c)
	if claims == nil {
		t.Fatal("expected non-nil claims")
	}
	if claims.UserID != "u1" {
		t.Fatalf("expected u1, got %s", claims.UserID)
	}
}

func TestGetClaims_Nil(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	claims := getClaims(c)
	if claims != nil {
		t.Fatal("expected nil claims")
	}
}

func TestEnsureAuth_Valid(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("claims", &auth.Claims{UserID: "u1"})

	claims := ensureAuth(c)
	if claims == nil {
		t.Fatal("expected non-nil claims")
	}
}

func TestEnsureAuth_Missing(t *testing.T) {
	_, _ = setupMessengerHandler(t)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	claims := ensureAuth(c)
	if claims != nil {
		t.Fatal("expected nil claims for unauthenticated request")
	}
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 written to response, got %d", w.Code)
	}
}

func TestSanitizeContent(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		expectOk    bool
		expectedMsg string
	}{
		{"normal", "Hello world", true, "Hello world"},
		{"trim spaces", "  hello  ", true, "hello"},
		{"short", "ok", true, "ok"},
		{"empty", "   ", false, ""},
		{"html tag", "<b>bold</b>", false, ""},
		{"html script", "<script>alert('xss')</script>", false, ""},
		{"html img", "hello<img src=x>", false, ""},
		{"html entity ok", "hello &amp; world", true, "hello &amp; world"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := sanitizeContent(tt.input)
			if tt.expectOk {
				if err != nil {
					t.Errorf("expected ok, got error: %v", err)
				}
				if result != tt.expectedMsg {
					t.Errorf("expected %q, got %q", tt.expectedMsg, result)
				}
			} else {
				if err == nil {
					t.Errorf("expected error for %q, got nil", tt.input)
				}
			}
		})
	}
}

func TestHasHTML(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"plain text", false},
		{"<b>bold</b>", true},
		{"text with <br> tag", true},
		{"just text", false},
		{"<img src=x>", true},
		{"hello &amp; goodbye", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			if got := hasHTML(tt.input); got != tt.expected {
				t.Errorf("hasHTML(%q) = %v, want %v", tt.input, got, tt.expected)
			}
		})
	}
}

func TestGenerateClientID(t *testing.T) {
	id1 := GenerateClientID()
	id2 := GenerateClientID()

	if id1 == "" {
		t.Error("expected non-empty client ID")
	}
	if id1[:1] != "c" {
		t.Errorf("expected client ID to start with 'c', got %q", id1)
	}
	if id2[:1] != "c" {
		t.Errorf("expected client ID to start with 'c', got %q", id2)
	}
}

func TestEncryptDecrypt(t *testing.T) {
	// Save original key and restore
	origKey := messengerEncryptionKey
	defer func() { messengerEncryptionKey = origKey }()

	// Set a test key (must be exactly 32 bytes for AES-256)
	messengerEncryptionKey = []byte("test-key-exactly-32-bytes-here!!")

	plaintext := "Hello, secure world!"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent failed: %v", err)
	}
	if encrypted == plaintext {
		t.Fatal("encrypted content should differ from plaintext")
	}

	decrypted, err := decryptContent(encrypted)
	if err != nil {
		t.Fatalf("decryptContent failed: %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("decrypt mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDecrypt_NoKey(t *testing.T) {
	origKey := messengerEncryptionKey
	defer func() { messengerEncryptionKey = origKey }()

	messengerEncryptionKey = nil

	plaintext := "unencrypted"
	encrypted, err := encryptContent(plaintext)
	if err != nil {
		t.Fatalf("encryptContent without key failed: %v", err)
	}
	if encrypted != plaintext {
		t.Fatal("without key, content should not be encrypted")
	}

	decrypted, err := decryptContent(plaintext)
	if err != nil {
		t.Fatalf("decryptContent without key failed: %v", err)
	}
	if decrypted != plaintext {
		t.Fatal("without key, decryption should return plaintext")
	}
}
