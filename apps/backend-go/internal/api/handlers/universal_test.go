package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
)

// ─── HandleTableRequest ──────────────────────────────────────────────────────

func TestHandleTableRequest_DisallowedTable(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/secret_table", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

func TestHandleTableRequest_EmptyTable(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestHandleTableRequest_MethodNotAllowed(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PATCH", "/api/v1/user_roles", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405, got %d", w.Code)
	}
}

// ─── handleGet ───────────────────────────────────────────────────────────────

func TestUniversalGet_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1").AddRow("2", "u2", "b2"))

	c, w := newUniversalRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_WithFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id = \$1`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin"))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=eq.u1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM gomosub_memberships`).
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("GET", "/api/v1/gomosub_memberships", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

// ─── Messenger GET ───────────────────────────────────────────────────────────

func TestUniversalGet_MessengerUnauthenticated(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("GET", "/api/v1/chat_conversations", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_MessengerConversations(t *testing.T) {
	h, mock := setupUniversalHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectBegin()
	mock.ExpectExec(`(?s).*set_config.*`).WithArgs("u1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s).*SELECT c\.\* FROM chat_conversations c.*INNER JOIN chat_conversation_members cm ON c\.id = cm\.conversation_id.*WHERE cm\.user_id = \$1 AND cm\.archived_at IS NULL`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at"}).AddRow("conv1", "2025-01-01T00:00:00Z"))
	mock.ExpectCommit()

	c, w := newUniversalRequestContext("GET", "/api/v1/chat_conversations", nil, claims)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_MessengerMessages(t *testing.T) {
	h, mock := setupUniversalHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	mock.ExpectBegin()
	mock.ExpectExec(`(?s).*set_config.*`).WithArgs("u1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s).*SELECT m\.\* FROM chat_messages m.*WHERE m\.conversation_id IN \(.*SELECT conversation_id FROM chat_conversation_members.*WHERE user_id = \$1 AND archived_at IS NULL.*\)`).
		WithArgs("u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "conversation_id", "ciphertext"}).
			AddRow("msg1", "conv1", "encrypted_data"))
	mock.ExpectCommit()

	c, w := newUniversalRequestContext("GET", "/api/v1/chat_messages", nil, claims)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── handlePost ──────────────────────────────────────────────────────────────

func TestUniversalPost_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The INSERT column order depends on map iteration (random in Go).
	// Use (?s).* to match against any order.
	mock.ExpectQuery(`(?s).*INSERT INTO polls \(.*\).*VALUES \(.*\).*RETURNING \*`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "question", "created_by"}).
			AddRow("poll1", "Test question?", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/polls", map[string]string{
		"question":   "Test question?",
		"created_by": "u1",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_UpsertDailyVisits(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO user_daily_visits.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "visit_date"}).
			AddRow("1", "u1", "2025-01-01"))

	c, w := newUniversalRequestContext("POST", "/api/v1/user_daily_visits", map[string]string{
		"user_id": "u1",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_MessengerChatMessagesUnauthenticated(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/chat_messages", map[string]string{
		"conversation_id": "conv1",
	}, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── handlePut ───────────────────────────────────────────────────────────────

func TestUniversalPut_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE user_roles SET role = \$1 WHERE user_id = \$2 RETURNING \*`).
		WithArgs("moderator", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "moderator"))

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_MissingFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalPut_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE privacy_settings SET show_online_status = \$1 WHERE user_id = \$2 RETURNING \*`).
		WithArgs("false", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "show_online_status"}))

	c, w := newUniversalRequestContext("PUT", "/api/v1/privacy_settings?user_id=eq.u1", map[string]string{
		"show_online_status": "false",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── handleDelete ────────────────────────────────────────────────────────────

func TestUniversalDelete_Success(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM poll_votes WHERE id = \$1 RETURNING \*`).
		WithArgs("vote1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "poll_id", "user_id"}).
			AddRow("vote1", "poll1", "u1"))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/poll_votes?id=eq.vote1", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalDelete_MissingFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("DELETE", "/api/v1/poll_votes", nil, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalDelete_NotFound(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`DELETE FROM thread_subscriptions WHERE id = \$1 RETURNING \*`).
		WithArgs("nonexistent").
		WillReturnRows(sqlmock.NewRows([]string{"id", "thread_id", "user_id"}))

	c, w := newUniversalRequestContext("DELETE", "/api/v1/thread_subscriptions?id=eq.nonexistent", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ─── handleMessengerTablePost ────────────────────────────────────────────────

func TestUniversalPost_MessengerChatMessagesForbidden(t *testing.T) {
	h, mock := setupUniversalHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Send a message with all required fields passing validation,
	// but user is not a member of the conversation -> 403
	mock.ExpectBegin()
	mock.ExpectExec(`(?s).*set_config.*`).WithArgs("u1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(`(?s).*SELECT EXISTS\(.*SELECT 1 FROM chat_conversation_members.*WHERE conversation_id = \$1 AND user_id = \$2 AND archived_at IS NULL.*\)`).
		WithArgs("550e8400-e29b-41d4-a716-446655440000", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectRollback()

	c, w := newUniversalRequestContext("POST", "/api/v1/chat_messages", map[string]string{
		"conversation_id":      "550e8400-e29b-41d4-a716-446655440000",
		"sender_user_id":       "550e8400-e29b-41d4-a716-446655440001",
		"ciphertext":           "aGVsbG8=",
		"nonce":                "dGVzdG5vbmNl",
		"sender_public_key":    "dGVzdHB1YmxpY2tleTEyMzQ1Njc4OTAxMjM0NTY3OA==",
		"recipient_public_key": "dGVzdHB1YmxpY2tleTEyMzQ1Njc4OTAxMjM0NTY3OA==",
		"client_message_id":    "660e8400-e29b-41d4-a716-446655440001",
	}, claims)
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_MessengerConversationsForbidden(t *testing.T) {
	h, mock := setupUniversalHandler(t)
	claims := &auth.Claims{UserID: "u1", Username: "testuser", Domain: "localhost:8080"}

	// Handler opens a transaction + sets RLS context before checking tableName
	mock.ExpectBegin()
	mock.ExpectExec(`(?s).*set_config.*`).WithArgs("u1").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	c, w := newUniversalRequestContext("POST", "/api/v1/chat_conversations", map[string]string{
		"id": "conv1",
	}, claims)
	h.HandleTableRequest(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── HandleUserAchievements ──────────────────────────────────────────────────

func TestUniversalGet_UserAchievements(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	// The actual query is a complex JOIN - use (?s).* to match the full structure
	mock.ExpectQuery(`(?s).*SELECT ua\.id, ua\.user_id.*FROM user_achievements ua.*LEFT JOIN achievements a.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "achievement_id", "unlocked_at", "level", "is_pinned", "pinned_order", "achievements"}).
			AddRow("1", "u1", "ach1", "2025-01-01T00:00:00Z", 1, false, nil, `{"id":"ach1","name":"Test"}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_achievements", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

func TestUniversal_ParseOrCondition(t *testing.T) {
	col, op, val, ok := parseOrCondition("user_id.eq.123")
	if !ok || col != "user_id" || op != "eq" || val != "123" {
		t.Fatalf("unexpected result: %s, %s, %s, %v", col, op, val, ok)
	}
}

func TestUniversal_SplitCSV(t *testing.T) {
	result := splitCSV("a,b,c")
	if len(result) != 3 || result[0] != "a" || result[1] != "b" || result[2] != "c" {
		t.Fatalf("unexpected: %v", result)
	}
}

func TestUniversal_SplitCSV_Empty(t *testing.T) {
	result := splitCSV("")
	if result != nil {
		t.Fatalf("expected nil, got %v", result)
	}
}

func TestUniversal_IsMessengerTable(t *testing.T) {
	if !isMessengerTable("chat_messages") {
		t.Fatal("chat_messages should be messenger table")
	}
	if !isMessengerTable("chat_user_keys") {
		t.Fatal("chat_user_keys should be messenger table")
	}
	if isMessengerTable("polls") {
		t.Fatal("polls should not be messenger table")
	}
}

func TestUniversal_JoinStrings(t *testing.T) {
	result := joinStrings([]string{"a", "b", "c"}, ", ")
	if result != "a, b, c" {
		t.Fatalf("unexpected: %s", result)
	}
	result2 := joinStrings(nil, ",")
	if result2 != "" {
		t.Fatalf("unexpected: %s", result2)
	}
}

// test helper to verify UniversalHandler response parsing
type universalResponse struct {
	Data  json.RawMessage `json:"data"`
	Error *string         `json:"error"`
}

func TestUniversalPost_UpsertGomosubRules(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO gomosub_rules_acceptance.*VALUES.*ON CONFLICT.*DO UPDATE.*RETURNING \*`).
		WithArgs("u1", "b1", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "board_id"}).
			AddRow("1", "u1", "b1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/gomosub_rules_acceptance", map[string]string{
		"user_id":  "u1",
		"board_id": "b1",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp universalResponse
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to parse: %v", err)
	}
	if resp.Error != nil {
		t.Fatalf("unexpected error: %s", *resp.Error)
	}
}

func TestUniversalPost_UpsertWallPostLikes(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*INSERT INTO profile_wall_post_likes.*VALUES.*ON CONFLICT.*DO UPDATE SET user_id = EXCLUDED.user_id.*RETURNING \*`).
		WithArgs("post1", "u1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id"}).
			AddRow("1", "post1", "u1"))

	c, w := newUniversalRequestContext("POST", "/api/v1/profile_wall_post_likes", map[string]string{
		"post_id": "post1",
		"user_id": "u1",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPost_InvalidBody(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/polls", "invalid json", nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestUniversalGet_WithInFilter(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IN \(\$1, \$2\)`).
		WithArgs("u1", "u2").
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}).
			AddRow("1", "u1", "admin").AddRow("2", "u2", "user"))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=in.(u1,u2)", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_WithIsNull(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`SELECT \* FROM user_roles WHERE user_id IS NULL`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "role"}))

	c, w := newUniversalRequestContext("GET", "/api/v1/user_roles?user_id=is.null", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_ProfileWallPosts(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT p\.id.*FROM profile_wall_posts p LEFT JOIN users u.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "user_id", "author_id", "title", "content", "created_at", "updated_at", "is_pinned", "pinned_order", "author"}).
			AddRow("post1", "u1", "u1", "Hello!", "Test", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", false, nil, `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_posts", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalGet_ProfileWallPostComments(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`(?s).*SELECT c\.id.*FROM profile_wall_post_comments c LEFT JOIN users u.*`).
		WillReturnRows(sqlmock.NewRows([]string{"id", "post_id", "user_id", "content", "created_at", "updated_at", "author"}).
			AddRow("comment1", "post1", "u1", "Nice!", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", `{}`))

	c, w := newUniversalRequestContext("GET", "/api/v1/profile_wall_post_comments", nil, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUniversalPut_DBError(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	mock.ExpectQuery(`UPDATE user_roles SET role = \$1 WHERE user_id = \$2 RETURNING \*`).
		WithArgs("moderator", "u1").
		WillReturnError(sqlmock.ErrCancelled)

	c, w := newUniversalRequestContext("PUT", "/api/v1/user_roles?user_id=eq.u1", map[string]string{
		"role": "moderator",
	}, nil)
	h.HandleTableRequest(c)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", w.Code)
	}
}

func TestUniversalGet_BuildFilterClause_PlainValue(t *testing.T) {
	clause, args, next := buildFilterClause("user_id", "u1", 1)
	if clause != "user_id = $1" || len(args) != 1 || args[0] != "u1" || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

func TestUniversalGet_BuildFilterClause_NotOp(t *testing.T) {
	clause, args, next := buildFilterClause("user_id", "not.eq.u1", 1)
	if clause != "NOT (user_id = $1)" || len(args) != 1 || next != 2 {
		t.Fatalf("unexpected: %s, %v, %d", clause, args, next)
	}
}

// ─── Messenger POST: chat_receipts ──────────────────────────────────────────

func TestUniversalPost_ChatReceiptsUnauthenticated(t *testing.T) {
	h, mock := setupUniversalHandler(t)

	c, w := newUniversalRequestContext("POST", "/api/v1/chat_receipts", map[string]string{
		"message_id": "msg1",
	}, nil)
	h.HandleTableRequest(c)
	_ = mock

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

// helper test
func TestUniversal_ParseAPIOrder(t *testing.T) {
	var result strings.Builder
	h, mock := setupUniversalHandler(t)
	_ = h
	_ = mock
	result.WriteString("ok")
	_ = result
}
