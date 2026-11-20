package messenger

import (
	"database/sql/driver"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
	"github.com/gomo6/backend/internal/auth"
	"github.com/gomo6/backend/internal/crypto"
	"github.com/gomo6/backend/internal/models"
)

// ─── Test UUIDs ──────────────────────────────────────────────────────────────
const (
	testUser1     = "00000000-0000-0000-0000-000000000001"
	testUser2     = "00000000-0000-0000-0000-000000000002"
	testUser3     = "00000000-0000-0000-0000-000000000003"
	testUser999   = "00000000-0000-0000-0000-000000000999"
	testConv1     = "10000000-0000-0000-0000-000000000001"
	testConv2     = "10000000-0000-0000-0000-000000000002"
	testMsg1      = "20000000-0000-0000-0000-000000000001"
	testMsg2      = "20000000-0000-0000-0000-000000000002"
	testMsg3      = "20000000-0000-0000-0000-000000000003"
	testMsg5      = "20000000-0000-0000-0000-000000000005"
	testMsg999    = "20000000-0000-0000-0000-000000000999"
	testClientID1 = "c1"
	testClientID2 = "c2"
	testClientID3 = "c3"
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

// ─── Phase-3 test helpers ────────────────────────────────────────────────────

// expectConversationAccess mocks the single access query that answers
// membership + conversation kind + encryption mode + the 1:1 peer.
func expectConversationAccess(mock sqlmock.Sqlmock, convID, userID, otherUser string, isGroup, isNotes, isService bool, mode string) {
	mock.ExpectQuery(`FROM chat_conversations c`).
		WithArgs(convID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "is_member", "is_group", "is_notes", "is_service", "encryption_mode", "other_user",
		}).AddRow(convID, true, isGroup, isNotes, isService, mode, otherUser))
}

// expectConversationAccessError mocks a failing access lookup.
func expectConversationAccessError(mock sqlmock.Sqlmock, convID, userID string, err error) {
	mock.ExpectQuery(`FROM chat_conversations c`).
		WithArgs(convID, userID).
		WillReturnError(err)
}

// expectNoConversationAccess mocks the access query for a non-member: the row is
// visible but the explicit membership predicate is false.
func expectNoConversationAccess(mock sqlmock.Sqlmock, convID, userID string) {
	mock.ExpectQuery(`FROM chat_conversations c`).
		WithArgs(convID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "is_member", "is_group", "is_notes", "is_service", "encryption_mode", "other_user",
		}).AddRow(convID, false, false, false, false, "server", ""))
}

// expectMessageExtras mocks the single extras query (attachments + reactions +
// voice listens) with empty JSON arrays.
func expectMessageExtras(mock sqlmock.Sqlmock, ids ...driver.Value) {
	mock.ExpectQuery(`SELECT\s+COALESCE\(\(`).
		WithArgs(ids...).
		WillReturnRows(sqlmock.NewRows([]string{"attachments", "reactions", "voice"}).
			AddRow([]byte("[]"), []byte("[]"), []byte("[]")))
}

// expectMessageExtrasJSON mocks the extras query with explicit JSON payloads.
func expectMessageExtrasJSON(mock sqlmock.Sqlmock, attachments, reactions, voice string, ids ...driver.Value) {
	mock.ExpectQuery(`SELECT\s+COALESCE\(\(`).
		WithArgs(ids...).
		WillReturnRows(sqlmock.NewRows([]string{"attachments", "reactions", "voice"}).
			AddRow([]byte(attachments), []byte(reactions), []byte(voice)))
}

// expectDirectMessageAllowed mocks the 1:1 write gate as allowed.
func expectDirectMessageAllowed(mock sqlmock.Sqlmock, senderID, recipientID string) {
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(senderID, recipientID).
		WillReturnRows(sqlmock.NewRows([]string{"blocked", "friends", "allow_dm"}).AddRow(false, false, true))
}

// expectDirectMessageBlocked mocks the 1:1 write gate as blocked.
func expectDirectMessageBlocked(mock sqlmock.Sqlmock, senderID, recipientID string) {
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(senderID, recipientID).
		WillReturnRows(sqlmock.NewRows([]string{"blocked", "friends", "allow_dm"}).AddRow(true, false, true))
}

