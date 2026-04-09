package handlers

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// MessengerValidator validates messenger data
type MessengerValidator struct {
	MaxMessageLength      int
	MaxConversationMembers int
}

// NewMessengerValidator creates a new validator with default limits
func NewMessengerValidator() *MessengerValidator {
	return &MessengerValidator{
		MaxMessageLength:      10000, // 10KB max message
		MaxConversationMembers: 2,     // Direct chats only for now
	}
}

// ValidateMessageData validates message data before insertion
func (v *MessengerValidator) ValidateMessageData(data map[string]interface{}) error {
	// Check required fields
	conversationID, ok := data["conversation_id"].(string)
	if !ok || conversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}

	senderUserID, ok := data["sender_user_id"].(string)
	if !ok || senderUserID == "" {
		return fmt.Errorf("sender_user_id is required")
	}

	ciphertext, ok := data["ciphertext"].(string)
	if !ok || ciphertext == "" {
		return fmt.Errorf("ciphertext is required")
	}

	// For bot messages (BOT_PLAINTEXT:), nonce can be null
	isBotMessage := strings.HasPrefix(ciphertext, "BOT_PLAINTEXT:")
	nonce, ok := data["nonce"].(string)
	if !isBotMessage && (!ok || nonce == "") {
		return fmt.Errorf("nonce is required")
	}

	senderPublicKey, ok := data["sender_public_key"].(string)
	if !ok || senderPublicKey == "" {
		return fmt.Errorf("sender_public_key is required")
	}

	recipientPublicKey, ok := data["recipient_public_key"].(string)
	if !ok || recipientPublicKey == "" {
		return fmt.Errorf("recipient_public_key is required")
	}

	clientMessageID, ok := data["client_message_id"].(string)
	if !ok || clientMessageID == "" {
		return fmt.Errorf("client_message_id is required")
	}

	// Validate UUIDs format (basic check)
	if !isValidUUIDFormat(conversationID) {
		return fmt.Errorf("invalid conversation_id format")
	}
	if !isValidUUIDFormat(senderUserID) {
		return fmt.Errorf("invalid sender_user_id format")
	}

	// Validate ciphertext length (base64 encoded, so actual message is ~75% of this)
	if len(ciphertext) > v.MaxMessageLength {
		return fmt.Errorf("message too long: max %d characters", v.MaxMessageLength)
	}

	// Validate base64 format for encrypted data
	if !isBotMessage && !isValidBase64(ciphertext) {
		return fmt.Errorf("invalid ciphertext format: must be base64")
	}
	if !isBotMessage && !isValidBase64(nonce) {
		return fmt.Errorf("invalid nonce format: must be base64")
	}
	if !isValidBase64(senderPublicKey) {
		return fmt.Errorf("invalid sender_public_key format: must be base64")
	}
	if !isValidBase64(recipientPublicKey) {
		return fmt.Errorf("invalid recipient_public_key format: must be base64")
	}

	// Validate client_message_id format (should be UUID-like)
	if len(clientMessageID) > 100 {
		return fmt.Errorf("client_message_id too long")
	}

	return nil
}

// ValidateConversationID validates conversation ID
func (v *MessengerValidator) ValidateConversationID(conversationID string) error {
	if conversationID == "" {
		return fmt.Errorf("conversation_id is required")
	}
	if !isValidUUIDFormat(conversationID) {
		return fmt.Errorf("invalid conversation_id format")
	}
	return nil
}

// ValidateMessageID validates message ID
func (v *MessengerValidator) ValidateMessageID(messageID string) error {
	if messageID == "" {
		return fmt.Errorf("message_id is required")
	}
	if !isValidUUIDFormat(messageID) {
		return fmt.Errorf("invalid message_id format")
	}
	return nil
}

// ValidateUserID validates user ID
func (v *MessengerValidator) ValidateUserID(userID string) error {
	if userID == "" {
		return fmt.Errorf("user_id is required")
	}
	if !isValidUUIDFormat(userID) {
		return fmt.Errorf("invalid user_id format")
	}
	return nil
}

// isValidUUIDFormat checks if string looks like a UUID
func isValidUUIDFormat(s string) bool {
	if len(s) != 36 {
		return false
	}
	// Basic UUID format check: 8-4-4-4-12
	if s[8] != '-' || s[13] != '-' || s[18] != '-' || s[23] != '-' {
		return false
	}
	return true
}

// isValidBase64 checks if string is valid base64
func isValidBase64(s string) bool {
	if s == "" {
		return false
	}
	// Base64 characters: A-Z, a-z, 0-9, +, /, =
	for _, c := range s {
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
			(c >= '0' && c <= '9') || c == '+' || c == '/' || c == '=') {
			return false
		}
	}
	return true
}

// SanitizeString removes potentially dangerous characters
func SanitizeString(s string) string {
	// Remove null bytes
	s = strings.ReplaceAll(s, "\x00", "")

	// Ensure valid UTF-8
	if !utf8.ValidString(s) {
		// Convert to valid UTF-8
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

// ValidatePublicKey validates a public key format
func (v *MessengerValidator) ValidatePublicKey(publicKey string) error {
	if publicKey == "" {
		return fmt.Errorf("public_key is required")
	}

	// libsodium public keys are 32 bytes, base64 encoded = 44 characters
	if len(publicKey) != 44 {
		return fmt.Errorf("invalid public_key length: expected 44 characters")
	}

	if !isValidBase64(publicKey) {
		return fmt.Errorf("invalid public_key format: must be base64")
	}

	return nil
}
