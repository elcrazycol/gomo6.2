package messenger

import (
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── ListConversations ───────────────────────────────────────────────────────

func TestListConversations_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted", "is_group", "group_name", "group_avatar_url", "is_notes", "member_count",

		"other_id", "other_username", "other_display_name", "other_nickname_emoji_id",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at", "other_last_read_at",
	}).
		AddRow(testConv1, now, "Hello!", testUser2, nil, now, 3, false, false, nil, nil, false, 2, testUser2, "alice", "Alice", "emoji-1", nil, 1001, true, nil, now).
		AddRow(testConv2, now.Add(-time.Hour), "Hey there", testUser3, nil, now, 0, false, false, nil, nil, false, 2, testUser3, "bob", "Bob", "emoji-2", "avatar.jpg", 1002, false, now.Add(-time.Hour), now.Add(-2*time.Hour))

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
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted", "is_group", "group_name", "group_avatar_url", "is_notes", "member_count",

		"other_id", "other_username", "other_display_name", "other_nickname_emoji_id",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at", "other_last_read_at",
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
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)

	handler.ListConversations(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestListConversations_DecryptionFailureNoCiphertextLeak(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted", "is_group", "group_name", "group_avatar_url", "is_notes", "member_count",

		"other_id", "other_username", "other_display_name", "other_nickname_emoji_id",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at", "other_last_read_at",
	}).AddRow(testConv1, now, "not-a-valid-ciphertext!", testUser2, nil, now, 3, false, false, nil, nil, false, 2, testUser2, "alice", "Alice", "emoji-1", nil, 1001, true, nil, nil)

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
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
	if len(data) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	preview := first["last_message_preview"]
	if preview == "not-a-valid-ciphertext!" {
		t.Fatal("ciphertext preview must never be returned to the client")
	}
	if preview != crypto.DecryptionFailedPlaceholder {
		t.Errorf("expected placeholder preview %q, got %v", crypto.DecryptionFailedPlaceholder, preview)
	}
}

func TestListConversations_DBError(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)
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
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

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
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

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
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

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
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_MissingUserID(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetOrCreateConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	body := map[string]string{"user_id": testUser2}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, nil, nil)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── LeaveConversation ───────────────────────────────────────────────────────

func TestLeaveConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// Notes check (regular conversation)
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

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
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))

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
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})

	handler.LeaveConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ─── Notes (client-side E2E self-chat) ───────────────────────────────────────

func TestGetOrCreateNotesConversation_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/notes", nil, claims, nil)

	mock.ExpectQuery(`SELECT find_or_create_notes_conversation\(\$1\)`).
		WithArgs(testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"find_or_create_notes_conversation"}).AddRow(testConv1))

	handler.GetOrCreateNotesConversation(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}

	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["conversation_id"] != testConv1 {
		t.Fatalf("expected notes conv id, got %v", data["conversation_id"])
	}
	if data["is_notes"] != true {
		t.Fatalf("expected is_notes=true, got %v", data["is_notes"])
	}
}

func TestGetOrCreateNotesConversation_Unauthenticated(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	c, w := testutil.NewPOSTContext("/api/v1/messenger/notes", nil, nil, nil)

	handler.GetOrCreateNotesConversation(c)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestListConversations_NotesPreviewPassthrough(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContext("/api/v1/messenger/conversations", nil)
	c.Set("claims", claims)

	now := time.Now()
	// The notes conversation has exactly one member and no "other" user.
	ciphertext := "e2enote1:abcdefghijklmnopqrstuvwxyz0123456789"
	rows := sqlmock.NewRows([]string{
		"id", "last_message_at", "last_message_preview",
		"last_message_sender_id", "pinned_message_id", "updated_at",
		"unread_count", "is_muted", "is_group", "group_name", "group_avatar_url", "is_notes", "member_count",

		"other_id", "other_username", "other_display_name", "other_nickname_emoji_id",
		"other_avatar_url", "other_account_number", "other_is_online", "other_last_seen_at", "other_last_read_at",
	}).AddRow(testConv1, now, ciphertext, testUser1, nil, now, 0, false, false, nil, nil, true, 1,
		nil, nil, nil, nil, nil, nil, nil, nil, nil)

	mock.ExpectQuery(`SELECT.*FROM chat_members cm.*`).
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
	if len(data) != 1 {
		t.Fatalf("expected 1 conversation, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	// The notes preview is client E2E ciphertext: it must pass through
	// verbatim so the device can decrypt it (never decrypted server-side).
	if first["is_notes"] != true {
		t.Fatalf("expected is_notes=true, got %v", first["is_notes"])
	}
	if first["last_message_preview"] != ciphertext {
		t.Errorf("expected notes ciphertext preview passthrough, got %v", first["last_message_preview"])
	}
}

func TestLeaveConversation_NotesRejected(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/leave", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	// It IS the notes self-chat: leaving must be rejected.
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(true))

	handler.LeaveConversation(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for notes leave, got %d", w.Code)
	}
}
