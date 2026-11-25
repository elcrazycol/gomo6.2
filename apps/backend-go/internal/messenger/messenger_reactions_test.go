package messenger

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/lib/pq"
)

var errReactionInsert = errors.New("insert failed")

// ─── Reaction helpers ───────────────────────────────────────────────────────

func TestValidReactionEmoji(t *testing.T) {
	valid := []string{"❤️", "👍", "🔥", "😂", "🎉", "👨‍👩‍👧‍👦", "❤️‍🔥", "🫶"}
	for _, emoji := range valid {
		if !validReactionEmoji(emoji) {
			t.Fatalf("expected %q to be a valid reaction", emoji)
		}
	}
	invalid := []string{"", " ", "hello", "a", "❤️ ", "❤️\n", "\x00", "asdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdfasdf", "123"}
	for _, emoji := range invalid {
		if validReactionEmoji(emoji) {
			t.Fatalf("expected %q to be rejected", emoji)
		}
	}
}

func TestFetchReactionsForMessages_EmptyPageShortCircuits(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	summaries, err := handler.fetchReactionsForMessages(nil, nil, testUser1)
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
	if summaries != nil {
		t.Fatalf("expected no summaries for an empty page, got %v", summaries)
	}

	// An empty page short-circuits the extras query too.
	attachments, reactions, voice, err := handler.fetchMessageExtras(nil, nil, testUser1)
	if err != nil {
		t.Fatalf("expected no error for an empty page, got %v", err)
	}
	if len(attachments) != 0 || len(reactions) != 0 || len(voice) != 0 {
		t.Fatalf("expected empty extras, got %v %v %v", attachments, reactions, voice)
	}
}

// ─── ToggleReaction ─────────────────────────────────────────────────────────

func TestToggleReaction_AddsAndReturnsChips(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	// Membership, message existence.
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// No existing row → the delete reports zero → insert.
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "❤️").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM message_reactions WHERE message_id = \$1 AND user_id = \$2`).
		WithArgs(testMsg1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectExec(`INSERT INTO message_reactions`).
		WithArgs(testMsg1, testConv1, testUser1, "❤️").
		WillReturnResult(sqlmock.NewResult(0, 1))

	now := time.Now()
	reactionRows := sqlmock.NewRows([]string{"message_id", "emoji", "user_id", "username", "created_at"}).
		AddRow(testMsg1, "❤️", testUser1, "testuser", now).
		AddRow(testMsg1, "❤️", testUser2, "bob", now.Add(time.Second)).
		AddRow(testMsg1, "🔥", testUser2, "bob", now.Add(2*time.Second))
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at`).
		WithArgs(pq.Array([]string{testMsg1})).
		WillReturnRows(reactionRows)

	handler.ToggleReaction(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["action"] != "add" {
		t.Fatalf("expected action=add, got %v", data["action"])
	}
	chips, ok := data["reactions"].([]interface{})
	if !ok || len(chips) != 2 {
		t.Fatalf("expected 2 chips, got %v", data["reactions"])
	}
	// Popularity first: ❤️ has two people, 🔥 one.
	first := chips[0].(map[string]interface{})
	if first["emoji"] != "❤️" || first["count"].(float64) != 2 {
		t.Fatalf("expected the heavier chip first, got %v", first)
	}
	if first["mine"] != true {
		t.Fatalf("expected mine on the viewer's chip, got %v", first["mine"])
	}
	users, ok := first["users"].([]interface{})
	if !ok || len(users) != 2 {
		t.Fatalf("expected both reactors, got %v", first["users"])
	}
	if second := chips[1].(map[string]interface{}); second["mine"] != false {
		t.Fatalf("expected mine=false on someone else's chip, got %v", second["mine"])
	}
}

func TestToggleReaction_Removes(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "👍"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// The row existed → delete reports one row → remove.
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "👍").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at`).
		WithArgs(pq.Array([]string{testMsg1})).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "emoji", "user_id", "username", "created_at"}))

	handler.ToggleReaction(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["action"] != "remove" {
		t.Fatalf("expected action=remove, got %v", data["action"])
	}
	chips, ok := data["reactions"].([]interface{})
	if !ok || len(chips) != 0 {
		t.Fatalf("expected an empty chip list once the last reaction is gone, got %v", data["reactions"])
	}
}

func TestToggleReaction_SurfacesInsertFailure(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "❤️").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM message_reactions WHERE message_id = \$1 AND user_id = \$2`).
		WithArgs(testMsg1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectExec(`INSERT INTO message_reactions`).
		WillReturnError(errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_MembershipLookupFails(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccessError(mock, testConv1, testUser1, errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_MessageLookupFails(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnError(errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_DeleteFails(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "❤️").
		WillReturnError(errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_ChipsLookupFails(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "❤️").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at`).
		WithArgs(pq.Array([]string{testMsg1})).
		WillReturnError(errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_RejectsNonMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser999, Username: "outsider"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectNoConversationAccess(mock, testConv1, testUser999)

	handler.ToggleReaction(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_RejectsDeletedMessage(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.ToggleReaction(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_ReplacesTheOldestAtTheCeiling(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "🎉"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "🎉").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM message_reactions WHERE message_id = \$1 AND user_id = \$2`).
		WithArgs(testMsg1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(maxReactionsPerUser))
	// At the cap the oldest one the reader holds is evicted (Telegram's model),
	// not refused.
	mock.ExpectExec(`DELETE FROM message_reactions\s+WHERE id = \(\s+SELECT id FROM message_reactions\s+WHERE message_id = \$1 AND user_id = \$2\s+ORDER BY created_at ASC\s+LIMIT 1\s+\)`).
		WithArgs(testMsg1, testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(`INSERT INTO message_reactions`).
		WithArgs(testMsg1, testConv1, testUser1, "🎉").
		WillReturnResult(sqlmock.NewResult(0, 1))

	now := time.Now()
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at`).
		WithArgs(pq.Array([]string{testMsg1})).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "emoji", "user_id", "username", "created_at"}).
			AddRow(testMsg1, "❤️", testUser1, "testuser", now).
			AddRow(testMsg1, "🎉", testUser1, "testuser", now.Add(time.Second)))

	handler.ToggleReaction(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 (the new reaction replaces the oldest), got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["action"] != "add" {
		t.Fatalf("expected action=add, got %v", data["action"])
	}
	chips, ok := data["reactions"].([]interface{})
	if !ok || len(chips) != 2 {
		t.Fatalf("expected the surviving chips, got %v", data["reactions"])
	}
}

func TestToggleReaction_SurfacesEvictionFailure(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "🎉"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_messages WHERE id = \$1 AND conversation_id = \$2 AND is_deleted = false\)`).
		WithArgs(testMsg1, testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectExec(`DELETE FROM message_reactions WHERE message_id = \$1 AND user_id = \$2 AND emoji = \$3`).
		WithArgs(testMsg1, testUser1, "🎉").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`SELECT COUNT\(\*\) FROM message_reactions WHERE message_id = \$1 AND user_id = \$2`).
		WithArgs(testMsg1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(maxReactionsPerUser))
	mock.ExpectExec(`DELETE FROM message_reactions\s+WHERE id = \(`).
		WithArgs(testMsg1, testUser1).
		WillReturnError(errReactionInsert)

	handler.ToggleReaction(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d: %s", w.Code, w.Body.String())
	}
}

func TestToggleReaction_RejectsBadEmoji(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "not-an-emoji"},
		claims,
		map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	handler.ToggleReaction(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &map[string]interface{}{}); err != nil {
		t.Fatalf("response is not JSON: %v", err)
	}
}
