package gomosubchat

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

const testChannel = "10000000-0000-0000-0000-0000000000aa"
const testUser = "20000000-0000-0000-0000-0000000000bb"
const testUser2 = "20000000-0000-0000-0000-0000000000cc"

func setupChatHandler(t *testing.T) (*Handler, sqlmock.Sqlmock) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("failed to open sqlmock: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return NewHandler(db, nil), mock
}

type chatResponse struct {
	Success bool            `json:"success"`
	Error   string          `json:"error"`
	Data    json.RawMessage `json:"data"`
}

func decodeChat(t *testing.T, body []byte) chatResponse {
	t.Helper()
	var r chatResponse
	if err := json.Unmarshal(body, &r); err != nil {
		t.Fatalf("failed to unmarshal response %q: %v", string(body), err)
	}
	return r
}

const readAccessPattern = `SELECT EXISTS\(\s*SELECT 1 FROM channels ch`
const writeAccessPattern = `SELECT b\.owner_id::text = \$2\s*OR\s*\(\s*EXISTS\(`

// ─── GetMessages ─────────────────────────────────────────────────────────────

func TestGetMessages_Success(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		nil, map[string]string{"id": testChannel})
	c.Set("claims", &auth.Claims{UserID: testUser, Username: "tester"})

	mock.ExpectQuery(readAccessPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	now := time.Now()
	rows := sqlmock.NewRows([]string{
		"id", "channel_id", "user_id", "username", "avatar_url",
		"content", "edited_at", "deleted_at", "created_at",
	}).
		AddRow(int64(2), testChannel, testUser2, "bob", nil, "Второе!", nil, nil, now.Add(time.Minute)).
		AddRow(int64(1), testChannel, testUser, "tester", "a.png", "Привет!", nil, nil, now)

	mock.ExpectQuery(`SELECT m\.id, m\.channel_id.*ORDER BY m\.id DESC LIMIT \$?`).
		WithArgs(testChannel).
		WillReturnRows(rows)

	h.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	r := decodeChat(t, w.Body.Bytes())
	if !r.Success {
		t.Fatalf("expected success")
	}
	var msgs []map[string]interface{}
	if err := json.Unmarshal(r.Data, &msgs); err != nil {
		t.Fatalf("data is not an array: %v", err)
	}
	if len(msgs) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(msgs))
	}
	// Newest-first SQL window must be returned oldest→newest for timeline append.
	if msgs[0]["id"].(float64) != 1 || msgs[1]["id"].(float64) != 2 {
		t.Errorf("expected oldest first, got ids %v, %v", msgs[0]["id"], msgs[1]["id"])
	}
}

func TestGetMessages_BeforeCursor(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		map[string]string{"before": "5", "limit": "10"}, map[string]string{"id": testChannel})
	c.Set("claims", &auth.Claims{UserID: testUser, Username: "tester"})

	mock.ExpectQuery(readAccessPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectQuery(`SELECT m\.id, m\.channel_id.*AND m\.id < \$.*ORDER BY m\.id DESC`).
		WithArgs(testChannel, int64(5)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "channel_id", "user_id", "username", "avatar_url",
			"content", "edited_at", "deleted_at", "created_at",
		}))

	h.GetMessages(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
}

