package websocket

import (
	"encoding/json"
	"testing"

	"github.com/gomo6/backend/internal/crypto"
)

// setTestEncryptionKey ensures crypto has a master key for tests that exercise
// decryption. The first crypto call in the package wins (sync.Once), so this
// must run before any other crypto-touching test.
func setTestEncryptionKey(t *testing.T) {
	t.Helper()
	t.Setenv("MESSENGER_ENCRYPTION_KEY", "0123456789abcdef0123456789abcdef")
	crypto.GetMasterKey() // force Init now so subsequent calls reuse the key
}

func TestDecryptChatPayloadForBroadcast_Success(t *testing.T) {
	setTestEncryptionKey(t)

	convID := "10000000-0000-0000-0000-000000000001"
	plaintext := "hello world"
	enc, err := crypto.EncryptForConversation(convID, plaintext)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	payload := map[string]interface{}{
		"id":                "msg-1",
		"conversation_id":   convID,
		"encrypted_content": enc,
	}
	message := Message{Type: "new_chat_message", Timestamp: 1}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}

	out := decryptChatPayloadForBroadcast(payload, message, messageBytes, MessageTypeNewChatMessage)

	var received Message
	if err := json.Unmarshal(out, &received); err != nil {
		t.Fatalf("unmarshal broadcast: %v", err)
	}
	var data map[string]interface{}
	if err := json.Unmarshal(received.Data, &data); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if data["content"] != plaintext {
		t.Errorf("expected content %q, got %v", plaintext, data["content"])
	}
	if _, ok := data["encrypted_content"]; ok {
		t.Error("encrypted_content must be removed from the broadcast payload")
	}
}

func TestDecryptChatPayloadForBroadcast_DecryptionFailureNoCiphertextLeak(t *testing.T) {
	setTestEncryptionKey(t)

	// Not valid base64 → both decrypt attempts fail.
	badCiphertext := "not-a-valid-ciphertext!!"
	payload := map[string]interface{}{
		"id":                "msg-1",
		"conversation_id":   "10000000-0000-0000-0000-000000000001",
		"encrypted_content": badCiphertext,
	}
	message := Message{Type: "new_chat_message", Timestamp: 1}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}

	out := decryptChatPayloadForBroadcast(payload, message, messageBytes, MessageTypeNewChatMessage)

	var received Message
	if err := json.Unmarshal(out, &received); err != nil {
		t.Fatalf("unmarshal broadcast: %v", err)
	}
	var data map[string]interface{}
	if err := json.Unmarshal(received.Data, &data); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if data["content"] == badCiphertext {
		t.Fatal("ciphertext must never be forwarded to clients")
	}
	if data["content"] != crypto.DecryptionFailedPlaceholder {
		t.Errorf("expected placeholder %q, got %v", crypto.DecryptionFailedPlaceholder, data["content"])
	}
	if _, ok := data["encrypted_content"]; ok {
		t.Error("encrypted_content must be removed even when decryption fails")
	}
}

func TestDecryptChatPayloadForBroadcast_EmptyContentPassthrough(t *testing.T) {
	payload := map[string]interface{}{
		"id":                "msg-1",
		"conversation_id":   "10000000-0000-0000-0000-000000000001",
		"encrypted_content": "",
	}
	message := Message{Type: "new_chat_message", Timestamp: 1}
	messageBytes, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal message: %v", err)
	}

	out := decryptChatPayloadForBroadcast(payload, message, messageBytes, MessageTypeNewChatMessage)
	if string(out) != string(messageBytes) {
		t.Error("payload without encrypted_content should pass through unchanged")
	}
}
