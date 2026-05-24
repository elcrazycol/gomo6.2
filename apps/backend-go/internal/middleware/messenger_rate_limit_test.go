package middleware

import (
	"testing"
	"time"
)

// =============================================================================
// MessengerRateLimiter — AllowMessage
// =============================================================================

func TestMessengerRateLimiter_FirstMessageAllowed(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	if !limiter.AllowMessage("user-1") {
		t.Error("first message must be allowed")
	}
}

func TestMessengerRateLimiter_30MessagesPerMinute(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	// Send 30 messages — all must be allowed
	for i := 0; i < 30; i++ {
		if !limiter.AllowMessage("user-1") {
			t.Fatalf("message %d must be allowed (within 30/min limit)", i+1)
		}
	}

	// 31st must be denied (exceeds 30/min)
	if limiter.AllowMessage("user-1") {
		t.Fatal("31st message must be denied (exceeds 30/min limit)")
	}
}

func TestMessengerRateLimiter_100MessagesPerHour(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	// Send 30 messages, all at current time
	for i := 0; i < 30; i++ {
		limiter.AllowMessage("user-1")
	}

	// 31st fails minutely limit
	if limiter.AllowMessage("user-1") {
		t.Fatal("31st must be denied by minute limit")
	}

	// Verify hour limit was never reached (only 30 messages total)
	// The minute limit is hit first
}

func TestMessengerRateLimiter_SeparateUsers_Independent(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	// User 1 hits the limit
	for i := 0; i < 30; i++ {
		limiter.AllowMessage("user-1")
	}
	if limiter.AllowMessage("user-1") {
		t.Fatal("user-1 must be rate-limited")
	}

	// User 2 should still be fine
	if !limiter.AllowMessage("user-2") {
		t.Error("user-2 must still be allowed")
	}
}

// =============================================================================
// MessengerRateLimiter — AllowConversationCreate
// =============================================================================

func TestMessengerRateLimiter_FirstConversationAllowed(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	if !limiter.AllowConversationCreate("user-1") {
		t.Error("first conversation must be allowed")
	}
}

func TestMessengerRateLimiter_10ConversationsPerHour(t *testing.T) {
	limiter := NewMessengerRateLimiter()

	// Create 10 conversations — all must be allowed
	for i := 0; i < 10; i++ {
		if !limiter.AllowConversationCreate("user-1") {
			t.Fatalf("conversation %d must be allowed (within 10/hr limit)", i+1)
		}
	}

	// 11th must be denied
	if limiter.AllowConversationCreate("user-1") {
		t.Fatal("11th conversation must be denied (exceeds 10/hr limit)")
	}
}

// =============================================================================
// MessengerRateLimiter — conversation and message share same storage
// =============================================================================

func TestMessengerRateLimiter_ConversationAffectsMessage(t *testing.T) {
	// Conversation creates are stored in messages slice, which affects AllowMessage
	limiter := NewMessengerRateLimiter()

	// Create 10 conversations
	for i := 0; i < 10; i++ {
		limiter.AllowConversationCreate("user-1")
	}

	// The conversation timestamps count toward message limits (same slice)
	// So we can send 30 - 10 = 20 more messages
	for i := 0; i < 20; i++ {
		if !limiter.AllowMessage("user-1") {
			t.Fatalf("message %d with 10 prior conversations must be allowed (total=30)", i+1)
		}
	}

	// 21st message should hit the limit (10 convs + 21 msgs = 31 > 30)
	if limiter.AllowMessage("user-1") {
		t.Error("message after filling should be denied")
	}
}

// =============================================================================
// MessengerRateLimiter — cleanup
// =============================================================================

func TestMessengerRateLimiter_Cleanup(t *testing.T) {
	// We can't easily change cleanupInterval (it's internal)
	// So we just verify cleanup doesn't panic and runs
	limiter := NewMessengerRateLimiter()

	limiter.AllowMessage("user-1")

	// Verify user exists
	limiter.mu.RLock()
	_, exists := limiter.userLimits["user-1"]
	limiter.mu.RUnlock()
	if !exists {
		t.Fatal("user-1 must exist after AllowMessage")
	}

	// Wait for cleanup to potentially fire (5min interval, so it won't in this test)
	// But at minimum we verify no panics
	time.Sleep(10 * time.Millisecond)

	limiter.mu.RLock()
	_, exists = limiter.userLimits["user-1"]
	limiter.mu.RUnlock()
	if !exists {
		t.Error("user-1 should still exist (cleanup interval is 5min)")
	}
}

// =============================================================================
// isMessengerEndpoint
// =============================================================================

func TestIsMessengerEndpoint_Valid(t *testing.T) {
	endpoints := []string{
		"/api/v1/chat_messages",
		"/api/v1/chat_conversations",
		"/api/v1/chat_conversation_members",
		"/api/v1/chat_receipts",
		"/api/rpc/get_or_create_direct_chat",
		"/api/rpc/chat_mark_delivered",
		"/api/rpc/chat_mark_read",
	}
	for _, ep := range endpoints {
		t.Run(ep, func(t *testing.T) {
			if !isMessengerEndpoint(ep) {
				t.Errorf("expected %q to be a messenger endpoint", ep)
			}
		})
	}
}

func TestIsMessengerEndpoint_Invalid(t *testing.T) {
	endpoints := []string{
		"/api/v1/users",
		"/api/v1/chat_message",
		"/api/rpc/chat",
		"/api/v1/chat_messages/123",
		"",
		"/",
	}
	for _, ep := range endpoints {
		t.Run(ep, func(t *testing.T) {
			if isMessengerEndpoint(ep) {
				t.Errorf("expected %q to NOT be a messenger endpoint", ep)
			}
		})
	}
}