// expectDirectMessageFriendsOnly mocks a friends-only inbox for a non-friend.
func expectDirectMessageFriendsOnly(mock sqlmock.Sqlmock, senderID, recipientID string) {
	mock.ExpectQuery(`FROM user_blocks`).
		WithArgs(senderID, recipientID).
		WillReturnRows(sqlmock.NewRows([]string{"blocked", "friends", "allow_dm"}).AddRow(false, false, false))
}

// insertMessageRowColumns is the RETURNING projection of a message insert
// (no sender_username join).
var insertMessageRowColumns = []string{
	"event_id", "id", "conversation_id", "sender_user_id", "parent_message_id",
	"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
	"edited_at", "sent_at", "client_id",
}

// expectMessageRowColumns is the shared column list of a chat_messages page row.
var messageRowColumns = []string{
	"event_id", "id", "conversation_id", "sender_user_id", "sender_username", "parent_message_id",
	"content", "type", "payload", "enc_v", "enc_alg", "is_edited", "is_deleted",
	"edited_at", "sent_at", "client_id",
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
// expectServiceConversationAccess mocks the access query for a service thread.
func expectServiceConversationAccess(mock sqlmock.Sqlmock, convID, userID string) {
	mock.ExpectQuery(`FROM chat_conversations c`).
		WithArgs(convID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "is_member", "is_group", "is_notes", "is_service", "encryption_mode", "other_user",
		}).AddRow(convID, true, false, false, true, "server", ""))
}

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
		{"math comparisons ok", "a < b && c > d", true, "a < b && c > d"},
		{"heart emoticon ok", "<3", true, "<3"},
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
		{"a < b && c > d", false},
		{"<3", false},
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

func TestNormalizeMessageEnvelope(t *testing.T) {
	giftMsg := MessageResponse{Content: "__GIFT__:g-1:Роза:/gift.png"}
	normalizeMessageEnvelope(&giftMsg)
	if giftMsg.Type != "gift" {
		t.Fatalf("expected type=gift, got %q", giftMsg.Type)
	}
	if len(giftMsg.Payload) == 0 {
		t.Fatal("expected gift payload to be populated")
	}

	shareMsg := MessageResponse{Content: "__SHARE__:thread:t-42"}
	normalizeMessageEnvelope(&shareMsg)
	if shareMsg.Type != "share" {
		t.Fatalf("expected type=share, got %q", shareMsg.Type)
	}
	if len(shareMsg.Payload) == 0 {
		t.Fatal("expected share payload to be populated")
	}

	voiceMeta := `{"voice":true,"duration":4.2,"waveform":[10,20,30]}`
	voiceMsg := MessageResponse{
		Content:     "",
		Attachments: []Attachment{{Type: "audio", Meta: &voiceMeta}},
	}
	normalizeMessageEnvelope(&voiceMsg)
	if voiceMsg.Type != "voice" {
		t.Fatalf("expected type=voice, got %q", voiceMsg.Type)
	}

	mediaMsg := MessageResponse{
		Content:     "",
		Attachments: []Attachment{{Type: "image", URL: "u1/messenger/img.jpg"}},
	}
	normalizeMessageEnvelope(&mediaMsg)
	if mediaMsg.Type != "media" {
		t.Fatalf("expected type=media, got %q", mediaMsg.Type)
	}

	textMsg := MessageResponse{Content: "hello"}
	normalizeMessageEnvelope(&textMsg)
	if textMsg.Type != "text" {
		t.Fatalf("expected type=text, got %q", textMsg.Type)
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
	// Use a local 32-byte key so the test does not depend on the process env var.
	key := []byte("test-key-exactly-32-bytes-here!!")

	plaintext := "Hello, secure world!"
	encrypted, err := crypto.Encrypt(key, plaintext)
	if err != nil {
		t.Fatalf("crypto.Encrypt failed: %v", err)
	}
	if encrypted == plaintext {
		t.Fatal("encrypted content should differ from plaintext")
	}

	decrypted, err := crypto.Decrypt(key, encrypted)
	if err != nil {
		t.Fatalf("crypto.Decrypt failed: %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("decrypt mismatch: got %q, want %q", decrypted, plaintext)
	}
}

func TestEncryptDecrypt_NoKey(t *testing.T) {
	plaintext := "unencrypted"
	// Encrypt without a key should return an error.
	_, err := crypto.Encrypt(nil, plaintext)
	if err == nil {
		t.Error("crypto.Encrypt without key should return error")
	}

	// Decrypt without a key should also return an error.
	_, err = crypto.Decrypt(nil, "somedata")
	if err == nil {
		t.Error("crypto.Decrypt without key should return error")
	}
}
