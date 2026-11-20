package messenger

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
	"github.com/lib/pq"
)

// ─── 1:1 write policy: blocks and a friends-only inbox ──────────────────────
// These are the "can I write to this person at all" rules. They are enforced on
// BOTH entry points — creating the chat and sending into an existing one — so a
// block cannot be bypassed by reusing an old conversation.

func sendToPeer(t *testing.T, _ sqlmock.Sqlmock) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "hello", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages",
		body, claims, map[string]string{"id": testConv1},
	)
	return c, w
}

func TestSendMessage_BlockedByPeer(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, w := sendToPeer(t, mock)
	// The peer (testUser2) blocked me.
	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	expectDirectMessageBlocked(mock, testUser1, testUser2)

	handler.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when blocked, got %d: %s", w.Code, w.Body.String())
	}
	if testing.Verbose() {
		t.Log("blocked send correctly refused")
	}
}

func TestSendMessage_FriendsOnlyInboxRefusesStranger(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, w := sendToPeer(t, mock)
	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	expectDirectMessageFriendsOnly(mock, testUser1, testUser2)

	handler.SendMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a friends-only inbox, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_FriendsOnlyInboxAllowsFriend(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, w := sendToPeer(t, mock)
	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	// allow_private_messages=false BUT they are mutual friends → allowed.
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"blocked", "friends", "allow_dm"}).AddRow(false, true, false))

	now := time.Now()
	msgRows := sqlmock.NewRows(insertMessageRowColumns).
		AddRow(int64(1), testMsg1, testConv1, testUser1, nil, "cipher", "text", nil, 0, nil, false, false, nil, now, testClientID1)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID1, nil, "text", nil, 0, nil).
		WillReturnRows(msgRows)
	mock.ExpectExec(`UPDATE chat_conversations.*SET last_message_preview`).
		WithArgs(sqlmock.AnyArg(), testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for a friend, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_BlockGateSkippedForGroups(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, w := sendToPeer(t, mock)
	// A group has no "other user": the 1:1 gate must not run (and must not
	// accidentally read a random member as the peer).
	expectConversationAccess(mock, testConv1, testUser1, "", true, false, false, "server")

	now := time.Now()
	msgRows := sqlmock.NewRows(insertMessageRowColumns).
		AddRow(int64(1), testMsg1, testConv1, testUser1, nil, "cipher", "text", nil, 0, nil, false, false, nil, now, testClientID1)
	mock.ExpectBegin()
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), testClientID1, nil, "text", nil, 0, nil).
		WillReturnRows(msgRows)
	mock.ExpectExec(`UPDATE chat_conversations.*SET last_message_preview`).
		WithArgs(sqlmock.AnyArg(), testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 in a group, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetOrCreateConversation_BlockedRefused(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser2}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\),`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists", "is_service"}).AddRow(true, false))
	expectDirectMessageBlocked(mock, testUser1, testUser2)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when blocked at creation, got %d: %s", w.Code, w.Body.String())
	}
}

func TestGetOrCreateConversation_FriendsOnlyRefused(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"user_id": testUser2}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations", body, claims, nil)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\),`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists", "is_service"}).AddRow(true, false))
	expectDirectMessageFriendsOnly(mock, testUser1, testUser2)

	handler.GetOrCreateConversation(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a friends-only inbox, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Editing the newest message refreshes the chat-list preview ─────────────

func TestEditMessage_RefreshesPreviewWhenNewest(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "edited text"}
	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001",
		body, claims, map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg(), 0, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The edited message IS the newest one…
	mock.ExpectQuery(`SELECT id\s+FROM chat_messages\s+WHERE conversation_id = \$1 AND is_deleted = false`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(testMsg1))
	// …so the preview is recomputed.
	mock.ExpectQuery(`SELECT content, sent_at, sender_user_id\s+FROM chat_messages`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"content", "sent_at", "sender_user_id"}).
			AddRow("cipher", time.Now(), testUser1))
	mock.ExpectExec(`UPDATE chat_conversations\s+SET last_message_preview = \$1`).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.EditMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_DoesNotTouchPreviewForOlderMessage(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "edited old text"}
	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001",
		body, claims, map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectExec(`UPDATE chat_messages.*SET content = \$4`).
		WithArgs(testMsg1, testConv1, testUser1, sqlmock.AnyArg(), 0, nil).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// A newer message exists → no preview writes are expected at all.
	mock.ExpectQuery(`SELECT id\s+FROM chat_messages\s+WHERE conversation_id = \$1 AND is_deleted = false`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(testMsg2))

	handler.EditMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Message extras: one query feeds all three satellites ──────────────────

