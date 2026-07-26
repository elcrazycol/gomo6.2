package handlers

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
)

// ─── AES-256-GCM field-level encryption for messenger content ──────────────
// Protects against DB dumps, backups, and SQL injection data exposure.
// NOT E2EE — server holds the key. For true E2EE, client-side key exchange is needed.
//
// Key is derived per-conversation via HKDF (Phase 7) from the master key,
// providing isolation: compromise of one conversation key doesn't expose others.

var messengerEncryptionKey []byte

func init() {
	loadEncryptionKey()
}

// loadEncryptionKey loads the encryption key from environment.
// Called from init() and can be called again in tests.
func loadEncryptionKey() {
	key := os.Getenv("MESSENGER_ENCRYPTION_KEY")
	if key == "" {
		key = os.Getenv("ENCRYPTION_KEY") // fallback
	}
	if key == "" {
		log.Printf("[Messenger] WARNING: MESSENGER_ENCRYPTION_KEY not set — encryption disabled")
		return
	}
	k := []byte(key)
	if len(k) != 32 {
		log.Fatalf("[Messenger] FATAL: MESSENGER_ENCRYPTION_KEY must be exactly 32 bytes, got %d. Generate with: openssl rand -hex 32", len(k))
	}
	messengerEncryptionKey = k
}

// encryptContent encrypts plaintext using AES-256-GCM with the master key.
func encryptContent(plaintext string) (string, error) {
	return encryptWithKey(messengerEncryptionKey, plaintext)
}

// encryptContentForConversation encrypts plaintext using a per-conversation key
// derived via HKDF from the master key + conversation ID.
func encryptContentForConversation(conversationID, plaintext string) (string, error) {
	key := deriveConversationKey(conversationID)
	return encryptWithKey(key, plaintext)
}

func encryptWithKey(key []byte, plaintext string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", fmt.Errorf("nonce gen: %w", err)
	}

	ciphertext := aesGCM.Seal(nonce, nonce, []byte(plaintext), nil)
	return base64.RawStdEncoding.EncodeToString(ciphertext), nil
}

// decryptContent decrypts AES-256-GCM encrypted content using the master key.
func decryptContent(encoded string) (string, error) {
	return decryptWithKey(messengerEncryptionKey, encoded)
}

// decryptContentForConversation decrypts using a per-conversation key.
func decryptContentForConversation(conversationID, encoded string) (string, error) {
	key := deriveConversationKey(conversationID)
	return decryptWithKey(key, encoded)
}

func decryptWithKey(key []byte, encoded string) (string, error) {
	if encoded == "" {
		return "", nil
	}

	ciphertext, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", fmt.Errorf("not encrypted (base64 decode failed)")
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("cipher init: %w", err)
	}

	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("GCM init: %w", err)
	}

	nonceSize := aesGCM.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short (%d bytes)", len(ciphertext))
	}

	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := aesGCM.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		log.Printf("[Messenger] decrypt failed (content_id redacted)")
		return "", fmt.Errorf("decryption failed")
	}

	return string(plaintext), nil
}

// marshalCiphertexts converts CiphertextEntries to JSON for storage
func marshalCiphertexts(entries []CiphertextEntry) (string, error) {
	b, err := json.Marshal(entries)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalCiphertexts parses stored ciphertexts JSON
func unmarshalCiphertexts(raw string) ([]CiphertextEntry, error) {
	if raw == "" {
		return nil, nil
	}
	var entries []CiphertextEntry
	if err := json.Unmarshal([]byte(raw), &entries); err != nil {
		return nil, err
	}
	return entries, nil
}

// ─── Per-conversation key derivation ───────────────────────────────────────

// deriveConversationKey derives a unique 32-byte AES key for a conversation
// using HMAC-SHA256 based key derivation from the master key + conversation ID.
// This ensures that compromise of one conversation's key doesn't expose others.
func deriveConversationKey(conversationID string) []byte {
	// Use counter-based derivation similar to HKDF-Expand:
	// key = HMAC-SHA256(master_key, "gomo6-messenger-v1" || conversation_id || counter)
	mac := hmac.New(sha256.New, messengerEncryptionKey)
	mac.Write([]byte("gomo6-messenger-v1"))
	mac.Write([]byte(conversationID))
	mac.Write([]byte{0x01}) // counter byte
	return mac.Sum(nil)
}

// ─── HMAC integrity verification ───────────────────────────────────────────

// computeHMAC computes HMAC-SHA256 over plaintext using the master key.
func computeHMAC(plaintext string) string {
	mac := hmac.New(sha256.New, messengerEncryptionKey)
	mac.Write([]byte(plaintext))
	return hex.EncodeToString(mac.Sum(nil))
}

// verifyHMAC checks if the HMAC matches the plaintext.
func verifyHMAC(plaintext, expectedHMAC string) bool {
	return computeHMAC(plaintext) == expectedHMAC
}

// ─── Byte-level encryption (for attachments) ───────────────────────────────

// encryptBytes encrypts raw bytes using AES-256-GCM with the master key.
func encryptBytes(plaintext []byte) ([]byte, error) {
	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("cipher init: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("GCM init: %w", err)
	}
	nonce := make([]byte, aesGCM.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("nonce gen: %w", err)
	}
	return aesGCM.Seal(nonce, nonce, plaintext, nil), nil
}

// decryptBytes decrypts raw bytes using AES-256-GCM with the master key.
func decryptBytes(data []byte) ([]byte, error) {
	if messengerEncryptionKey == nil || len(data) == 0 {
		return data, nil
	}
	block, err := aes.NewCipher(messengerEncryptionKey)
	if err != nil {
		return nil, fmt.Errorf("cipher init: %w", err)
	}
	aesGCM, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("GCM init: %w", err)
	}
	nonceSize := aesGCM.NonceSize()
	if len(data) < nonceSize {
		return nil, fmt.Errorf("ciphertext too short (%d bytes)", len(data))
	}
	nonce, ciphertext := data[:nonceSize], data[nonceSize:]
	return aesGCM.Open(nil, nonce, ciphertext, nil)
}

// ─── Key rotation infrastructure ───────────────────────────────────────────

// Previous encryption keys (indexed by version number).
// Used during key rotation to decrypt messages encrypted with older keys.
var (
	previousKeys    = make(map[int][]byte)
	currentKeyVersion = 1
)

// RotateMasterKey moves the current key to previousKeys and sets a new key.
// Returns the old key version for logging/audit.
func RotateMasterKey(newKeyHex string) (int, error) {
	newKey, err := hex.DecodeString(newKeyHex)
	if err != nil {
		return 0, fmt.Errorf("invalid hex key: %w", err)
	}
	if len(newKey) != 32 {
		return 0, fmt.Errorf("key must be 32 bytes, got %d", len(newKey))
	}

	oldVersion := currentKeyVersion
	previousKeys[oldVersion] = messengerEncryptionKey
	currentKeyVersion++
	messengerEncryptionKey = newKey

	log.Printf("[Messenger] Key rotated: version %d → %d", oldVersion, currentKeyVersion)
	return oldVersion, nil
}

// getKeyForVersion returns the encryption key for a given version.
func getKeyForVersion(version int) []byte {
	if version == currentKeyVersion {
		return messengerEncryptionKey
	}
	if key, ok := previousKeys[version]; ok {
		return key
	}
	return messengerEncryptionKey // fallback to current
}
