package handlers

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── ListConversations ───────────────────────────────────────────────────────

func TestListConversations_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted",
		"is_group", "group_name", "group_avatar_url", "member_count",
		"other_id", "other_username", "other_display_name",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at",
	}).
		AddRow(testConv1, now, "Hello!", testUser2, nil, now, 3, false, false, nil, nil, 2, testUser2, "alice", "Alice", nil, 1001, true, nil).
		AddRow(testConv2, now.Add(-time.Hour), "Hey there", testUser3, nil, now, 0, false, false, nil, nil, 2, testUser3, "bob", "Bob", "avatar.jpg", 1002, false, now.Add(-time.Hour))

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*LEFT JOIN`).
		WithArgs(testUser1).
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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted",
		"is_group", "group_name", "group_avatar_url", "member_count",
		"other_id", "other_username", "other_display_name",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at",
	})

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
		WithArgs(testUser1).
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

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
		WithArgs(testUser1).
		WillReturnError(sqlmock.ErrCancelled)

	handler.ListConversations(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── GetOrCreateConversation ─────────────────────────────────────────────────

func TestGetOrCreateConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser2}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Atomic find-or-create via DB function
	mock.ExpectQuery(`SELECT find_or_create_conversation\(\$1, \$2\)`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"find_or_create_conversation"}).AddRow(testConv1))

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != testConv1 {
		t.Fatalf("expected conv-existing, got %v", data["conversation_id"])
	}
}

func TestGetOrCreateConversation_CreatesNew(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser2}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Atomic find-or-create via DB function — returns new conversation
	mock.ExpectQuery(`SELECT find_or_create_conversation\(\$1, \$2\)`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"find_or_create_conversation"}).AddRow(testConv1))

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != testConv1 {
		t.Fatalf("expected conv-new, got %v", data["conversation_id"])
	}
}

func TestGetOrCreateConversation_UserNotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser999}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	// Check user exists — nope
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(testUser999).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for nonexistent user, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_SelfChat(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser1}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_MissingUserID(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := map[string]string{"user_id": testUser2}
	c, w := newPOSTContext("/api/v1/messenger/conversations", body, nil, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── LeaveConversation ───────────────────────────────────────────────────────

func TestLeaveConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// Membership check
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// Delete membership
	mock.ExpectExec(`DELETE FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2`).
		WithArgs(testConv1, testUser1).
		WillReturnResult(sqlmock.NewResult(1, 1))

	handler.LeaveConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestLeaveConversation_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.LeaveConversation(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestLeaveConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := newDELETEPContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})

	handler.LeaveConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
