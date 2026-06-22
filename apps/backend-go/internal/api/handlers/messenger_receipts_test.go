package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── MarkRead ────────────────────────────────────────────────────────────────

func TestMarkRead_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := MarkReadRequest{MessageID: testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/read", body, claims, map[string]string{"id": testConv1})

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Get message sent_at (now with conversation_id check)
	now := time.Now()
	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"sent_at"}).AddRow(now))

	// Transaction
	mock.ExpectBegin()

	// Combined mark read + delivered
	mock.ExpectExec(`INSERT INTO chat_receipts \(message_id, user_id, delivered_at, read_at\).*SELECT m.id, \$2.*ON CONFLICT.*DO UPDATE SET read_at = NOW\(\), delivered_at = COALESCE`).
		WithArgs(testConv1, testUser1, now).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// Reset unread
	mock.ExpectExec(`UPDATE chat_members.*SET unread_count = 0, last_read_message_id = \$2.*WHERE conversation_id = \$1 AND user_id = \$3`).
		WithArgs(testConv1, testMsg1, testUser1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectCommit()

	handler.MarkRead(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkRead_MessageNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := MarkReadRequest{MessageID: testMsg999}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/read", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs(testMsg999, testConv1).
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkRead(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkRead_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := MarkReadRequest{MessageID: testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/read", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkRead(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ─── MarkDelivered ───────────────────────────────────────────────────────────

func TestMarkDelivered_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/delivered", body, claims, map[string]string{"id": testConv1})

	// Membership check (NEW)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Message sent_at check (now with conversation_id)
	now := time.Now()
	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"sent_at"}).AddRow(now))

	mock.ExpectExec(`INSERT INTO chat_receipts \(message_id, user_id, delivered_at\).*SELECT m.id, \$2.*ON CONFLICT.*DO UPDATE SET delivered_at = COALESCE`).
		WithArgs(testConv1, testUser1, now).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.MarkDelivered(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestMarkDelivered_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/delivered", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.MarkDelivered(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestMarkDelivered_MessageNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg999}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/delivered", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT sent_at FROM chat_messages WHERE id = \$1 AND conversation_id = \$2`).
		WithArgs(testMsg999, testConv1).
		WillReturnError(sqlmock.ErrCancelled)

	handler.MarkDelivered(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ─── GetUnreadCount ──────────────────────────────────────────────────────────

func TestMessengerGetUnreadCount_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COALESCE\(SUM\(unread_count\), 0\).*FROM chat_members.*WHERE user_id = \$1`).
		WithArgs(testUser1).
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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/unread-count", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COALESCE\(SUM\(unread_count\), 0\).*FROM chat_members.*`).
		WithArgs(testUser1).
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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/receipts", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	mock.ExpectQuery(`SELECT r.message_id, r.user_id, r.delivered_at, r.read_at.*FROM chat_receipts r.*INNER JOIN chat_messages m.*WHERE m.conversation_id = \$1`).
		WithArgs(testConv1, 500).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "user_id", "delivered_at", "read_at"}).
			AddRow(testMsg1, testUser2, now, now.Add(time.Minute)))

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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/receipts", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetReceipts(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

// ─── TogglePin ───────────────────────────────────────────────────────────────

func TestTogglePin_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/pin", body, claims, map[string]string{"id": testConv1})

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Verify message belongs to conversation (NEW)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Get current pin — NULL
	mock.ExpectQuery(`SELECT pinned_message_id FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"pinned_message_id"}).AddRow(nil))

	// Pin
	mock.ExpectExec(`UPDATE chat_conversations SET pinned_message_id = \$2 WHERE id = \$1`).
		WithArgs(testConv1, testMsg1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.TogglePin(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestTogglePin_Unpin(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/pin", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Already pinned to msg-1
	mock.ExpectQuery(`SELECT pinned_message_id FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"pinned_message_id"}).AddRow(testMsg1))

	// Unpin
	mock.ExpectExec(`UPDATE chat_conversations SET pinned_message_id = NULL WHERE id = \$1`).
		WithArgs(testConv1).
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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": "30000000-0000-0000-0000-000000000001"}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/pin", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members.*`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Message doesn't belong to this conversation
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs("30000000-0000-0000-0000-000000000001", testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.TogglePin(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for message not in conversation, got %d", w.Code)
	}
}

func TestTogglePin_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := map[string]string{"message_id": testMsg1}
	c, w := newPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/pin", body, nil, map[string]string{"id": testConv1})

	handler.TogglePin(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