func TestFetchMessageExtras_ParsesAllThreeSets(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, _ := testutil.NewGETContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil)
	c.Set("claims", &auth.Claims{UserID: testUser1, Username: "testuser"})

	attachments := `[{"id":"a1","message_id":"` + testMsg1 + `","url":"k/a.jpg","type":"image","name":"a.jpg","size":10,"mime":"image/jpeg","meta":null,"sort_order":0}]`
	reactions := `[{"message_id":"` + testMsg1 + `","emoji":"❤️","user_id":"` + testUser1 + `","username":"testuser","created_at":"2026-01-01T00:00:00Z"}]`
	voice := `[{"message_id":"` + testMsg1 + `","user_id":"` + testUser2 + `"}]`
	expectMessageExtrasJSON(mock, attachments, reactions, voice, pq.Array([]string{testMsg1}))

	atts, chips, listeners, err := handler.fetchMessageExtras(c, []string{testMsg1}, testUser1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(atts[testMsg1]) != 1 || atts[testMsg1][0].URL != "k/a.jpg" {
		t.Fatalf("expected one attachment, got %v", atts[testMsg1])
	}
	if len(chips[testMsg1]) != 1 || !chips[testMsg1][0].Mine || chips[testMsg1][0].Emoji != "❤️" {
		t.Fatalf("expected the viewer's chip, got %v", chips[testMsg1])
	}
	if len(listeners[testMsg1]) != 1 || listeners[testMsg1][0] != testUser2 {
		t.Fatalf("expected one listener, got %v", listeners[testMsg1])
	}
}

func TestBuildReactionChips_OrdersByPopularityThenFirstAppearance(t *testing.T) {
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	rows := []reactionRow{
		{MessageID: "m1", Emoji: "🔥", UserID: "u1", Username: "a", CreatedAt: base},
		{MessageID: "m1", Emoji: "❤️", UserID: "u2", Username: "b", CreatedAt: base.Add(time.Second)},
		{MessageID: "m1", Emoji: "🔥", UserID: "u3", Username: "c", CreatedAt: base.Add(2 * time.Second)},
		{MessageID: "m1", Emoji: "😂", UserID: "u4", Username: "d", CreatedAt: base.Add(3 * time.Second)},
	}
	chips := buildReactionChips(rows, "u1")
	if len(chips["m1"]) != 3 {
		t.Fatalf("expected 3 chips, got %v", chips["m1"])
	}
	// 🔥 has the most people, then the two single chips in first-seen order.
	if chips["m1"][0].Emoji != "🔥" || chips["m1"][0].Count != 2 {
		t.Fatalf("expected 🔥 first with count 2, got %v", chips["m1"][0])
	}
	if chips["m1"][1].Emoji != "❤️" || chips["m1"][2].Emoji != "😂" {
		t.Fatalf("expected stable first-appearance order, got %v", chips["m1"])
	}
	if !chips["m1"][0].Mine {
		t.Fatal("expected mine on the viewer's chip")
	}
}

// ─── Attachment storage keys ────────────────────────────────────────────────

func TestAttachmentStorageKeys_IncludesPreviewDerivative(t *testing.T) {
	meta := `{"preview_key":"u/msg/a.jpg.preview.jpg","thumb_hash":"AAAA"}`
	rows := []attachmentKeyRow{
		{URL: "u/msg/a.jpg", Meta: &meta},
		{URL: "u/msg/b.pdf"},
	}
	keys := attachmentStorageKeys(rows)
	if len(keys) != 3 {
		t.Fatalf("expected 3 keys (2 objects + 1 preview), got %v", keys)
	}
	want := map[string]bool{
		"u/msg/a.jpg":             true,
		"u/msg/a.jpg.preview.jpg": true,
		"u/msg/b.pdf":             true,
	}
	for _, key := range keys {
		if !want[key] {
			t.Fatalf("unexpected key %q", key)
		}
		delete(want, key)
	}
	if len(want) != 0 {
		t.Fatalf("missing keys: %v", want)
	}
}

