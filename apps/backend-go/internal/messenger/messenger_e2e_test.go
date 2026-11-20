package messenger

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/testutil"
)

// ─── E2E envelope ────────────────────────────────────────────────────────────

func TestParseE2EEnvelope_Valid(t *testing.T) {
	alg, body, ok := parseE2EEnvelope("e2e1:p256-aesgcm:QUJDRA==")
	if !ok {
		t.Fatal("expected valid envelope to parse")
	}
	if alg != e2eAlgP256AESGCM {
		t.Fatalf("expected alg %q, got %q", e2eAlgP256AESGCM, alg)
	}
	if body != "QUJDRA==" {
		t.Fatalf("expected body preserved, got %q", body)
	}
}

func TestParseE2EEnvelope_Invalid(t *testing.T) {
	for _, bad := range []string{
		"",
		"plain text",
		"e2enote1:abcdef",
		"e2e1:",
		"e2e1::body",
		"e2e1:unknown-alg:QUJD",
		"e2e1:p256-aesgcm:",
	} {
		if _, _, ok := parseE2EEnvelope(bad); ok {
			t.Fatalf("expected %q to be rejected", bad)
		}
	}
}

func TestValidateE2EPayload_TooLarge(t *testing.T) {
	big := "e2e1:p256-aesgcm:" + strings.Repeat("A", maxE2EContentLen)
	if err := validateE2EPayload(big); err == nil {
		t.Fatal("expected oversized payload to be rejected")
	}
}

// ─── Opaque 1:1 conversation: send / edit / read ────────────────────────────

func setupE2EConversationMocks(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("server"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
}

func TestSendMessage_E2ERejectsPlaintext(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "plaintext must never enter an e2e chat", ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext in e2e chat, got %d: %s", w.Code, w.Body.String())
	}
}