func TestGetMessages_NoAccess(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewGETContextWithParams(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		nil, map[string]string{"id": testChannel})
	c.Set("claims", &auth.Claims{UserID: testUser2, Username: "bob"})

	mock.ExpectQuery(readAccessPattern).
		WithArgs(testChannel, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	h.GetMessages(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestGetMessages_InvalidChannelID(t *testing.T) {
	h, _ := setupChatHandler(t)
	c, w := testutil.NewGETContextWithParams(
		"/api/v1/gomosubchat/channels/nope/messages", nil, map[string]string{"id": "nope"})
	c.Set("claims", &auth.Claims{UserID: testUser, Username: "tester"})
	h.GetMessages(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

// ─── SendMessage ─────────────────────────────────────────────────────────────

func TestSendMessage_HappyPath(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPOSTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		map[string]string{"content": "  привет  "},
		&auth.Claims{UserID: testUser, Username: "tester"},
		map[string]string{"id": testChannel})

	mock.ExpectQuery(`SELECT kind FROM channels WHERE id = \$1`).
		WithArgs(testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"kind"}).AddRow("text"))

	mock.ExpectQuery(writeAccessPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(true))

	mock.ExpectQuery(`INSERT INTO channel_messages \(channel_id, user_id, content\) VALUES \(\$1, \$2, \$3\) RETURNING id, created_at`).
		WithArgs(testChannel, testUser, "привет").
		WillReturnRows(sqlmock.NewRows([]string{"id", "created_at"}).AddRow(int64(7), time.Now()))

	mock.ExpectQuery(`SELECT u\.username, u\.avatar_url FROM users u WHERE u\.id = \$1`).
		WithArgs(testUser).
		WillReturnRows(sqlmock.NewRows([]string{"username", "avatar_url"}).AddRow("tester", "pic.png"))

	h.SendMessage(c)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d. Body: %s", w.Code, w.Body.String())
	}
	r := decodeChat(t, w.Body.Bytes())
	var msg map[string]interface{}
	if err := json.Unmarshal(r.Data, &msg); err != nil {
		t.Fatalf("data is not an object: %v", err)
	}
	if msg["id"].(float64) != 7 {
		t.Errorf("expected id 7, got %v", msg["id"])
	}
	// Content must be trimmed server-side.
	if msg["content"] != "привет" {
		t.Errorf("expected trimmed content, got %q", msg["content"])
	}
	// The WS payload target — clients join by channel_id.
	if msg["channel_id"] != testChannel {
		t.Errorf("expected channel_id echo, got %v", msg["channel_id"])
	}
}

func TestSendMessage_ForumChannelRejected(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPOSTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		map[string]string{"content": "hi"},
		&auth.Claims{UserID: testUser, Username: "tester"},
		map[string]string{"id": testChannel})

	mock.ExpectQuery(`SELECT kind FROM channels WHERE id = \$1`).
		WithArgs(testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"kind"}).AddRow("forum"))

	h.SendMessage(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for forum channel, got %d", w.Code)
	}
}

func TestSendMessage_NoWriteAccess(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPOSTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		map[string]string{"content": "hi"},
		&auth.Claims{UserID: testUser2, Username: "bob"},
		map[string]string{"id": testChannel})

	mock.ExpectQuery(`SELECT kind FROM channels WHERE id = \$1`).
		WithArgs(testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"kind"}).AddRow("text"))

	mock.ExpectQuery(writeAccessPattern).
		WithArgs(testChannel, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(false))

	h.SendMessage(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestSendMessage_EmptyContent(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPOSTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages",
		map[string]string{"content": "   \n\t "},
		&auth.Claims{UserID: testUser, Username: "tester"},
		map[string]string{"id": testChannel})

	h.SendMessage(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blank content, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("blank content must not touch the DB: %v", err)
	}
}

// ─── EditMessage ─────────────────────────────────────────────────────────────

const loadMsgPattern = `SELECT user_id, deleted_at IS NULL FROM channel_messages WHERE id = \$1 AND channel_id = \$2`

func msgRow(userID string, alive bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"user_id", "?column?"}).AddRow(userID, alive)
}

func TestEditMessage_Own(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPUTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/11",
		map[string]string{"content": "исправлено"},
		&auth.Claims{UserID: testUser, Username: "tester"},
		map[string]string{"id": testChannel, "msgId": "11"})

	mock.ExpectQuery(loadMsgPattern).
		WithArgs(int64(11), testChannel).
		WillReturnRows(msgRow(testUser, true))

	mock.ExpectQuery(writeAccessPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(true))

	mock.ExpectExec(`UPDATE channel_messages SET content = \$3, edited_at = NOW\(\) WHERE id = \$1 AND channel_id = \$2`).
		WithArgs(int64(11), testChannel, "исправлено").
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(`SELECT m\.id, m\.channel_id.*WHERE m\.channel_id = \$1 AND m\.id = \$2`).
		WithArgs(testChannel, int64(11)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "channel_id", "user_id", "username", "avatar_url",
			"content", "edited_at", "deleted_at", "created_at",
		}).AddRow(int64(11), testChannel, testUser, "tester", nil, "исправлено", time.Now(), nil, time.Now()))

	h.EditMessage(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_ForeignForbidden(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPUTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/11",
		map[string]string{"content": "hack"},
		&auth.Claims{UserID: testUser2, Username: "bob"},
		map[string]string{"id": testChannel, "msgId": "11"})

	mock.ExpectQuery(loadMsgPattern).
		WithArgs(int64(11), testChannel).
		WillReturnRows(msgRow(testUser, true)) // чужое

	h.EditMessage(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("foreign edits must stop before any write: %v", err)
	}
}