func TestAttachmentStorageKeys_IgnoresGarbageMeta(t *testing.T) {
	garbage := "not-json"
	rows := []attachmentKeyRow{{URL: "u/msg/a.jpg", Meta: &garbage}}
	keys := attachmentStorageKeys(rows)
	if len(keys) != 1 || keys[0] != "u/msg/a.jpg" {
		t.Fatalf("expected only the object key, got %v", keys)
	}
}

// ─── Integration write path ────────────────────────────────────────────────

func TestDeliverIntegrationMessage_SkipsE2EConversation(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT find_or_create_conversation\(\$1, \$2\)`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"conv"}).AddRow(testConv1))
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT COALESCE\(encryption_mode, 'server'\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))

	msg, err := handler.DeliverIntegrationMessage(t.Context(), testUser1, testUser2, "gift", "gift", nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg != nil {
		t.Fatalf("an E2E conversation must not receive a server-authored message, got %+v", msg)
	}
}

func TestDeliverIntegrationMessage_BadArguments(t *testing.T) {
	handler, _ := setupMessengerHandler(t)
	if _, err := handler.DeliverIntegrationMessage(t.Context(), "", testUser2, "x", "gift", nil, ""); err == nil {
		t.Fatal("empty sender must fail")
	}
	if _, err := handler.DeliverIntegrationMessage(t.Context(), testUser1, testUser1, "x", "gift", nil, ""); err == nil {
		t.Fatal("self-send must fail")
	}
	if _, err := handler.DeliverIntegrationMessage(t.Context(), testUser1, testUser2, "", "gift", nil, ""); err == nil {
		t.Fatal("empty content must fail")
	}
}

// ─── Opaque conversations: preview stays ciphertext ────────────────────────

// A deleted/edited last message in an E2E or notes chat must leave the preview
// as the raw client ciphertext: the server cannot decrypt it, and a plaintext
// preview would both break the client's local decryption and leak nothing
// useful — but storing the decrypted blob would be impossible anyway. This test
// pins "no decrypt attempt, verbatim store".
func TestDeleteMessage_OpaquePreviewStoredVerbatim(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	blob := "e2e1:p256-aesgcm:QUJDREVGR0g="
	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "e2e")
	mock.ExpectQuery(`SELECT EXISTS\(\s+SELECT 1 FROM chat_messages`).
		WithArgs(testMsg1, testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT url, meta FROM message_attachments WHERE message_id = \$1`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"url", "meta"}))
	mock.ExpectExec(`UPDATE chat_messages\s+SET is_deleted = true,`).
		WithArgs(testMsg1, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectDeleteCascade(mock, testMsg1)

	// The surviving newest message is an opaque blob…
	mock.ExpectQuery(`SELECT content, sent_at, sender_user_id\s+FROM chat_messages`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"content", "sent_at", "sender_user_id"}).
			AddRow(blob, time.Now(), testUser2))
	// …and it is written to the preview as-is (no re-encryption of plaintext).
	mock.ExpectExec(`UPDATE chat_conversations\s+SET last_message_preview = \$1`).
		WithArgs(blob, sqlmock.AnyArg(), testUser2, testConv1).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.DeleteMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

