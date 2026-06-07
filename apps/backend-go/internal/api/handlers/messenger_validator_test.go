package handlers

import (
	"testing"
)

func TestNewMessengerValidator_Defaults(t *testing.T) {
	v := NewMessengerValidator()
	if v.MaxMessageLength != 10000 {
		t.Fatalf("expected MaxMessageLength 10000, got %d", v.MaxMessageLength)
	}
}

func TestValidateMessageData_Valid(t *testing.T) {
	v := NewMessengerValidator()
	data := map[string]interface{}{
		"conversation_id":   "550e8400-e29b-41d4-a716-446655440000",
		"sender_user_id":    "660e8400-e29b-41d4-a716-446655440001",
		"client_message_id": "770e8400-e29b-41d4-a716-446655440002",
	}

	err := v.ValidateMessageData(data)
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestValidateMessageData_MissingFields(t *testing.T) {
	v := NewMessengerValidator()

	tests := []struct {
		name string
		data map[string]interface{}
	}{
		{"empty data", map[string]interface{}{}},
		{"missing conversation_id", map[string]interface{}{
			"sender_user_id":    "660e8400-e29b-41d4-a716-446655440001",
			"client_message_id": "c2lk"},
		},
		{"missing sender_user_id", map[string]interface{}{
			"conversation_id":   "550e8400-e29b-41d4-a716-446655440000",
			"client_message_id": "c2lk"},
		},
		{"missing client_message_id", map[string]interface{}{
			"conversation_id": "550e8400-e29b-41d4-a716-446655440000",
			"sender_user_id":  "660e8400-e29b-41d4-a716-446655440001"},
		},
		{"empty conversation_id", map[string]interface{}{
			"conversation_id": "", "sender_user_id": "660e8400-e29b-41d4-a716-446655440001",
			"client_message_id": "c2lk"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.ValidateMessageData(tt.data)
			if err == nil {
				t.Fatalf("expected error for %q, got nil", tt.name)
			}
		})
	}
}

func TestValidateMessageData_InvalidUUID(t *testing.T) {
	v := NewMessengerValidator()
	data := map[string]interface{}{
		"conversation_id":   "not-a-uuid-at-all",
		"sender_user_id":    "660e8400-e29b-41d4-a716-446655440001",
		"client_message_id": "c2lk",
	}

	err := v.ValidateMessageData(data)
	if err == nil {
		t.Fatal("expected error for invalid conversation_id UUID format")
	}
}

func TestValidateMessageData_ClientMessageIDTooLong(t *testing.T) {
	v := NewMessengerValidator()
	longID := make([]byte, 101)
	for i := range longID {
		longID[i] = 'x'
	}

	data := map[string]interface{}{
		"conversation_id":   "550e8400-e29b-41d4-a716-446655440000",
		"sender_user_id":    "660e8400-e29b-41d4-a716-446655440001",
		"client_message_id": string(longID),
	}

	err := v.ValidateMessageData(data)
	if err == nil {
		t.Fatal("expected error for too long client_message_id")
	}
}

// ─── ValidateConversationID ──────────────────────────────────────────────────

func TestValidateConversationID_Valid(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateConversationID("550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestValidateConversationID_Empty(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateConversationID("")
	if err == nil {
		t.Fatal("expected error for empty conversation_id")
	}
}

func TestValidateConversationID_InvalidFormat(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateConversationID("not-a-uuid")
	if err == nil {
		t.Fatal("expected error for invalid conversation_id format")
	}
}

// ─── ValidateMessageID ───────────────────────────────────────────────────────

func TestValidateMessageID_Valid(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateMessageID("550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestValidateMessageID_Empty(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateMessageID("")
	if err == nil {
		t.Fatal("expected error for empty message_id")
	}
}

// ─── ValidateUserID ──────────────────────────────────────────────────────────

func TestValidateUserID_Valid(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateUserID("660e8400-e29b-41d4-a716-446655440001")
	if err != nil {
		t.Fatalf("expected no error, got: %v", err)
	}
}

func TestValidateUserID_Empty(t *testing.T) {
	v := NewMessengerValidator()
	err := v.ValidateUserID("")
	if err == nil {
		t.Fatal("expected error for empty user_id")
	}
}

// ─── SanitizeString ──────────────────────────────────────────────────────────

func TestSanitizeString_NormalString(t *testing.T) {
	result := SanitizeString("hello world")
	if result != "hello world" {
		t.Fatalf("expected 'hello world', got %q", result)
	}
}

func TestSanitizeString_NullBytes(t *testing.T) {
	input := "hello\x00world\x00"
	result := SanitizeString(input)
	if result != "helloworld" {
		t.Fatalf("expected 'helloworld', got %q", result)
	}
}

func TestSanitizeString_ValidUTF8(t *testing.T) {
	input := "Привет мир 🌍"
	result := SanitizeString(input)
	if result != input {
		t.Fatalf("expected %q, got %q", input, result)
	}
}

func TestSanitizeString_Empty(t *testing.T) {
	result := SanitizeString("")
	if result != "" {
		t.Fatalf("expected empty string, got %q", result)
	}
}

func TestSanitizeString_InvalidUTF8(t *testing.T) {
	// 0xFF is invalid UTF-8, should be stripped by the utf8.RuneError filter
	input := "hello\xffworld"
	result := SanitizeString(input)
	if result != "helloworld" {
		t.Fatalf("expected 'helloworld', got %q", result)
	}
}

// ─── isValidUUIDFormat (tested indirectly via public Validate* methods) ───────

func TestIsValidUUIDFormat_ThroughValidateConversationID(t *testing.T) {
	v := NewMessengerValidator()

	tests := []struct {
		name  string
		uuid  string
		valid bool
	}{
		{"valid UUID", "550e8400-e29b-41d4-a716-446655440000", true},
		{"too short", "550e8400", false},
		{"too long", "550e8400-e29b-41d4-a716-446655440000-extra", false},
		{"missing dashes", "550e8400e29b41d4a716446655440000", false},
		{"empty string", "", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := v.ValidateConversationID(tt.uuid)
			if tt.valid && err != nil {
				t.Fatalf("expected valid, got error: %v", err)
			}
			if !tt.valid && err == nil {
				t.Fatalf("expected invalid, got nil error")
			}
		})
	}
}