func TestSendMessage_E2EStoresVerbatim(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	blob := "e2e1:p256-aesgcm:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWQ=="
	body := SendMessageRequest{Content: blob, ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectBegin()

	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(11), "20000000-0000-0000-0000-000000000011", testConv1, testUser1, nil, blob, "text", nil, 1, "p256-aesgcm", false, false, nil, now, testClientID1)

	// The opaque blob must be stored verbatim with the envelope version.
	mock.ExpectQuery(`INSERT INTO chat_messages`).
		WithArgs(testConv1, testUser1, blob, testClientID1, nil, "text", nil, 1, "p256-aesgcm").
		WillReturnRows(msgRows)
	mock.ExpectExec(`UPDATE chat_conversations.*SET last_message_preview`).
		WithArgs(blob, testUser1, testConv1).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	handler.SendMessage(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSON(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if data["content"] != blob {
		t.Fatalf("expected opaque blob echoed back, got %v", data["content"])
	}
}

func TestGetMessages_E2EPassthrough(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", nil, map[string]string{"id": testConv1})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))

	blob := "e2e1:p256-aesgcm:QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWQ=="
	now := time.Now()
	msgRows := sqlmock.NewRows([]string{
		"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
		"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
		"edited_at", "sent_at", "client_id",
	}).AddRow(int64(1), testMsg1, testConv1, testUser1, "testuser", nil, blob, "text", nil, 1, "p256-aesgcm", false, false, nil, now, "c1")

	mock.ExpectQuery(`SELECT m.event_id, m.id, m.conversation_id, m.sender_user_id, u.username AS sender_username,.*FROM chat_messages m.*LEFT JOIN users u.*WHERE m.conversation_id = \$1.*ORDER BY m.sent_at DESC.*LIMIT \$2`).
		WithArgs(testConv1, 50).
		WillReturnRows(msgRows)
	mock.ExpectQuery(`SELECT id, message_id, url, type, name, size, mime, meta, sort_order FROM message_attachments WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"id", "message_id", "url", "type", "name", "size", "mime", "meta", "sort_order"}))
	mock.ExpectQuery(`SELECT r.message_id, r.emoji, r.user_id, COALESCE\(u.username, ''\), r.created_at.*FROM message_reactions r`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "emoji", "user_id", "username", "created_at"}))
	mock.ExpectQuery(`SELECT message_id, user_id FROM message_voice_listens WHERE message_id IN`).
		WithArgs(testMsg1).
		WillReturnRows(sqlmock.NewRows([]string{"message_id", "user_id"}))

	handler.GetMessages(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 message, got %d", len(data))
	}
	first := data[0].(map[string]interface{})
	// The server must never decrypt: the blob passes through verbatim and the
	// envelope version is exposed for the client.
	if first["content"] != blob {
		t.Fatalf("expected opaque passthrough, got %v", first["content"])
	}
	enc, ok := first["enc"].(map[string]interface{})
	if !ok || enc["v"] != float64(1) {
		t.Fatalf("expected enc.v=1, got %v", first["enc"])
	}
}

func TestSendMessage_E2EAttachmentOnlyAllowed(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{
		Content:  "",
		ClientID: testClientID1,
		Attachments: []AttachmentInput{{
			URL:  testUser1 + "/messenger/photo.jpg",
			Type: "image",
			Name: "photo.jpg",
			Size: 1024,
			Mime: "image/jpeg",
		}},
	}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// A caption-less media message in an e2e chat is legitimate: the envelope
	// only exists for text, so an empty content with attachments must pass
	// validation and reach the attachment check (storage is nil here → 400).
	handler.SendMessage(c)

	if strings.Contains(w.Body.String(), "Content required") {
		t.Fatalf("attachment-only e2e message must not be rejected as missing content: %s", w.Body.String())
	}
}

func TestSendMessage_E2ERejectsOversized(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := SendMessageRequest{Content: "e2e1:p256-aesgcm:" + strings.Repeat("A", maxE2EContentLen), ClientID: testClientID1}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages", body, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))

	handler.SendMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized e2e payload, got %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "too large") {
		t.Fatalf("expected the size error, got: %s", w.Body.String())
	}
}

func TestEditMessage_E2ERejectsPlaintext(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := EditMessageRequest{Content: "plaintext edit"}
	c, w := testutil.NewPUTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/messages/20000000-0000-0000-0000-000000000001", body, claims, map[string]string{"id": testConv1, "msgId": testMsg1})

	mock.ExpectQuery(`SELECT COALESCE\(is_notes, false\) FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_notes"}).AddRow(false))
	mock.ExpectQuery(`SELECT encryption_mode FROM chat_conversations WHERE id = \$1`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"encryption_mode"}).AddRow("e2e"))

	handler.EditMessage(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext edit in e2e chat, got %d", w.Code)
	}
}

// ─── Key directory ───────────────────────────────────────────────────────────

func TestPutDeviceKey_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	body := PutDeviceKeyRequest{DeviceID: "dev-1", PublicKey: "MCowBQYDK2VwAyEAbGFyZ2VwdWJsaWNrZXlmb3J0ZXN0aW5nMTIzNA", Alg: "p256-aesgcm"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/keys", body, claims, nil)

	mock.ExpectQuery(`INSERT INTO messenger_device_keys`).
		WithArgs(testUser1, "dev-1", "MCowBQYDK2VwAyEAbGFyZ2VwdWJsaWNrZXlmb3J0ZXN0aW5nMTIzNA", "p256-aesgcm").
		WillReturnRows(sqlmock.NewRows([]string{"updated_at"}).AddRow(time.Now().UTC().Format(time.RFC3339)))

	handler.PutDeviceKey(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestPutDeviceKey_RejectsBlank(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/keys", map[string]string{"device_id": "", "public_key": ""}, claims, nil)

	handler.PutDeviceKey(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestGetUserKeys_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/users/00000000-0000-0000-0000-000000000002/keys", nil, map[string]string{"userId": testUser2})
	c.Set("claims", claims)

	mock.ExpectQuery(`SELECT user_id, device_id, public_key, alg, updated_at FROM messenger_device_keys WHERE user_id = \$1`).
		WithArgs(testUser2).
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "device_id", "public_key", "alg", "updated_at"}).
			AddRow(testUser2, "dev-9", "MCowBQYDK2VwAyEAcGVlcnB1YmxpY2tleWZvcmhlYW5kc2hha2Ux", "p256-aesgcm", time.Now().UTC().Format(time.RFC3339)))

	handler.GetUserKeys(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	data, err := stripJSONArray(w.Body.Bytes())
	if err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}
	if len(data) != 1 {
		t.Fatalf("expected 1 key, got %d", len(data))
	}
}

func TestGetUserKeys_InvalidUser(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewGETContextWithParams("/api/v1/messenger/users/not-a-uuid/keys", nil, map[string]string{"userId": "not-a-uuid"})
	c.Set("claims", claims)

	handler.GetUserKeys(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestDeleteDeviceKey_NotFound(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewDELETEContext("/api/v1/messenger/keys/dev-404", nil, map[string]string{"deviceId": "dev-404"})
	c.Set("claims", claims)

	mock.ExpectExec(`DELETE FROM messenger_device_keys WHERE user_id = \$1 AND device_id = \$2`).
		WithArgs(testUser1, "dev-404").
		WillReturnResult(sqlmock.NewResult(0, 0))

	handler.DeleteDeviceKey(c)

	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ─── Encryption mode switch ──────────────────────────────────────────────────

func TestUpdateEncryptionMode_Success(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/encryption", map[string]string{"mode": "e2e"}, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT COALESCE\(is_group, false\), COALESCE\(is_notes, false\), COALESCE\(is_service, false\)`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_group", "is_notes", "is_service"}).AddRow(false, false, false))
	mock.ExpectExec(`UPDATE chat_conversations SET encryption_mode`).
		WithArgs(testConv1, "e2e").
		WillReturnResult(sqlmock.NewResult(0, 1))

	handler.UpdateEncryptionMode(c)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}

func TestUpdateEncryptionMode_RejectsGroup(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/encryption", map[string]string{"mode": "e2e"}, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT COALESCE\(is_group, false\), COALESCE\(is_notes, false\), COALESCE\(is_service, false\)`).
		WithArgs(testConv1).
		WillReturnRows(sqlmock.NewRows([]string{"is_group", "is_notes", "is_service"}).AddRow(true, false, false))

	handler.UpdateEncryptionMode(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for group chat, got %d", w.Code)
	}
}

func TestUpdateEncryptionMode_RejectsBadMode(t *testing.T) {
	handler, _ := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/encryption", map[string]string{"mode": "rot13"}, claims, map[string]string{"id": testConv1})

	handler.UpdateEncryptionMode(c)

	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unknown mode, got %d", w.Code)
	}
}

func TestUpdateEncryptionMode_NotMember(t *testing.T) {
	handler, mock := setupMessengerHandler(t)

	claims := &auth.Claims{UserID: testUser1, Username: "testuser"}
	c, w := testutil.NewPOSTContext("/api/v1/messenger/conversations/10000000-0000-0000-0000-000000000001/encryption", map[string]string{"mode": "e2e"}, claims, map[string]string{"id": testConv1})

	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM chat_members WHERE conversation_id = \$1 AND user_id = \$2\)`).
		WithArgs(testConv1, testUser1).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	handler.UpdateEncryptionMode(c)

	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}