// Deleting a message twice must not run the cascade twice: the second call sees
// is_deleted = true and stops at 404.
func TestDeleteMessage_IdempotentOnAlreadyDeleted(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", nil, map[string]string{"id": testConv1, "msgId": testMsg1})
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	mock.ExpectQuery(`SELECT EXISTS\(\s+SELECT 1 FROM chat_messages`).
		WithArgs(testMsg1, testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.DeleteMessage(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an already deleted message, got %d", w.Code)
	}
}

// A blocked pair never receives a server-authored chat entry (the gift itself
// is still recorded; only the bubble is suppressed).
func TestDeliverIntegrationMessage_SkipsBlockedPair(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT find_or_create_conversation\(\$1, \$2\)`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"conv"}).AddRow(testConv1))
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	msg, err := handler.DeliverIntegrationMessage(t.Context(), testUser1, testUser2, "gift", "gift", nil, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg != nil {
		t.Fatalf("a blocked pair must not receive a chat entry, got %+v", msg)
	}
}

// A non-member never reaches the notes-metadata update (membership is answered
// explicitly, not by RLS).
func TestUpdateNotesMeta_NonMemberForbidden(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := UpdateNotesMetaRequest{Meta: "e2enote1:abcdef0123456789abcdef0123456789"}
	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001/notes-meta",
		body, claims, map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectNoConversationAccess(mock, testConv1, testUser1)

	handler.UpdateNotesMeta(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a non-member, got %d: %s", w.Code, w.Body.String())
	}
}

// Attachment meta is JSONB in the database but a JSON *string* in the API (the
// client runs JSON.parse on it). The extras query must cast it to text; this
// test pins the wire shape the parser produces.
func TestFetchMessageExtras_AttachmentMetaStaysAJSONString(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	c, _ := testutil.NewGETContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil)
	c.Set("claims", &auth.Claims{UserID: testUser1, Username: "testuser"})

	metaText := `{"voice":true,"duration":2}`
	// Build the JSON with an encoder so the embedded quotes are escaped exactly
	// like PostgreSQL's json_agg output (a JSON string, not a nested object).
	rowsJSON, marshalErr := json.Marshal([]map[string]any{{
		"id": "a1", "message_id": testMsg1, "url": "k/v.weba", "type": "audio",
		"name": "v.weba", "size": 10, "mime": "audio/webm", "meta": metaText, "sort_order": 0,
	}})
	if marshalErr != nil {
		t.Fatalf("marshal fixture: %v", marshalErr)
	}
	expectMessageExtrasJSON(mock, string(rowsJSON), "[]", "[]", pq.Array([]string{testMsg1}))

	atts, _, _, err := handler.fetchMessageExtras(c, []string{testMsg1}, testUser1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(atts[testMsg1]) != 1 {
		t.Fatalf("expected one attachment, got %v", atts[testMsg1])
	}
	meta := atts[testMsg1][0].Meta
	if meta == nil || *meta != metaText {
		t.Fatalf("expected meta preserved as a JSON string, got %v", meta)
	}
}

// A retried integration delivery with the same idempotency key returns the
// existing bubble (ON CONFLICT DO NOTHING yields no RETURNING row) instead of
// failing the caller or duplicating the message.
func TestDeliverIntegrationMessage_IdempotentRetryReturnsExisting(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	mock.ExpectBegin()
	mock.ExpectExec(`SELECT set_config\('app.current_user_id', \$1, true\)`).
		WithArgs(testUser1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(`SELECT find_or_create_conversation\(\$1, \$2\)`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"conv"}).AddRow(testConv1))
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(testUser1, testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT COALESCE\(encryption_mode, 'server'\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("server"))
	// The insert hits the unique (conversation_id, client_id) constraint.
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, sqlmock.AnyArg(), "gift_gift-1", "gift", sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "event_id", "sent_at"}))
	// The existing row is returned instead.
	now := time.Now()
	mock.ExpectQuery(`SELECT id, event_id, sent_at FROM chat_messages\s+WHERE conversation_id = \$1 AND client_id = \$2`).
		WithArgs(testConv1, "gift_gift-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "event_id", "sent_at"}).AddRow(testMsg1, "7", now))
	mock.ExpectCommit()

	msg, err := handler.DeliverIntegrationMessage(t.Context(), testUser1, testUser2, "gift", "gift", nil, "gift_gift-1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if msg == nil || msg.ID != testMsg1 || msg.ClientID != "gift_gift-1" {
		t.Fatalf("expected the existing message to be returned, got %+v", msg)
	}
}

// ─── Block list API ─────────────────────────────────────────────────────────

func TestBlockUser_InsertsAndIsIdempotent(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/blocks/"+testUser2, nil, claims, map[string]string{"userId": testUser2})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	// ON CONFLICT DO NOTHING makes a repeated block a no-op.
	mock.ExpectExec(`INSERT INTO user_blocks`).
		WithArgs(testUser1, testUser2).
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.BlockUser(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestBlockUser_RejectsSelf(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/blocks/"+testUser1, nil, claims, map[string]string{"userId": testUser1})

	handler.BlockUser(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for blocking yourself, got %d", w.Code)
	}
}

func TestBlockUser_UnknownTarget(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/blocks/"+testUser999, nil, claims, map[string]string{"userId": testUser999})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM users WHERE id = \$1\)`).
		WithArgs(testUser999).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.BlockUser(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 for an unknown user, got %d", w.Code)
	}
}

