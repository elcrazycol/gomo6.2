package handlers

import (
	"strings"
	"testing"

	"github.com/gomo6/backend/internal/notifications"
)

// messagePushBody truncates long messages and falls back to sensible placeholders
// for attachment-only or empty sends. The URL is always /messages so the push
// opens the messenger.

func TestMessagePushBody_Plain(t *testing.T) {
	if got := messagePushBody("Hello, world!", false); got != "Hello, world!" {
		t.Fatalf("expected plain body, got %q", got)
	}
}

func TestMessagePushBody_Truncates(t *testing.T) {
	long := strings.Repeat("а", 300)
	got := messagePushBody(long, false)
	if len([]rune(got)) > 141 {
		t.Fatalf("expected truncated body <=141 runes, got %d", len([]rune(got)))
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("expected truncation ellipsis, got %q", got)
	}
}

func TestMessagePushBody_AttachmentOnly(t *testing.T) {
	if got := messagePushBody("", true); got != "📎 Вложение" {
		t.Fatalf("expected attachment placeholder, got %q", got)
	}
}

func TestMessagePushBody_EmptyGeneric(t *testing.T) {
	if got := messagePushBody("", false); got != "Новое сообщение" {
		t.Fatalf("expected generic fallback, got %q", got)
	}
}

func TestMessagePushBody_TrimsWhitespace(t *testing.T) {
	if got := messagePushBody("   \n\t hi ", false); got != "hi" {
		t.Fatalf("expected trimmed body, got %q", got)
	}
}

// deliverMessagePush is a no-op when the push service is disabled — it must not
// query the DB (raises an unexpected-query error under sqlmock) nor panic.
func TestDeliverMessagePush_DisabledServiceNoop(t *testing.T) {
	prev := notifications.PushService
	notifications.PushService = nil // simulate VAPID keys not configured
	defer func() { notifications.PushService = prev }()

	h, mock := setupMessengerHandler(t)
	h.deliverMessagePush(t.Context(), testConv1, testUser1, "bob", "hi")

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("disabled push must not touch the DB: %v", err)
	}
}
