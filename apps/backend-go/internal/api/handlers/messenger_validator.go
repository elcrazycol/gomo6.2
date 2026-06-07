package handlers

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// MessengerValidator provides basic validation for messenger data.
type MessengerValidator struct {
	MaxMessageLength int
}

// NewMessengerValidator creates a new validator with default limits.
func NewMessengerValidator() *MessengerValidator {
	return &MessengerValidator{
		MaxMessageLength: 10000,
	}
}

// ValidateMessageData validates basic message fields.
func (v *MessengerValidator) ValidateMessageData(data map[string]interface{}) error {
	conversationID, ok := data["conversation_id"].(string)
	if !ok || conversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}

	senderUserID, ok := data["sender_user_id"].(string)
	if !ok || senderUserID == "" {
		return fmt.Errorf("sender_user_id is required")
	}

	clientMessageID, ok := data["client_message_id"].(string)
	if !ok || clientMessageID == "" {
		return fmt.Errorf("client_message_id is required")
	}

	// Validate UUIDs format
	if !isValidUUIDFormat(conversationID) {
		return fmt.Errorf("invalid conversation_id format")
	}
	if !isValidUUIDFormat(senderUserID) {
		return fmt.Errorf("invalid sender_user_id format")
	}

	if len(clientMessageID) > 100 {
		return fmt.Errorf("client_message_id too long")
	}

	return nil
}

// ValidateConversationID validates conversation ID.
func (v *MessengerValidator) ValidateConversationID(conversationID string) error {
	if conversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}
	if !isValidUUIDFormat(conversationID) {
		return fmt.Errorf("invalid conversation_id format")
	}
	return nil
}

// ValidateMessageID validates message ID.
func (v *MessengerValidator) ValidateMessageID(messageID string) error {
	if messageID == "" {
		return fmt.Errorf("message_id is required")
	}
	if !isValidUUIDFormat(messageID) {
		return fmt.Errorf("invalid message_id format")
	}
	return nil
}

// ValidateUserID validates user ID.
func (v *MessengerValidator) ValidateUserID(userID string) error {
	if userID == "" {
		return fmt.Errorf("user_id is required")
	}
	if !isValidUUIDFormat(userID) {
		return fmt.Errorf("invalid user_id format")
	}
	return nil
}

// isValidUUIDFormat checks if string looks like a UUID.
func isValidUUIDFormat(s string) bool {
	if len(s) != 36 {
		return false
	}
	if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	return true
}

// SanitizeString removes potentially dangerous characters.
func SanitizeString(s string) string {
	s = strings.ReplaceAll(s, "\x00", "")
	if !utf8.ValidString(s) {
		v := make([]rune, 0, len(s))
		for _, r := range s {
			if r != utf8.RuneError {
				v = append(v, r)
			}
		}
		s = string(v)
	}
	return s
}