func TestUnblockUser_DeletesOnlyOwnRow(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/blocks/"+testUser2, nil, map[string]string{"userId": testUser2})
	c.Set("claims", claims)

	// Blocker and blocked ids are both bound: a user can only lift their own block.
	mock.ExpectExec(`DELETE FROM user_blocks WHERE blocker_id = \$1 AND blocked_id = \$2`).
		WithArgs(testUser1, testUser2).
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.UnblockUser(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListBlockedUsers_ScopedToTheCaller(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContext("/api/v1/messenger/blocks", nil)
	c.Set("claims", claims)

	blockedAt := time.Date(2026, 2, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(`FROM user_blocks b`).
		WithArgs(testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"blocked_id", "username", "display_name", "avatar_url", "created_at"}).
			AddRow(testUser2, "bob", "Bob", "u/bob.png", blockedAt))

	handler.ListBlockedUsers(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, testUser2) || !strings.Contains(body, `"username":"bob"`) {
		t.Fatalf("expected the blocked entry in the response, got %s", body)
	}
}

// ─── Shared-state mutations obey the block ─────────────────────────────────

func TestToggleReaction_BlockedPairForbidden(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1+"/reactions",
		map[string]string{"emoji": "❤️"}, claims, map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	expectDirectMessageBlocked(mock, testUser1, testUser2)

	handler.ToggleReaction(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a blocked pair, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTogglePin_BlockedPairForbidden(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := map[string]string{"message_id": testMsg1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/"+testConv1+"/pin", body, claims, map[string]string{"id": testConv1})

	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	expectDirectMessageBlocked(mock, testUser1, testUser2)

	handler.TogglePin(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a blocked pair, got %d: %s", w.Code, w.Body.String())
	}
}

func TestEditMessage_BlockedPairForbidden(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "edit"}
	c, w := testutil.NewPUTContext(
		"/api/v1/messenger/conversations/"+testConv1+"/messages/"+testMsg1,
		body, claims, map[string]string{"id": testConv1, "msgId": testMsg1},
	)

	expectConversationAccess(mock, testConv1, testUser1, testUser2, false, false, false, "server")
	expectDirectMessageBlocked(mock, testUser1, testUser2)

	handler.EditMessage(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a blocked pair, got %d: %s", w.Code, w.Body.String())
	}
}

// ─── Specific-message mode (notes pinned strip) ────────────────────────────

func TestGetMessages_ByIDs(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/messages?ids="+testMsg1+","+testMsg2,
		nil, map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")
	now := time.Now()
	mock.ExpectQuery(`FROM chat_messages m.*WHERE m.conversation_id = \$1 AND m.id = ANY\(\$2::uuid\[\]\)`).
		WithArgs(testConv1, pq.Array([]string{testMsg1, testMsg2})).
		WillReturnRows(sqlmock.NewRows(messageRowColumns).
			AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, "one", "text", nil, 0, nil, false, false, nil, now, "c1").
			AddRow(int64(2), testMsg2, testConv1, testUser2, "bob", nil, "two", "text", nil, 0, nil, false, false, nil, now, "c2"))
	expectMessageExtras(mock, pq.Array([]string{testMsg1, testMsg2}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(data) != 2 {
		t.Fatalf("expected both requested messages, got %v", data)
	}
	first, _ := data[0].(map[string]interface{})
	second, _ := data[1].(map[string]interface{})
	if first["id"] != testMsg1 || second["id"] != testMsg2 {
		t.Fatalf("expected chronological order of the requested ids, got %v", data)
	}
}

func TestGetMessages_ByIDsRejectsInvalid(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/messages?ids=not-a-uuid",
		nil, map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")

	handler.GetMessages(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for a non-uuid id, got %d", w.Code)
	}
}

func TestGetMessages_ByIDsRejectsTooMany(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	ids := make([]string, 51)
	for i := range ids {
		ids[i] = fmt.Sprintf("00000000-0000-0000-0000-%012d", i)
	}
	c, w := testutil.NewGETContextWithParams(
		"/api/v1/messenger/conversations/"+testConv1+"/messages?ids="+strings.Join(ids, ","),
		nil, map[string]string{"id": testConv1},
	)
	c.Set("claims", claims)

	expectConversationAccess(mock, testConv1, testUser1, "", false, false, false, "server")

	handler.GetMessages(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 above the id cap, got %d", w.Code)
	}
}
