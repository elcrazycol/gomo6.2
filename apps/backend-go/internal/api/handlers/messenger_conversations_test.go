package handlers

import (
	"database/sql"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

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
		"other_id", "other_username", "other_display_name",
		"avatar_url", "account_number", "is_online", "last_seen_at",
	}).
		AddRow("conv-1", now, "Hello!", "u2", nil, now, 3, 3, "u2", "alice", "Alice", nil, 1001, true, nil).
		AddRow("conv-2", now.Add(-time.Hour), "Hey there", "u3", nil, now, 0, 0, "u3", "bob", "Bob", "avatar.jpg", 1002, false, now.Add(-time.Hour))

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
		"other_id", "other_username", "other_display_name",
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