func TestEditMessage_DeletedGone(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewPUTContext(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/11",
		map[string]string{"content": "x"},
		&auth.Claims{UserID: testUser, Username: "tester"},
		map[string]string{"id": testChannel, "msgId": "11"})

	mock.ExpectQuery(loadMsgPattern).
		WithArgs(int64(11), testChannel).
		WillReturnRows(msgRow(testUser, false))

	h.EditMessage(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for deleted message, got %d", w.Code)
	}
}

// ─── DeleteMessage ───────────────────────────────────────────────────────────

const loadDeleteablePattern = `SELECT user_id FROM channel_messages WHERE id = \$1 AND channel_id = \$2 AND deleted_at IS NULL`

func TestDeleteMessage_Own(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewDELETEContextWithClaims(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/12",
		nil, map[string]string{"id": testChannel, "msgId": "12"},
		&auth.Claims{UserID: testUser, Username: "tester"})

	mock.ExpectQuery(loadDeleteablePattern).
		WithArgs(int64(12), testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(testUser))

	mock.ExpectExec(`UPDATE channel_messages SET deleted_at = NOW\(\) WHERE id = \$1 AND channel_id = \$2 AND deleted_at IS NULL`).
		WithArgs(int64(12), testChannel).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(`SELECT m\.id, m\.channel_id.*WHERE m\.channel_id = \$1 AND m\.id = \$2`).
		WithArgs(testChannel, int64(12)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "channel_id", "user_id", "username", "avatar_url",
			"content", "edited_at", "deleted_at", "created_at",
		}).AddRow(int64(12), testChannel, testUser, "tester", nil, "", nil, time.Now(), time.Now()))

	h.DeleteMessage(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
	r := decodeChat(t, w.Body.Bytes())
	var msg map[string]interface{}
	if err := json.Unmarshal(r.Data, &msg); err != nil {
		t.Fatal(err)
	}
	if msg["content"] != "" {
		t.Errorf("deleted payload must carry no content, got %q", msg["content"])
	}
	if msg["deleted_at"] == nil {
		t.Error("deleted_at must be set in the response")
	}
}

func TestDeleteMessage_ModeratorCan(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewDELETEContextWithClaims(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/13",
		nil, map[string]string{"id": testChannel, "msgId": "13"},
		&auth.Claims{UserID: testUser, Username: "tester"})

	mock.ExpectQuery(loadDeleteablePattern).
		WithArgs(int64(13), testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(testUser2)) // чужое

	// Moderation predicate (owner or can_delete_threads role)
	mock.ExpectQuery(readAccessPattern).
		WithArgs(testChannel, testUser).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	mock.ExpectExec(`UPDATE channel_messages SET deleted_at = NOW\(\)`).
		WithArgs(int64(13), testChannel).
		WillReturnResult(sqlmock.NewResult(0, 1))

	mock.ExpectQuery(`SELECT m\.id, m\.channel_id.*WHERE m\.channel_id = \$1 AND m\.id = \$2`).
		WithArgs(testChannel, int64(13)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "channel_id", "user_id", "username", "avatar_url",
			"content", "edited_at", "deleted_at", "created_at",
		}).AddRow(int64(13), testChannel, testUser2, "bob", nil, "", nil, time.Now(), time.Now()))

	h.DeleteMessage(c)
	if w.Code != http.StatusOK {
		t.Fatalf("moderator delete expected 200, got %d. Body: %s", w.Code, w.Body.String())
	}
}

func TestDeleteMessage_ForeignForbidden(t *testing.T) {
	h, mock := setupChatHandler(t)

	c, w := testutil.NewDELETEContextWithClaims(
		"/api/v1/gomosubchat/channels/"+testChannel+"/messages/14",
		nil, map[string]string{"id": testChannel, "msgId": "14"},
		&auth.Claims{UserID: testUser2, Username: "bob"})

	mock.ExpectQuery(loadDeleteablePattern).
		WithArgs(int64(14), testChannel).
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow(testUser))

	mock.ExpectQuery(readAccessPattern).
		WithArgs(testChannel, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	h.DeleteMessage(c)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
