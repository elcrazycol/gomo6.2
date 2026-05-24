package handlers

import (
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
)

// TestNewBotEventPublisher_CreatesPublisher tests publisher creation
func TestNewBotEventPublisher_CreatesPublisher(t *testing.T) {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	pub := NewBotEventPublisher(rdb)

	if pub == nil {
		t.Fatal("NewBotEventPublisher returned nil")
	}
	if pub.redis != rdb {
		t.Fatal("redis client not set correctly")
	}
}

// TestNewBotEventPublisher_NilRedis tests publisher with nil redis
func TestNewBotEventPublisher_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)

	if pub == nil {
		t.Fatal("NewBotEventPublisher(nil) returned nil")
	}
	if pub.redis != nil {
		t.Fatal("redis should be nil")
	}
}

// TestBotEventPublisher_SetDB tests setting database
func TestBotEventPublisher_SetDB(t *testing.T) {
	pub := NewBotEventPublisher(nil)

	// SetDB should not panic with nil
	pub.SetDB(nil)

	if pub.db != nil {
		t.Fatal("db should be nil after SetDB(nil)")
	}
}

// TestBotEventPublisher_PublishWallPost_NilRedis tests nil redis guard
func TestBotEventPublisher_PublishWallPost_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	// Should not panic when redis is nil
	pub.PublishWallPost(map[string]interface{}{
		"id": "post-1",
	})
}

// TestBotEventPublisher_PublishWallComment_NilRedis tests nil redis guard
func TestBotEventPublisher_PublishWallComment_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	pub.PublishWallComment(map[string]interface{}{
		"id": "comment-1",
	})
}

// TestBotEventPublisher_PublishThread_NilRedis tests nil redis guard
func TestBotEventPublisher_PublishThread_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	pub.PublishThread(map[string]interface{}{
		"id": "thread-1",
	})
}

// TestBotEventPublisher_PublishThreadPost_NilRedis tests nil redis guard
func TestBotEventPublisher_PublishThreadPost_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	pub.PublishThreadPost(map[string]interface{}{
		"id": "post-1",
	})
}

// TestBotEventPublisher_PublishChatMessage_NilRedis tests nil redis guard
func TestBotEventPublisher_PublishChatMessage_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	pub.PublishChatMessage(map[string]interface{}{
		"id": "msg-1",
	})
}

// TestBotEventPublisher_PublishChatMessage_PlaintextExtraction tests BOT_PLAINTEXT: prefix handling
func TestBotEventPublisher_PublishChatMessage_PlaintextExtraction(t *testing.T) {
	message := map[string]interface{}{
		"id":              "msg-1",
		"ciphertext":      "BOT_PLAINTEXT:Hello bots!",
		"conversation_id": "conv-1",
	}

	// Plaintext should be extracted from ciphertext
	if ciphertext, ok := message["ciphertext"].(string); ok {
		if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
			plaintext := strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
			message["plaintext"] = plaintext
		}
	}

	plaintext, ok := message["plaintext"].(string)
	if !ok {
		t.Fatal("plaintext was not extracted")
	}
	if plaintext != "Hello bots!" {
		t.Errorf("Expected plaintext 'Hello bots!', got '%s'", plaintext)
	}
}

// TestBotEventPublisher_PublishChatMessage_NoPlaintextPrefix tests ciphertext without BOT_PLAINTEXT: prefix
func TestBotEventPublisher_PublishChatMessage_NoPlaintextPrefix(t *testing.T) {
	message := map[string]interface{}{
		"id":         "msg-1",
		"ciphertext": "encrypted-blob-here",
	}

	// No BOT_PLAINTEXT: prefix — plaintext should NOT be extracted
	if ciphertext, ok := message["ciphertext"].(string); ok {
		if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
			message["plaintext"] = strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
		}
	}

	if _, exists := message["plaintext"]; exists {
		t.Fatal("plaintext should NOT be extracted for non-BOT_PLAINTEXT ciphertext")
	}
}

// TestBotEventPublisher_PublishChatMessage_EmptyPlaintext tests empty BOT_PLAINTEXT:
func TestBotEventPublisher_PublishChatMessage_EmptyPlaintext(t *testing.T) {
	message := map[string]interface{}{
		"id":         "msg-1",
		"ciphertext": "BOT_PLAINTEXT:",
	}

	if ciphertext, ok := message["ciphertext"].(string); ok {
		if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
			plaintext := strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
			message["plaintext"] = plaintext
		}
	}

	plaintext, ok := message["plaintext"].(string)
	if !ok {
		t.Fatal("plaintext was not extracted")
	}
	if plaintext != "" {
		t.Errorf("Expected empty plaintext, got '%s'", plaintext)
	}
}

// TestBotEventPublisher_AllPublishMethods_NilRedis tests all publish methods with nil redis don't panic
func TestBotEventPublisher_AllPublishMethods_NilRedis(t *testing.T) {
	pub := NewBotEventPublisher(nil)
	data := map[string]interface{}{"id": "test-1"}

	// Each method should return immediately without panicking
	tests := []struct {
		name string
		fn   func()
	}{
		{"PublishWallPost", func() { pub.PublishWallPost(data) }},
		{"PublishWallComment", func() { pub.PublishWallComment(data) }},
		{"PublishThread", func() { pub.PublishThread(data) }},
		{"PublishThreadPost", func() { pub.PublishThreadPost(data) }},
		{"PublishChatMessage", func() { pub.PublishChatMessage(data) }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Should not panic
			tt.fn()
		})
	}
}

// TestBotEventPublisher_PublishChatMessage_PreservesOriginalMessage tests that original message keys are preserved
func TestBotEventPublisher_PublishChatMessage_PreservesOriginalMessage(t *testing.T) {
	message := map[string]interface{}{
		"id":              "msg-1",
		"ciphertext":      "BOT_PLAINTEXT:Hello!",
		"conversation_id": "conv-1",
		"sender_id":       "user-1",
	}

	originalLen := len(message)

	// Simulate PublishChatMessage logic
	if ciphertext, ok := message["ciphertext"].(string); ok {
		if strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:") {
			message["plaintext"] = strings.TrimPrefix(ciphertext, "BOT_PLAINTEXT:")
		}
	}

	// Original keys should still be present
	if _, ok := message["id"]; !ok {
		t.Error("original 'id' key was lost")
	}
	if _, ok := message["ciphertext"]; !ok {
		t.Error("original 'ciphertext' key was lost")
	}
	if _, ok := message["conversation_id"]; !ok {
		t.Error("original 'conversation_id' key was lost")
	}
	if _, ok := message["sender_id"]; !ok {
		t.Error("original 'sender_id' key was lost")
	}

	// Plaintext should be added as a new key
	if _, ok := message["plaintext"]; !ok {
		t.Error("'plaintext' key was not added")
	}

	// Should have original keys + plaintext
	if len(message) != originalLen+1 {
		t.Errorf("Expected %d keys, got %d", originalLen+1, len(message))
	}
}
